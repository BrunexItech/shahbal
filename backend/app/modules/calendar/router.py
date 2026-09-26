from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.core.deps import Ctx, require_step_up
from app.core.roles import MANAGERS, OVERSIGHT
from app.modules.calendar.schemas import Entry, EventIn, EventPatch, Gap
from app.modules.calendar.service import CalendarService

router = APIRouter(prefix="/api/v1/calendar", tags=["calendar"])
# The planner is a locked room: every visit needs a fresh fingerprint / face / password check.
viewers = require_step_up(*OVERSIGHT)
editors = require_step_up(*MANAGERS)


@router.get("", response_model=list[Entry])
async def entries(start: datetime, end: datetime, ctx: Ctx = Depends(viewers)):
    return await CalendarService(ctx).entries(start, end)


@router.get("/gaps", response_model=list[Gap])
async def gaps(days: int = Query(14, ge=3, le=60), ctx: Ctx = Depends(viewers)):
    return await CalendarService(ctx).gaps(days)


@router.post("", response_model=list[Entry], status_code=201)
async def create(payload: EventIn, ctx: Ctx = Depends(editors)):
    return await CalendarService(ctx).create(payload)


@router.patch("/{event_id}", status_code=204)
async def update(event_id: str, payload: EventPatch, ctx: Ctx = Depends(editors)):
    await CalendarService(ctx).update(event_id, payload)


@router.delete("/{event_id}")
async def delete(event_id: str, series: bool = False, ctx: Ctx = Depends(editors)):
    return {"deleted": await CalendarService(ctx).delete(event_id, series)}


