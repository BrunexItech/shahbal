from datetime import timedelta

import jwt
import segno
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit, crypto
from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import get_session
from app.core.deps import Ctx, mfa_setup_pending, require
from app.core.ratelimit import RateLimiter, client_ip
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
from app.modules.auth.schemas import (
    CodeIn,
    LoginIn,
    LoginOut,
    MeOut,
    MfaIn,
    PasswordChangeIn,
    SessionOut,
    TotpSetupOut,
)
from app.modules.users.models import User, UserSession
from app.modules.users.schemas import UserOut
from app.modules.users.service import revoke_all_sessions

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_login_limiter = RateLimiter(limit=20, window_seconds=15 * 60)
_mfa_limiter = RateLimiter(limit=10, window_seconds=15 * 60)
me_dep = require(allow_mfa_pending=True)

GENERIC_FAIL = "Incorrect email or password"


async def _start_session(session: AsyncSession, user: User, request: Request, response: Response) -> None:
    us = UserSession(
        user_id=user.id,
        expires_at=utcnow() + timedelta(hours=settings.session_hours),
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300],
    )
    session.add(us)
    await session.flush()
    user.last_login_at = utcnow()
    user.failed_logins = 0
    user.locked_until = None
    response.set_cookie(
        settings.cookie_name,
        create_session_token(user.id, us.id),
        max_age=settings.session_hours * 3600,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        path="/",
    )


@router.post("/login", response_model=LoginOut)
async def login(payload: LoginIn, request: Request, response: Response, session: AsyncSession = Depends(get_session)):
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

    if user.totp_enabled:
        user.failed_logins = 0
        await session.commit()
        return LoginOut(mfa_required=True, mfa_token=create_mfa_token(user.id))

    await _start_session(session, user, request, response)
    audit.record(session, actor_id=user.id, action="LOGIN", entity="user", entity_id=user.id, ip=ip)
    await session.commit()
    return LoginOut(user=UserOut.model_validate(user))


@router.post("/mfa", response_model=LoginOut)
async def login_mfa(payload: MfaIn, request: Request, response: Response, session: AsyncSession = Depends(get_session)):
    ip = client_ip(request)
    try:
        user_id = decode_token(payload.mfa_token, "mfa")["sub"]
    except jwt.PyJWTError:
        raise HTTPException(401, "Your sign-in expired. Please start again.")
    _mfa_limiter.hit(user_id)
    user = await session.get(User, user_id)
    if user is None or not user.is_active or not user.totp_enabled or not user.totp_secret_enc:
        raise HTTPException(401, "Your sign-in expired. Please start again.")
    if not verify_totp(crypto.decrypt(user.totp_secret_enc), payload.code):
        audit.record(session, actor_id=user.id, action="MFA_FAIL", entity="user", entity_id=user.id, ip=ip)
        await session.commit()
        raise HTTPException(401, "That code is incorrect or has expired")
    await _start_session(session, user, request, response)
    audit.record(session, actor_id=user.id, action="LOGIN", entity="user", entity_id=user.id, ip=ip, mfa=True)
    await session.commit()
    return LoginOut(user=UserOut.model_validate(user))


@router.post("/logout", status_code=204)
async def logout(response: Response, ctx: Ctx = Depends(me_dep)):
    us = await ctx.session.get(UserSession, ctx.session_id)
    if us:
        us.revoked_at = utcnow()
    audit.record(ctx.session, actor_id=ctx.user.id, action="LOGOUT", entity="user", entity_id=ctx.user.id, ip=ctx.ip)
    await ctx.session.commit()
    response.delete_cookie(settings.cookie_name, path="/")


@router.get("/me", response_model=MeOut)
async def me(ctx: Ctx = Depends(me_dep)):
    return MeOut(**UserOut.model_validate(ctx.user).model_dump(), mfa_setup_required=mfa_setup_pending(ctx.user))


# ---- 2FA enrolment -------------------------------------------------------------
@router.post("/totp/setup", response_model=TotpSetupOut)
async def totp_setup(ctx: Ctx = Depends(me_dep)):
    if ctx.user.totp_enabled:
        raise HTTPException(409, "Two-factor authentication is already on")
    secret = new_totp_secret()
    ctx.user.totp_secret_enc = crypto.encrypt(secret)
    await ctx.session.commit()
    uri = totp_uri(secret, ctx.user.email)
    return TotpSetupOut(secret=secret, otpauth_uri=uri, qr_svg=segno.make(uri, error="m").svg_inline(scale=5, border=2, dark="#0b1f3a"))


@router.post("/totp/enable", status_code=204)
async def totp_enable(payload: CodeIn, ctx: Ctx = Depends(me_dep)):
    if not ctx.user.totp_secret_enc or ctx.user.totp_enabled:
        raise HTTPException(409, "Start setup first")
    _mfa_limiter.hit(ctx.user.id)
    if not verify_totp(crypto.decrypt(ctx.user.totp_secret_enc), payload.code):
        raise HTTPException(422, "That code didn't match. Check your phone's time and try again.")
    ctx.user.totp_enabled = True
    audit.record(ctx.session, actor_id=ctx.user.id, action="MFA_ENABLE", entity="user", entity_id=ctx.user.id, ip=ctx.ip)
    await ctx.session.commit()


@router.post("/totp/disable", status_code=204)
async def totp_disable(payload: CodeIn, ctx: Ctx = Depends(me_dep)):
    if not ctx.user.totp_enabled:
        raise HTTPException(409, "Two-factor authentication is not on")
    if settings.is_production and ctx.user.role.value in settings.mfa_roles:
        raise HTTPException(403, "Two-factor authentication is mandatory for your role")
    _mfa_limiter.hit(ctx.user.id)
    if not verify_totp(crypto.decrypt(ctx.user.totp_secret_enc or ""), payload.code):
        raise HTTPException(422, "That code is incorrect")
    ctx.user.totp_enabled = False
    ctx.user.totp_secret_enc = None
    audit.record(ctx.session, actor_id=ctx.user.id, action="MFA_DISABLE", entity="user", entity_id=ctx.user.id, ip=ctx.ip)
    await ctx.session.commit()


# ---- password & sessions -----------------------------------------------------
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
