"""Public, unauthenticated supporter sign-up. Deliberately returns the same
response whether or not the ID already exists, so the portal can't be used to
probe who is in the campaign's database."""
import io

import segno
from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit, crypto
from app.core.config import settings
from app.core.db import get_session
from app.core.ratelimit import RateLimiter, client_ip
from app.modules.geo.schemas import ConstituencyOut, StationOut
from app.modules.geo.service import geo_tree, list_stations
from app.modules.voters.models import Source
from app.modules.voters.schemas import ConsentMixin, NationalIdMixin, VoterBase, VoterCreate
from app.modules.voters.service import DuplicateVoter, register_voter

router = APIRouter(prefix="/api/v1/portal", tags=["portal"])
_limiter = RateLimiter(limit=settings.portal_rate_limit_per_hour, window_seconds=3600)


class SignupIn(VoterBase, NationalIdMixin, ConsentMixin):
    website: str | None = None  # honeypot: humans never see or fill this
    birth_year: int = Field(ge=1900)  # required: only adults (18+) can join (checked in VoterBase)

    ref: str | None = Field(default=None, pattern=r"^[A-Z2-7]{8}$")  # invite link code of whoever shared it


class SignupOut(BaseModel):
    message: str
    share_code: str | None = None


MESSAGE = "Asante! Your details have been received. Our team will reach out to you by SMS."


@router.get("/geo", response_model=list[ConstituencyOut])
async def portal_geo(session: AsyncSession = Depends(get_session)):
    return await geo_tree(session)


@router.get("/stations", response_model=list[StationOut])
async def portal_stations(ward_id: str, session: AsyncSession = Depends(get_session)):
    return await list_stations(session, ward_id, None, active_only=True)


@router.post("/signup", response_model=SignupOut, status_code=202)
async def signup(payload: SignupIn, request: Request, session: AsyncSession = Depends(get_session)):
    ip = client_ip(request)
    _limiter.hit(ip)
    data = VoterCreate(**payload.model_dump(exclude={"website", "ref"}))
    # Same answer in every case (new, duplicate, bot): the share code comes from the
    # submitted phone only, so nothing here tells a visitor what's in the database.
    received = SignupOut(message=MESSAGE, share_code=crypto.share_code(data.phone))
    if payload.website:  # bot
        return received
    try:
        voter = await register_voter(session, data, source=Source.portal, captured_by=None)
    except DuplicateVoter as dup:
        audit.record(session, actor_id=None, action="PORTAL_DUPLICATE", entity="voter", entity_id=dup.voter.id, ip=ip)
        await session.commit()
        return received
    if payload.ref and payload.ref != voter.share_code:
        voter.referred_by = payload.ref
    audit.record(session, actor_id=None, action="CREATE", entity="voter", entity_id=voter.id, ip=ip, source="portal",
                 referred=bool(voter.referred_by))
    await session.commit()
    return received


@router.get("/join-qr.svg", include_in_schema=False)
async def join_qr(ref: str | None = Query(default=None, pattern=r"^[A-Z2-7]{8}$")):
    """QR code for posters and phones: opens the sign-up page, credited to `ref`."""
    url = f"{settings.app_url.rstrip('/')}/join" + (f"?ref={ref}" if ref else "")
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=8, border=2, dark="#06101f")
    return Response(buf.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})
