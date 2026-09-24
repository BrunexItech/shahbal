"""Softphone provisioning, SIP lines and encrypted call recordings."""
from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.core import audit, crypto, vault
from app.core.clock import utcnow
from app.core.config import settings
from app.core.deps import Ctx
from app.core.roles import MANAGERS, Role
from app.core.scope import voter_scope
from app.modules.calls.models import CallRecording, SipAccount
from app.modules.users.models import User
from app.modules.voters.models import Voter

AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"}


async def softphone_config(ctx: Ctx) -> dict:
    base = {"provider": settings.voice_provider, "caller_id": settings.sip_caller_id or None, "stun": settings.stun_servers,
            "recording_retention_days": settings.recording_retention_days}
    if settings.voice_provider != "sip":
        return base
    acct = (await ctx.session.execute(select(SipAccount).where(SipAccount.user_id == ctx.user.id))).scalar_one_or_none()
    if acct is None or not settings.sip_wss_url or not settings.sip_domain:
        raise HTTPException(409, "No phone line is assigned to you yet. Ask HQ to set up your SIP line.")
    audit.record(ctx.session, actor_id=ctx.user.id, action="SOFTPHONE_CONNECT", entity="user", entity_id=ctx.user.id, ip=ctx.ip)
    await ctx.session.commit()
    # The browser must hold the SIP secret to register: standard for WebRTC softphones.
    return {**base, "wss_url": settings.sip_wss_url, "domain": settings.sip_domain,
            "uri": f"sip:{acct.sip_user}@{settings.sip_domain}", "username": acct.sip_user,
            "password": crypto.decrypt(acct.sip_password_enc)}


async def set_sip_account(ctx: Ctx, user_id: str, sip_user: str, sip_password: str) -> None:
    target = await ctx.session.get(User, user_id)
    if target is None or target.role not in MANAGERS | {Role.call_agent}:
        raise HTTPException(404, "Only call-centre staff and coordinators can have a phone line")
    acct = (await ctx.session.execute(select(SipAccount).where(SipAccount.user_id == user_id))).scalar_one_or_none()
    if acct is None:
        acct = SipAccount(user_id=user_id, sip_user=sip_user, sip_password_enc=crypto.encrypt(sip_password))
        ctx.session.add(acct)
    else:
        acct.sip_user, acct.sip_password_enc = sip_user, crypto.encrypt(sip_password)
    audit.record(ctx.session, actor_id=ctx.user.id, action="SIP_LINE_SET", entity="user", entity_id=user_id, ip=ctx.ip, sip_user=sip_user)
    await ctx.session.commit()


async def list_sip_accounts(ctx: Ctx) -> list[dict]:
    rows = (await ctx.session.execute(select(SipAccount, User.full_name, User.role).join(User, User.id == SipAccount.user_id))).all()
    return [{"user_id": a.user_id, "name": n, "role": r.value, "sip_user": a.sip_user} for a, n, r in rows]


async def save_recording(ctx: Ctx, file: UploadFile, voter_id: str | None, dialled: str | None, duration: int, line: str) -> CallRecording:
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in AUDIO_TYPES:
        raise HTTPException(415, "Unsupported recording format")
    data = await file.read(settings.recording_max_mb * 1024 * 1024 + 1)
    if len(data) > settings.recording_max_mb * 1024 * 1024:
        raise HTTPException(413, f"Recording is larger than {settings.recording_max_mb} MB")
    if not data:
        raise HTTPException(422, "Empty recording")
    if voter_id:
        ok = (await ctx.session.execute(select(Voter.id).where(Voter.id == voter_id, voter_scope(ctx.user)))).first()
        if not ok:
            raise HTTPException(404, "Voter not found")
    elif ctx.user.role not in MANAGERS:
        raise HTTPException(403, "Only supervisors can record calls outside the voter queues")
    name, digest = vault.store(data)
    digits = "".join(ch for ch in (dialled or "") if ch.isdigit())
    rec = CallRecording(agent_id=ctx.user.id, voter_id=voter_id, dialled_last4=digits[-4:] or None,
                        duration_seconds=max(0, min(duration, 6 * 3600)), mime=mime, size_bytes=len(data),
                        sha256=digest, path=name, line=line if line in ("sip", "sandbox") else "sandbox")
    ctx.session.add(rec)
    await ctx.session.flush()
    audit.record(ctx.session, actor_id=ctx.user.id, action="RECORDING_ADD", entity="recording", entity_id=rec.id, ip=ctx.ip,
                 voter_id=voter_id, seconds=rec.duration_seconds)
    await ctx.session.commit()
    return rec


