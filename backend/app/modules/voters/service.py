from fastapi import HTTPException
from sqlalchemy import Sequence, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core import audit, crypto
from app.core.clock import utcnow
from app.core.db import Base
from app.core.deps import Ctx
from app.core.roles import Role
from app.core.scope import can_touch_ward, voter_scope
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.users.models import User
from app.modules.voters.models import Source, Status, Voter
from app.modules.voters.schemas import DuplicateCheck, VoterCreate, VoterOut, VoterUpdate

STATUS_ACTIONS = {Status.verified: "VERIFY", Status.rejected: "REJECT", Status.pending: "REOPEN"}

voter_ref_seq = Sequence("voter_ref_seq", metadata=Base.metadata)


class DuplicateVoter(Exception):
    def __init__(self, voter: Voter):
        self.voter = voter


async def _validate_location(session: AsyncSession, ward_id: str, station_id: str | None) -> Ward:
    ward = await session.get(Ward, ward_id)
    if ward is None:
        raise HTTPException(422, "Unknown ward")
    if station_id:
        st = await session.get(PollingStation, station_id)
        if st is None or st.ward_id != ward_id:
            raise HTTPException(422, "Polling station does not belong to the selected ward")
    return ward


async def find_by_national_id(session: AsyncSession, national_id: str) -> Voter | None:
    stmt = select(Voter).where(Voter.national_id_hash == crypto.blind_index(national_id))
    return (await session.execute(stmt)).scalar_one_or_none()


async def register_voter(
    session: AsyncSession, data: VoterCreate, *, source: Source, captured_by: User | None
) -> Voter:
    """Single write path for every channel (field, portal, call centre, import),
    so dedup, encryption and referencing can never drift between them.
    Raises DuplicateVoter; the caller decides how much to reveal.
    A replayed offline sync (same client_ref) returns the original record."""
    if data.client_ref:
        replay = (await session.execute(select(Voter).where(Voter.client_ref == data.client_ref))).scalar_one_or_none()
        if replay is not None:
            return replay
    await _validate_location(session, data.ward_id, data.station_id)
    existing = await find_by_national_id(session, data.national_id)
    if existing is not None:
        raise DuplicateVoter(existing)

    seq = (await session.execute(select(voter_ref_seq.next_value()))).scalar_one()
    voter = Voter(
        reference=f"MSA-{utcnow():%y}-{seq:06d}",
        full_name=data.full_name,
        phone=data.phone,
        national_id_enc=crypto.encrypt(data.national_id),
        national_id_hash=crypto.blind_index(data.national_id),
        national_id_last4=data.national_id[-4:],
        voter_card_no=data.voter_card_no,
        gender=data.gender,
        birth_year=data.birth_year,
        ward_id=data.ward_id,
        station_id=data.station_id,
        support=data.support,
        source=source,
        share_code=crypto.share_code(data.phone),
        notes=data.notes,
        consent_at=utcnow(),
        capture_lat=data.capture_lat,
        capture_lng=data.capture_lng,
        client_ref=data.client_ref,
        captured_by_id=captured_by.id if captured_by else None,
    )
    session.add(voter)
    try:
        await session.flush()
    except IntegrityError:  # lost a race with a concurrent submit of the same ID
        await session.rollback()
        existing = await find_by_national_id(session, data.national_id)
        if existing is None:
            raise
        raise DuplicateVoter(existing)
    return voter


