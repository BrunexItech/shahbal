"""AI assistant: optional, grounded in aggregate figures, no personal data sent out.
OpenAI is simulated here; nothing leaves the machine."""
from app.core.config import settings
from app.modules.ai import client as ai_client
from tests.conftest import make_user, voter_payload


class Recorder:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    async def __call__(self, system, user, **kw):
        self.calls.append({"system": system, "user": user, **kw})
        return self.reply  # text for complete(), a dict for complete_json()


async def test_switched_off_without_a_key(client, admin, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    assert (await client.get("/api/v1/ai/status", headers=admin)).json() == {"enabled": False}
    r = await client.post("/api/v1/ai/ask", json={"question": "How are we doing?"}, headers=admin)
    assert r.status_code == 503 and "isn't switched on" in r.json()["detail"]


async def test_ask_uses_aggregates_only(client, admin, wards, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id="44556677", phone="0711998877"))
    fake = Recorder("Tudor has 1 captured.")
    monkeypatch.setattr(ai_client, "complete", fake)
    r = await client.post("/api/v1/ai/ask", json={"question": "Which ward leads?"}, headers=admin)
    assert r.status_code == 200 and r.json()["answer"] == "Tudor has 1 captured."
    sent = fake.calls[0]["user"]
    assert "Tudor" in sent and "44556677" not in sent and "0711998877" not in sent and "711998877" not in sent
    # Agents don't get the campaign-wide assistant.
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    assert (await client.post("/api/v1/ai/ask", json={"question": "Which ward leads?"}, headers=agent)).status_code == 403


async def test_sms_drafts_report_length(client, admin, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(ai_client, "complete_json", Recorder({"drafts": ["Habari {first_name}! Join us Saturday at Tononoka.", "x" * 200]}))
    d = (await client.post("/api/v1/ai/draft-sms", json={"purpose": "Invite supporters to Saturday's rally"}, headers=admin)).json()
    assert d["limit"] == 150 and d["drafts"][0]["fits"] is True and d["drafts"][1]["fits"] is False


async def test_issue_assist_only_offers_real_duplicates_in_the_ward(client, admin, wards, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    body = {"category": "water", "description": "No water for five days in our block.", "ward_id": wards["Tudor"].id, "consent": True}
    a = (await client.post("/api/v1/portal/issues", json=body)).json()["reference"]
    await client.post("/api/v1/portal/issues", json=body)
    case_id = (await client.get("/api/v1/issues", params={"q": a}, headers=admin)).json()["items"][0]["id"]
    monkeypatch.setattr(ai_client, "complete_json", Recorder({"topic": "water", "urgent": True, "why": "Days without water.",
                                                               "duplicates": ["ISS-99999", "ISS-00002"], "reply": "Asante, we're on it."}))
    r = (await client.post(f"/api/v1/ai/issues/{case_id}/assist", headers=admin)).json()
    assert r["topic"] == "water" and r["urgent"] is True and r["duplicates"] == ["ISS-00002"] and r["reply"]


async def test_talking_points_respect_area(client, admin, wards, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(ai_client, "complete", Recorder("- Water first."))
    lead = await make_user(client, admin, "ward_coordinator", ward=wards["Tudor"])
    ok = await client.post("/api/v1/ai/talking-points", json={"ward_id": wards["Tudor"].id}, headers=lead)
    assert ok.status_code == 200 and ok.json()["points"] == "- Water first."
    assert (await client.post("/api/v1/ai/talking-points", json={"ward_id": wards["Likoni"].id}, headers=lead)).status_code == 404
