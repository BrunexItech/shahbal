"""Community Voice: residents and agents raise local problems; coordinators work them."""
from app.core.db import SessionLocal
from app.modules.issues.models import IssueUpdate
from tests.conftest import make_user, photo_bytes

from sqlalchemy import select


def report(ward, **kw) -> dict:
    return {"category": "water", "description": "No water in Mwembe Tayari for five days now.", "ward_id": ward.id,
            "area": "Near the mosque", "reporter_name": "Amina", "reporter_phone": "0712345678", "contact_ok": True, "consent": True, **kw}


async def test_resident_reports_attaches_a_photo_and_tracks_it(client, wards):
    r = await client.post("/api/v1/portal/issues", json=report(wards["Tudor"]))
    assert r.status_code == 201, r.text
    ref, token = r.json()["reference"], r.json()["upload_token"]
    assert ref.startswith("ISS-")

    files = {"file": ("tap.png", photo_bytes(), "image/png")}
    assert (await client.post(f"/api/v1/portal/issues/{ref}/photos", params={"token": "x" * 32}, files=files)).status_code == 404
    assert (await client.post(f"/api/v1/portal/issues/{ref}/photos", params={"token": token}, files=files)).status_code == 201

    # Tracking needs the reference *and* the phone used, so references can't be browsed.
    assert (await client.post("/api/v1/portal/issues/track", json={"reference": ref, "phone": "0799999999"})).status_code == 404
    t = await client.post("/api/v1/portal/issues/track", json={"reference": ref.lower(), "phone": "+254712345678"})
    assert t.status_code == 200 and t.json()["status"] == "new" and t.json()["ward"] == "Tudor"
    assert [u["note"] for u in t.json()["updates"]] == ["Report received"]


async def test_public_form_rules(client, wards):
    assert (await client.post("/api/v1/portal/issues", json=report(wards["Tudor"], consent=False))).status_code == 422
    assert (await client.post("/api/v1/portal/issues", json=report(wards["Tudor"], reporter_phone=None))).status_code == 422
    anon = await client.post("/api/v1/portal/issues", json=report(wards["Tudor"], reporter_name=None, reporter_phone=None, contact_ok=False))
    assert anon.status_code == 201  # anonymous reports are welcome
    bot = await client.post("/api/v1/portal/issues", json=report(wards["Tudor"], website="spam.example"))
    assert bot.status_code == 201 and bot.json()["reference"] == "ISS-00000"


async def test_coordinators_work_cases_in_their_area_and_residents_hear_back(client, admin, wards):
    tudor = (await client.post("/api/v1/portal/issues", json=report(wards["Tudor"]))).json()["reference"]
    await client.post("/api/v1/portal/issues", json=report(wards["Likoni"], category="roads", reporter_phone="0722000111"))
    lead = await make_user(client, admin, "ward_coordinator", ward=wards["Tudor"])
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    viewer = await make_user(client, admin, "viewer")

    mine = (await client.get("/api/v1/issues", headers=lead)).json()
    assert [i["reference"] for i in mine["items"]] == [tudor] and mine["items"][0]["reporter_phone"] == "+254712345678"
    assert (await client.get("/api/v1/issues", headers=agent)).json()["total"] == 0  # agents see only their own
    seen = (await client.get("/api/v1/issues", headers=viewer)).json()
    assert seen["total"] == 2 and all(i["reporter_phone"].startswith("••••") for i in seen["items"])  # observers: masked
    case_id = mine["items"][0]["id"]
    assert (await client.patch(f"/api/v1/issues/{case_id}", json={"status": "resolved"}, headers=agent)).status_code == 403

    # Assigning someone acknowledges the case; the resident gets an SMS.
    people = (await client.get(f"/api/v1/issues/{case_id}/assignees", headers=lead)).json()
    field = next(p for p in people if p["role"] == "field_agent")
    d = (await client.patch(f"/api/v1/issues/{case_id}", json={"assigned_to_id": field["id"]}, headers=lead)).json()
    assert d["status"] == "acknowledged" and d["assigned_to"] and "sms" in [u["kind"] for u in d["updates"]]
    # Someone from another ward can't be assigned.
    other = await make_user(client, admin, "field_agent", ward=wards["Likoni"])
    other_id = (await client.get("/api/v1/auth/me", headers=other)).json()["id"]
    assert (await client.patch(f"/api/v1/issues/{case_id}", json={"assigned_to_id": other_id}, headers=lead)).status_code == 422

    d = (await client.patch(f"/api/v1/issues/{case_id}", json={"status": "resolved", "note": "Pipe fixed by the county", "public": True},
                            headers=lead)).json()
    assert d["status"] == "resolved" and d["resolved_at"]
    t = (await client.post("/api/v1/portal/issues/track", json={"reference": tudor, "phone": "0712345678"})).json()
    assert t["status"] == "resolved" and "Pipe fixed by the county" in [u["note"] for u in t["updates"]]
    # Internal notes stay internal.
    await client.post(f"/api/v1/issues/{case_id}/notes", json={"note": "Chief was helpful"}, headers=lead)
    t = (await client.post("/api/v1/portal/issues/track", json={"reference": tudor, "phone": "0712345678"})).json()
    assert "Chief was helpful" not in [u["note"] for u in t["updates"]]


