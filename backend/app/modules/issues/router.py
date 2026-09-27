import hmac

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import get_session
from app.core.phone import to_e164
from app.core.deps import Ctx, any_user, require
from app.core.ratelimit import RateLimiter, client_ip
from app.core.roles import CAPTURERS, MANAGERS
from app.modules.geo.models import Ward
from app.modules.issues.models import Category, Issue, IssueSource, IssueUpdate
from app.modules.issues.schemas import (
    Assignee,
    IssueDetail,
    IssuePage,
    IssuePatch,
    IssuePhotoOut,
    NoteIn,
    PublicIssueIn,
    PublicReceipt,
    PublicTrack,
    PublicUpdate,
    StaffIssueIn,
)
from app.modules.issues.service import UPLOAD_WINDOW, IssueService, create_issue, notify_reporter, store_photo, upload_token
from app.modules.visits.photos import MAX_BYTES

router = APIRouter(prefix="/api/v1/issues", tags=["community voice"])
public = APIRouter(prefix="/api/v1/portal/issues", tags=["community voice"])
capturers = require(*CAPTURERS)
managers = require(*MANAGERS)


# ---- staff -----------------------------------------------------------------------
@router.get("", response_model=IssuePage)
async def list_issues(status: str | None = Query(None, pattern="^(open|new|acknowledged|in_progress|resolved|closed)$"),
                      category: Category | None = None, ward_id: str | None = None, constituency_id: str | None = None,
                      source: IssueSource | None = None, mine: bool = False, q: str | None = Query(None, max_length=80),
                      page: int = Query(1, ge=1), size: int = Query(30, ge=1, le=100), ctx: Ctx = Depends(any_user)):
    return await IssueService(ctx).search(status=status, category=category, ward_id=ward_id, constituency_id=constituency_id,
                                        source=source, mine=mine, q=q, page=page, size=size)


@router.get("/stats")
async def issue_stats(days: int = Query(30, ge=7, le=365), ctx: Ctx = Depends(any_user)):
    return await IssueService(ctx).stats(days)


@router.get("/map")
async def issue_map(ctx: Ctx = Depends(any_user)):
    return await IssueService(ctx).map_points()


@router.post("", response_model=IssueDetail, status_code=201)
async def create(payload: StaffIssueIn, ctx: Ctx = Depends(capturers)):
    return await IssueService(ctx).create(payload)


@router.get("/{issue_id}", response_model=IssueDetail)
async def detail(issue_id: str, ctx: Ctx = Depends(any_user)):
    return await IssueService(ctx).detail(issue_id)


@router.patch("/{issue_id}", response_model=IssueDetail)
async def update(issue_id: str, payload: IssuePatch, ctx: Ctx = Depends(managers)):
    return await IssueService(ctx).patch(issue_id, payload)


@router.post("/{issue_id}/notes", response_model=IssueDetail)
async def add_note(issue_id: str, payload: NoteIn, ctx: Ctx = Depends(managers)):
    return await IssueService(ctx).patch(issue_id, IssuePatch(note=payload.note, public=payload.public))


@router.get("/{issue_id}/assignees", response_model=list[Assignee])
async def assignees(issue_id: str, ctx: Ctx = Depends(managers)):
    return await IssueService(ctx).assignees(issue_id)


@router.post("/{issue_id}/photos", response_model=IssuePhotoOut, status_code=201)
async def add_photo(issue_id: str, file: UploadFile = File(...), ctx: Ctx = Depends(capturers)):
    return await IssueService(ctx).add_photo(issue_id, await file.read(MAX_BYTES + 1))


@router.get("/{issue_id}/photos/{photo_id}")
async def photo(issue_id: str, photo_id: str, ctx: Ctx = Depends(any_user)):
    data = await IssueService(ctx).read_photo(issue_id, photo_id)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=600"})


# ---- public ----------------------------------------------------------------------
_submit_limit = RateLimiter(limit=settings.portal_rate_limit_per_hour, window_seconds=3600)
_track_limit = RateLimiter(limit=30, window_seconds=3600)

RECEIVED = "Asante! Your report is in. Keep the reference number to follow it up."


@public.post("", response_model=PublicReceipt, status_code=201)
async def report(payload: PublicIssueIn, request: Request, session: AsyncSession = Depends(get_session)):
    ip = client_ip(request)
    _submit_limit.hit(ip)
    if payload.website:  # bot: looks accepted, stores nothing
        return PublicReceipt(reference="ISS-00000", upload_token="0" * 32, message=RECEIVED)
    issue = await create_issue(session, payload, source=IssueSource.public, reporter=None)
    audit.record(session, actor_id=None, action="CREATE", entity="issue", entity_id=issue.id, ip=ip, source="public",
                 category=issue.category.value)
    await session.commit()
    await notify_reporter(session, issue, None, None, receipt=True)  # their reference, by SMS, if they asked for updates
    return PublicReceipt(reference=issue.reference, upload_token=upload_token(issue), message=RECEIVED)


@public.post("/{reference}/photos", status_code=201)
async def report_photo(reference: str, request: Request, token: str = Query(..., min_length=32, max_length=32),
                       file: UploadFile = File(...), session: AsyncSession = Depends(get_session)):
    ip = client_ip(request)
    _submit_limit.hit(ip)
    issue = (await session.execute(select(Issue).where(Issue.reference == reference.upper()))).scalar_one_or_none()
    # Only the browser that filed the report, and only shortly after.
    if issue is None or not hmac.compare_digest(token, upload_token(issue)) or utcnow() - issue.created_at > UPLOAD_WINDOW:
        raise HTTPException(404, "Report not found")
    await store_photo(session, issue, await file.read(MAX_BYTES + 1), added_by=None, ip=ip)
    return {"ok": True}


class TrackIn(BaseModel):
    reference: str
    phone: str


@public.post("/track", response_model=PublicTrack)
async def track(payload: TrackIn, request: Request, session: AsyncSession = Depends(get_session)):
    """Reference + the phone number used on the report: guessing references alone reveals nothing."""
    _track_limit.hit(client_ip(request))
    try:
        phone = to_e164(payload.phone)
    except ValueError:
        raise HTTPException(404, "No report matches that reference and phone number")
    issue = (await session.execute(
        select(Issue).where(Issue.reference == payload.reference.strip().upper(), Issue.reporter_phone == phone)
    )).scalar_one_or_none()
    if issue is None:
        raise HTTPException(404, "No report matches that reference and phone number")
    ward = await session.get(Ward, issue.ward_id)
    updates = (await session.execute(
        select(IssueUpdate).where(IssueUpdate.issue_id == issue.id, IssueUpdate.public.is_(True)).order_by(IssueUpdate.created_at)
    )).scalars().all()
    return PublicTrack(reference=issue.reference, category=issue.category, summary=issue.summary, ward=ward.name, status=issue.status,
                       created_at=issue.created_at, resolved_at=issue.resolved_at,
                       updates=[PublicUpdate(status=u.status, note=u.note, created_at=u.created_at) for u in updates])
