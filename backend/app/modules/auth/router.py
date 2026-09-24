from datetime import timedelta

import jwt
import segno
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit, crypto
from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import get_session
from app.core.deps import STEP_UP_STATUS, Ctx, mfa_setup_pending, require, require_step_up
from app.core.ratelimit import RateLimiter, client_ip
from app.core.roles import PORTAL_ROLES, Role
from app.core.security import (
    burn_password_check,
    create_mfa_token,
    create_session_token,
    decode_token,
    hash_password,
    new_totp_secret,
    password_problems,
    totp_uri,
    verify_password,
    verify_totp,
)
from app.modules.auth import passkeys
from app.modules.auth.devices import check_device
from app.modules.auth.models import ChallengePurpose, Passkey
from app.modules.auth.schemas import (
    CodeIn,
    LoginIn,
    LoginOut,
    MeOut,
    MfaIn,
    OptionsOut,
    PasskeyOptionsIn,
    PasskeyRegisterIn,
    PasskeyRegisterOptionsIn,
    PasskeyVerifyIn,
    PasswordChangeIn,
    SessionOut,
    StepUpIn,
    StepUpOptionsOut,
    TotpSetupOut,
)
from app.modules.users.models import User, UserSession
from app.modules.users.schemas import UserOut
from app.modules.users.service import revoke_all_sessions

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_login_limiter = RateLimiter(limit=20, window_seconds=15 * 60)
_mfa_limiter = RateLimiter(limit=10, window_seconds=15 * 60)
_passkey_limiter = RateLimiter(limit=30, window_seconds=15 * 60)
me_dep = require(allow_mfa_pending=True)

GENERIC_FAIL = "Incorrect email or password"
STRONG_METHODS = {"totp", "passkey"}


def _mfa_methods(user: User) -> list[str]:
    return [m for m, on in (("passkey", user.passkey_count > 0), ("totp", user.totp_enabled)) if on]


def _portal_admits(user: User, portal: str) -> bool:
    return user.role in PORTAL_ROLES.get(portal, set())


def _deny_portal(session: AsyncSession, user: User, portal: str, ip: str) -> None:
    """Right credentials, wrong door: record it, but answer exactly like a bad password
    so the page reveals nothing about which accounts exist or what role they hold."""
    audit.record(session, actor_id=user.id, action="PORTAL_DENIED", entity="user", entity_id=user.id, ip=ip, portal=portal)


async def _start_session(session: AsyncSession, user: User, request: Request, response: Response,
                         tasks: BackgroundTasks, method: str, portal: str) -> LoginOut:
    """The one place a session is created, whatever the sign-in method."""
    now = utcnow()
    us = UserSession(
        portal=portal,
        user_id=user.id,
        expires_at=now + timedelta(hours=settings.session_hours),
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300],
        auth_method=method,
        # A fresh strong sign-in counts as a recent re-confirmation.
        elevated_until=now + timedelta(minutes=settings.step_up_minutes) if method in STRONG_METHODS else None,
    )
    session.add(us)
    await session.flush()
    user.last_login_at, user.failed_logins, user.locked_until = now, 0, None
    response.set_cookie(
        settings.cookie_name, create_session_token(user.id, us.id), max_age=settings.session_hours * 3600,
        httponly=True, secure=settings.is_production, samesite="strict", path="/",
    )
    new_device = await check_device(session, user, request, response, tasks)
    audit.record(session, actor_id=user.id, action="LOGIN", entity="user", entity_id=user.id, ip=us.ip,
                 method=method, portal=portal, new_device=new_device)
    await session.commit()
    return LoginOut(user=UserOut.model_validate(user))


def _user_from_mfa_token(token: str, portal: str) -> str:
    try:
        payload = decode_token(token, "mfa")
    except jwt.PyJWTError:
        raise HTTPException(401, "Your sign-in expired. Please start again.")
    if payload.get("portal") != portal:  # a token from one portal can't finish sign-in on the other
        raise HTTPException(401, "Your sign-in expired. Please start again.")
    return payload["sub"]


