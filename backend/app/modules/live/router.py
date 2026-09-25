import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.clock import utcnow
from app.core.db import SessionLocal
from app.core.deps import idle_limit, Ctx, any_user, require
from app.core.roles import MANAGERS, Role
from app.modules.live.models import AgentPresence, AgentStatus
from app.modules.live.service import call_wall, feed, pulse
from app.modules.users.models import User, UserSession

router = APIRouter(prefix="/api/v1/live", tags=["live"])
TICK_SECONDS = 4
MAX_STREAM_SECONDS = 30 * 60  # clients reconnect; keeps long-lived connections bounded


@router.get("/stream")
async def stream(request: Request, ctx: Ctx = Depends(any_user)):
    user_id, session_id = ctx.user.id, ctx.session_id
    await ctx.session.close()  # don't hold the request's connection for the life of the stream

    async def events():
        since = utcnow()
        started = asyncio.get_running_loop().time()
        yield "retry: 5000\n\n"
        while not await request.is_disconnected():
            async with SessionLocal() as s:
                us = await s.get(UserSession, session_id)
                user = await s.get(User, user_id)
                if (us is None or us.revoked_at is not None or us.expires_at <= utcnow() or user is None or not user.is_active
                        or (us.active_at or us.created_at) + idle_limit(us.portal) <= utcnow()):
                    yield "event: expired\ndata: {}\n\n"
                    return
                now = utcnow()
                payload = {"t": now.isoformat(), "pulse": await pulse(s, user), "events": await feed(s, user, since)}
                if user.role in MANAGERS | {Role.viewer}:
                    payload["calls"] = await call_wall(s)
                since = now
            yield f"event: pulse\ndata: {json.dumps(payload, default=str)}\n\n"
            if asyncio.get_running_loop().time() - started > MAX_STREAM_SECONDS:
                return
            await asyncio.sleep(TICK_SECONDS)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


class PresenceIn(BaseModel):
    status: AgentStatus
    voter_id: str | None = Field(default=None, max_length=36)
    line: str | None = Field(default=None, max_length=20)


@router.post("/presence", status_code=204)
async def presence(payload: PresenceIn, ctx: Ctx = Depends(require(*MANAGERS, Role.call_agent))):
    now = utcnow()
    row = (await ctx.session.execute(select(AgentPresence).where(AgentPresence.user_id == ctx.user.id))).scalar_one_or_none()
    if row is None:
        row = AgentPresence(user_id=ctx.user.id, status=payload.status, status_since=now, heartbeat_at=now)
        ctx.session.add(row)
    elif row.status != payload.status or row.voter_id != payload.voter_id:
        row.status, row.status_since = payload.status, now
    row.voter_id, row.heartbeat_at, row.line = payload.voter_id, now, payload.line
    await ctx.session.commit()


@router.get("/calls")
async def calls(ctx: Ctx = Depends(require(*MANAGERS, Role.viewer))):
    return await call_wall(ctx.session)