async def test_closing_as_spam_never_texts_the_reporter(client, admin, wards):
    await client.post("/api/v1/portal/issues", json=report(wards["Tudor"]))
    case_id = (await client.get("/api/v1/issues", headers=admin)).json()["items"][0]["id"]
    await client.patch(f"/api/v1/issues/{case_id}", json={"status": "closed", "note": "Duplicate"}, headers=admin)
    async with SessionLocal() as s:
        kinds = (await s.execute(select(IssueUpdate.kind).where(IssueUpdate.issue_id == case_id))).scalars().all()
    assert kinds.count("sms") == 1  # only the receipt when they reported; nothing about the closure


async def test_residents_get_a_receipt_and_staff_see_whether_each_sms_really_went(client, admin, wards, monkeypatch):
    sent: list[tuple[str, str]] = []

    async def fake_sms(phone, text):
        sent.append((phone, text))
        from app.modules.messaging.transactional import Sent
        return Sent(False, "Mobile Sasa balance is too low for this batch (0402)") if "work has started" in text else Sent(True, None, f"bulk-{len(sent)}")

    monkeypatch.setattr("app.modules.messaging.transactional.send_system_sms", fake_sms)
    ref = (await client.post("/api/v1/portal/issues", json=report(wards["Tudor"]))).json()["reference"]
    assert sent[-1][0] == "+254712345678" and ref in sent[-1][1] and "We'll text you" in sent[-1][1]
    case_id = (await client.get("/api/v1/issues", headers=admin)).json()["items"][0]["id"]

    d = (await client.patch(f"/api/v1/issues/{case_id}", json={"status": "in_progress", "note": "Plumber booked for Monday", "public": True},
                            headers=admin)).json()
    failed = [u for u in d["updates"] if u["kind"] == "sms_failed"]
    assert len(failed) == 1 and "balance is too low" in failed[0]["note"] and "0712•••678" in failed[0]["note"]
    assert "Plumber booked for Monday" in sent[-1][1]
    d = (await client.patch(f"/api/v1/issues/{case_id}", json={"note": "Parts delivered", "public": True}, headers=admin)).json()
    ok = [u for u in d["updates"] if u["kind"] == "sms"]
    assert "Parts delivered" in ok[-1]["note"]  # the history shows exactly what the resident received
    # The resident sees the public note on the tracking page whether or not the SMS went.
    t = (await client.post("/api/v1/portal/issues/track", json={"reference": ref, "phone": "0712345678"})).json()
    assert "Plumber booked for Monday" in [u["note"] for u in t["updates"]]
    assert "sms" not in [u.get("kind") for u in t["updates"]] and "sms_failed" not in [u.get("kind") for u in t["updates"]]

    # No SMS when they didn't ask for updates.
    before = len(sent)
    await client.post("/api/v1/portal/issues", json=report(wards["Tudor"], contact_ok=False, reporter_phone="0722000333"))
    assert len(sent) == before


