from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.modules.voters.models import Voter
from tests.conftest import make_user, voter_payload


async def _count():
    async with SessionLocal() as s:
        return (await s.execute(select(func.count(Voter.id)))).scalar_one()


async def test_portal_signup_does_not_leak_duplicates(client, wards):
    body = voter_payload(wards["Likoni"])
    first = await client.post("/api/v1/portal/signup", json=body)
    second = await client.post("/api/v1/portal/signup", json={**body, "full_name": "Other Person"})
    assert first.status_code == second.status_code == 202
    assert first.json() == second.json()
    assert await _count() == 1


async def test_portal_honeypot_and_consent(client, wards):
    await client.post("/api/v1/portal/signup", json={**voter_payload(wards["Likoni"]), "website": "spam"})
    assert await _count() == 0
    r = await client.post("/api/v1/portal/signup", json={**voter_payload(wards["Likoni"]), "consent": False})
    assert r.status_code == 422


async def test_portal_rate_limited(client, wards):
    codes = [
        (await client.post("/api/v1/portal/signup", json=voter_payload(wards["Likoni"], national_id=f"1000{i:04d}"))).status_code
        for i in range(11)
    ]
    assert codes[-1] == 429


async def test_portal_geo_public(client):
    tree = (await client.get("/api/v1/portal/geo")).json()
    assert len(tree) == 6 and sum(len(c["wards"]) for c in tree) == 30


async def test_dashboard_target_gap_and_scope(client, admin, wards):
    tudor, bamburi = wards["Tudor"], wards["Bamburi"]
    assert (await client.patch(f"/api/v1/geo/wards/{tudor.id}", json={"target": 10}, headers=admin)).status_code == 200
    ids = []
    for nid in ("11110001", "11110002", "11110003"):
        ids.append((await client.post("/api/v1/voters", json=voter_payload(tudor, national_id=nid), headers=admin)).json()["id"])
    await client.post(f"/api/v1/voters/{ids[0]}/verify", headers=admin)
    await client.post(f"/api/v1/voters/{ids[1]}/reject", json={"reason": "fake"}, headers=admin)
    await client.post("/api/v1/voters", json=voter_payload(bamburi, national_id="22220001"), headers=admin)

    d = (await client.get("/api/v1/dashboard/summary", headers=admin)).json()
    w = next(x for x in d["wards"] if x["id"] == tudor.id)
    assert (w["target"], w["achieved"], w["gap"], w["percent"], w["verified"]) == (10, 2, 8, 20.0, 1)
    assert d["totals"]["total"] == 4 and d["totals"]["rejected"] == 1
    assert len(d["wards"]) == 30 and d["daily"][-1]["count"] == 4

    wc = await make_user(client, admin, "ward_coordinator", ward=tudor)
    scoped = (await client.get("/api/v1/dashboard/summary", headers=wc)).json()
    assert [x["name"] for x in scoped["wards"]] == ["Tudor"] and scoped["totals"]["total"] == 3


async def test_station_csv_import_upserts(client, admin):
    csv = "code,name,ward_code,streams,registered_voters\n001,Tudor Pri,0027,3,1200\n002,Bad,9999,1,\n"
    r = (await client.post("/api/v1/geo/stations/import", headers=admin, files={"file": ("s.csv", csv, "text/csv")})).json()
    assert r["created"] == 1 and len(r["errors"]) == 1
    r = (await client.post("/api/v1/geo/stations/import", headers=admin,
                           files={"file": ("s.csv", "code,name,ward_code\n001,Tudor Primary,0027\n", "text/csv")})).json()
    assert r["updated"] == 1
