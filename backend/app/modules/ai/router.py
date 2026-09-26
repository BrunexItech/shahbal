"""The AI assistant: optional help next to things people already do by hand.

Everything here drafts or explains; nothing is sent, saved or changed by the AI. Each
use is rate-limited per person and written to the audit log (never the text itself)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core import audit
from app.core.config import settings
from app.core.deps import Ctx, any_user, require
from app.core.ratelimit import RateLimiter
from app.core.roles import MANAGERS, OVERSIGHT
from app.core.scope import can_touch_ward
from app.modules.ai import client
from app.modules.ai.context import campaign_facts, facts_json
from app.modules.geo.models import Ward
from app.modules.issues.models import OPEN_STATUSES, Issue
from app.modules.issues.service import LABELS, IssueService

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])
oversight = require(*OVERSIGHT)
managers = require(*MANAGERS)
_limit = RateLimiter(limit=settings.ai_requests_per_hour, window_seconds=3600)

GROUND_RULES = (
    "You work for Team Shahbal, the campaign of Suleiman Shahbal for Governor of Mombasa County, Kenya. "
    "Be accurate, brief and practical. Use plain language. Never invent numbers: use only the facts you are given, "
    "and say plainly when the facts don't answer the question. Never profile or predict how any individual will vote, "
    "and never use ethnicity, religion or tribe. Reply in the language of the request (English or Kiswahili)."
)


def _use(ctx: Ctx, action: str, **extra) -> None:
    _limit.hit(ctx.user.id)
    audit.record(ctx.session, actor_id=ctx.user.id, action=f"AI_{action}", entity="ai", ip=ctx.ip, model=settings.openai_model, **extra)


@router.get("/status")
async def status(ctx: Ctx = Depends(any_user)):
    return {"enabled": client.enabled()}


# ---- Ask the campaign -----------------------------------------------------------
class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=800)
    history: list[Turn] = Field(default_factory=list, max_length=8)


@router.post("/ask")
async def ask(payload: AskIn, ctx: Ctx = Depends(oversight)):
    facts = await campaign_facts(ctx)
    _use(ctx, "ASK")
    await ctx.session.commit()
    convo = "\n".join(f"{t.role.upper()}: {t.content}" for t in payload.history[-6:])
    answer = await client.complete(
        GROUND_RULES + " You answer questions about the campaign's live figures for HQ and coordinators. "
        "Lead with the direct answer, then at most five short bullet points. Name wards and numbers. "
        "If something needs action, end with one line starting 'Next step:'. Use Markdown bullets only (no tables).",
        f"CAMPAIGN FACTS (JSON, limited to what this person may see):\n{facts_json(facts)}\n\n"
        + (f"EARLIER IN THIS CONVERSATION:\n{convo}\n\n" if convo else "")
        + f"QUESTION: {payload.question}",
    )
    return {"answer": answer, "as_of": facts["as_of"]}


@router.post("/briefing")
async def briefing(ctx: Ctx = Depends(oversight)):
    facts = await campaign_facts(ctx)
    _use(ctx, "BRIEFING")
    await ctx.session.commit()
    text = await client.complete(
        GROUND_RULES + " Write the weekly campaign briefing for HQ. Markdown with these headings exactly: "
        "'## Where we stand', '## Wards that need attention', '## What residents are raising', '## This week's plan', '## Recommended actions'. "
        "Under each, 2-5 short bullets with numbers. Keep the whole briefing under 350 words.",
        f"CAMPAIGN FACTS (JSON):\n{facts_json(facts)}",
        max_tokens=2500,
    )
    return {"briefing": text, "as_of": facts["as_of"]}


# ---- Drafting help ----------------------------------------------------------------
class SmsIn(BaseModel):
    purpose: str = Field(min_length=5, max_length=400)
    channel: str = Field(default="sms", pattern="^(sms|whatsapp)$")
    language: str = Field(default="en", pattern="^(en|sw|mixed)$")
    area: str | None = Field(default=None, max_length=200)


@router.post("/draft-sms")
async def draft_sms(payload: SmsIn, ctx: Ctx = Depends(managers)):
    _use(ctx, "DRAFT_SMS", channel=payload.channel)
    await ctx.session.commit()
    limit = 150 if payload.channel == "sms" else 600
    lang = {"en": "English", "sw": "Kiswahili", "mixed": "natural Kenyan mix of English and Kiswahili (Sheng-free)"}[payload.language]
    data = await client.complete_json(
        GROUND_RULES + f" You draft campaign {payload.channel.upper()} messages in {lang}. Each draft must be at most {limit} characters "
        "(an opt-out line is added separately). You may use the placeholders {first_name}, {ward} and {station} exactly as written. "
        "Warm, respectful, no promises of money or gifts, no attacks on opponents. "
        'Return JSON: {"drafts": ["...", "...", "..."]} with three different options.',
        f"PURPOSE: {payload.purpose}\nAUDIENCE AREA: {payload.area or 'as selected'}",
    )
    drafts = [str(d).strip() for d in data.get("drafts", []) if str(d).strip()][:3]
    return {"drafts": [{"text": d, "chars": len(d), "fits": len(d) <= limit} for d in drafts], "limit": limit}


@router.post("/issues/{issue_id}/assist")
async def issue_assist(issue_id: str, ctx: Ctx = Depends(managers)):
    detail = await IssueService(ctx).detail(issue_id)
    if not detail.can_manage:
        raise HTTPException(403, "Only coordinators for this area can use this")
    others = (await ctx.session.execute(
        select(Issue.reference, Issue.category, Issue.summary).where(
            Issue.ward_id == detail.ward_id, Issue.id != detail.id, Issue.status.in_(OPEN_STATUSES)).order_by(Issue.created_at.desc()).limit(25)
    )).all()
    _use(ctx, "ISSUE_ASSIST", issue=detail.reference)
    await ctx.session.commit()
    data = await client.complete_json(
        GROUND_RULES + " You help a ward coordinator handle a resident's report. "
        f"Topics allowed: {', '.join(k.value for k in LABELS)}. "
        'Return JSON: {"topic": "<one allowed topic>", "urgent": true|false, "why": "<one sentence>", '
        '"duplicates": ["<reference of an open report about the same problem>", ...], '
        '"reply": "<a short, warm reply to the resident, max 300 characters, no promises you cannot keep>"}',
        f"REPORT {detail.reference} in {detail.ward} ward ({detail.area or 'no landmark'}), filed as '{detail.category.value}':\n"
        f"{detail.description}\n\nOTHER OPEN REPORTS IN THIS WARD:\n"
        + "\n".join(f"- {r} [{c.value}] {s}" for r, c, s in others),
    )
    refs = {r for r, _, _ in others}
    topic = str(data.get("topic", "")).strip()
    return {
        "topic": topic if topic in {k.value for k in LABELS} else None,
        "urgent": bool(data.get("urgent")),
        "why": str(data.get("why", ""))[:300],
        "duplicates": [d for d in data.get("duplicates", []) if d in refs][:5],
        "reply": str(data.get("reply", ""))[:400],
    }


class PointsIn(BaseModel):
    ward_id: str
    event: str | None = Field(default=None, max_length=200)


@router.post("/talking-points")
async def talking_points(payload: PointsIn, ctx: Ctx = Depends(managers)):
    ward = await ctx.session.get(Ward, payload.ward_id)
    if ward is None or not can_touch_ward(ctx.user, ward):
        raise HTTPException(404, "Ward not found")
    facts = await campaign_facts(ctx)
    local = {"ward": next((w for w in facts["wards"] if w["ward"] == ward.name), None),
             "issues": next((w for w in facts["community_issues_30_days"]["by_ward"] if w["ward"] == ward.name), None),
             "county_topics": facts["community_issues_30_days"]["by_topic"][:6]}
    _use(ctx, "TALKING_POINTS", ward=ward.name)
    await ctx.session.commit()
    text = await client.complete(
        GROUND_RULES + " Write talking points for the candidate's visit. Markdown: a one-line opener, then 4-6 bullets "
        "tied to what residents of this ward have raised, then one line on the ask (join the team / register / vote). "
        "Under 180 words. Don't state figures the residents wouldn't know; speak to their concerns.",
        f"WARD: {ward.name}\nEVENT: {payload.event or 'campaign visit'}\nFACTS (JSON): {facts_json(local)}",
    )
    return {"points": text}

