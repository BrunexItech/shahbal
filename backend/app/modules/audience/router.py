"""Audiences: who we can reach, organised by place.

County → constituency → ward → polling station, with counts at every level, and a
people preview for any selection. Messaging uses the same Audience filter, so what
you see here is exactly who a message to that region reaches (opted-out excluded,
always inside the sender's own area)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select

from app.core.deps import Ctx, require
from app.core.roles import MANAGERS
from app.core.scope import voter_scope, ward_scope
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.voters.audience import Audience, audience_filter
from app.modules.voters.models import Status, Support, Voter

router = APIRouter(prefix="/api/v1/audience", tags=["audience"])
senders = require(*MANAGERS)


def _counts():
    live = Voter.status != Status.rejected
    reach = live & Voter.opted_out.is_(False)
    return (
        func.count(case((live, 1))).label("people"),
        func.count(case((reach, 1))).label("reachable"),
        func.count(case((live & (Voter.support == Support.supporter), 1))).label("supporters"),
    )


@router.get("/tree")
async def tree(ctx: Ctx = Depends(senders)):
    s, user = ctx.session, ctx.user
    vs = voter_scope(user)
    wards = (await s.execute(
        select(Ward.id, Ward.name, Ward.code, Constituency.id, Constituency.name, Constituency.code, *_counts())
        .join(Constituency, Constituency.id == Ward.constituency_id)
        .outerjoin(Voter, (Voter.ward_id == Ward.id) & vs)
        .where(ward_scope(user)).group_by(Ward.id, Constituency.id).order_by(Constituency.code, Ward.code)
    )).all()
    ward_ids = [w[0] for w in wards]
    stations = (await s.execute(
        select(PollingStation.id, PollingStation.name, PollingStation.code, PollingStation.ward_id, *_counts())
        .outerjoin(Voter, (Voter.station_id == PollingStation.id) & vs)
        .where(PollingStation.ward_id.in_(ward_ids), PollingStation.is_active.is_(True))
        .group_by(PollingStation.id).order_by(PollingStation.code)
    )).all() if ward_ids else []
    by_ward: dict[str, list] = {}
    for sid, name, code, wid, p, r, sup in stations:
        by_ward.setdefault(wid, []).append({"id": sid, "name": name, "code": code, "people": p, "reachable": r, "supporters": sup})
    cons: dict[str, dict] = {}
    for wid, wname, wcode, cid, cname, ccode, p, r, sup in wards:
        c = cons.setdefault(cid, {"id": cid, "name": cname, "code": ccode, "people": 0, "reachable": 0, "supporters": 0, "wards": []})
        c["wards"].append({"id": wid, "name": wname, "code": wcode, "people": p, "reachable": r, "supporters": sup,
                           "stations": sorted(by_ward.get(wid, []), key=lambda x: -x["people"])})
        c["people"] += p
        c["reachable"] += r
        c["supporters"] += sup
    out = list(cons.values())
    return {"people": sum(c["people"] for c in out), "reachable": sum(c["reachable"] for c in out),
            "supporters": sum(c["supporters"] for c in out), "constituencies": out}


class PeopleIn(BaseModel):
    audience: Audience = Field(default_factory=Audience)
    q: str | None = Field(default=None, max_length=80)
    limit: int = Field(default=50, ge=1, le=200)


def _mask(phone: str) -> str:
    return f"{phone[:4]}•••••{phone[-3:]}" if phone and len(phone) > 7 else "•••"


@router.post("/people")
async def people(payload: PeopleIn, ctx: Ctx = Depends(senders)):
    """Who is in this selection: counts by support, plus the first names for a sanity check.
    Phone numbers are masked; the list is a preview, not an export."""
    s = ctx.session
    conds = audience_filter(ctx.user, payload.audience)
    if payload.q:
        like = f"%{payload.q.strip()}%"
        conds.append(or_(Voter.full_name.ilike(like), Voter.reference.ilike(like)))
    total = (await s.execute(select(func.count()).select_from(Voter).where(*conds))).scalar_one()
    by_support = dict((await s.execute(select(Voter.support, func.count()).where(*conds).group_by(Voter.support))).all())
    rows = (await s.execute(
        select(Voter.id, Voter.reference, Voter.full_name, Voter.phone, Voter.support, Voter.source, Ward.name, Constituency.name, PollingStation.name)
        .join(Ward, Ward.id == Voter.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
        .outerjoin(PollingStation, PollingStation.id == Voter.station_id)
        .where(*conds).order_by(Voter.full_name).limit(payload.limit)
    )).all()
    return {
        "total": total,
        "by_support": {k.value: v for k, v in by_support.items()},
        "people": [{"id": i, "reference": ref, "full_name": n, "phone": _mask(ph), "support": sup.value, "source": src.value,
                    "ward": w, "constituency": c, "station": st} for i, ref, n, ph, sup, src, w, c, st in rows],
    }
