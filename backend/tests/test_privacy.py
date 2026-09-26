"""Data rights (Kenya DPA 2019): prove the number by SMS code, then see, stop, correct or erase."""
import re

from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.modules.issues.models import Issue
from app.modules.privacy import router as privacy
from app.modules.voters.models import Voter
from tests.conftest import voter_payload

SENT: list[tuple[str, str]] = []


async def fake_sms(phone, text):
    SENT.append((phone, text))


def last_code() -> str:
    return re.search(r"\b(\d{6})\b", SENT[-1][1]).group(1)


async def test_see_and_stop_contact(client, admin, wards, monkeypatch):
    monkeypatch.setattr(privacy, "send_system_sms", fake_sms)
    SENT.clear()
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id="31234567", phone="0712000001"))
    unknown = (await client.post("/api/v1/portal/my-data/start", json={"phone": "0799999999"})).json()
    known = (await client.post("/api/v1/portal/my-data/start", json={"phone": "0712000001"})).json()
    assert unknown["message"] == known["message"] and len(SENT) == 1  # same answer; only the known number gets a code

    bad = await client.post("/api/v1/portal/my-data/verify", json={"request_id": known["request_id"], "code": "000000"})
    assert bad.status_code == 422
    ok = await client.post("/api/v1/portal/my-data/verify", json={"request_id": known["request_id"], "code": last_code()})
    assert ok.status_code == 200
    data = ok.json()
    assert data["records"][0]["name"] == "Amina Wanjiku" and data["records"][0]["national_id"].endswith("4567") and "31234567" not in str(data)

    r = await client.post(f"/api/v1/portal/my-data/{known['request_id']}/act", json={"token": data["token"], "action": "stop"})
    assert r.json()["status"] == "done"
    async with SessionLocal() as s:
        v = (await s.execute(select(Voter))).scalar_one()
        assert v.opted_out and v.do_not_call
    again = await client.post(f"/api/v1/portal/my-data/{known['request_id']}/act", json={"token": data["token"], "action": "erase"})
    assert again.status_code == 403  # one request, one action


async def test_erasure_goes_to_hq_and_removes_everything(client, admin, wards, monkeypatch):
    monkeypatch.setattr(privacy, "send_system_sms", fake_sms)
    SENT.clear()
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id="32234567", phone="0712000002"))
    await client.post("/api/v1/portal/issues", json={"category": "water", "description": "No water for days in our street.", "ward_id": wards["Tudor"].id,
                                                     "reporter_name": "Amina", "reporter_phone": "0712000002", "contact_ok": True, "consent": True})
    rid = (await client.post("/api/v1/portal/my-data/start", json={"phone": "0712000002"})).json()["request_id"]
    token = (await client.post("/api/v1/portal/my-data/verify", json={"request_id": rid, "code": last_code()})).json()["token"]
    assert (await client.post(f"/api/v1/portal/my-data/{rid}/act", json={"token": token, "action": "erase"})).json()["status"] == "open"

    queue = (await client.get("/api/v1/data-requests", headers=admin)).json()
    assert queue[0]["kind"] == "erase" and len(queue[0]["records"]) == 1 and len(queue[0]["reports"]) == 1
    done = await client.post(f"/api/v1/data-requests/{rid}/resolve", json={"outcome": "done", "note": "Your details have been erased.", "erase": True}, headers=admin)
    assert done.json() == {"status": "done", "erased_records": 1}
    async with SessionLocal() as s:
        assert (await s.execute(select(func.count(Voter.id)))).scalar_one() == 0
        issue = (await s.execute(select(Issue))).scalar_one()
        assert issue.reporter_phone is None and issue.reporter_name is None  # the report stays, anonymous
    assert SENT[-1][0] == "+254712000002" and "completed" in SENT[-1][1]
    everything = (await client.get("/api/v1/data-requests", params={"status": "all"}, headers=admin)).json()
    assert everything[0]["phone"] == "erased"


async def test_hq_only(client, admin, wards):
    from tests.conftest import make_user

    lead = await make_user(client, admin, "coordinator", constituency_id=wards["Tudor"].constituency_id)
    assert (await client.get("/api/v1/data-requests", headers=lead)).status_code == 403