class VoterService:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self.s = ctx.session

    # -- read -----------------------------------------------------------------
    def _query(self):
        cap, ver = aliased(User), aliased(User)
        return (
            select(
                Voter,
                Ward.name.label("ward_name"),
                Constituency.name.label("constituency_name"),
                PollingStation.name.label("station_name"),
                cap.full_name.label("captured_by_name"),
                ver.full_name.label("verified_by_name"),
            )
            .join(Ward, Ward.id == Voter.ward_id)
            .join(Constituency, Constituency.id == Ward.constituency_id)
            .outerjoin(PollingStation, PollingStation.id == Voter.station_id)
            .outerjoin(cap, cap.id == Voter.captured_by_id)
            .outerjoin(ver, ver.id == Voter.verified_by_id)
            .where(voter_scope(self.ctx.user))
        )

    @staticmethod
    def to_out(row) -> VoterOut:
        v: Voter = row[0]
        data = {c: getattr(v, c) for c in VoterOut.model_fields if hasattr(v, c)}
        data.update(
            national_id_masked=crypto.mask(v.national_id_last4),
            ward_name=row.ward_name,
            constituency_name=row.constituency_name,
            station_name=row.station_name,
            captured_by_name=row.captured_by_name,
            verified_by_name=row.verified_by_name,
        )
        return VoterOut(**data)

    async def search(self, *, q, status, support, source, ward_id, constituency_id, page, size):
        stmt = self._query()
        if q:
            q = q.strip()
            digits = q.replace(" ", "")
            conds = [Voter.full_name.ilike(f"%{q}%"), Voter.reference.ilike(f"{q}%"), Voter.voter_card_no == q]
            if digits.isdigit() and len(digits) >= 6:
                conds.append(Voter.national_id_hash == crypto.blind_index(digits))
            if digits.lstrip("+").isdigit() and len(digits) >= 4:
                conds.append(Voter.phone.like(f"%{digits[-9:]}"))
            stmt = stmt.where(or_(*conds))
        if status:
            stmt = stmt.where(Voter.status == status)
        if support:
            stmt = stmt.where(Voter.support == support)
        if source:
            stmt = stmt.where(Voter.source == source)
        if ward_id:
            stmt = stmt.where(Voter.ward_id == ward_id)
        if constituency_id:
            stmt = stmt.where(Ward.constituency_id == constituency_id)
        stmt = stmt.order_by(Voter.created_at.desc())
        total = (await self.s.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
        rows = (await self.s.execute(stmt.limit(size).offset((page - 1) * size))).all()
        return [self.to_out(r) for r in rows], total

    async def _row(self, voter_id: str):
        row = (await self.s.execute(self._query().where(Voter.id == voter_id))).first()
        if row is None:
            raise HTTPException(404, "Record not found")
        return row

    async def get(self, voter_id: str) -> VoterOut:
        row = await self._row(voter_id)
        audit.record(self.s, actor_id=self.ctx.user.id, action="VIEW", entity="voter", entity_id=voter_id, ip=self.ctx.ip)
        await self.s.commit()
        return self.to_out(row)

    async def check_duplicate(self, national_id: str) -> DuplicateCheck:
        v = await find_by_national_id(self.s, national_id)
        if v is None:
            return DuplicateCheck(exists=False)
        ward = await self.s.get(Ward, v.ward_id)
        return DuplicateCheck(exists=True, reference=v.reference, full_name=v.full_name, ward_name=ward.name if ward else None)

    # -- write ----------------------------------------------------------------
    async def create(self, data: VoterCreate) -> VoterOut:
        ward = await self.s.get(Ward, data.ward_id)
        if ward is None or not can_touch_ward(self.ctx.user, ward):
            raise HTTPException(403, "You can only capture voters in your assigned area")
        source = Source.call_centre if self.ctx.user.role == Role.call_agent else Source.field
        try:
            voter = await register_voter(self.s, data, source=source, captured_by=self.ctx.user)
        except DuplicateVoter as dup:
            raise HTTPException(409, f"This national ID is already registered ({dup.voter.reference})")
        audit.record(self.s, actor_id=self.ctx.user.id, action="CREATE", entity="voter", entity_id=voter.id,
                     ip=self.ctx.ip, source=source.value)
        await self.s.commit()
        return self.to_out(await self._row(voter.id))

    async def update(self, voter_id: str, data: VoterUpdate) -> VoterOut:
        row = await self._row(voter_id)
        voter: Voter = row[0]
        fields = data.model_dump(exclude_unset=True)
        if "ward_id" in fields or "station_id" in fields:
            ward_id = fields.get("ward_id", voter.ward_id)
            # Moving ward without naming a station clears the old (now foreign) station.
            station_id = fields.get("station_id", None if "ward_id" in fields else voter.station_id)
            ward = await _validate_location(self.s, ward_id, station_id)
            if not can_touch_ward(self.ctx.user, ward):
                raise HTTPException(403, "You cannot move records outside your area")
        for k, v in fields.items():
            setattr(voter, k, v)
        if "ward_id" in fields and "station_id" not in fields:
            voter.station_id = None
        audit.record(self.s, actor_id=self.ctx.user.id, action="UPDATE", entity="voter", entity_id=voter.id,
                     ip=self.ctx.ip, fields=sorted(fields))
        await self.s.commit()
        return self.to_out(await self._row(voter.id))

    async def set_status(self, voter_id: str, status: Status, reason: str | None = None) -> VoterOut:
        voter: Voter = (await self._row(voter_id))[0]
        if voter.status == status:
            raise HTTPException(409, f"Record is already {status.value}")
        voter.status = status
        voter.rejection_reason = reason if status == Status.rejected else None
        voter.verified_by_id = self.ctx.user.id
        voter.verified_at = utcnow()
        audit.record(self.s, actor_id=self.ctx.user.id, action=STATUS_ACTIONS[status], entity="voter",
                     entity_id=voter.id, ip=self.ctx.ip, reason=reason)
        await self.s.commit()
        return self.to_out(await self._row(voter.id))

    async def reveal_national_id(self, voter_id: str) -> str:
        voter: Voter = (await self._row(voter_id))[0]
        audit.record(self.s, actor_id=self.ctx.user.id, action="REVEAL_ID", entity="voter", entity_id=voter.id, ip=self.ctx.ip)
        await self.s.commit()
        return crypto.decrypt(voter.national_id_enc)
