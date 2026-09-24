from datetime import timedelta

import pytest
from sqlalchemy import select, update

from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.audit.models import AuditLog
from app.modules.calls.models import CallRecording
from tests.conftest import make_user, voter_payload

AUDIO = b"\x1aE\xdf\xa3" + b"fake-opus-frames" * 64  # a WebM header + payload


@pytest.fixture(autouse=True)
def vault_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "recordings_dir", str(tmp_path / "vault"))


async def upload(client, headers, voter_id=None, data=AUDIO, mime="audio/webm", **form):
    return await client.post("/api/v1/calls/recordings", headers=headers, files={"file": ("call.webm", data, mime)},
                             data={"voter_id": voter_id or "", "duration_seconds": "42", "line": "sandbox", **form})


async def test_softphone_provisioning(client, admin, monkeypatch):
    agent = await make_user(client, admin, "call_agent", email="line@campaign.co.ke")
    assert (await client.get("/api/v1/calls/softphone", headers=agent)).json()["provider"] == "sandbox"
    monkeypatch.setattr(settings, "voice_provider", "sip")
    monkeypatch.setattr(settings, "sip_wss_url", "wss://sip.example.co.ke:7443")
    monkeypatch.setattr(settings, "sip_domain", "sip.example.co.ke")
    assert (await client.get("/api/v1/calls/softphone", headers=agent)).status_code == 409  # no line yet
    me = (await client.get("/api/v1/auth/me", headers=agent)).json()
    r = await client.put(f"/api/v1/calls/sip-accounts/{me['id']}", json={"sip_user": "agent101", "sip_password": "s3cret-line"}, headers=admin)
    assert r.status_code == 204
    cfg = (await client.get("/api/v1/calls/softphone", headers=agent)).json()
    assert cfg["uri"] == "sip:agent101@sip.example.co.ke" and cfg["password"] == "s3cret-line"
    listing = (await client.get("/api/v1/calls/sip-accounts", headers=admin)).json()
    assert "password" not in str(listing) and listing[0]["sip_user"] == "agent101"


async def test_recording_lifecycle(client, admin, wards):
    vid = (await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=admin)).json()["id"]
    agent = await make_user(client, admin, "call_agent", email="rec@campaign.co.ke")
    rec = await upload(client, agent, vid)
    assert rec.status_code == 201
    rid = rec.json()["id"]
    async with SessionLocal() as s:
        row = await s.get(CallRecording, rid)
        from pathlib import Path

        on_disk = (Path(settings.recordings_dir) / row.path).read_bytes()
    assert AUDIO not in on_disk and b"fake-opus" not in on_disk  # encrypted at rest
    call = await client.post("/api/v1/calls", headers=agent, json={"voter_id": vid, "queue": "verify", "outcome": "answered", "recording_id": rid})
    assert call.status_code == 201
    hist = (await client.get(f"/api/v1/calls/voter/{vid}", headers=agent)).json()
    assert hist[0]["recording_id"] == rid
    # Agents can't browse or play recordings; supervisors can, after re-confirming.
    assert (await client.get("/api/v1/calls/recordings", headers=agent)).status_code == 403
    assert (await client.get(f"/api/v1/calls/recordings/{rid}/audio", headers=agent)).status_code == 403
    lst = (await client.get("/api/v1/calls/recordings", headers=admin)).json()
    assert lst["total"] == 1 and lst["items"][0]["voter"] == "Amina Wanjiku"
    audio = await client.get(f"/api/v1/calls/recordings/{rid}/audio", headers=admin)
    assert audio.status_code == 200 and audio.content == AUDIO and audio.headers["cache-control"] == "no-store"
    async with SessionLocal() as s:
        actions = {a.action for a in (await s.execute(select(AuditLog))).scalars()}
    assert {"RECORDING_ADD", "RECORDING_PLAY"} <= actions
    # A recording can't be attached twice, or by someone else.
    again = await client.post("/api/v1/calls", headers=agent, json={"voter_id": vid, "queue": "verify", "outcome": "busy", "recording_id": rid})
    assert again.status_code == 422


async def test_recording_validation_and_tamper(client, admin, wards, monkeypatch):
    vid = (await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=admin)).json()["id"]
    assert (await upload(client, admin, vid, data=b"<html>", mime="text/html")).status_code == 415
    monkeypatch.setattr(settings, "recording_max_mb", 0)
    assert (await upload(client, admin, vid)).status_code == 413
    monkeypatch.setattr(settings, "recording_max_mb", 50)
    agent = await make_user(client, admin, "call_agent", email="nov@campaign.co.ke")
    assert (await upload(client, agent)).status_code == 403  # agents only record voter-queue calls
    rid = (await upload(client, admin, vid)).json()["id"]
    async with SessionLocal() as s:
        row = await s.get(CallRecording, rid)
        from pathlib import Path

        p = Path(settings.recordings_dir) / row.path
    b = bytearray(p.read_bytes())
    b[-1] ^= 1
    p.write_bytes(bytes(b))
    assert (await client.get(f"/api/v1/calls/recordings/{rid}/audio", headers=admin)).status_code == 500


async def test_recordings_expire(client, admin, wards):
    from app.modules.calls.telephony import purge_expired_recordings

    vid = (await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=admin)).json()["id"]
    rid = (await upload(client, admin, vid)).json()["id"]
    async with SessionLocal() as s:
        await s.execute(update(CallRecording).values(created_at=utcnow() - timedelta(days=settings.recording_retention_days + 1)))
        await s.commit()
        assert await purge_expired_recordings(s) == 1
        assert await s.get(CallRecording, rid) is None
