"""Invitation-only onboarding and staff photos.

Flow: HQ creates a person with a specific email → a single-use link (72 h) is
generated and sent to that email/phone → the person opens it, re-types the exact
email, sets a password and (for data collectors) takes a profile photo → only
then does the account work. Nobody can self-register; an installed copy of the
app is useless without an invitation.
"""
import asyncio
import hashlib
import io
import logging
import secrets
import smtplib
from datetime import timedelta
from email.message import EmailMessage

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit, vault
from app.core.clock import utcnow
from app.core.config import settings
from app.core.roles import Role
from app.core.security import hash_password, password_problems
from app.modules.messaging.transactional import send_system_sms
from app.modules.users.models import User, UserInvite

log = logging.getLogger("onboarding")

PHOTO_REQUIRED = {Role.field_agent, Role.call_agent}  # the people collecting data
MAX_PHOTO_BYTES = 8 * 1024 * 1024
PHOTO_SIZE = 512
MAX_EMAIL_ATTEMPTS = 5


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def invite_url(token: str) -> str:
    return f"{settings.app_url.rstrip('/')}/invite/{token}"


def unusable_password() -> str:
    """Invited accounts get a random hash nobody knows: they can't sign in yet."""
    return hash_password(secrets.token_urlsafe(48))


async def issue_invite(session: AsyncSession, user: User, created_by: User | None) -> tuple[str, UserInvite]:
    """New link; any earlier unused link for this person stops working."""
    now = utcnow()
    await session.execute(update(UserInvite).where(UserInvite.user_id == user.id, UserInvite.used_at.is_(None),
                                                   UserInvite.revoked_at.is_(None)).values(revoked_at=now))
    token = secrets.token_urlsafe(32)
    inv = UserInvite(user_id=user.id, token_hash=_hash(token), expires_at=now + timedelta(hours=settings.invite_hours),
                     created_by_id=created_by.id if created_by else None)
    session.add(inv)
    await session.flush()
    return token, inv


async def revoke_invites(session: AsyncSession, user_id: str) -> None:
    await session.execute(update(UserInvite).where(UserInvite.user_id == user_id, UserInvite.used_at.is_(None),
                                                   UserInvite.revoked_at.is_(None)).values(revoked_at=utcnow()))


async def open_invite(session: AsyncSession, user_id: str) -> UserInvite | None:
    return (await session.execute(select(UserInvite).where(
        UserInvite.user_id == user_id, UserInvite.used_at.is_(None), UserInvite.revoked_at.is_(None),
        UserInvite.expires_at > utcnow()).order_by(UserInvite.created_at.desc()).limit(1))).scalar_one_or_none()


# ---- delivery ------------------------------------------------------------------------
def _send_email_sync(to: str, name: str, url: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = f"Your {settings.app_name} invitation"
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    first = name.split()[0]
    msg.set_content(
        f"Habari {first},\n\nYou've been invited to {settings.app_name}.\n\n"
        f"Open this link on the phone or computer you'll use, confirm your email, set a password"
        f" and take your profile photo:\n\n{url}\n\nThe link works once and expires in {settings.invite_hours} hours."
        " If you weren't expecting this, ignore this email.\n")
    msg.add_alternative(
        f"""<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0b1f3a">
<div style="height:4px;background:linear-gradient(90deg,#111 30%,#bb1e10 30% 65%,#006b3f 65%)"></div>
<h2 style="margin:24px 0 8px">Karibu, {first}</h2>
<p>You've been invited to <b>{settings.app_name}</b>. Open the link on the device you'll use, confirm your email,
set a password and take your profile photo.</p>
<p style="margin:28px 0"><a href="{url}" style="background:#006b3f;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Accept invitation</a></p>
<p style="color:#64748b;font-size:13px">This link works once and expires in {settings.invite_hours} hours. If you weren't expecting it, ignore this email.</p>
</div>""", subtype="html")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
        s.starttls()
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)


