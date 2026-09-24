import csv
import io
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.clock import utcnow
from app.core.db import get_session
from app.core.deps import Ctx, any_user, require, require_step_up
from app.core.ratelimit import client_ip
from app.core.roles import ADMINS
from app.core.scope import voter_scope
from app.modules.audit.models import AuditLog
from app.modules.auth.models import AuthChallenge, ChallengePurpose
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.mapping.project import build_project
from app.modules.mapping.service import MapService, constituency_boundaries, ward_boundaries
from app.modules.users.models import User
from app.modules.voters.models import Voter

router = APIRouter(prefix="/api/v1/map", tags=["map"])
admins = require(*ADMINS)
# Anything that leaves the system needs a fresh re-confirmation.
exporters = require_step_up(*ADMINS)


@router.get("/boundaries")
async def boundaries(ctx: Ctx = Depends(any_user)):
    # Public geography (IEBC ward shapes): cacheable, unlike everything else under /api.
    return JSONResponse(ward_boundaries(), headers={"Cache-Control": "private, max-age=86400"})


@router.get("/boundaries/constituencies")
async def constituency_outlines(ctx: Ctx = Depends(any_user)):
    return JSONResponse(constituency_boundaries(), headers={"Cache-Control": "private, max-age=86400"})


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
async def export_wards(ctx: Ctx = Depends(exporters)):
    audit.record(ctx.session, actor_id=ctx.user.id, action="EXPORT", entity="gis", entity_id="wards", ip=ctx.ip)
    await ctx.session.commit()
    return _geojson("ward-coverage", await MapService(ctx).export_wards())


@router.get("/export/grid.geojson")
async def export_grid(ctx: Ctx = Depends(exporters)):
    audit.record(ctx.session, actor_id=ctx.user.id, action="EXPORT", entity="gis", entity_id="grid", ip=ctx.ip)
    await ctx.session.commit()
    return _geojson("capture-density", await MapService(ctx).export_grid())


@router.get("/export/stations.geojson")
async def export_stations(ctx: Ctx = Depends(exporters)):
    audit.record(ctx.session, actor_id=ctx.user.id, action="EXPORT", entity="gis", entity_id="stations", ip=ctx.ip)
    await ctx.session.commit()
    return _geojson("polling-stations", await MapService(ctx).export_stations())


async def _project_response(ctx: Ctx, mode: str, via: str) -> JSONResponse:
    svc = MapService(ctx)
    project = build_project(await svc.export_constituencies(), await svc.export_wards(), await svc.export_grid(), await svc.export_stations(),
                            briefing=mode == "briefing")
    audit.record(ctx.session, actor_id=ctx.user.id, action="EXPORT", entity="gis", entity_id=f"project:{mode}", ip=ctx.ip, via=via)
    await ctx.session.commit()
    return JSONResponse(project, headers={"Content-Disposition": 'inline; filename="mombasa-campaign.geolibre.json"', "Cache-Control": "no-store"})


@router.get("/export/project.geolibre.json")
async def export_project(mode: str = Query("workspace", pattern="^(workspace|briefing)$"), ctx: Ctx = Depends(exporters)):
    """One-click GIS Lab project (same-origin, cookie session): styled layers, popups,
    charts; `mode=briefing` adds the story map and opens as a presentation."""
    return await _project_response(ctx, mode, "session")


LINK_TTL_SECONDS = 120


@router.post("/export/project-link")
async def project_link(mode: str = Query("workspace", pattern="^(workspace|briefing)$"), ctx: Ctx = Depends(exporters)):
    """A one-time, 2-minute link the GIS Lab can fetch from its own origin. Minting it
    needs re-confirmation; the link dies on first use or expiry, whichever is first."""
    token = secrets.token_urlsafe(32)
    ctx.session.add(AuthChallenge(purpose=ChallengePurpose.gis_link, challenge=token.encode(), user_id=ctx.user.id,
                                  meta={"mode": mode}, expires_at=utcnow() + timedelta(seconds=LINK_TTL_SECONDS)))
    await ctx.session.commit()
    return {"url": f"/map/export/linked/{token}.geolibre.json", "expires_in": LINK_TTL_SECONDS}


@router.get("/export/linked/{token}.geolibre.json", include_in_schema=False)
async def linked_project(token: str, request: Request, session: AsyncSession = Depends(get_session)):
    ch = (await session.execute(select(AuthChallenge).where(AuthChallenge.challenge == token.encode(),
                                                            AuthChallenge.purpose == ChallengePurpose.gis_link).with_for_update())).scalar_one_or_none()
    if ch is None or ch.used_at is not None or ch.expires_at <= utcnow():
        raise HTTPException(410, "This GIS Lab link has expired. Open the lab again from Campaign HQ.")
    ch.used_at = utcnow()
    user = await session.get(User, ch.user_id)
    if user is None or not user.is_active or user.role not in ADMINS:
        await session.commit()
        raise HTTPException(403, "Not allowed")
    ctx = Ctx(session=session, user=user, ip=client_ip(request))
    return await _project_response(ctx, (ch.meta or {}).get("mode", "workspace"), "one-time-link")


@router.get("/export/voters.csv")
async def export_voters(ward_id: str | None = None, ctx: Ctx = Depends(exporters)):
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
