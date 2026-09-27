"""The "Talk to Shahbal" phone assistant on ElevenLabs, defined in code: greeting, rules, voice and knowledge.

`sync()` creates the agent (first time) or brings it up to date, and reloads its knowledge from what the
website has published. Used by the Refresh button in the Command Centre and by `python -m scripts.voice_agent`.
"""
import asyncio
import logging
import re
from datetime import timedelta

import httpx
from sqlalchemy import select

from app.core.clock import TZ, utcnow
from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.geo.models import Constituency, Ward
from app.modules.site.models import AgendaItem, NewsPost, SitePage
from app.modules.visits.models import Visit, VisitStatus

API = "https://api.elevenlabs.io"
# The live server and each dev machine get their own agent and knowledge document, so publishing on
# one never overwrites what the other says. Production keeps the phone line.
NAME = "Talk to Shahbal (phone line)" if settings.is_production else "Talk to Shahbal (dev)"
KB_NAME = "Shahbal campaign: published content" + ("" if settings.is_production else " (dev)")
CANDIDATE = "Suleiman Shahbal"

FIRST_MESSAGE = (
    "Habari, and thank you for calling. This is Suleiman Shahbal's AI assistant, speaking in his voice with his approval. "
    "I can tell you about our agenda for Mombasa, upcoming events, or help you report an issue. "
    "Ungependa kuzungumza kwa Kiswahili au English?"
)

PROMPT = f"""You are the AI phone assistant of {CANDIDATE}, candidate for Governor of Mombasa County, Kenya.
You speak in his cloned voice, with his approval. You are not him: never claim to be the man himself.
If asked whether you are real or a person, say plainly that you are his AI assistant and a human team member can call back.

# Language
Reply in the caller's language: Kiswahili or English (switch if they switch). Keep Kiswahili natural, as spoken in Mombasa.

# How to speak (this is a phone call)
- Short answers: one to three sentences, then check what else they need.
- Warm, respectful and calm. No lists read aloud, no web addresses spelled out character by character.
- Numbers and dates spoken naturally.

# What you may say
- Only facts found in the campaign knowledge provided to you (About, Our agenda, events, news).
- If something is not in that knowledge, say you don't have those details and offer that the campaign team calls them back.
- Never invent policies, promises, figures, dates, endorsements or personal facts about {CANDIDATE}.

# What you must never do
- Never attack, insult or speculate about other candidates or parties. If asked, redirect to our agenda.
- Never offer or hint at money, gifts, jobs or favours in exchange for support or votes.
- Never ask for ID numbers, voter card numbers, bank or M-Pesa details, or PINs.
- Never give official election instructions as fact (registration, polling stations, voting rules): refer them to the IEBC,
  the official electoral body, for anything official.
- Don't discuss tribe or religion as reasons to vote.
- If the caller is abusive or threatening, stay calm, say you will end the call, and end it.

# Helping callers
- Agenda: explain the relevant pledge briefly, in plain words.
- Events: say what is coming up near them (ward or constituency) from the events list.
- Problems in their area (water, roads, security, and so on): listen, summarise it back in one sentence, and tell them
  the campaign team will follow it up; they can also report it on the campaign website under "Tell us what matters".
- Joining or volunteering: tell them they can sign up on the campaign website, or a team member can call them back.
- If they ask for a person, or you cannot help: tell them a campaign team member will call them back.

# Ending
When they're done, thank them warmly ("Asante sana" / "Thank you for calling") and end the call.
"""


def _plain(md: str) -> str:
    """Page text for the assistant: no media placeholders or markdown symbols."""
    md = re.sub(r"^\[\[(media|youtube):[^\]]+\]\]\s*$", "", md, flags=re.M)
    md = re.sub(r"\*\*(.+?)\*\*", r"\1", md)
    md = re.sub(r"^#+\s*", "", md, flags=re.M)
    return re.sub(r"\n{3,}", "\n\n", md).strip()


