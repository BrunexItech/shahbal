"""Talk to Shahbal: HQ-only browser test of the phone assistant, and what it knows."""
from app.core.config import settings
from app.modules.voiceline import agent
from tests.conftest import make_user


async def test_only_hq_can_talk_to_the_assistant_and_the_key_stays_on_the_server(client, admin, wards, monkeypatch):
    comms = await make_user(client, admin, "communications")
    lead = await make_user(client, admin, "coordinator", constituency_id=wards["Tudor"].constituency_id)
    for who in (comms, lead):
        assert (await client.post("/api/v1/voice-assistant/session", headers=who)).status_code == 403
    assert (await client.get("/api/v1/voice-assistant/status", headers=admin)).json() == {"enabled": False}
    assert (await client.post("/api/v1/voice-assistant/session", headers=admin)).status_code == 409  # not set up: says so

    monkeypatch.setattr(settings, "elevenlabs_api_key", "sk_test")
    monkeypatch.setattr(settings, "elevenlabs_agent_id", "agent_test")
    seen = {}

    class FakeClient:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params=None, headers=None):
            seen.update(url=url, params=params, headers=headers)
            import httpx
            return httpx.Response(200, json={"signed_url": "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_test&conversation_signature=x"})

    monkeypatch.setattr("app.modules.voiceline.router.httpx.AsyncClient", FakeClient)
    r = (await client.post("/api/v1/voice-assistant/session", headers=admin)).json()
    assert r["signed_url"].startswith("wss://api.elevenlabs.io/")
    assert "sk_test" not in str(r) and seen["headers"]["xi-api-key"] == "sk_test" and seen["params"]["agent_id"] == "agent_test"


async def test_the_assistant_only_knows_what_is_published(client, admin, wards):
    await client.put("/api/v1/site-admin/pages/about", headers=admin,
                     json={"title": "About", "body": "## Who he is\nA son of **Mombasa**.\n[[youtube:dQw4w9WgXcQ]]"})
    await client.post("/api/v1/site-admin/agenda", headers=admin, json={"title": "Water every day", "summary": "Piped water to every ward in the first term."})
    await client.post("/api/v1/site-admin/agenda", headers=admin, json={"title": "Secret draft plan", "summary": "Not ready to be shared yet at all.", "published": False})
    text = await agent.knowledge()
    assert "Water every day" in text and "A son of Mombasa." in text
    assert "Secret draft plan" not in text and "[[" not in text and "**" not in text


async def test_publishing_refreshes_the_assistant_by_itself(client, admin, monkeypatch):
    import asyncio

    calls = []

    async def fake_sync():
        calls.append(1)
        return {"agent_id": "agent_test", "created": False, "knowledge_chars": 1}

    monkeypatch.setattr(settings, "testing", False)
    for k, v in (("elevenlabs_api_key", "sk_test"), ("elevenlabs_voice_id", "voice"), ("elevenlabs_agent_id", "agent_test")):
        monkeypatch.setattr(settings, k, v)
    monkeypatch.setattr(agent, "sync", fake_sync)
    monkeypatch.setattr(agent, "REFRESH_DELAY", 3)
    body = {"title": "Jobs at the port", "summary": "Local hiring first for port and county jobs."}
    await client.post("/api/v1/site-admin/agenda", headers=admin, json=body)
    await asyncio.sleep(0.5)
    await client.post("/api/v1/site-admin/agenda", headers=admin, json={**body, "title": "Clean water"})  # still editing
    assert calls == []  # the timer restarts with each change
    await asyncio.sleep(5)
    assert calls == [1]  # one refresh for the whole session
    await client.put("/api/v1/site-admin/pages/about", headers=admin, json={"title": "About", "body": "Updated."})
    await asyncio.sleep(5)
    assert calls == [1, 1]
