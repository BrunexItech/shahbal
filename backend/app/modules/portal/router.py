"""Public, unauthenticated supporter sign-up. Deliberately returns the same
response whether or not the ID already exists, so the portal can't be used to
probe who is in the campaign's database."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
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


class SignupOut(BaseModel):
    message: str


RECEIVED = SignupOut(message="Asante! Your details have been received. Our team will reach out to you by SMS.")


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
    if payload.website:  # bot
        return RECEIVED
    data = VoterCreate(**payload.model_dump(exclude={"website"}))
    try:
        voter = await register_voter(session, data, source=Source.portal, captured_by=None)
    except DuplicateVoter as dup:
        audit.record(session, actor_id=None, action="PORTAL_DUPLICATE", entity="voter", entity_id=dup.voter.id, ip=ip)
        await session.commit()
        return RECEIVED
    audit.record(session, actor_id=None, action="CREATE", entity="voter", entity_id=voter.id, ip=ip, source="portal")
    await session.commit()
    return RECEIVED
