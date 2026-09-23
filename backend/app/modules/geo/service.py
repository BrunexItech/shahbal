import csv
import io

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.deps import Ctx
from app.core.scope import can_touch_ward, ward_scope
from app.modules.geo import seed_data
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.geo.schemas import ConstituencyOut, ImportResult, StationIn, StationUpdate, WardOut, WardUpdate


async def geo_tree(session: AsyncSession, where=None) -> list[ConstituencyOut]:
    constituencies = (await session.execute(select(Constituency).order_by(Constituency.code))).scalars().all()
    stmt = select(Ward).order_by(Ward.code)
    if where is not None:
        stmt = stmt.where(where)
    wards = (await session.execute(stmt)).scalars().all()
    tree = []
    for c in constituencies:
        cw = [WardOut.model_validate(w) for w in wards if w.constituency_id == c.id]
        if cw or where is None:
            tree.append(ConstituencyOut(id=c.id, code=c.code, name=c.name, county=c.county, wards=cw))
    return tree


async def list_stations(session: AsyncSession, ward_id: str | None, q: str | None, active_only: bool, where=None):
    stmt = select(PollingStation).join(Ward).order_by(PollingStation.name)
    if where is not None:
        stmt = stmt.where(where)
    if ward_id:
        stmt = stmt.where(PollingStation.ward_id == ward_id)
    if q:
        stmt = stmt.where(PollingStation.name.ilike(f"%{q}%") | PollingStation.code.ilike(f"{q}%"))
    if active_only:
        stmt = stmt.where(PollingStation.is_active.is_(True))
    return list((await session.execute(stmt.limit(500))).scalars().all())


async def seed_geography(session: AsyncSession) -> int:
    """Idempotent: inserts any missing constituency/ward by code."""
    existing_c = {c.code: c for c in (await session.execute(select(Constituency))).scalars()}
    existing_w = set((await session.execute(select(Ward.code))).scalars())
    created, ward_no = 0, 0
    for code, name, wards in seed_data.CONSTITUENCIES:
        c = existing_c.get(code)
        if c is None:
            c = Constituency(code=code, name=name, county=seed_data.COUNTY)
            session.add(c)
            await session.flush()
            created += 1
        for ward_name in wards:
            ward_no += 1
            wcode = f"{ward_no:04d}"
            if wcode not in existing_w:
                session.add(Ward(code=wcode, name=ward_name, constituency_id=c.id))
                created += 1
    await session.commit()
    return created


class GeoService:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self.s = ctx.session

    async def _ward(self, ward_id: str) -> Ward:
        ward = await self.s.get(Ward, ward_id)
        if ward is None or not can_touch_ward(self.ctx.user, ward):
            raise HTTPException(404, "Ward not found")
        return ward

    async def tree(self):
        return await geo_tree(self.s, ward_scope(self.ctx.user))

    async def update_ward(self, ward_id: str, data: WardUpdate) -> Ward:
        ward = await self._ward(ward_id)
        fields = data.model_dump(exclude_unset=True)
        for k, v in fields.items():
            setattr(ward, k, v)
        audit.record(self.s, actor_id=self.ctx.user.id, action="UPDATE", entity="ward", entity_id=ward.id,
                     ip=self.ctx.ip, **fields)
        await self.s.commit()
        return ward

    async def stations(self, ward_id: str | None, q: str | None):
        return await list_stations(self.s, ward_id, q, active_only=False, where=ward_scope(self.ctx.user))

    async def create_station(self, data: StationIn) -> PollingStation:
        await self._ward(data.ward_id)
        if (await self.s.execute(select(PollingStation.id).where(PollingStation.code == data.code))).first():
            raise HTTPException(409, "A polling station with this code already exists")
        st = PollingStation(**data.model_dump())
        self.s.add(st)
        await self.s.flush()
        audit.record(self.s, actor_id=self.ctx.user.id, action="CREATE", entity="station", entity_id=st.id, ip=self.ctx.ip)
        await self.s.commit()
        return st

    async def update_station(self, station_id: str, data: StationUpdate) -> PollingStation:
        st = await self.s.get(PollingStation, station_id)
        if st is None:
            raise HTTPException(404, "Polling station not found")
        await self._ward(st.ward_id)
        fields = data.model_dump(exclude_unset=True)
        for k, v in fields.items():
            setattr(st, k, v)
        audit.record(self.s, actor_id=self.ctx.user.id, action="UPDATE", entity="station", entity_id=st.id,
                     ip=self.ctx.ip, fields=sorted(fields))
        await self.s.commit()
        return st

    async def import_csv(self, raw: bytes) -> ImportResult:
        """Columns: code,name,ward_code[,streams,registered_voters,latitude,longitude].
        Upserts by station code so the IEBC list can be re-imported safely."""
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
        wards = {w.code: w for w in (await self.s.execute(select(Ward))).scalars()}
        stations = {s.code: s for s in (await self.s.execute(select(PollingStation))).scalars()}
        created = updated = 0
        errors: list[str] = []

        def num(v, cast):
            return cast(v) if v not in (None, "") else None

        for i, row in enumerate(reader, start=2):
            try:
                code, name = (row.get("code") or "").strip(), (row.get("name") or "").strip()
                ward = wards.get((row.get("ward_code") or "").strip().zfill(4))
                if not code or not name or ward is None:
                    raise ValueError("code, name and a valid ward_code are required")
                values = dict(
                    name=name,
                    ward_id=ward.id,
                    streams=num(row.get("streams"), int) or 1,
                    registered_voters=num(row.get("registered_voters"), int),
                    latitude=num(row.get("latitude"), float),
                    longitude=num(row.get("longitude"), float),
                )
                if code in stations:
                    for k, v in values.items():
                        setattr(stations[code], k, v)
                    updated += 1
                else:
                    stations[code] = PollingStation(code=code, **values)
                    self.s.add(stations[code])
                    created += 1
            except (ValueError, TypeError) as exc:
                errors.append(f"Row {i}: {exc}")
        audit.record(self.s, actor_id=self.ctx.user.id, action="IMPORT", entity="station", ip=self.ctx.ip,
                     created=created, updated=updated, errors=len(errors))
        await self.s.commit()
        return ImportResult(created=created, updated=updated, errors=errors[:50])
