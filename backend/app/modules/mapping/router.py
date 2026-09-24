import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select

from app.core import audit
from app.core.deps import Ctx, any_user, require
from app.core.roles import ADMINS
from app.core.scope import voter_scope
from app.modules.audit.models import AuditLog
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.mapping.service import MapService, ward_boundaries
from app.modules.users.models import User
from app.modules.voters.models import Voter

router = APIRouter(prefix="/api/v1/map", tags=["map"])
admins = require(*ADMINS)


@router.get("/boundaries")
async def boundaries(ctx: Ctx = Depends(any_user)):
    # Public geography (IEBC ward shapes): cacheable, unlike everything else under /api.
    return JSONResponse(ward_boundaries(), headers={"Cache-Control": "private, max-age=86400"})


@router.get("/overview")
async def overview(ctx: Ctx = Depends(any_user)):
    return await MapService(ctx).overview()


@router.get("/activity")
async def activity(limit: int = Query(30, ge=1, le=100), ctx: Ctx = Depends(admins)):
    """Live HQ activity stream (county-wide admins only: audit rows aren't area-scoped)."""
    rows = (await ctx.session.execute(
        select(AuditLog.id, AuditLog.created_at, AuditLog.action, AuditLog.entity, AuditLog.entity_id, AuditLog.meta, User.full_name)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.action.not_in(["VIEW", "LOGIN", "LOGOUT"]))
        .order_by(AuditLog.created_at.desc()).limit(limit)
    )).all()
    return [{"id": i, "at": at.isoformat(), "action": a, "entity": e, "entity_id": eid, "meta": m, "actor": n or "Public portal"}
            for i, at, a, e, eid, m, n in rows]


def _geojson(name: str, data: dict) -> JSONResponse:
    return JSONResponse(data, media_type="application/geo+json",
                        headers={"Content-Disposition": f'attachment; filename="{name}.geojson"'})


@router.get("/export/wards.geojson")
async def export_wards(ctx: Ctx = Depends(admins)):
    audit.record(ctx.session, actor_id=ctx.user.id, action="EXPORT", entity="gis", entity_id="wards", ip=ctx.ip)
    await ctx.session.commit()
    return _geojson("ward-coverage", await MapService(ctx).export_wards())


@router.get("/export/grid.geojson")
async def export_grid(ctx: Ctx = Depends(admins)):
    audit.record(ctx.session, actor_id=ctx.user.id, action="EXPORT", entity="gis", entity_id="grid", ip=ctx.ip)
    await ctx.session.commit()
    return _geojson("capture-density", await MapService(ctx).export_grid())


@router.get("/export/stations.geojson")
async def export_stations(ctx: Ctx = Depends(admins)):
    audit.record(ctx.session, actor_id=ctx.user.id, action="EXPORT", entity="gis", entity_id="stations", ip=ctx.ip)
    await ctx.session.commit()
    return _geojson("polling-stations", await MapService(ctx).export_stations())


@router.get("/export/voters.csv")
async def export_voters(ward_id: str | None = None, ctx: Ctx = Depends(admins)):
    """Operational export for HQ. National IDs stay masked; every export is audited."""
    stmt = (select(Voter.reference, Voter.full_name, Voter.phone, Voter.national_id_last4, Voter.support, Voter.status,
                   Voter.source, Voter.opted_out, Voter.voted_at, Ward.name, Constituency.name, PollingStation.name, Voter.created_at)
            .join(Ward, Ward.id == Voter.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
            .outerjoin(PollingStation, PollingStation.id == Voter.station_id).where(voter_scope(ctx.user)).order_by(Voter.created_at))
    if ward_id:
        stmt = stmt.where(Voter.ward_id == ward_id)
    rows = (await ctx.session.execute(stmt)).all()
    audit.record(ctx.session, actor_id=ctx.user.id, action="EXPORT", entity="voters", entity_id=ward_id, ip=ctx.ip, rows=len(rows))
    await ctx.session.commit()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["reference", "full_name", "phone", "national_id", "support", "status", "source", "opted_out", "voted_at",
                "ward", "constituency", "polling_station", "captured_at"])
    for r in rows:
        # Leading apostrophe defuses spreadsheet formula injection from user-supplied names.
        safe = [f"'{x}" if isinstance(x, str) and x[:1] in "=+-@" else x for x in
                (r[0], r[1], r[2], f"••••{r[3]}", r[4].value, r[5].value, r[6].value, r[7], r[8].isoformat() if r[8] else "",
                 r[9], r[10], r[11] or "", r[12].isoformat())]
        w.writerow(safe)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="voters.csv"'})
