"""Segment builder shared by messaging, visit announcements, the call centre and GOTV.

Every audience is intersected with the *creator's* area scope, so a ward
coordinator can never message outside their ward, whatever filters they send."""
from pydantic import BaseModel, Field
from sqlalchemy import Select, select

from app.core.scope import voter_scope
from app.modules.geo.models import Ward
from app.modules.users.models import User
from app.modules.voters.models import Source, Status, Support, Voter


class Audience(BaseModel):
    constituency_ids: list[str] = Field(default_factory=list, max_length=50)
    ward_ids: list[str] = Field(default_factory=list, max_length=100)
    station_ids: list[str] = Field(default_factory=list, max_length=500)
    support: list[Support] = Field(default_factory=list)
    statuses: list[Status] = Field(default_factory=lambda: [Status.verified, Status.pending])
    sources: list[Source] = Field(default_factory=list)
    voted: bool | None = None  # GOTV: False = not yet voted


def audience_filter(user: User, a: Audience, *, for_calls: bool = False) -> list:
    conds = [voter_scope(user), Voter.status != Status.rejected]
    conds.append(Voter.do_not_call.is_(False) if for_calls else Voter.opted_out.is_(False))
    if a.constituency_ids:
        conds.append(Voter.ward_id.in_(select(Ward.id).where(Ward.constituency_id.in_(a.constituency_ids))))
    if a.ward_ids:
        conds.append(Voter.ward_id.in_(a.ward_ids))
    if a.station_ids:
        conds.append(Voter.station_id.in_(a.station_ids))
    if a.support:
        conds.append(Voter.support.in_(a.support))
    if a.statuses:
        conds.append(Voter.status.in_(a.statuses))
    if a.sources:
        conds.append(Voter.source.in_(a.sources))
    if a.voted is True:
        conds.append(Voter.voted_at.is_not(None))
    elif a.voted is False:
        conds.append(Voter.voted_at.is_(None))
    return conds


def audience_stmt(user: User, a: Audience) -> Select:
    return select(Voter).where(*audience_filter(user, a))
