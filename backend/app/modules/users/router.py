import io

import segno
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.db import get_session
from app.core.deps import Ctx, require, require_step_up
from app.core.ratelimit import RateLimiter, client_ip
from app.core.roles import MANAGERS, ROLE_LABELS, Role, portal_for
from app.modules.users import onboarding
from app.modules.users.models import User, UserInvite
from app.modules.users.schemas import InviteOut, InvitePreview, UserCreate, UserCreatedOut, UserOut, UserUpdate
from app.modules.users.service import UserService

router = APIRouter(prefix="/api/v1/users", tags=["users"])
invites_router = APIRouter(prefix="/api/v1/invites", tags=["invites"])
managers = require(*MANAGERS)
# Changing who can access what needs a fresh re-confirmation.
managers_confirmed = require_step_up(*MANAGERS)
me_dep = require(allow_mfa_pending=True)
_invite_limiter = RateLimiter(limit=30, window_seconds=15 * 60)


async def user_out(session: AsyncSession, u: User, invite: UserInvite | None = None) -> UserOut:
    inv = invite or (await onboarding.open_invite(session, u.id) if u.activated_at is None else None)
    status = "disabled" if not u.is_active else "active" if u.activated_at else "invited"
    return UserOut.model_validate(u).model_copy(update={
        "status": status, "has_photo": bool(u.photo_path), "invite_expires_at": inv.expires_at if inv else None})


async def _invite_out(u: User, token: str, inv: UserInvite) -> InviteOut:
    url = onboarding.invite_url(token)
    # Full SVG with its namespace: the browser shows it as an image (data: URI); the
    # "inline" variant has no xmlns and renders as a broken image there.
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", xmldecl=False, svgns=True, scale=5, border=2, dark="#0b1f3a")
    qr = buf.getvalue().decode()
    return InviteOut(url=url, expires_at=inv.expires_at, sent_via=await onboarding.deliver_invite(u, url), qr_svg=qr)


@router.get("", response_model=list[UserOut])
async def list_users(ctx: Ctx = Depends(managers)):
    return [await user_out(ctx.session, u) for u in await UserService(ctx).list()]


@router.post("", response_model=UserCreatedOut, status_code=201)
async def create_user(payload: UserCreate, ctx: Ctx = Depends(managers_confirmed)):
    user, token, inv = await UserService(ctx).create(payload)
    return UserCreatedOut(user=await user_out(ctx.session, user, inv), invite=await _invite_out(user, token, inv))


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(user_id: str, payload: UserUpdate, ctx: Ctx = Depends(managers_confirmed)):
    return await user_out(ctx.session, await UserService(ctx).update(user_id, payload))


@router.post("/{user_id}/invite", response_model=InviteOut)
async def reinvite(user_id: str, ctx: Ctx = Depends(managers_confirmed)):
    user, token, inv = await UserService(ctx).reinvite(user_id)
    return await _invite_out(user, token, inv)


@router.delete("/{user_id}/invite", status_code=204)
async def revoke_invite(user_id: str, ctx: Ctx = Depends(managers_confirmed)):
    await UserService(ctx).revoke_invite(user_id)


@router.post("/{user_id}/revoke-sessions", status_code=204)
async def revoke_sessions(user_id: str, ctx: Ctx = Depends(managers_confirmed)):
    await UserService(ctx).revoke_sessions(user_id)


# ---- photos -----------------------------------------------------------------------
@router.get("/{user_id}/photo")
async def photo(user_id: str, ctx: Ctx = Depends(me_dep)):
    """Your own photo, or (for managers) photos of people in your area."""
    if user_id not in ("me", ctx.user.id) and ctx.user.role not in MANAGERS | {Role.viewer}:
        raise HTTPException(403, "Not allowed")
    target = await UserService(ctx).visible_user(user_id)
    return Response(onboarding.read_photo(target), media_type="image/jpeg",
                    headers={"Cache-Control": "private, max-age=300", "Content-Disposition": "inline"})


@router.post("/me/photo", status_code=204)
async def upload_my_photo(file: UploadFile = File(...), ctx: Ctx = Depends(me_dep)):
    await onboarding.set_photo(ctx.session, ctx.user, await file.read(onboarding.MAX_PHOTO_BYTES + 1))
    audit.record(ctx.session, actor_id=ctx.user.id, action="PHOTO_UPDATE", entity="user", entity_id=ctx.user.id, ip=ctx.ip)
    await ctx.session.commit()


# ---- public invitation endpoints -------------------------------------------------------
@invites_router.get("/{token}", response_model=InvitePreview)
async def preview_invite(token: str, request: Request, session: AsyncSession = Depends(get_session)):
    _invite_limiter.hit(client_ip(request))
    inv, user = await onboarding.find_invite(session, token)
    local, domain = user.email.split("@", 1)
    return InvitePreview(first_name=user.full_name.split()[0], email_hint=f"{local[:2]}•••@{domain}",
                         role_label=ROLE_LABELS[user.role], photo_required=user.role in onboarding.PHOTO_REQUIRED,
                         expires_at=inv.expires_at, portal=portal_for(user.role))


@invites_router.post("/{token}/accept")
async def accept_invite(token: str, request: Request, email: str = Form(..., max_length=160), password: str = Form(..., max_length=200),
                        photo: UploadFile | None = File(None), session: AsyncSession = Depends(get_session)):
    _invite_limiter.hit(client_ip(request))
    raw = await photo.read(onboarding.MAX_PHOTO_BYTES + 1) if photo else None
    user = await onboarding.accept_invite(session, token, email, password, raw or None, client_ip(request))
    return {"portal": portal_for(user.role), "email": user.email}
