"""Residents' data rights, from the public page, and HQ's desk to complete them.

The person proves they hold the phone number with a one-time SMS code. We never reveal
whether a number is in the database before that: the start step answers the same way
either way. Stopping contact takes effect immediately; corrections and erasure go to HQ,
who must complete them (the Act expects a response without delay)."""
import hashlib
import hmac
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit, crypto, vault
from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import get_session
from app.core.deps import Ctx, require_step_up
from app.core.phone import to_e164
from app.core.ratelimit import RateLimiter, client_ip
from app.core.roles import ADMINS
from app.modules.calls.models import CallRecording
from app.modules.geo.models import PollingStation, Ward
from app.modules.issues.models import Issue
from app.modules.messaging.transactional import send_system_sms
from app.modules.privacy.models import DataRequest
from app.modules.voters.models import Voter

public = APIRouter(prefix="/api/v1/portal/my-data", tags=["data rights"])
router = APIRouter(prefix="/api/v1/data-requests", tags=["data rights"])
_start_limit = RateLimiter(limit=6, window_seconds=3600)
_verify_limit = RateLimiter(limit=20, window_seconds=3600)
CODE_MINUTES, ACT_MINUTES, MAX_ATTEMPTS = 10, 30, 5


def _hash(code: str) -> str:
    return hmac.new(settings.pii_pepper.encode(), f"dsr:{code}".encode(), hashlib.sha256).hexdigest()


def _act_token(r: DataRequest) -> str:
    return hmac.new(settings.jwt_secret.encode(), f"dsr-act:{r.id}:{r.verified_at.isoformat()}".encode(), hashlib.sha256).hexdigest()[:40]


async def _holdings(session: AsyncSession, phone: str) -> dict:
    voters = (await session.execute(
        select(Voter, Ward.name, PollingStation.name).join(Ward, Ward.id == Voter.ward_id)
        .outerjoin(PollingStation, PollingStation.id == Voter.station_id).where(Voter.phone == phone)
    )).all()
    issues = (await session.execute(select(Issue).where(Issue.reporter_phone == phone).order_by(Issue.created_at))).scalars().all()
    return {
        "records": [{"reference": v.reference, "name": v.full_name, "phone": v.phone, "national_id": crypto.mask(v.national_id_last4),
                     "birth_year": v.birth_year, "gender": v.gender.value if v.gender else None, "ward": wn, "polling_centre": sn,
                     "voter_card": v.voter_card_no, "status": v.status.value, "support": v.support.value, "source": v.source.value,
                     "consented_at": v.consent_at.isoformat() if v.consent_at else None, "registered_at": v.created_at.isoformat(),
                     "no_contact": v.opted_out or v.do_not_call} for v, wn, sn in voters],
        "reports": [{"reference": i.reference, "topic": i.category.value, "summary": i.summary, "status": i.status.value,
                     "name_given": i.reporter_name, "sms_updates": i.contact_ok, "reported_at": i.created_at.isoformat()} for i in issues],
    }


# ---- public -----------------------------------------------------------------------------
class StartIn(BaseModel):
    phone: str = Field(min_length=9, max_length=20)
    website: str | None = None  # honeypot


@public.post("/start", status_code=202)
async def start(payload: StartIn, request: Request, session: AsyncSession = Depends(get_session)):
    """Sends a code if (and only if) we hold something for this number. Same answer either way."""
    _start_limit.hit(client_ip(request))
    answer = {"message": "If we hold information for this number, we've sent it a 6-digit code by SMS."}
    try:
        phone = to_e164(payload.phone)
    except ValueError:
        raise HTTPException(422, "Enter a valid Kenyan mobile number")
    r = DataRequest(phone=phone)
    session.add(r)
    await session.flush()
    answer["request_id"] = r.id
    if payload.website:
        await session.commit()
        return answer
    known = (await session.execute(select(Voter.id).where(Voter.phone == phone).limit(1))).first() or \
        (await session.execute(select(Issue.id).where(Issue.reporter_phone == phone).limit(1))).first()
    if known:
        code = f"{secrets.randbelow(10**6):06d}"
        r.code_hash, r.code_expires_at = _hash(code), utcnow() + timedelta(minutes=CODE_MINUTES)
        await send_system_sms(phone, f"{settings.sms_sender_name}: your code to see or manage your data is {code}. It expires in {CODE_MINUTES} minutes. "
                                     "If you didn't ask for this, ignore this message.")
    audit.record(session, actor_id=None, action="DSR_START", entity="data_request", entity_id=r.id, ip=client_ip(request))
    await session.commit()
    return answer


class VerifyIn(BaseModel):
    request_id: str
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


@public.post("/verify")
async def verify(payload: VerifyIn, request: Request, session: AsyncSession = Depends(get_session)):
    _verify_limit.hit(client_ip(request))
    r = await session.get(DataRequest, payload.request_id)
    wrong = HTTPException(422, "That code isn't right, or it has expired. Ask for a new one.")
    if r is None or r.status != "verifying" or not r.code_hash or r.code_expires_at < utcnow() or r.attempts >= MAX_ATTEMPTS:
        raise wrong
    r.attempts += 1
    if not hmac.compare_digest(r.code_hash, _hash(payload.code)):
        await session.commit()
        raise wrong
    r.verified_at, r.code_hash = utcnow(), None
    audit.record(session, actor_id=None, action="DSR_VERIFIED", entity="data_request", entity_id=r.id, ip=client_ip(request))
    await session.commit()
    return {"token": _act_token(r), **(await _holdings(session, r.phone))}