def _visible(ctx: Ctx):
    if ctx.user.role == Role.super_admin:
        return CallRecording.id.is_not(None)
    return CallRecording.voter_id.in_(select(Voter.id).where(voter_scope(ctx.user)))


async def list_recordings(ctx: Ctx, agent_id: str | None, voter_id: str | None, page: int, size: int):
    agent = aliased(User)
    stmt = (select(CallRecording, agent.full_name, Voter.full_name, Voter.reference)
            .join(agent, agent.id == CallRecording.agent_id).outerjoin(Voter, Voter.id == CallRecording.voter_id)
            .where(_visible(ctx)))
    if agent_id:
        stmt = stmt.where(CallRecording.agent_id == agent_id)
    if voter_id:
        stmt = stmt.where(CallRecording.voter_id == voter_id)
    total = (await ctx.session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await ctx.session.execute(stmt.order_by(CallRecording.created_at.desc()).limit(size).offset((page - 1) * size))).all()
    return [{"id": r.id, "created_at": r.created_at.isoformat(), "agent": an, "voter": vn, "voter_reference": vr, "voter_id": r.voter_id,
             "dialled_last4": r.dialled_last4, "duration_seconds": r.duration_seconds, "size_bytes": r.size_bytes, "line": r.line,
             "call_log_id": r.call_log_id} for r, an, vn, vr in rows], total


async def play_recording(ctx: Ctx, rec_id: str) -> tuple[bytes, str]:
    rec = (await ctx.session.execute(select(CallRecording).where(CallRecording.id == rec_id, _visible(ctx)))).scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "Recording not found")
    try:
        data = vault.load(rec.path, rec.sha256)
    except FileNotFoundError:
        raise HTTPException(410, "This recording's file is no longer available")
    except Exception:
        audit.record(ctx.session, actor_id=ctx.user.id, action="RECORDING_TAMPERED", entity="recording", entity_id=rec.id, ip=ctx.ip)
        await ctx.session.commit()
        raise HTTPException(500, "Recording failed its integrity check")
    audit.record(ctx.session, actor_id=ctx.user.id, action="RECORDING_PLAY", entity="recording", entity_id=rec.id, ip=ctx.ip)
    await ctx.session.commit()
    return data, rec.mime


async def delete_recording(ctx: Ctx, rec_id: str) -> None:
    rec = await ctx.session.get(CallRecording, rec_id)
    if rec is None:
        raise HTTPException(404, "Recording not found")
    vault.delete(rec.path)
    await ctx.session.delete(rec)
    audit.record(ctx.session, actor_id=ctx.user.id, action="RECORDING_DELETE", entity="recording", entity_id=rec_id, ip=ctx.ip)
    await ctx.session.commit()


async def purge_expired_recordings(session) -> int:
    from datetime import timedelta

    cutoff = utcnow() - timedelta(days=settings.recording_retention_days)
    old = list((await session.execute(select(CallRecording).where(CallRecording.created_at < cutoff).limit(500))).scalars())
    for rec in old:
        vault.delete(rec.path)
        await session.delete(rec)
    if old:
        audit.record(session, actor_id=None, action="RECORDING_PURGE", entity="recording", count=len(old))
    await session.commit()
    return len(old)
