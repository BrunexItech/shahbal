"""The "Talk to Shahbal" phone assistant on ElevenLabs: create it, or bring it up to date.

    python -m scripts.voice_agent          # create (first run) or update the agent
    python -m scripts.voice_agent --show   # print what is configured, change nothing

The whole setup lives here (greeting, rules, voice, knowledge), so dev and the server get the
same assistant. Its knowledge is the website's published content only (About, Our agenda,
upcoming public events, recent news); run this again after publishing to refresh it.
The first run prints ELEVENLABS_AGENT_ID: put it in backend/.env.
"""
import asyncio
import re
import sys
from datetime import timedelta

import httpx
from sqlalchemy import select

import app.models  # noqa: F401  (register every table)
from app.core.clock import TZ, utcnow
from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.geo.models import Constituency, Ward
from app.modules.site.models import AgendaItem, NewsPost, SitePage
from app.modules.visits.models import Visit, VisitStatus

API = "https://api.elevenlabs.io"
NAME = "Talk to Shahbal (phone line)"
KB_NAME = "Shahbal campaign: published content"
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
        "platform_settings": {"privacy": {"record_voice": True, "retention_days": 90}},
    }


async def main() -> None:
    key, voice = settings.elevenlabs_api_key.strip(), settings.elevenlabs_voice_id.strip()
    if not key or not voice:
        sys.exit("Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in backend/.env first.")
    h = {"xi-api-key": key}
    agent_id = settings.elevenlabs_agent_id.strip()
    async with httpx.AsyncClient(base_url=API, headers=h, timeout=60) as c:
        # Safety lock: this account also holds other agents (e.g. Tolkyn). Only ever touch our own.
        if agent_id:
            mine = await c.get(f"/v1/convai/agents/{agent_id}")
            if mine.status_code != 200 or mine.json().get("name") != NAME:
                sys.exit(f"ELEVENLABS_AGENT_ID does not point at the '{NAME}' agent. Nothing was changed.")
        if "--show" in sys.argv:
            if not agent_id:
                sys.exit("No ELEVENLABS_AGENT_ID yet: run without --show to create the agent.")
            d = (await c.get(f"/v1/convai/agents/{agent_id}")).json()
            a = d["conversation_config"]["agent"]
            print(d.get("name"), "|", a["prompt"].get("llm"), "| knowledge:", [k.get("name") for k in a["prompt"].get("knowledge_base", [])])
            return

        # Knowledge: one text document with everything published, replaced on each run.
        text = await knowledge()
        old = (await c.get("/v1/convai/knowledge-base", params={"search": KB_NAME, "page_size": 50})).json().get("documents", [])
        doc = await c.post("/v1/convai/knowledge-base/text", json={"text": text, "name": KB_NAME})
        doc.raise_for_status()
        kb = [{"type": "text", "id": doc.json()["id"], "name": KB_NAME, "usage_mode": "prompt"}]

        body = config(kb)
        if agent_id:
            r = await c.patch(f"/v1/convai/agents/{agent_id}", json=body)
        else:
            r = await c.post("/v1/convai/agents/create", json=body)
        if r.status_code >= 300:
            sys.exit(f"ElevenLabs refused the agent settings ({r.status_code}): {r.text[:600]}")
        agent_id = agent_id or r.json()["agent_id"]
        # Old copies of the knowledge document are no longer used.
        for d in old:
            if d.get("name") == KB_NAME:
                await c.delete(f"/v1/convai/knowledge-base/{d['id']}", params={"force": "true"})
        print(f"Agent ready: {NAME}")
        print(f"Knowledge: {len(text):,} characters from the published website")
        if not settings.elevenlabs_agent_id.strip():
            print(f"\nAdd this line to backend/.env:\nELEVENLABS_AGENT_ID={agent_id}")


if __name__ == "__main__":
    asyncio.run(main())
