from dataclasses import dataclass
from datetime import timedelta

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import get_session
from app.core.ratelimit import client_ip
from app.core.roles import Role
from app.core.security import decode_token
from app.modules.users.models import User, UserSession

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_HEADER = "x-requested-with"


@dataclass
class Ctx:
    """Everything a service needs about the caller for one request."""

    session: AsyncSession
    user: User
    ip: str
    session_id: str | None = None
    user_session: UserSession | None = None


def mfa_setup_pending(user: User) -> bool:
    """Production policy: roles in MFA_ROLES must enrol a passkey or an authenticator app."""
    return settings.is_production and user.role.value in settings.mfa_roles and not user.has_second_factor


def _token(request: Request) -> tuple[str | None, bool]:
    """Returns (token, from_cookie). Bearer is accepted for non-browser API clients."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:], False
    return request.cookies.get(settings.cookie_name), True


async def _authenticate(request: Request, session: AsyncSession, allow_mfa_pending: bool) -> tuple[User, UserSession]:
    token, from_cookie = _token(request)
    if not token:
        raise HTTPException(401, "Not authenticated")
    # CSRF: a cookie-authenticated write must carry a custom header, which a
    # cross-site form or <img> can't add and a cross-origin fetch can't send
    # without passing our CORS allow-list. SameSite=Strict is the second layer.
    if from_cookie and request.method not in SAFE_METHODS and not request.headers.get(CSRF_HEADER):
        raise HTTPException(403, "Missing CSRF header")
    try:
        payload = decode_token(token, "session")
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired, please sign in again")
    us = await session.get(UserSession, payload.get("sid"))
    now = utcnow()
    if us is None or us.revoked_at is not None or us.expires_at <= now or us.user_id != payload["sub"]:
        raise HTTPException(401, "Session expired, please sign in again")
    user = await session.get(User, us.user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Account disabled")
    if not allow_mfa_pending and mfa_setup_pending(user):
        raise HTTPException(403, "Two-factor authentication must be set up before continuing")
    # Throttled touch so "last seen" is useful without a write per request.
    if us.last_seen_at is None or now - us.last_seen_at > timedelta(minutes=5):
        us.last_seen_at = now
        await session.commit()
    return user, us


def require(*roles: Role, allow_mfa_pending: bool = False):
    allowed = set(roles)

    async def dep(request: Request, session: AsyncSession = Depends(get_session)) -> Ctx:
        user, us = await _authenticate(request, session, allow_mfa_pending)
        if allowed and user.role not in allowed:
            raise HTTPException(403, "You do not have access to this action")
        return Ctx(session=session, user=user, ip=client_ip(request), session_id=us.id, user_session=us)

    return dep


STEP_UP_STATUS = 428  # Precondition Required: the client re-confirms identity, then retries


def require_step_up(*roles: Role, allow_mfa_pending: bool = False):
    """Like `require`, plus a recent re-confirmation (passkey / authenticator code)
    for actions that could leak data or change access even from an unlocked device."""
    base = require(*roles, allow_mfa_pending=allow_mfa_pending)

    async def dep(ctx: Ctx = Depends(base)) -> Ctx:
        us = ctx.user_session
        if us is None or us.elevated_until is None or us.elevated_until <= utcnow():
            raise HTTPException(STEP_UP_STATUS, "Please confirm it's you to continue")
        return ctx

    return dep


any_user = require()
