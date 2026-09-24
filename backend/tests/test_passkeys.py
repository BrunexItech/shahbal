from sqlalchemy import select

from app.core.db import SessionLocal
from app.modules.audit.models import AuditLog
from tests.conftest import ADMIN, accept, elevate, invite, make_user, session_headers, voter_payload
from tests.soft_authenticator import SoftAuthenticator


async def enrol(client, headers, auth: SoftAuthenticator, name="Pixel 8 fingerprint", kind="platform"):
    o = (await client.post("/api/v1/auth/passkeys/register/options", json={"kind": kind}, headers=headers)).json()
    assert o["options"]["authenticatorSelection"]["userVerification"] == "required"
    assert o["options"]["authenticatorSelection"]["residentKey"] == "required"
    r = await client.post("/api/v1/auth/passkeys/register/verify", headers=headers,
                          json={"flow_id": o["flow_id"], "credential": auth.register(o["options"]), "name": name})
    assert r.status_code == 201, r.text
    return r.json()


async def passwordless(client, auth: SoftAuthenticator, **sign_kw):
    o = (await client.post("/api/v1/auth/passkeys/login/options", json={"portal": "command"})).json()
    assert o["options"]["allowCredentials"] == []  # discoverable: no email needed
    r = await client.post("/api/v1/auth/passkeys/login/verify", json={"flow_id": o["flow_id"], "credential": auth.sign(o["options"], **sign_kw), "portal": "command"})
    return r, o


async def test_enrol_then_passwordless_sign_in_is_elevated(client, admin, wards):
    auth = SoftAuthenticator()
    pk = await enrol(client, admin, auth)
    assert pk["kind"] == "platform" and pk["name"] == "Pixel 8 fingerprint"
    client.cookies.clear()
    r, _ = await passwordless(client, auth)
    assert r.status_code == 200, r.text
    h = session_headers(r)
    client.cookies.clear()
    me = (await client.get("/api/v1/auth/me", headers=h)).json()
    assert me["session_method"] == "passkey" and me["passkey_count"] == 1 and me["elevated_until"]
    # A fresh passkey sign-in counts as re-confirmation: sensitive actions work straight away.
    vid = (await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=h)).json()["id"]
    assert (await client.post(f"/api/v1/voters/{vid}/reveal-id", headers=h)).status_code == 200


