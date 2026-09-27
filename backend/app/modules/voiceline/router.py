"""Talk to Shahbal: HQ tries the phone assistant from the browser, exactly as callers will hear it.

The ElevenLabs key never leaves the server: each test conversation gets a one-time signed link."""
import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core import audit
from app.core.config import settings
from app.core.deps import Ctx, require
from app.core.ratelimit import RateLimiter
from app.core.roles import ADMINS
from app.modules.voiceline.agent import AgentError, sync

router = APIRouter(prefix="/api/v1/voice-assistant", tags=["voice assistant"])
hq = require(*ADMINS)
_limit = RateLimiter(limit=30, window_seconds=3600)  # test calls cost ElevenLabs minutes


def _ready() -> bool:
    return bool(settings.elevenlabs_api_key.strip() and settings.elevenlabs_agent_id.strip())


@router.get("/status")
async def status(ctx: Ctx = Depends(hq)):
    return {"enabled": _ready()}


@router.post("/session")
async def session(ctx: Ctx = Depends(hq)):
    if not _ready():
        raise HTTPException(409, "The phone assistant isn't set up yet")
    _limit.hit(ctx.user.id)
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url",
                            params={"agent_id": settings.elevenlabs_agent_id.strip()},
                            headers={"xi-api-key": settings.elevenlabs_api_key.strip()})
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach ElevenLabs. Try again in a moment.")
    if r.status_code != 200:
        raise HTTPException(502, "ElevenLabs didn't start the conversation. Check the API key and agent in backend/.env.")
    audit.record(ctx.session, actor_id=ctx.user.id, action="VOICE_TEST", entity="voice_assistant", entity_id=None, ip=ctx.ip)
    await ctx.session.commit()
    return {"signed_url": r.json()["signed_url"]}


@router.post("/refresh")
async def refresh(ctx: Ctx = Depends(hq)):
    """Reload what the assistant knows from the website's published content (and apply its latest settings)."""
    if not _ready():
        raise HTTPException(409, "The phone assistant isn't set up yet")
    try:
        done = await sync()
    except AgentError as e:
        raise HTTPException(422, str(e))
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach ElevenLabs. Try again in a moment.")
    audit.record(ctx.session, actor_id=ctx.user.id, action="VOICE_REFRESH", entity="voice_assistant", entity_id=None, ip=ctx.ip)
    await ctx.session.commit()
    return {"knowledge_chars": done["knowledge_chars"]}
