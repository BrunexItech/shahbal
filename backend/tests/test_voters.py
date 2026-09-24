from sqlalchemy import select

from app.core.db import SessionLocal
from app.modules.audit.models import AuditLog
from app.modules.voters.models import Voter
from tests.conftest import elevate, make_user, voter_payload


async def test_login_rejects_bad_password(client):
    r = await client.post("/api/v1/auth/login", json={"email": "admin@campaign.co.ke", "password": "nope", "portal": "command"})
    assert r.status_code == 401


async def test_capture_normalises_encrypts_and_masks(client, admin, wards):
    r = await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=admin)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["phone"] == "+254712345678"
    assert body["full_name"] == "Amina Wanjiku"
    assert body["national_id_masked"] == "••••5678"
    assert body["reference"].startswith("MSA-")
    assert "national_id" not in body
    async with SessionLocal() as s:
        v = (await s.execute(select(Voter))).scalar_one()
        assert "12345678" not in v.national_id_enc and "12345678" != v.national_id_hash


async def test_duplicate_national_id_blocked_and_searchable(client, admin, wards):
    await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=admin)
    r = await client.post("/api/v1/voters", json=voter_payload(wards["Bamburi"], full_name="Someone Else"), headers=admin)
    assert r.status_code == 409
    dup = await client.get("/api/v1/voters/check-duplicate", params={"national_id": "12345678"}, headers=admin)
    assert dup.json()["exists"] is True
    found = await client.get("/api/v1/voters", params={"q": "12345678"}, headers=admin)
    assert found.json()["total"] == 1


async def test_consent_required(client, admin, wards):
    r = await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"], consent=False), headers=admin)
    assert r.status_code == 422


async def test_field_agent_confined_to_ward_and_own_records(client, admin, wards):
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    assert (await client.post("/api/v1/voters", json=voter_payload(wards["Bamburi"]), headers=agent)).status_code == 403
    assert (await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=agent)).status_code == 201
    await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"], national_id="87654321"), headers=admin)
    mine = (await client.get("/api/v1/voters", headers=agent)).json()
    assert mine["total"] == 1
    vid = mine["items"][0]["id"]
    assert (await client.post(f"/api/v1/voters/{vid}/verify", headers=agent)).status_code == 403


async def test_coordinator_sees_only_constituency(client, admin, wards):
    tudor, bamburi = wards["Tudor"], wards["Bamburi"]
    coord = await make_user(client, admin, "coordinator", constituency_id=tudor.constituency_id)
    await client.post("/api/v1/voters", json=voter_payload(tudor), headers=admin)
    await client.post("/api/v1/voters", json=voter_payload(bamburi, national_id="22223333"), headers=admin)
    assert (await client.get("/api/v1/voters", headers=coord)).json()["total"] == 1
    # cannot promote someone to coordinator (even after re-confirming identity)
    await elevate(client, coord, "Password!1")
    r = await client.post("/api/v1/users", headers=coord, json={
        "full_name": "Nope Nope", "email": "n@campaign.co.ke",
        "role": "coordinator", "constituency_id": tudor.constituency_id})
    assert r.status_code == 403


async def test_verify_reject_flow_is_audited(client, admin, wards):
    vid = (await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=admin)).json()["id"]
    assert (await client.post(f"/api/v1/voters/{vid}/reject", json={"reason": ""}, headers=admin)).status_code == 422
    r = await client.post(f"/api/v1/voters/{vid}/verify", headers=admin)
    assert r.json()["status"] == "verified" and r.json()["verified_by_name"] == "Test Admin"
    assert (await client.post(f"/api/v1/voters/{vid}/verify", headers=admin)).status_code == 409
    r = await client.post(f"/api/v1/voters/{vid}/reject", json={"reason": "Wrong number"}, headers=admin)
    assert r.json()["status"] == "rejected"
    async with SessionLocal() as s:
        actions = {a.action for a in (await s.execute(select(AuditLog).where(AuditLog.entity_id == vid))).scalars()}
    assert {"CREATE", "VERIFY", "REJECT"} <= actions


async def test_reveal_id_admin_only(client, admin, wards):
    vid = (await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=admin)).json()["id"]
    call = await make_user(client, admin, "call_agent", email="call@campaign.co.ke")
    assert (await client.post(f"/api/v1/voters/{vid}/reveal-id", headers=call)).status_code == 403
    assert (await client.post(f"/api/v1/voters/{vid}/reveal-id", headers=admin)).json()["national_id"] == "12345678"


async def test_moving_ward_clears_foreign_station(client, admin, wards):
    st = (await client.post("/api/v1/geo/stations", headers=admin, json={
        "code": "001001", "name": "Tudor Primary", "ward_id": wards["Tudor"].id})).json()
    vid = (await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"], station_id=st["id"]), headers=admin)).json()["id"]
    r = await client.patch(f"/api/v1/voters/{vid}", json={"ward_id": wards["Bamburi"].id}, headers=admin)
    assert r.status_code == 200 and r.json()["station_id"] is None
    bad = await client.post("/api/v1/voters", headers=admin,
                            json=voter_payload(wards["Bamburi"], national_id="99990000", station_id=st["id"]))
    assert bad.status_code == 422
