"""Target planner: set many targets at once, level by level.

  county        → every ward in the county
  constituency  → the wards of one constituency
  ward          → the polling stations of one ward

Constituency and county targets are always the sum of their wards (never stored
separately), and station targets sit inside their ward, so the numbers can't drift.
Totals are split with the largest-remainder method, so they add up exactly.
"""
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from app.core import audit
from app.core.deps import Ctx
from app.core.roles import Role
from app.modules.geo.models import Constituency, PollingStation, Ward

Method = Literal["percent_registered", "split_registered", "split_equal"]


class PlanIn(BaseModel):
    level: Literal["county", "constituency", "ward"]
    area_id: str | None = None
    method: Method
    value: float = Field(gt=0, le=10_000_000)

    @model_validator(mode="after")
    def _check(self):
        if self.level != "county" and not self.area_id:
            raise ValueError("Choose the constituency or ward to plan")
        if self.method == "percent_registered" and self.value > 100:
            raise ValueError("A percentage can't be more than 100")
        return self


class PlanItem(BaseModel):
    id: str
    name: str
    group: str
    registered: int | None
    current: int
    proposed: int


class PlanOut(BaseModel):
    unit: Literal["wards", "stations"]
    items: list[PlanItem]
    total_current: int
    total_proposed: int
    missing_registered: int


def _split(total: int, weights: list[float]) -> list[int]:
    s = sum(weights)
    if s <= 0:
        weights, s = [1.0] * len(weights), float(len(weights))
    raw = [total * w / s for w in weights]
    base = [int(x) for x in raw]
    for i in sorted(range(len(raw)), key=lambda i: raw[i] - base[i], reverse=True)[: total - sum(base)]:
        base[i] += 1
    return base


class TargetPlanner:
    def __init__(self, ctx: Ctx):
        self.ctx, self.s, self.user = ctx, ctx.session, ctx.user

    def _allowed(self, constituency_id: str) -> None:
        if self.user.role == Role.coordinator and constituency_id != self.user.constituency_id:
            raise HTTPException(403, "You can only plan targets in your own constituency")

    async def _units(self, p: PlanIn):
        if p.level == "ward":
            ward = await self.s.get(Ward, p.area_id)
            if ward is None:
                raise HTTPException(404, "Ward not found")
            self._allowed(ward.constituency_id)
            rows = (await self.s.execute(select(PollingStation).where(PollingStation.ward_id == ward.id, PollingStation.is_active.is_(True))
                                         .order_by(PollingStation.code))).scalars().all()
            if not rows:
                raise HTTPException(409, "This ward has no polling stations yet")
            return "stations", [(r, ward.name) for r in rows]
        q = select(Ward, Constituency.name).join(Constituency, Constituency.id == Ward.constituency_id).order_by(Constituency.code, Ward.code)
        if p.level == "constituency":
            cons = await self.s.get(Constituency, p.area_id)
            if cons is None:
                raise HTTPException(404, "Constituency not found")
            self._allowed(cons.id)
            q = q.where(Ward.constituency_id == cons.id)
        elif self.user.role != Role.super_admin:
            raise HTTPException(403, "Only HQ can plan targets for the whole county")
        return "wards", (await self.s.execute(q)).all()

    async def plan(self, p: PlanIn) -> PlanOut:
        unit, rows = await self._units(p)
        regs = [r.registered_voters for r, _ in rows]
        if p.method == "percent_registered":
            proposed = [round((reg or 0) * p.value / 100) if reg else r.target for (r, _), reg in zip(rows, regs)]
        elif p.method == "split_registered":
            proposed = _split(int(p.value), [float(reg or 0) for reg in regs])
        else:
            proposed = _split(int(p.value), [1.0] * len(rows))
        items = [PlanItem(id=r.id, name=r.name, group=g, registered=r.registered_voters, current=r.target, proposed=n)
                 for (r, g), n in zip(rows, proposed)]
        return PlanOut(unit=unit, items=items, total_current=sum(i.current for i in items),
                       total_proposed=sum(i.proposed for i in items), missing_registered=sum(1 for x in regs if not x))

    async def apply(self, p: PlanIn) -> PlanOut:
        out = await self.plan(p)
        model = PollingStation if out.unit == "stations" else Ward
        for i in out.items:
            row = await self.s.get(model, i.id)
            row.target = i.proposed
        audit.record(self.s, actor_id=self.user.id, action="TARGET_PLAN", entity="ward" if out.unit == "stations" else "geo",
                     entity_id=p.area_id or "county", ip=self.ctx.ip, level=p.level, method=p.method, value=p.value,
                     total=out.total_proposed, count=len(out.items))
        await self.s.commit()
        return out
