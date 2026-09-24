import io
from datetime import timedelta

import pytest
from PIL import Image
from sqlalchemy import select, update

from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.users.models import User, UserInvite
from tests.conftest import accept, invite, login, photo_bytes


@pytest.fixture(autouse=True)
def vault_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "recordings_dir", str(tmp_path / "vault" / "recordings"))


def agent_body(wards, email="new.agent@campaign.co.ke", **kw):
    return {"full_name": "Neema Achieng", "email": email, "role": "field_agent", "ward_id": wards["Tudor"].id, **kw}


async def test_invited_account_cannot_sign_in_until_accepted(client, admin, wards):
    created = await invite(client, admin, agent_body(wards))
    assert created["user"]["status"] == "invited" and created["invite"]["url"].startswith(settings.app_url)
    assert "password" not in created["user"]
    r = await client.post("/api/v1/auth/login", json={"email": "new.agent@campaign.co.ke", "password": "anything12", "portal": "field"})
    assert r.status_code == 401
    token = created["invite"]["url"].rsplit("/", 1)[1]
    async with SessionLocal() as s:  # only a hash of the token is stored
        inv = (await s.execute(select(UserInvite))).scalar_one()
        assert token not in inv.token_hash and len(inv.token_hash) == 64
    preview = (await client.get(f"/api/v1/invites/{token}")).json()
    assert preview["first_name"] == "Neema" and preview["photo_required"] is True and "new.agent@" not in preview["email_hint"]
    assert (await accept(client, created)).json()["portal"] == "field"
    await login(client, "new.agent@campaign.co.ke", "Password!1")
    users = {u["email"]: u for u in (await client.get("/api/v1/users", headers=admin)).json()}
    assert users["new.agent@campaign.co.ke"]["status"] == "active" and users["new.agent@campaign.co.ke"]["has_photo"]


async def test_link_is_single_use_and_email_bound(client, admin, wards):
    created = await invite(client, admin, agent_body(wards))
    assert (await accept(client, created, email="someone.else@gmail.com")).status_code == 400
    assert (await accept(client, created)).status_code == 200
    again = await accept(client, created)
    assert again.status_code == 410  # used


async def test_forwarded_link_locks_after_wrong_emails(client, admin, wards):
    created = await invite(client, admin, agent_body(wards))
    for i in range(5):
        await accept(client, created, email=f"guess{i}@gmail.com")
    assert (await accept(client, created)).status_code == 404  # revoked after 5 wrong emails


async def test_expired_and_resent_links(client, admin, wards):
    created = await invite(client, admin, agent_body(wards))
    async with SessionLocal() as s:
        await s.execute(update(UserInvite).values(expires_at=utcnow() - timedelta(minutes=1)))
        await s.commit()
    assert (await accept(client, created)).status_code == 410
    uid = created["user"]["id"]
    fresh = (await client.post(f"/api/v1/users/{uid}/invite", headers=admin)).json()
    assert (await accept(client, {"invite": fresh, "user": created["user"]})).status_code == 200


async def test_reset_access_kills_old_password_and_sessions(client, admin, wards):
    created = await invite(client, admin, agent_body(wards))
    await accept(client, created)
    old = await login(client, "new.agent@campaign.co.ke", "Password!1")
    fresh = (await client.post(f"/api/v1/users/{created['user']['id']}/invite", headers=admin)).json()
    assert (await client.get("/api/v1/auth/me", headers=old)).status_code == 401
    r = await client.post("/api/v1/auth/login", json={"email": "new.agent@campaign.co.ke", "password": "Password!1", "portal": "field"})
    assert r.status_code == 401
    assert (await accept(client, {"invite": fresh, "user": created["user"]}, password="Brand-new-pass7")).status_code == 200


async def test_photo_required_for_collectors_and_cleaned(client, admin, wards):
    created = await invite(client, admin, agent_body(wards))
    assert (await accept(client, created, photo=False)).status_code == 422
    # A phone photo carrying GPS in its EXIF: the stored copy must not keep it.
    img = Image.new("RGB", (1200, 900), (200, 30, 30))
    exif = Image.Exif()
    exif[0x8825] = {1: "S", 2: (4.0, 3.0, 0.0), 3: "E", 4: (39.0, 40.0, 0.0)}  # GPS IFD: Mombasa
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    assert Image.open(io.BytesIO(buf.getvalue())).getexif().get_ifd(0x8825)  # the upload really carries GPS
    token = created["invite"]["url"].rsplit("/", 1)[1]
    r = await client.post(f"/api/v1/invites/{token}/accept", data={"email": "new.agent@campaign.co.ke", "password": "Password!1"},
                          files={"photo": ("gps.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 200
    me = await login(client, "new.agent@campaign.co.ke", "Password!1")
    stored = (await client.get("/api/v1/users/me/photo", headers=me)).content
    out = Image.open(io.BytesIO(stored))
    assert out.size == (512, 512) and not out.getexif().get_ifd(0x8825)
    async with SessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == "new.agent@campaign.co.ke"))).scalar_one()
    from pathlib import Path

    on_disk = (Path(settings.recordings_dir).parent / "photos" / u.photo_path).read_bytes()
    assert stored not in on_disk  # encrypted at rest
    # HQ can see it; another agent can't.
    assert (await client.get(f"/api/v1/users/{u.id}/photo", headers=admin)).status_code == 200
    other = await invite(client, admin, agent_body(wards, email="other@campaign.co.ke"))
    await accept(client, other)
    oh = await login(client, "other@campaign.co.ke", "Password!1")
    assert (await client.get(f"/api/v1/users/{u.id}/photo", headers=oh)).status_code == 403


async def test_bad_photos_rejected(client, admin, wards):
    created = await invite(client, admin, agent_body(wards))
    token = created["invite"]["url"].rsplit("/", 1)[1]
    for data, name in ((b"<script>alert(1)</script>", "x.jpg"), (photo_bytes(size=80), "tiny.png")):
        r = await client.post(f"/api/v1/invites/{token}/accept", data={"email": "new.agent@campaign.co.ke", "password": "Password!1"},
                              files={"photo": (name, data, "image/png")})
        assert r.status_code in (415, 422), name


async def test_only_managers_invite_and_hq_roles_stay_hq(client, admin, wards):
    created = await invite(client, admin, {"full_name": "Coord Person", "email": "coord.new@campaign.co.ke", "role": "coordinator",
                                           "constituency_id": wards["Tudor"].constituency_id})
    assert (await accept(client, created, photo=False)).json()["portal"] == "command"  # HQ roles: photo optional