async def test_password_then_passkey_as_second_factor(client, admin):
    auth = SoftAuthenticator()
    await enrol(client, admin, auth)
    step1 = (await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": ADMIN[1], "portal": "command"})).json()
    assert step1["mfa_required"] and step1["mfa_methods"] == ["passkey"] and step1["user"] is None
    o = (await client.post("/api/v1/auth/passkeys/login/options", json={"mfa_token": step1["mfa_token"], "portal": "command"})).json()
    assert len(o["options"]["allowCredentials"]) == 1  # only this account's passkeys
    r = await client.post("/api/v1/auth/passkeys/login/verify",
                          json={"flow_id": o["flow_id"], "credential": auth.sign(o["options"]), "mfa_token": step1["mfa_token"], "portal": "command"})
    assert r.status_code == 200 and r.json()["user"]["email"] == ADMIN[0]


async def test_challenge_is_single_use(client, admin):
    auth = SoftAuthenticator()
    await enrol(client, admin, auth)
    r, o = await passwordless(client, auth)
    assert r.status_code == 200
    replay = await client.post("/api/v1/auth/passkeys/login/verify", json={"flow_id": o["flow_id"], "credential": auth.sign(o["options"]), "portal": "command"})
    assert replay.status_code == 400


async def test_phishing_origin_rejected(client, admin):
    auth = SoftAuthenticator()
    await enrol(client, admin, auth)
    r, _ = await passwordless(client, auth, origin="https://campaign-hq-login.evil.example")
    assert r.status_code == 401


async def expire_elevation():
    from app.modules.users.models import UserSession

    async with SessionLocal() as s:
        for us in (await s.execute(select(UserSession))).scalars():
            us.elevated_until = None
        await s.commit()


async def test_biometric_verification_required(client, admin):
    # Registration without user verification (no fingerprint/face/PIN) is refused.
    o = (await client.post("/api/v1/auth/passkeys/register/options", json={"kind": "platform"}, headers=admin)).json()
    r = await client.post("/api/v1/auth/passkeys/register/verify", headers=admin,
                          json={"flow_id": o["flow_id"], "credential": SoftAuthenticator().register(o["options"], uv=False), "name": "x"})
    assert r.status_code == 422
    auth = SoftAuthenticator()
    await enrol(client, admin, auth)
    r, _ = await passwordless(client, auth, uv=False)  # a tap without fingerprint/face/PIN
    assert r.status_code == 401


async def test_hijacked_session_cannot_plant_a_passkey(client, admin):
    await enrol(client, admin, SoftAuthenticator())
    await expire_elevation()  # e.g. a stolen, idle session
    r = await client.post("/api/v1/auth/passkeys/register/options", json={"kind": "platform"}, headers=admin)
    assert r.status_code == 428
    assert (await client.post("/api/v1/auth/totp/setup", headers=admin)).status_code == 428


async def test_cloned_authenticator_detected_by_sign_count(client, admin):
    auth = SoftAuthenticator()
    await enrol(client, admin, auth)
    assert (await passwordless(client, auth))[0].status_code == 200
    r, _ = await passwordless(client, auth, bump=False)  # counter didn't move: a clone replaying state
    assert r.status_code == 401


async def test_passkey_cannot_satisfy_another_accounts_second_factor(client, admin, wards):
    mine = SoftAuthenticator()
    await enrol(client, admin, mine)
    coord = await make_user(client, admin, "coordinator", constituency_id=wards["Tudor"].constituency_id, email="c@campaign.co.ke")
    theirs = SoftAuthenticator()
    await enrol(client, coord, theirs)
    step1 = (await client.post("/api/v1/auth/login", json={"email": "c@campaign.co.ke", "password": "Password!1", "portal": "command"})).json()
    o = (await client.post("/api/v1/auth/passkeys/login/options", json={"mfa_token": step1["mfa_token"], "portal": "command"})).json()
    r = await client.post("/api/v1/auth/passkeys/login/verify",
                          json={"flow_id": o["flow_id"], "credential": mine.sign(o["options"]), "mfa_token": step1["mfa_token"], "portal": "command"})
    assert r.status_code == 401


async def test_step_up_gates_sensitive_actions(client, admin, wards):
    tudor = wards["Tudor"]
    coord = await make_user(client, admin, "coordinator", constituency_id=tudor.constituency_id, email="c2@campaign.co.ke")
    body = {"full_name": "New Agent", "email": "na@campaign.co.ke", "role": "field_agent", "ward_id": tudor.id}
    assert (await client.post("/api/v1/users", json=body, headers=coord)).status_code == 428
    bad = await client.post("/api/v1/auth/step-up/verify", json={"method": "password", "password": "nope-nope-1"}, headers=coord)
    assert bad.status_code == 401
    await elevate(client, coord, "Password!1")
    assert (await client.post("/api/v1/users", json=body, headers=coord)).status_code == 201
    # Once a passkey exists, the password is no longer accepted for step-up.
    auth = SoftAuthenticator()
    await enrol(client, coord, auth)
    o = (await client.post("/api/v1/auth/step-up/options", headers=coord)).json()
    assert o["methods"] == ["passkey"] and o["flow_id"]
    pw = await client.post("/api/v1/auth/step-up/verify", json={"method": "password", "password": "Password!1"}, headers=coord)
    assert pw.status_code == 400
    ok = await client.post("/api/v1/auth/step-up/verify", headers=coord,
                           json={"method": "passkey", "flow_id": o["flow_id"], "credential": auth.sign(o["options"])})
    assert ok.status_code == 204


async def test_removing_a_passkey_needs_step_up_and_is_audited(client, admin):
    auth = SoftAuthenticator()
    pk = await enrol(client, admin, auth)
    # A new, un-elevated session for the same admin (via passkey second factor, then let elevation lapse).
    step1 = (await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": ADMIN[1], "portal": "command"})).json()
    o = (await client.post("/api/v1/auth/passkeys/login/options", json={"mfa_token": step1["mfa_token"], "portal": "command"})).json()
    r = await client.post("/api/v1/auth/passkeys/login/verify",
                          json={"flow_id": o["flow_id"], "credential": auth.sign(o["options"]), "mfa_token": step1["mfa_token"], "portal": "command"})
    h = session_headers(r)
    client.cookies.clear()
    await expire_elevation()
    assert (await client.delete(f"/api/v1/auth/passkeys/{pk['id']}", headers=h)).status_code == 428
    o = (await client.post("/api/v1/auth/step-up/options", headers=h)).json()
    await client.post("/api/v1/auth/step-up/verify", headers=h, json={"method": "passkey", "flow_id": o["flow_id"], "credential": auth.sign(o["options"])})
    assert (await client.delete(f"/api/v1/auth/passkeys/{pk['id']}", headers=h)).status_code == 204
    async with SessionLocal() as s:
        actions = [a.action for a in (await s.execute(select(AuditLog).order_by(AuditLog.created_at))).scalars()]
    assert {"PASSKEY_ADD", "STEP_UP", "PASSKEY_REMOVE"} <= set(actions)


async def test_new_device_alert(client, admin, wards, monkeypatch):
    sent = []

    async def fake_sms(phone, text):
        sent.append((phone, text))

    monkeypatch.setattr("app.modules.auth.devices.send_system_sms", fake_sms)
    created = await invite(client, admin, {"full_name": "Alert Agent", "email": "alert@campaign.co.ke", "phone": "+254712000111",
                                           "role": "field_agent", "ward_id": wards["Tudor"].id})
    assert (await accept(client, created)).status_code == 200
    first = await client.post("/api/v1/auth/login", json={"email": "alert@campaign.co.ke", "password": "Password!1", "portal": "field"},
                              headers={"User-Agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130.0"})
    device = first.cookies.get("chq_device")
    assert device and not sent  # first ever sign-in: just remember the device
    client.cookies.clear()
    same = await client.post("/api/v1/auth/login", json={"email": "alert@campaign.co.ke", "password": "Password!1", "portal": "field"},
                             headers={"Cookie": f"chq_device={device}"})
    assert same.status_code == 200 and not sent  # recognised device: no alert
    client.cookies.clear()
    await client.post("/api/v1/auth/login", json={"email": "alert@campaign.co.ke", "password": "Password!1", "portal": "field"},
                      headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0) Firefox/131.0"})
    client.cookies.clear()
    assert len(sent) == 1 and sent[0][0] == "+254712000111" and "Firefox on Windows" in sent[0][1]
    async with SessionLocal() as s:
        assert (await s.execute(select(AuditLog).where(AuditLog.action == "NEW_DEVICE"))).scalars().first() is not None


async def test_production_requires_every_role_to_enrol(client, admin, wards, monkeypatch):
    from app.core.config import settings

    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    monkeypatch.setattr(settings, "environment", "production")
    r = await client.get("/api/v1/voters", headers=agent)
    assert r.status_code == 403 and "Two-factor" in r.text
    assert (await client.get("/api/v1/auth/me", headers=agent)).json()["mfa_setup_required"] is True
    await enrol(client, agent, SoftAuthenticator())  # first factor: no step-up needed
    assert (await client.get("/api/v1/voters", headers=agent)).status_code == 200


async def test_portals_are_separate(client, admin, wards):
    """HQ and field staff can't sign in through each other's portal, and the
    wrong door looks exactly like a wrong password."""
    agent_email = "portal.agent@campaign.co.ke"
    created = await invite(client, admin, {"full_name": "Portal Agent", "email": agent_email, "role": "field_agent", "ward_id": wards["Tudor"].id})
    assert (await accept(client, created)).status_code == 200
    wrong = await client.post("/api/v1/auth/login", json={"email": agent_email, "password": "Password!1", "portal": "command"})
    bad_pw = await client.post("/api/v1/auth/login", json={"email": agent_email, "password": "Wrong-pass1", "portal": "field"})
    assert wrong.status_code == bad_pw.status_code == 401 and wrong.json() == bad_pw.json()
    assert (await client.post("/api/v1/auth/login", json={"email": agent_email, "password": "Password!1", "portal": "field"})).status_code == 200
    client.cookies.clear()
    hq = await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": ADMIN[1], "portal": "field"})
    assert hq.status_code == 401
    assert (await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})).status_code == 422  # portal is mandatory
    async with SessionLocal() as s:
        assert (await s.execute(select(AuditLog).where(AuditLog.action == "PORTAL_DENIED"))).scalars().first() is not None


async def test_passkey_cannot_open_the_wrong_portal(client, admin):
    auth = SoftAuthenticator()
    await enrol(client, admin, auth)
    o = (await client.post("/api/v1/auth/passkeys/login/options", json={"portal": "field"})).json()
    r = await client.post("/api/v1/auth/passkeys/login/verify", json={"flow_id": o["flow_id"], "credential": auth.sign(o["options"]), "portal": "field"})
    assert r.status_code == 401  # an HQ passkey can't open the field portal
    step1 = (await client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": ADMIN[1], "portal": "command"})).json()
    o = (await client.post("/api/v1/auth/passkeys/login/options", json={"mfa_token": step1["mfa_token"], "portal": "field"}))
    assert o.status_code == 401  # a second-factor token is bound to the portal it started on
