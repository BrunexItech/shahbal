import pyotp
from sqlalchemy import select

from app.core import crypto
from app.core.db import SessionLocal
from app.modules.users.models import User
from tests.conftest import ADMIN, login, make_user, session_headers, voter_payload


async def test_session_cookie_is_hardened(client):
    r = await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert "access_token" not in r.text  # token never exposed to JavaScript


async def test_csrf_header_required_for_cookie_writes(client, admin, wards):
    no_csrf = {"Cookie": admin["Cookie"]}
    assert (await client.get("/api/v1/auth/me", headers=no_csrf)).status_code == 200  # reads are fine
    r = await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=no_csrf)
    assert r.status_code == 403 and "CSRF" in r.text


async def test_logout_revokes_session_server_side(client, admin):
    assert (await client.post("/api/v1/auth/logout", headers=admin)).status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=admin)).status_code == 401


async def test_forged_or_missing_token_rejected(client):
    assert (await client.get("/api/v1/voters")).status_code == 401
    bad = {"Cookie": "chq_session=eyJhbGciOiJIUzI1NiJ9.e30.x", "X-Requested-With": "x"}
    assert (await client.get("/api/v1/voters", headers=bad)).status_code == 401


async def test_account_lockout_after_repeated_failures(client):
    for _ in range(5):
        assert (await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": "wrong-pass-1"})).status_code == 401
    r = await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
    assert r.status_code == 423  # locked even with the right password


async def test_unknown_email_and_wrong_password_look_identical(client):
    a = await client.post("/api/v1/auth/login", json={"email": "nobody@campaign.co.ke", "password": "x"})
    b = await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": "x"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


async def test_password_policy(client, admin, wards):
    body = {"full_name": "Weak Pass", "email": "weak@campaign.co.ke", "role": "field_agent", "ward_id": wards["Tudor"].id}
    for pw in ("short1", "onlyletterslong", "password123", "weak12345678"):
        r = await client.post("/api/v1/users", json={**body, "password": pw}, headers=admin)
        assert r.status_code == 422, pw


async def test_disabling_user_kills_their_sessions(client, admin, wards):
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    uid = (await client.get("/api/v1/auth/me", headers=agent)).json()["id"]
    assert (await client.patch(f"/api/v1/users/{uid}", json={"is_active": False}, headers=admin)).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=agent)).status_code == 401


async def test_totp_two_factor_flow(client, admin):
    setup = (await client.post("/api/v1/auth/totp/setup", headers=admin)).json()
    assert setup["qr_svg"].startswith("<svg") and setup["otpauth_uri"].startswith("otpauth://")
    assert (await client.post("/api/v1/auth/totp/enable", json={"code": "000000"}, headers=admin)).status_code == 422
    code = pyotp.TOTP(setup["secret"]).now()
    assert (await client.post("/api/v1/auth/totp/enable", json={"code": code}, headers=admin)).status_code == 204
    async with SessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == ADMIN[0]))).scalar_one()
        assert u.totp_secret_enc and setup["secret"] not in u.totp_secret_enc  # stored encrypted
        assert crypto.decrypt(u.totp_secret_enc) == setup["secret"]

    step1 = await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
    assert step1.json()["mfa_required"] is True and "chq_session" not in step1.cookies
    bad = await client.post("/api/v1/auth/mfa", json={"mfa_token": step1.json()["mfa_token"], "code": "123456"})
    assert bad.status_code == 401
    ok = await client.post("/api/v1/auth/mfa", json={"mfa_token": step1.json()["mfa_token"], "code": pyotp.TOTP(setup["secret"]).now()})
    assert ok.status_code == 200
    client.cookies.clear()
    assert (await client.get("/api/v1/auth/me", headers=session_headers(ok))).json()["totp_enabled"] is True


async def test_mfa_token_cannot_be_used_as_session(client, admin):
    setup = (await client.post("/api/v1/auth/totp/setup", headers=admin)).json()
    await client.post("/api/v1/auth/totp/enable", json={"code": pyotp.TOTP(setup["secret"]).now()}, headers=admin)
    mfa_token = (await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})).json()["mfa_token"]
    client.cookies.clear()
    r = await client.get("/api/v1/auth/me", headers={"Cookie": f"chq_session={mfa_token}"})
    assert r.status_code == 401


async def test_password_change_revokes_other_sessions(client, admin):
    other = await login(client, *ADMIN)
    r = await client.post("/api/v1/auth/password", json={"current_password": ADMIN[1], "new_password": "N3wStrongPass!"}, headers=admin)
    assert r.status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=admin)).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=other)).status_code == 401


async def test_security_headers_present(client, admin):
    r = await client.get("/api/v1/voters", headers=admin)
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"


async def test_production_refuses_default_secrets(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "environment", "production")
    import pytest

    with pytest.raises(RuntimeError, match="default secrets"):
        settings.assert_production_safe()
