import os

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://shahbal:shahbal@localhost:5436/shahbal_test"
)
os.environ["TESTING"] = "true"

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import select, text  # noqa: E402

from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.core.roles import Role  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.geo.models import Ward  # noqa: E402
from app.modules.geo.service import seed_geography  # noqa: E402
from app.modules.users.models import User  # noqa: E402
from app.modules.voters import service as _voter_service  # noqa: E402,F401  (registers sequence)

ADMIN = ("admin@campaign.co.ke", "AdminPass!1")


@pytest.fixture(scope="session", autouse=True)
async def schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
async def clean():
    async with engine.begin() as conn:
        # DELETE, not TRUNCATE: tiny tables, and TRUNCATE's file rewrite + fsync is slow per test.
        for table in ("audit_logs", "call_recordings", "sip_accounts", "agent_presence", "messages", "call_logs", "visits", "message_campaigns", "election_settings", "voters",
                      "auth_challenges", "known_devices", "passkeys", "user_sessions", "users", "polling_stations",
                      "wards", "constituencies"):
            await conn.execute(text(f"DELETE FROM {table}"))
    async with SessionLocal() as s:
        await seed_geography(s)
        s.add(User(full_name="Test Admin", email=ADMIN[0], password_hash=hash_password(ADMIN[1]), role=Role.super_admin))
        await s.commit()
    from app.modules.auth import router as auth_router
    from app.modules.portal import router as portal_router

    auth_router._login_limiter._hits.clear()
    auth_router._mfa_limiter._hits.clear()
    auth_router._passkey_limiter._hits.clear()
    portal_router._limiter._hits.clear()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def session_headers(response) -> dict:
    token = response.cookies.get("chq_session")
    assert token, response.text
    return {"Cookie": f"chq_session={token}", "X-Requested-With": "fetch"}


async def login(client, email, password, portal: str | None = None) -> dict:
    """Each test 'user' carries its own cookie explicitly; the shared jar is cleared
    so identities never bleed between requests. Without a portal, the one that
    admits the user's role is used (HQ roles → command, field roles → field)."""
    for p in ([portal] if portal else ["command", "field"]):
        r = await client.post("/api/v1/auth/login", json={"email": email, "password": password, "portal": p})
        if r.status_code == 200:
            break
    assert r.status_code == 200, r.text
    client.cookies.clear()
    return session_headers(r)


async def elevate(client, headers: dict, password: str) -> dict:
    """Re-confirm identity (step-up) so sensitive endpoints accept this session."""
    r = await client.post("/api/v1/auth/step-up/verify", json={"method": "password", "password": password}, headers=headers)
    assert r.status_code == 204, r.text
    return headers


@pytest.fixture
async def admin(client):
    return await elevate(client, await login(client, *ADMIN), ADMIN[1])


@pytest.fixture
async def wards():
    async with SessionLocal() as s:
        return {w.name: w for w in (await s.execute(select(Ward))).scalars()}


async def make_user(client, admin_headers, role: str, ward=None, constituency_id=None, email=None) -> dict:
    email = email or f"{role}-{ward.code if ward else constituency_id or 'x'}@campaign.co.ke"
    body = {"full_name": f"{role.replace('_', ' ').title()} User", "email": email, "password": "Password!1", "role": role}
    if ward:
        body["ward_id"] = ward.id
    if constituency_id:
        body["constituency_id"] = constituency_id
    r = await client.post("/api/v1/users", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return await login(client, email, "Password!1")


def voter_payload(ward, national_id="12345678", **kw) -> dict:
    return {"full_name": "amina  wanjiku", "phone": "0712345678", "national_id": national_id,
            "ward_id": ward.id, "consent": True, **kw}
