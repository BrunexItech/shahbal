"""New-device detection for sign-in alerts.

A random device id lives in a long-lived httpOnly cookie; only its SHA-256 is
stored. The first-ever sign-in just registers the device; any later sign-in from
an unrecognised browser records NEW_DEVICE in the audit trail and texts the user.
"""
import hashlib
import secrets

from fastapi import BackgroundTasks, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.clock import TZ, utcnow
from app.core.config import settings
from app.core.ratelimit import client_ip
from app.modules.auth.models import KnownDevice
from app.modules.messaging.transactional import send_system_sms
from app.modules.users.models import User


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def describe(ua: str | None) -> str:
    ua = ua or ""
    browser = next((n for k, n in (("Edg/", "Edge"), ("Chrome/", "Chrome"), ("Firefox/", "Firefox"), ("Safari/", "Safari")) if k in ua), "a browser")
    os_ = next((n for k, n in (("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"), ("Windows", "Windows"), ("Mac OS", "Mac"), ("Linux", "Linux")) if k in ua), "")
    return f"{browser}{' on ' + os_ if os_ else ''}"


async def check_device(session: AsyncSession, user: User, request: Request, response: Response, tasks: BackgroundTasks) -> bool:
    """Returns True when this sign-in came from a device new to this user."""
    token = request.cookies.get(settings.device_cookie_name)
    ua = (request.headers.get("user-agent") or "")[:300]
    if token:
        known = (await session.execute(
            select(KnownDevice).where(KnownDevice.user_id == user.id, KnownDevice.device_hash == _hash(token))
        )).scalar_one_or_none()
        if known:
            known.last_seen_at = utcnow()
            return False
    else:
        token = secrets.token_urlsafe(32)
    had_devices = (await session.execute(select(func.count(KnownDevice.id)).where(KnownDevice.user_id == user.id))).scalar_one()
    ip = client_ip(request)
    session.add(KnownDevice(user_id=user.id, device_hash=_hash(token), user_agent=ua, first_ip=ip, last_seen_at=utcnow()))
    response.set_cookie(settings.device_cookie_name, token, max_age=400 * 24 * 3600, httponly=True,
                        secure=settings.is_production, samesite="strict", path="/")
    if had_devices:
        audit.record(session, actor_id=user.id, action="NEW_DEVICE", entity="user", entity_id=user.id, ip=ip, device=describe(ua))
        if user.phone:
            when = utcnow().astimezone(TZ).strftime("%d %b %H:%M")
            tasks.add_task(send_system_sms, user.phone,
                           f"{settings.app_name}: new sign-in to your account from {describe(ua)} at {when}. "
                           "If this wasn't you, contact HQ immediately.")
    return bool(had_devices)