async def knowledge() -> str:
    """Everything the assistant may talk about, from what HQ has published on the website."""
    parts: list[str] = [f"# About the campaign\n{CANDIDATE} is a candidate for Governor of Mombasa County."]
    async with SessionLocal() as s:
        for key, title in (("about", "About"), ("agenda", "Our agenda: introduction"), ("contact", "Contact")):
            p = (await s.execute(select(SitePage).where(SitePage.key == key))).scalar_one_or_none()
            if p and p.body.strip():
                parts.append(f"# {title}\n{_plain(p.body)}")
        items = (await s.execute(select(AgendaItem).where(AgendaItem.published.is_(True)).order_by(AgendaItem.position))).scalars().all()
        if items:
            parts.append("# Our agenda (pledges)\n" + "\n\n".join(f"## {a.title}\n{a.summary}\n{_plain(a.body)}".strip() for a in items))
        events = (await s.execute(
            select(Visit.title, Visit.venue, Visit.scheduled_at, Ward.name, Constituency.name)
            .join(Ward, Ward.id == Visit.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
            .where(Visit.public.is_(True), Visit.status.in_([VisitStatus.scheduled, VisitStatus.in_progress]),
                   Visit.scheduled_at >= utcnow() - timedelta(hours=3))
            .order_by(Visit.scheduled_at).limit(30)
        )).all()
        if events:
            parts.append("# Upcoming public events\n" + "\n".join(
                f"- {t}: {at.astimezone(TZ):%A %d %B at %H:%M}, {venue}, {ward} ward ({cons})" for t, venue, at, ward, cons in events))
        news = (await s.execute(select(NewsPost).where(NewsPost.published.is_(True)).order_by(NewsPost.published_at.desc()).limit(8))).scalars().all()
        if news:
            parts.append("# Recent news\n" + "\n\n".join(f"## {n.title} ({n.published_at.astimezone(TZ):%d %B %Y})\n{n.summary}" for n in news))
    return "\n\n".join(parts)


def config(kb: list[dict]) -> dict:
    return {
        "name": NAME,
        "conversation_config": {
            "agent": {
                "first_message": FIRST_MESSAGE,
                "language": "en",
                "prompt": {
                    "prompt": PROMPT,
                    "llm": settings.elevenlabs_llm,
                    "temperature": 0.2,
                    "knowledge_base": kb,
                    "built_in_tools": {
                        "end_call": {"name": "end_call", "description": "", "params": {"system_tool_type": "end_call"}},
                        "language_detection": {"name": "language_detection", "description": "", "params": {"system_tool_type": "language_detection"}},
                    },
                },
            },
            "tts": {"voice_id": settings.elevenlabs_voice_id.strip(), "model_id": "eleven_v3_conversational", "stability": 0.5, "similarity_boost": 0.8, "speed": 1.0},
            "conversation": {"max_duration_seconds": 600},
            "language_presets": {"sw": {"overrides": {"agent": {"first_message": FIRST_MESSAGE, "language": "sw"}}}},
        },
        # Only our platform (signed links) and phone calls can reach it; not anyone with the agent ID.
        "platform_settings": {"privacy": {"record_voice": True, "retention_days": 90}, "auth": {"enable_auth": True}},
    }



class AgentError(Exception):
    """Something the person running the sync can act on; the message says what."""


async def sync() -> dict:
    """Create or update the agent and refresh its knowledge. Returns what was done."""
    key, voice = settings.elevenlabs_api_key.strip(), settings.elevenlabs_voice_id.strip()
    if not key or not voice:
        raise AgentError("Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in backend/.env first.")
    agent_id = settings.elevenlabs_agent_id.strip()
    async with httpx.AsyncClient(base_url=API, headers={"xi-api-key": key}, timeout=60) as c:
        # Safety lock: the account also holds other agents (e.g. Tolkyn). Only ever touch our own.
        if agent_id:
            mine = await c.get(f"/v1/convai/agents/{agent_id}")
            if mine.status_code != 200 or mine.json().get("name") != NAME:
                raise AgentError(f"ELEVENLABS_AGENT_ID does not point at the '{NAME}' agent. Nothing was changed.")
        text = await knowledge()
        old = (await c.get("/v1/convai/knowledge-base", params={"search": KB_NAME, "page_size": 50})).json().get("documents", [])
        doc = await c.post("/v1/convai/knowledge-base/text", json={"text": text, "name": KB_NAME})
        if doc.status_code >= 300:
            raise AgentError(f"ElevenLabs refused the knowledge document ({doc.status_code}).")
        kb = [{"type": "text", "id": doc.json()["id"], "name": KB_NAME, "usage_mode": "prompt"}]
        body = config(kb)
        r = await (c.patch(f"/v1/convai/agents/{agent_id}", json=body) if agent_id else c.post("/v1/convai/agents/create", json=body))
        if r.status_code >= 300:
            raise AgentError(f"ElevenLabs refused the agent settings ({r.status_code}): {r.text[:300]}")
        created = not agent_id
        agent_id = agent_id or r.json()["agent_id"]
        for d in old:  # earlier copies of the knowledge are no longer used
            if d.get("name") == KB_NAME:
                await c.delete(f"/v1/convai/knowledge-base/{d['id']}", params={"force": "true"})
    return {"agent_id": agent_id, "created": created, "knowledge_chars": len(text)}


# ---- automatic refresh ---------------------------------------------------------------------
log = logging.getLogger("voiceline")
_pending: asyncio.Task | None = None
REFRESH_DELAY = 20  # seconds: several edits in a row become one refresh


def configured() -> bool:
    return bool(settings.elevenlabs_api_key.strip() and settings.elevenlabs_voice_id.strip() and settings.elevenlabs_agent_id.strip())


def schedule_refresh() -> None:
    """Called after HQ publishes on the website: the assistant picks up the change on its own, shortly after.
    Never raises; a failed refresh is logged and the Refresh button remains."""
    global _pending
    if settings.testing or not configured() or (_pending and not _pending.done()):
        return

    async def run() -> None:
        await asyncio.sleep(REFRESH_DELAY)
        try:
            done = await sync()
            log.info("phone assistant refreshed (%s characters)", done["knowledge_chars"])
        except Exception:
            log.exception("phone assistant refresh failed")

    try:
        _pending = asyncio.get_running_loop().create_task(run())
    except RuntimeError:  # no event loop (e.g. a script): nothing to schedule
        pass