async def deliver_invite(user: User, url: str) -> list[str]:
    """Best effort; the inviter also sees the link to pass on in person if needed."""
    sent: list[str] = []
    if settings.smtp_host:
        try:
            await asyncio.to_thread(_send_email_sync, user.email, user.full_name, url)
            sent.append("email")
        except Exception:
            log.exception("invite email to %s failed", user.email)
    if user.phone:
        await send_system_sms(user.phone, f"{settings.app_name}: you've been invited. Open {url} to set up your account (expires in {settings.invite_hours}h).")
        # With the sandbox provider nothing actually leaves the building: say so.
        sent.append("sms" if settings.sms_provider != "sandbox" else "sms_test")
    return sent


# ---- photos ----------------------------------------------------------------------------
def clean_photo(raw: bytes) -> bytes:
    """Decode, fix orientation, centre-crop to a square, and re-encode as JPEG.
    Re-encoding drops all metadata, including GPS location from phone cameras."""
    if len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Photo is too large (8 MB max)")
    try:
        img = Image.open(io.BytesIO(raw))
        if img.format not in ("JPEG", "PNG", "WEBP", "HEIF", "MPO"):
            raise HTTPException(415, "Use a JPEG, PNG or WebP photo")
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(415, "That file isn't a readable photo")
    img = ImageOps.exif_transpose(img).convert("RGB")
    if min(img.size) < 160:
        raise HTTPException(422, "Photo is too small. Use the camera or a clearer picture")
    img = ImageOps.fit(img, (PHOTO_SIZE, PHOTO_SIZE), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85, optimize=True)
    return out.getvalue()


async def set_photo(session: AsyncSession, user: User, raw: bytes) -> None:
    jpeg = clean_photo(raw)
    old = user.photo_path
    user.photo_path, user.photo_sha256 = vault.store(jpeg, ns="photos")
    user.photo_updated_at = utcnow()
    if old:
        vault.delete(old, ns="photos")


def read_photo(user: User) -> bytes:
    if not user.photo_path or not user.photo_sha256:
        raise HTTPException(404, "No photo")
    try:
        return vault.load(user.photo_path, user.photo_sha256, ns="photos")
    except FileNotFoundError:
        raise HTTPException(404, "No photo")


# ---- acceptance ------------------------------------------------------------------------
async def find_invite(session: AsyncSession, token: str) -> tuple[UserInvite, User]:
    inv = (await session.execute(select(UserInvite).where(UserInvite.token_hash == _hash(token)).with_for_update())).scalar_one_or_none()
    if inv is None or inv.revoked_at is not None:
        raise HTTPException(404, "This invitation link isn't valid. Ask HQ for a new one.")
    if inv.used_at is not None:
        raise HTTPException(410, "This invitation has already been used. Sign in instead.")
    if inv.expires_at <= utcnow():
        raise HTTPException(410, "This invitation has expired. Ask HQ to send a new one.")
    user = await session.get(User, inv.user_id)
    if user is None or not user.is_active:
        raise HTTPException(404, "This invitation link isn't valid. Ask HQ for a new one.")
    return inv, user


async def accept_invite(session: AsyncSession, token: str, email: str, password: str, photo: bytes | None, ip: str) -> User:
    inv, user = await find_invite(session, token)
    if email.strip().lower() != user.email.lower():
        inv.failed_attempts += 1
        if inv.failed_attempts >= MAX_EMAIL_ATTEMPTS:
            inv.revoked_at = utcnow()  # a forwarded/leaked link can't be brute-forced
        audit.record(session, actor_id=user.id, action="INVITE_EMAIL_MISMATCH", entity="user", entity_id=user.id, ip=ip,
                     attempts=inv.failed_attempts)
        await session.commit()
        raise HTTPException(400, "That email doesn't match this invitation.")
    if problem := password_problems(password, user.email):
        raise HTTPException(422, problem)
    if user.role in PHOTO_REQUIRED and not photo and not user.photo_path:
        raise HTTPException(422, "A profile photo is required for your role")
    if photo:
        await set_photo(session, user, photo)
    user.password_hash = hash_password(password)
    user.activated_at = utcnow()
    inv.used_at = utcnow()
    audit.record(session, actor_id=user.id, action="INVITE_ACCEPTED", entity="user", entity_id=user.id, ip=ip)
    await session.commit()
    return user
