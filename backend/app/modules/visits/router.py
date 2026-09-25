from datetime import datetime

from fastapi import APIRouter, Depends, File, Response, UploadFile

from app.core.deps import Ctx, any_user
from app.modules.visits.models import VisitStatus
from app.modules.visits.schemas import CheckinIn, CompleteIn, QuickVisitIn, VisitIn, VisitOut, VisitUpdate
from app.modules.visits.photos import MAX_BYTES, VisitPhotoService
from app.modules.visits.service import VisitService

router = APIRouter(prefix="/api/v1/visits", tags=["visits"])


@router.get("", response_model=list[VisitOut])
async def list_visits(status: VisitStatus | None = None, ward_id: str | None = None, frm: datetime | None = None,
                      to: datetime | None = None, ctx: Ctx = Depends(any_user)):
    return await VisitService(ctx).list_visits(status, ward_id, frm, to)


@router.post("", response_model=VisitOut, status_code=201)
async def create_visit(payload: VisitIn, ctx: Ctx = Depends(any_user)):
    return await VisitService(ctx).create(payload)


@router.post("/quick", response_model=VisitOut, status_code=201)
async def quick_visit(payload: QuickVisitIn, ctx: Ctx = Depends(any_user)):
    return await VisitService(ctx).quick(payload)


@router.get("/{vid}", response_model=VisitOut)
async def get_visit(vid: str, ctx: Ctx = Depends(any_user)):
    return await VisitService(ctx).get(vid)


@router.patch("/{vid}", response_model=VisitOut)
async def update_visit(vid: str, payload: VisitUpdate, ctx: Ctx = Depends(any_user)):
    return await VisitService(ctx).update(vid, payload)


@router.post("/{vid}/cancel", response_model=VisitOut)
async def cancel_visit(vid: str, ctx: Ctx = Depends(any_user)):
    return await VisitService(ctx).cancel(vid)


@router.post("/{vid}/checkin", response_model=VisitOut)
async def checkin_visit(vid: str, payload: CheckinIn, ctx: Ctx = Depends(any_user)):
    return await VisitService(ctx).checkin(vid, payload)


@router.post("/{vid}/complete", response_model=VisitOut)
async def complete_visit(vid: str, payload: CompleteIn, ctx: Ctx = Depends(any_user)):
    return await VisitService(ctx).complete(vid, payload)


# ---- photos ------------------------------------------------------------------------
@router.get("/{vid}/photos")
async def list_photos(vid: str, ctx: Ctx = Depends(any_user)):
    return await VisitPhotoService(ctx).list(vid)


@router.post("/{vid}/photos", status_code=201)
async def add_photo(vid: str, photo: UploadFile = File(...), ctx: Ctx = Depends(any_user)):
    return await VisitPhotoService(ctx).add(vid, await photo.read(MAX_BYTES + 1))


@router.get("/{vid}/photos/{pid}")
async def get_photo(vid: str, pid: str, ctx: Ctx = Depends(any_user)):
    data = await VisitPhotoService(ctx).read(vid, pid)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.delete("/{vid}/photos/{pid}", status_code=204)
async def delete_photo(vid: str, pid: str, ctx: Ctx = Depends(any_user)):
    await VisitPhotoService(ctx).delete(vid, pid)