async def test_agents_log_cases_offline_safe_and_numbers_add_up(client, admin, wards):
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    body = {**report(wards["Tudor"], category="security", latitude=-4.0547, longitude=39.6636), "client_ref": "dev-1-issue-1"}
    a = await client.post("/api/v1/issues", json=body, headers=agent)
    b = await client.post("/api/v1/issues", json=body, headers=agent)  # replayed sync
    assert a.status_code == b.status_code == 201 and a.json()["id"] == b.json()["id"] and a.json()["source"] == "field"
    assert (await client.post("/api/v1/issues", json=report(wards["Likoni"]), headers=agent)).status_code == 422  # not their ward
    await client.post("/api/v1/portal/issues", json=report(wards["Tudor"], category="water"))
    await client.post("/api/v1/portal/issues", json=report(wards["Likoni"], category="water", reporter_phone="0733000111"))

    s = (await client.get("/api/v1/issues/stats", headers=admin)).json()
    assert s["total"] == 3 and s["open"] == 3 and s["by_category"][0] == {"category": "water", "label": "Water", "total": 2, "open": 2, "resolved": 0}
    assert {w["ward"]: w["total"] for w in s["by_ward"]} == {"Tudor": 2, "Likoni": 1}
    assert s["by_source"] == {"field": 1, "public": 2} and sum(w["reported"] for w in s["weekly"]) == 3
    pins = (await client.get("/api/v1/issues/map", headers=admin)).json()
    assert [p["category"] for p in pins] == ["security"]  # only cases with a location


async def test_coordinators_text_residents_directly_and_see_what_really_happened(client, admin, wards, monkeypatch):
    from app.core.config import settings
    from app.modules.messaging import providers

    ref = (await client.post("/api/v1/portal/issues", json=report(wards["Tudor"]))).json()["reference"]
    case_id = (await client.get("/api/v1/issues", headers=admin)).json()["items"][0]["id"]
    d = (await client.post(f"/api/v1/issues/{case_id}/sms", json={"message": "The county engineer visits tomorrow at 10."}, headers=admin)).json()
    sms = [u for u in d["updates"] if u["kind"] == "sms"][-1]
    assert f"about your report {ref}: The county engineer visits tomorrow at 10." in sms["note"] and sms["sms_status"] == "delivered"  # sandbox, dev

    # A delivery report from Mobile Sasa settles the status of a real send.
    async with SessionLocal() as s:
        u = (await s.execute(select(IssueUpdate).where(IssueUpdate.id == sms["id"]))).scalar_one()
        u.sms_status, u.provider_ref = "sent", "bulk-abc"
        await s.commit()
    monkeypatch.setattr(settings, "mobilesasa_webhook_secret", "whsec_test")
    r = await client.post("/api/v1/messaging/webhooks/mobilesasa/delivery", headers={"X-MobileSasa-Secret": "whsec_test"},
                          json={"reference": "bulk-abc", "msisdn": "254712345678", "status": "Failed", "deliveryStatus": "Absent subscriber"})
    assert r.status_code == 200
    got = await client.get(f"/api/v1/issues/{case_id}", headers=admin)
    assert got.status_code == 200, got.text
    u = next(x for x in got.json()["updates"] if x["id"] == sms["id"])
    assert u["sms_status"] == "failed" and "Absent subscriber" in u["note"]

    # A live server without a real SMS provider never pretends: nothing "sent", and it says why.
    from types import SimpleNamespace

    monkeypatch.setattr(providers, "settings", SimpleNamespace(is_production=True, testing=False, sms_provider="sandbox", whatsapp_provider="sandbox"))
    d = (await client.post(f"/api/v1/issues/{case_id}/sms", json={"message": "Second update for you."}, headers=admin)).json()
    last = d["updates"][-1]
    assert last["kind"] == "sms_failed" and "SMS_PROVIDER=mobilesasa" in last["note"] and d["sms_live"] is False
    assert (await client.get("/api/v1/messaging/status", headers=admin)).json()["sms_live"] is False

    # Residents who didn't ask for SMS, or left no number, aren't texted.
    await client.post("/api/v1/portal/issues", json=report(wards["Tudor"], contact_ok=False, reporter_phone="0722000444"))
    quiet = (await client.get("/api/v1/issues", headers=admin)).json()["items"][0]["id"]
    r = await client.post(f"/api/v1/issues/{quiet}/sms", json={"message": "Hello there."}, headers=admin)
    assert r.status_code == 409 and "didn't ask for SMS" in r.json()["detail"]
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    assert (await client.post(f"/api/v1/issues/{case_id}/sms", json={"message": "Hello there."}, headers=agent)).status_code == 403
