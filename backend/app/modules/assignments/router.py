"""Daily assignments. Coordinators plan agents' days in their own area; agents see and
tick off their own; HQ sees everyone. Progress counts the agent's captures that day."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select

from app.core import audit
from app.core.clock import TZ, local_date, utcnow
from app.core.deps import Ctx, require
from app.core.roles import MANAGERS, OVERSIGHT, Role
from app.core.scope import can_touch_ward, ward_scope
from app.modules.assignments.models import Assignment
from app.modules.geo.models import PollingStation, Ward
from app.modules.users.models import User
from app.modules.voters.models import Voter

router = APIRouter(prefix="/api/v1/assignments", tags=["assignments"])
viewers = require(*OVERSIGHT, Role.field_agent)
managers = require(*MANAGERS)


class AssignmentIn(BaseModel):
    user_id: str
    day: date
    title: str = Field(min_length=3, max_length=140)
    station_id: str | None = None
    target_captures: int | None = Field(default=None, ge=0, le=2000)
    notes: str | None = Field(default=None, max_length=1000)
    repeat_days: int = Field(default=0, ge=0, le=13)  # same task on the following days too


class AssignmentPatch(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=140)
    station_id: str | None = None
    target_captures: int | None = Field(default=None, ge=0, le=2000)
    notes: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, pattern="^(pending|done|skipped)$")
    report: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _skip_needs_reason(self):
        if self.status == "skipped" and not (self.report or "").strip():
            raise ValueError("Say briefly why the task was skipped")
        return self


def today() -> date:
    return utcnow().astimezone(TZ).date()


async def _agents(ctx: Ctx) -> list[tuple[User, Ward]]:
    """Field agents this person may plan for (or just themselves, for an agent)."""
    q = select(User, Ward).join(Ward, Ward.id == User.ward_id).where(User.is_active.is_(True), User.role == Role.field_agent)
    if ctx.user.role == Role.field_agent:
        q = q.where(User.id == ctx.user.id)
    else:
        q = q.where(ward_scope(ctx.user))
    return list((await ctx.session.execute(q.order_by(Ward.name, User.full_name))).all())


def _out(a: Assignment, station: str | None) -> dict:
    return {"id": a.id, "user_id": a.user_id, "day": a.day.isoformat(), "title": a.title, "ward_id": a.ward_id, "station_id": a.station_id,
            "station": station, "target_captures": a.target_captures, "notes": a.notes, "status": a.status,
            "done_at": a.done_at.isoformat() if a.done_at else None, "report": a.report}


@router.get("")
async def day_plan(day: date | None = None, ctx: Ctx = Depends(viewers)):
    """Everyone in scope for one day: their tasks and how many they've captured that day."""
    d = day or today()
    agents = await _agents(ctx)
    ids = [u.id for u, _ in agents]
    tasks = (await ctx.session.execute(
        select(Assignment, PollingStation.name).outerjoin(PollingStation, PollingStation.id == Assignment.station_id)
        .where(Assignment.day == d, Assignment.user_id.in_(ids)).order_by(Assignment.created_at)
    )).all() if ids else []
    captured = dict((await ctx.session.execute(
        select(Voter.captured_by_id, func.count()).where(Voter.captured_by_id.in_(ids), local_date(Voter.created_at) == d)
        .group_by(Voter.captured_by_id)
    )).all()) if ids else {}
    by_user: dict[str, list] = {}
    for a, st in tasks:
        by_user.setdefault(a.user_id, []).append(_out(a, st))
    return {"day": d.isoformat(), "today": today().isoformat(),
            "agents": [{"id": u.id, "name": u.full_name, "ward_id": w.id, "ward": w.name, "has_photo": bool(u.photo_path),
                        "captured": captured.get(u.id, 0), "tasks": by_user.get(u.id, [])} for u, w in agents]}


@router.post("", status_code=201)
async def create(payload: AssignmentIn, ctx: Ctx = Depends(managers)):
    agent = await ctx.session.get(User, payload.user_id)
    if agent is None or agent.role != Role.field_agent or not agent.is_active or not agent.ward_id:
        raise HTTPException(422, "Choose an active field agent")
    ward = await ctx.session.get(Ward, agent.ward_id)
    if not can_touch_ward(ctx.user, ward):
        raise HTTPException(403, "You can plan only for agents in your area")
    if payload.day < today():
        raise HTTPException(422, "Plan today or a day ahead")
    if payload.station_id:
        st = await ctx.session.get(PollingStation, payload.station_id)
        if st is None or st.ward_id != ward.id:
            raise HTTPException(422, "That polling centre isn't in the agent's ward")
    made = []
    for i in range(payload.repeat_days + 1):
        a = Assignment(user_id=agent.id, day=payload.day + timedelta(days=i), title=payload.title, ward_id=ward.id, station_id=payload.station_id,
                       target_captures=payload.target_captures, notes=payload.notes, created_by_id=ctx.user.id)
        ctx.session.add(a)
        made.append(a)
    await ctx.session.flush()
    audit.record(ctx.session, actor_id=ctx.user.id, action="CREATE", entity="assignment", entity_id=made[0].id, ip=ctx.ip,
                 agent=agent.id, days=len(made))
    await ctx.session.commit()
    return {"created": len(made)}


async def _load(ctx: Ctx, aid: str) -> tuple[Assignment, bool]:
    a = await ctx.session.get(Assignment, aid)
    if a is None:
        raise HTTPException(404, "Task not found")
    ward = await ctx.session.get(Ward, a.ward_id)
    mine = a.user_id == ctx.user.id
    manager = ctx.user.role in MANAGERS and can_touch_ward(ctx.user, ward)
    if not (mine or manager):
        raise HTTPException(404, "Task not found")
    return a, manager


@router.patch("/{aid}")
async def update(aid: str, payload: AssignmentPatch, ctx: Ctx = Depends(require(*MANAGERS, Role.field_agent))):
    a, manager = await _load(ctx, aid)
    fields = payload.model_dump(exclude_unset=True)
    if not manager and set(fields) - {"status", "report"}:
        raise HTTPException(403, "Only your coordinator can change the task itself")
    if "station_id" in fields and fields["station_id"]:
        st = await ctx.session.get(PollingStation, fields["station_id"])
        if st is None or st.ward_id != a.ward_id:
            raise HTTPException(422, "That polling centre isn't in the agent's ward")
    for k, v in fields.items():
        setattr(a, k, v)
    if "status" in fields:
        a.done_at = utcnow() if a.status in ("done", "skipped") else None
    audit.record(ctx.session, actor_id=ctx.user.id, action="UPDATE", entity="assignment", entity_id=a.id, ip=ctx.ip, fields=sorted(fields))
    await ctx.session.commit()
    return {"ok": True}


@router.delete("/{aid}", status_code=204)
async def delete(aid: str, ctx: Ctx = Depends(managers)):
    a, manager = await _load(ctx, aid)
    if not manager:
        raise HTTPException(403, "Only coordinators can remove tasks")
    await ctx.session.delete(a)
    audit.record(ctx.session, actor_id=ctx.user.id, action="DELETE", entity="assignment", entity_id=aid, ip=ctx.ip)
    await ctx.session.commit()