# ---- password (+ second factor) ---------------------------------------------------
@router.post("/login", response_model=LoginOut)
async def login(payload: LoginIn, request: Request, response: Response, tasks: BackgroundTasks,
                session: AsyncSession = Depends(get_session)):
    ip = client_ip(request)
    email = payload.email.strip().lower()
    _login_limiter.hit(f"{ip}:{email}")
    user = (await session.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
    now = utcnow()

    if user is None:
        burn_password_check(payload.password)
        raise HTTPException(401, GENERIC_FAIL)
    if user.locked_until and user.locked_until > now:
        raise HTTPException(423, "Too many failed attempts. This account is locked for a few minutes.")
    if not verify_password(payload.password, user.password_hash):
        user.failed_logins += 1
        if user.failed_logins >= settings.max_failed_logins:
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            user.failed_logins = 0
            audit.record(session, actor_id=user.id, action="LOCKOUT", entity="user", entity_id=user.id, ip=ip)
        await session.commit()
        raise HTTPException(401, GENERIC_FAIL)
    if not user.is_active:
        raise HTTPException(403, "This account has been disabled")
    if not _portal_admits(user, payload.portal):
        _deny_portal(session, user, payload.portal, ip)
        await session.commit()
        raise HTTPException(401, GENERIC_FAIL)

    if user.has_second_factor:
        user.failed_logins = 0
        await session.commit()
        return LoginOut(mfa_required=True, mfa_token=create_mfa_token(user.id, payload.portal), mfa_methods=_mfa_methods(user))
    return await _start_session(session, user, request, response, tasks, "password", payload.portal)


@router.post("/mfa", response_model=LoginOut)
async def login_mfa(payload: MfaIn, request: Request, response: Response, tasks: BackgroundTasks,
                    session: AsyncSession = Depends(get_session)):
    user_id = _user_from_mfa_token(payload.mfa_token, payload.portal)
    _mfa_limiter.hit(user_id)
    user = await session.get(User, user_id)
    if user is None or not user.is_active or not user.totp_enabled or not user.totp_secret_enc or not _portal_admits(user, payload.portal):
        raise HTTPException(401, "Your sign-in expired. Please start again.")
    if not verify_totp(crypto.decrypt(user.totp_secret_enc), payload.code):
        audit.record(session, actor_id=user.id, action="MFA_FAIL", entity="user", entity_id=user.id, ip=client_ip(request))
        await session.commit()
        raise HTTPException(401, "That code is incorrect or has expired")
    return await _start_session(session, user, request, response, tasks, "totp", payload.portal)


# ---- passkey sign-in (passwordless, or as the second factor) ----------------------
@router.post("/passkeys/login/options", response_model=OptionsOut)
async def passkey_login_options(payload: PasskeyOptionsIn, request: Request, session: AsyncSession = Depends(get_session)):
    _passkey_limiter.hit(client_ip(request))
    if payload.mfa_token:
        user = await session.get(User, _user_from_mfa_token(payload.mfa_token, payload.portal))
        if user is None or not user.is_active:
            raise HTTPException(401, "Your sign-in expired. Please start again.")
        flow, opts = await passkeys.authentication_options(session, ChallengePurpose.second_factor, user)
    else:
        flow, opts = await passkeys.authentication_options(session, ChallengePurpose.login, None)
    await session.commit()
    return OptionsOut(flow_id=flow, options=opts)


@router.post("/passkeys/login/verify", response_model=LoginOut)
async def passkey_login_verify(payload: PasskeyVerifyIn, request: Request, response: Response, tasks: BackgroundTasks,
                               session: AsyncSession = Depends(get_session)):
    ip = client_ip(request)
    _passkey_limiter.hit(ip)
    expected = _user_from_mfa_token(payload.mfa_token, payload.portal) if payload.mfa_token else None
    purpose = ChallengePurpose.second_factor if expected else ChallengePurpose.login
    try:
        _, user = await passkeys.authenticate(session, payload.flow_id, purpose, payload.credential, expected)
    except HTTPException:
        # Commit so the challenge stays burned even when verification fails (no retries on one challenge).
        audit.record(session, actor_id=expected, action="PASSKEY_FAIL", entity="user", entity_id=expected, ip=ip)
        await session.commit()
        raise
    if not _portal_admits(user, payload.portal):
        # Passwordless: the passkey picked the account, so the portal check happens here.
        _deny_portal(session, user, payload.portal, ip)
        await session.commit()
        raise HTTPException(401, "Passkey sign-in failed")
    return await _start_session(session, user, request, response, tasks, "passkey", payload.portal)


# ---- session ---------------------------------------------------------------------
@router.post("/logout", status_code=204)
async def logout(response: Response, ctx: Ctx = Depends(me_dep)):
    if ctx.user_session:
        ctx.user_session.revoked_at = utcnow()
    audit.record(ctx.session, actor_id=ctx.user.id, action="LOGOUT", entity="user", entity_id=ctx.user.id, ip=ctx.ip)
    await ctx.session.commit()
    response.delete_cookie(settings.cookie_name, path="/")


@router.get("/me", response_model=MeOut)
async def me(ctx: Ctx = Depends(me_dep)):
    us = ctx.user_session
    elevated = us.elevated_until if us and us.elevated_until and us.elevated_until > utcnow() else None
    return MeOut(**UserOut.model_validate(ctx.user).model_dump(), mfa_setup_required=mfa_setup_pending(ctx.user),
                 portal=us.portal if us else "command",
                 passkey_count=ctx.user.passkey_count, session_method=us.auth_method if us else "password",
                 elevated_until=elevated.isoformat() if elevated else None)


# ---- step-up (re-confirm identity for sensitive actions) --------------------------
def _step_up_methods(user: User) -> list[str]:
    # Password is only acceptable when no stronger factor exists (development / first setup).
    return _mfa_methods(user) or ["password"]


@router.post("/step-up/options", response_model=StepUpOptionsOut)
async def step_up_options(ctx: Ctx = Depends(me_dep)):
    methods = _step_up_methods(ctx.user)
    if "passkey" in methods:
        flow, opts = await passkeys.authentication_options(ctx.session, ChallengePurpose.step_up, ctx.user)
        await ctx.session.commit()
        return StepUpOptionsOut(methods=methods, flow_id=flow, options=opts)
    return StepUpOptionsOut(methods=methods)


@router.post("/step-up/verify", status_code=204)
async def step_up_verify(payload: StepUpIn, ctx: Ctx = Depends(me_dep)):
    user, us = ctx.user, ctx.user_session
    _mfa_limiter.hit(f"step:{user.id}")
    if payload.method not in _step_up_methods(user) or us is None:
        raise HTTPException(400, "Use one of your sign-in methods to confirm")
    ok = False
    if payload.method == "passkey" and payload.flow_id and payload.credential is not None:
        try:
            await passkeys.authenticate(ctx.session, payload.flow_id, ChallengePurpose.step_up, payload.credential, user.id)
            ok = True
        except HTTPException:
            ok = False
    elif payload.method == "totp" and payload.code and user.totp_secret_enc:
        ok = verify_totp(crypto.decrypt(user.totp_secret_enc), payload.code)
    elif payload.method == "password" and payload.password:
        ok = verify_password(payload.password, user.password_hash)
    if not ok:
        audit.record(ctx.session, actor_id=user.id, action="STEP_UP_FAIL", entity="user", entity_id=user.id, ip=ctx.ip, method=payload.method)
        await ctx.session.commit()
        raise HTTPException(401, "That didn't match. Please try again.")
    us.elevated_until = utcnow() + timedelta(minutes=settings.step_up_minutes)
    audit.record(ctx.session, actor_id=user.id, action="STEP_UP", entity="user", entity_id=user.id, ip=ctx.ip, method=payload.method)
    await ctx.session.commit()


@router.post("/step-up/check", status_code=204)
async def step_up_check(ctx: Ctx = Depends(require_step_up())):
    """Lets the client confirm identity *before* leaving the app (e.g. opening the GIS Lab)."""


async def _guard_factor_change(ctx: Ctx) -> None:
    """Adding a sign-in method to an account that already has one is sensitive
    (a hijacked session must not plant its own passkey): it needs step-up."""
    if ctx.user.has_second_factor:
        us = ctx.user_session
        if us is None or us.elevated_until is None or us.elevated_until <= utcnow():
            raise HTTPException(STEP_UP_STATUS, "Please confirm it's you to continue")


# ---- passkey management -----------------------------------------------------------
@router.get("/passkeys")
async def list_passkeys(ctx: Ctx = Depends(me_dep)):
    return [passkeys.passkey_out(p) for p in await passkeys.user_passkeys(ctx.session, ctx.user.id)]


@router.post("/passkeys/register/options", response_model=OptionsOut)
async def passkey_register_options(payload: PasskeyRegisterOptionsIn, ctx: Ctx = Depends(me_dep)):
    await _guard_factor_change(ctx)
    if ctx.user.passkey_count >= 10:
        raise HTTPException(409, "You already have the maximum of 10 passkeys")
    flow, opts = await passkeys.registration_options(ctx.session, ctx.user, payload.kind)
    await ctx.session.commit()
    return OptionsOut(flow_id=flow, options=opts)


@router.post("/passkeys/register/verify", status_code=201)
async def passkey_register_verify(payload: PasskeyRegisterIn, ctx: Ctx = Depends(me_dep)):
    await _guard_factor_change(ctx)
    pk = await passkeys.register(ctx.session, ctx.user, payload.flow_id, payload.credential, payload.name.strip())
    audit.record(ctx.session, actor_id=ctx.user.id, action="PASSKEY_ADD", entity="user", entity_id=ctx.user.id, ip=ctx.ip,
                 kind=pk.kind, name=pk.name)
    await ctx.session.commit()
    return passkeys.passkey_out(pk)


@router.delete("/passkeys/{passkey_id}", status_code=204)
async def delete_passkey(passkey_id: str, ctx: Ctx = Depends(require_step_up(allow_mfa_pending=True))):
    pk = (await ctx.session.execute(select(Passkey).where(Passkey.id == passkey_id, Passkey.user_id == ctx.user.id))).scalar_one_or_none()
    if pk is None:
        raise HTTPException(404, "Passkey not found")
    remaining_factors = (ctx.user.passkey_count - 1) + (1 if ctx.user.totp_enabled else 0)
    if settings.is_production and ctx.user.role.value in settings.mfa_roles and remaining_factors == 0:
        raise HTTPException(409, "Add another passkey or an authenticator app before removing your last sign-in method")
    await ctx.session.delete(pk)
    ctx.user.passkey_count = max(ctx.user.passkey_count - 1, 0)
    audit.record(ctx.session, actor_id=ctx.user.id, action="PASSKEY_REMOVE", entity="user", entity_id=ctx.user.id, ip=ctx.ip, name=pk.name)
    await ctx.session.commit()


# ---- authenticator app (TOTP) -------------------------------------------------------
@router.post("/totp/setup", response_model=TotpSetupOut)
async def totp_setup(ctx: Ctx = Depends(me_dep)):
    if ctx.user.totp_enabled:
        raise HTTPException(409, "Two-factor authentication is already on")
    await _guard_factor_change(ctx)
    secret = new_totp_secret()
    ctx.user.totp_secret_enc = crypto.encrypt(secret)
    await ctx.session.commit()
    uri = totp_uri(secret, ctx.user.email)
    return TotpSetupOut(secret=secret, otpauth_uri=uri, qr_svg=segno.make(uri, error="m").svg_inline(scale=5, border=2, dark="#0b1f3a"))


@router.post("/totp/enable", status_code=204)
async def totp_enable(payload: CodeIn, ctx: Ctx = Depends(me_dep)):
    if not ctx.user.totp_secret_enc or ctx.user.totp_enabled:
        raise HTTPException(409, "Start setup first")
    await _guard_factor_change(ctx)
    _mfa_limiter.hit(ctx.user.id)
    if not verify_totp(crypto.decrypt(ctx.user.totp_secret_enc), payload.code):
        raise HTTPException(422, "That code didn't match. Check your phone's time and try again.")
    ctx.user.totp_enabled = True
    audit.record(ctx.session, actor_id=ctx.user.id, action="MFA_ENABLE", entity="user", entity_id=ctx.user.id, ip=ctx.ip)
    await ctx.session.commit()


@router.post("/totp/disable", status_code=204)
async def totp_disable(payload: CodeIn, ctx: Ctx = Depends(require_step_up(allow_mfa_pending=True))):
    if not ctx.user.totp_enabled:
        raise HTTPException(409, "Two-factor authentication is not on")
    if settings.is_production and ctx.user.role.value in settings.mfa_roles and ctx.user.passkey_count == 0:
        raise HTTPException(409, "Add a passkey before turning off your authenticator app")
    _mfa_limiter.hit(ctx.user.id)
    if not verify_totp(crypto.decrypt(ctx.user.totp_secret_enc or ""), payload.code):
        raise HTTPException(422, "That code is incorrect")
    ctx.user.totp_enabled = False
    ctx.user.totp_secret_enc = None
    audit.record(ctx.session, actor_id=ctx.user.id, action="MFA_DISABLE", entity="user", entity_id=ctx.user.id, ip=ctx.ip)
    await ctx.session.commit()


# ---- password & sessions ------------------------------------------------------------
@router.post("/password", status_code=204)
async def change_password(payload: PasswordChangeIn, ctx: Ctx = Depends(me_dep)):
    if not verify_password(payload.current_password, ctx.user.password_hash):
        raise HTTPException(422, "Current password is incorrect")
    if problem := password_problems(payload.new_password, ctx.user.email):
        raise HTTPException(422, problem)
    ctx.user.password_hash = hash_password(payload.new_password)
    await revoke_all_sessions(ctx.session, ctx.user.id, except_id=ctx.session_id)
    audit.record(ctx.session, actor_id=ctx.user.id, action="PASSWORD_CHANGE", entity="user", entity_id=ctx.user.id, ip=ctx.ip)
    await ctx.session.commit()


@router.get("/sessions", response_model=list[SessionOut])
async def my_sessions(ctx: Ctx = Depends(me_dep)):
    rows = (
        await ctx.session.execute(
            select(UserSession)
            .where(UserSession.user_id == ctx.user.id, UserSession.revoked_at.is_(None), UserSession.expires_at > utcnow())
            .order_by(UserSession.created_at.desc())
        )
    ).scalars()
    return [
        SessionOut(id=s.id, ip=s.ip, user_agent=s.user_agent, created_at=s.created_at.isoformat(),
                   last_seen_at=s.last_seen_at.isoformat() if s.last_seen_at else None, current=s.id == ctx.session_id)
        for s in rows
    ]


@router.post("/sessions/revoke-others", status_code=204)
async def revoke_others(ctx: Ctx = Depends(me_dep)):
    await revoke_all_sessions(ctx.session, ctx.user.id, except_id=ctx.session_id)
    audit.record(ctx.session, actor_id=ctx.user.id, action="SESSIONS_REVOKE", entity="user", entity_id=ctx.user.id, ip=ctx.ip)
    await ctx.session.commit()


@router.get("/gis-access", status_code=204, include_in_schema=False)
async def gis_access(ctx: Ctx = Depends(require(Role.super_admin))):
    """nginx `auth_request` target guarding /gis/ (the app shell and its lazy-loaded
    code). The campaign *data* the lab opens comes from the project export, which
    requires a fresh re-confirmation like every other export."""