class ActIn(BaseModel):
    token: str = Field(min_length=40, max_length=40)
    action: str = Field(pattern="^(stop|correct|erase)$")
    details: str | None = Field(default=None, max_length=1000)


@public.post("/{rid}/act")
async def act(rid: str, payload: ActIn, request: Request, session: AsyncSession = Depends(get_session)):
    r = await session.get(DataRequest, rid)
    if r is None or not r.verified_at or r.status != "verifying" or utcnow() - r.verified_at > timedelta(minutes=ACT_MINUTES) \
            or not hmac.compare_digest(payload.token, _act_token(r)):
        raise HTTPException(403, "This session has expired. Start again with your number.")
    ip = client_ip(request)
    if payload.action == "correct" and not (payload.details or "").strip():
        raise HTTPException(422, "Tell us what should be corrected")
    r.kind, r.details = payload.action, (payload.details or "").strip() or None
    if payload.action == "stop":
        # Takes effect now: no more SMS, WhatsApp or calls, and no updates on reports.
        await session.execute(update(Voter).where(Voter.phone == r.phone).values(opted_out=True, do_not_call=True))
        await session.execute(update(Issue).where(Issue.reporter_phone == r.phone).values(contact_ok=False))
        r.status, r.handled_at, r.note = "done", utcnow(), "Contact stopped at the person's request."
    else:
        r.status = "open"
    audit.record(session, actor_id=None, action=f"DSR_{payload.action.upper()}", entity="data_request", entity_id=r.id, ip=ip)
    await session.commit()
    return {"status": r.status, "message": {
        "stop": "Done. You won't be contacted by the campaign again.",
        "correct": "Thank you. HQ will correct your details and confirm by SMS.",
        "erase": "Your request is with HQ. Your details will be erased and we'll confirm by SMS.",
    }[payload.action]}


# ---- HQ -----------------------------------------------------------------------------------
hq = require_step_up(*ADMINS)


@router.get("")
async def list_requests(status: str | None = Query("open", pattern="^(open|done|rejected|all)$"), ctx: Ctx = Depends(hq)):
    q = select(DataRequest).where(DataRequest.status != "verifying").order_by(DataRequest.created_at.desc()).limit(200)
    if status != "all":
        q = q.where(DataRequest.status == status)
    out = []
    for r in (await ctx.session.execute(q)).scalars():
        out.append({"id": r.id, "phone": r.phone, "kind": r.kind, "status": r.status, "details": r.details, "note": r.note,
                    "created_at": r.created_at.isoformat(), "handled_at": r.handled_at.isoformat() if r.handled_at else None,
                    **(await _holdings(ctx.session, r.phone))})
    return out


class ResolveIn(BaseModel):
    outcome: str = Field(pattern="^(done|rejected)$")
    note: str = Field(min_length=3, max_length=500)
    erase: bool = False  # for erasure requests: delete their records now


@router.post("/{rid}/resolve")
async def resolve(rid: str, payload: ResolveIn, ctx: Ctx = Depends(hq)):
    r = await ctx.session.get(DataRequest, rid)
    if r is None or r.status != "open":
        raise HTTPException(404, "Open request not found")
    erased = 0
    if payload.erase:
        if r.kind != "erase" or payload.outcome != "done":
            raise HTTPException(422, "Erase only when completing an erasure request")
        voters = (await ctx.session.execute(select(Voter).where(Voter.phone == r.phone))).scalars().all()
        ids = [v.id for v in voters]
        if ids:
            for rec in (await ctx.session.execute(select(CallRecording).where(CallRecording.voter_id.in_(ids)))).scalars():
                vault.delete(rec.path)  # the voice goes too
                await ctx.session.delete(rec)
        for v in voters:
            await ctx.session.delete(v)  # messages and call logs go with the record
        await ctx.session.execute(update(Issue).where(Issue.reporter_phone == r.phone)
                                  .values(reporter_name=None, reporter_phone=None, contact_ok=False))
        erased = len(voters)
    r.status, r.note, r.handled_by_id, r.handled_at = payload.outcome, payload.note.strip(), ctx.user.id, utcnow()
    audit.record(ctx.session, actor_id=ctx.user.id, action=f"DSR_{payload.outcome.upper()}", entity="data_request", entity_id=r.id,
                 ip=ctx.ip, kind=r.kind, erased=erased)
    phone = r.phone
    if payload.erase:
        r.phone = "erased"  # the request itself keeps no number once the data is gone
    await ctx.session.commit()
    await send_system_sms(phone, f"{settings.sms_sender_name}: your data request has been "
                                 f"{'completed' if payload.outcome == 'done' else 'reviewed'}. {payload.note.strip()[:200]}")
    return {"status": r.status, "erased_records": erased}

