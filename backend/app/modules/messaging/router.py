import hmac

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import get_session
from app.core.deps import Ctx, any_user
from app.core.pagination import Page
from app.core.phone import to_e164
from app.core.ratelimit import client_ip
from app.modules.messaging.dispatcher import refresh_counters
from app.modules.messaging.models import CampaignStatus, Message, MessageCampaign, MessageStatus
from app.modules.messaging.schemas import CampaignIn, CampaignOut, MessageOut, PreviewIn, PreviewOut, ReviewIn
from app.modules.messaging.service import MessagingService
from app.modules.voters.models import Voter

router = APIRouter(prefix="/api/v1/messaging", tags=["messaging"])

STOP_WORDS = {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ACHA", "SITISHA"}


@router.post("/preview", response_model=PreviewOut)
async def preview(payload: PreviewIn, ctx: Ctx = Depends(any_user)):
    return await MessagingService(ctx).preview(payload)


@router.get("/campaigns", response_model=list[CampaignOut])
async def list_campaigns(status: CampaignStatus | None = None, ctx: Ctx = Depends(any_user)):
    return await MessagingService(ctx).list_campaigns(status)


@router.post("/campaigns", response_model=CampaignOut, status_code=201)
async def create_campaign(payload: CampaignIn, ctx: Ctx = Depends(any_user)):
    return await MessagingService(ctx).create(payload)


@router.get("/campaigns/{cid}", response_model=CampaignOut)
async def get_campaign(cid: str, ctx: Ctx = Depends(any_user)):
    return await MessagingService(ctx).get(cid)


@router.post("/campaigns/{cid}/review", response_model=CampaignOut)
async def review_campaign(cid: str, payload: ReviewIn, ctx: Ctx = Depends(any_user)):
    return await MessagingService(ctx).review(cid, payload)


@router.post("/campaigns/{cid}/cancel", response_model=CampaignOut)
async def cancel_campaign(cid: str, ctx: Ctx = Depends(any_user)):
    return await MessagingService(ctx).cancel(cid)


@router.get("/campaigns/{cid}/messages", response_model=Page[MessageOut])
async def campaign_messages(cid: str, page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200), ctx: Ctx = Depends(any_user)):
    items, total = await MessagingService(ctx).messages(cid, page, size)
    return Page(items=items, total=total, page=page, size=size)


# ---- provider webhooks (public; authenticated by shared secret) ---------------
def _check_token(token: str) -> None:
    if not hmac.compare_digest(token.encode(), settings.webhook_secret.encode()):
        raise HTTPException(403, "Invalid webhook token")


async def _opt_out(session: AsyncSession, raw_phone: str, request: Request, channel: str) -> int:
    try:
        phone = to_e164(raw_phone)
    except ValueError:
        return 0
    res = await session.execute(update(Voter).where(Voter.phone == phone, Voter.opted_out.is_(False)).values(opted_out=True))
    audit.record(session, actor_id=None, action="OPT_OUT", entity="phone", entity_id=phone[-4:], ip=client_ip(request),
                 channel=channel, records=res.rowcount)
    await session.commit()
    return res.rowcount


@router.post("/webhooks/at/delivery", include_in_schema=False)
async def at_delivery(request: Request, token: str = Query(...), session: AsyncSession = Depends(get_session)):
    _check_token(token)
    form = await request.form()
    m = (await session.execute(select(Message).where(Message.provider_id == str(form.get("id", ""))))).scalar_one_or_none()
    if m is None:
        return {"ok": True}
    status = str(form.get("status", ""))
    if status == "Success":
        m.status, m.delivered_at = MessageStatus.delivered, utcnow()
    elif status in ("Failed", "Rejected", "AbsentSubscriber", "Expired"):
        m.status, m.error = MessageStatus.failed, (str(form.get("failureReason") or status))[:240]
    await session.flush()
    await refresh_counters_any(session, m.campaign_id)
    await session.commit()
    return {"ok": True}


async def refresh_counters_any(session: AsyncSession, cid: str) -> None:
    """Delivery reports arrive after a campaign is marked sent; keep its counters true."""
    c = await session.get(MessageCampaign, cid)
    if c is None:
        return
    if c.status == CampaignStatus.sending:
        await refresh_counters(session, cid)
        return
    sent, delivered, failed = (await session.execute(
        select(
            func.count(case((Message.status.in_([MessageStatus.sent, MessageStatus.delivered]), 1))),
            func.count(case((Message.status == MessageStatus.delivered, 1))),
            func.count(case((Message.status == MessageStatus.failed, 1))),
        ).where(Message.campaign_id == cid)
    )).one()
    c.sent, c.delivered, c.failed = sent, delivered, failed


@router.post("/webhooks/at/inbound", include_in_schema=False)
async def at_inbound(request: Request, token: str = Query(...), session: AsyncSession = Depends(get_session)):
    _check_token(token)
    form = await request.form()
    words = str(form.get("text", "")).strip().upper().split()
    if words and words[0] in STOP_WORDS:
        await _opt_out(session, str(form.get("from", "")), request, "sms-inbound")
    return {"ok": True}


@router.post("/webhooks/at/optout", include_in_schema=False)
async def at_optout(request: Request, token: str = Query(...), session: AsyncSession = Depends(get_session)):
    _check_token(token)
    form = await request.form()
    await _opt_out(session, str(form.get("phoneNumber", "")), request, "sms-optout")
    return {"ok": True}


@router.get("/webhooks/whatsapp", include_in_schema=False)
async def wa_verify(hub_mode: str = Query(alias="hub.mode"), hub_verify_token: str = Query(alias="hub.verify_token"),
                    hub_challenge: str = Query(alias="hub.challenge")):
    if hub_mode != "subscribe" or not hmac.compare_digest(hub_verify_token.encode(), settings.webhook_secret.encode()):
        raise HTTPException(403, "Verification failed")
    return PlainTextResponse(hub_challenge)


@router.post("/webhooks/whatsapp", include_in_schema=False)
async def wa_events(request: Request, token: str = Query(...), session: AsyncSession = Depends(get_session)):
    _check_token(token)
    body = await request.json()
    for entry in body.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for st in value.get("statuses", []):
                m = (await session.execute(select(Message).where(Message.provider_id == st.get("id")))).scalar_one_or_none()
                if m is None:
                    continue
                if st.get("status") in ("delivered", "read"):
                    m.status, m.delivered_at = MessageStatus.delivered, utcnow()
                elif st.get("status") == "failed":
                    m.status, m.error = MessageStatus.failed, str((st.get("errors") or [{}])[0].get("title", "failed"))[:240]
                await session.flush()
                await refresh_counters_any(session, m.campaign_id)
            for msg in value.get("messages", []):
                text = (msg.get("text") or {}).get("body", "").strip().upper().split()
                if text and text[0] in STOP_WORDS:
                    await _opt_out(session, "+" + msg.get("from", ""), request, "whatsapp")
    await session.commit()
    return {"ok": True}
