import csv
import io
import math
import re
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.clock import utcnow
from app.core.deps import Ctx
from app.core.roles import Role
from app.core.scope import can_touch_ward, ward_scope
from app.modules.geo import seed_data
from app.modules.geo.locate import ward_code_at
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.users.models import User
from app.modules.geo.schemas import ConstituencyOut, ImportResult, PinIn, PinOut, StationIn, StationUpdate, WardOut, WardUpdate


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
        if st.latitude is not None and st.longitude is not None:
            st.location_quality = "verified"
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
        if "latitude" in fields or "longitude" in fields:
            st.location_quality = "verified" if st.latitude is not None and st.longitude is not None else None
            self._clear_pin(st)
        audit.record(self.s, actor_id=self.ctx.user.id, action="UPDATE", entity="station", entity_id=st.id,
                     ip=self.ctx.ip, fields=sorted(fields))
        await self.s.commit()
        return st

    # ---- field pins: "I'm standing at this station" ----------------------------------
    PIN_MAX_ACCURACY_M = 50
    PIN_BOUNDARY_SLACK_M = 500  # ward lines are drawn, not surveyed: allow a little past them

    async def propose_pin(self, station_id: str, data: PinIn) -> PollingStation:
        st = await self._station(station_id)
        ward = await self._ward(st.ward_id)
        if data.accuracy > self.PIN_MAX_ACCURACY_M:
            raise HTTPException(422, f"Your GPS is only accurate to ±{round(data.accuracy)} m. Step outside, wait a few "
                                     f"seconds and try again (it needs ±{self.PIN_MAX_ACCURACY_M} m or better).")
        near_pin = st.latitude is not None and metres(st.latitude, st.longitude, data.latitude, data.longitude) <= self.PIN_BOUNDARY_SLACK_M
        if ward_code_at(data.latitude, data.longitude) != ward.code and not near_pin:
            raise HTTPException(422, f"Your phone places you outside {ward.name} ward. Pin the station while standing at it.")
        if self.ctx.user.role == Role.super_admin:
            self._apply_pin(st, data.latitude, data.longitude)
            action = "PIN_SET"
        else:
            st.pin_lat, st.pin_lng, st.pin_accuracy = data.latitude, data.longitude, data.accuracy
            st.pin_by_id, st.pin_at = self.ctx.user.id, utcnow()
            action = "PIN_PROPOSE"
        audit.record(self.s, actor_id=self.ctx.user.id, action=action, entity="station", entity_id=st.id, ip=self.ctx.ip,
                     accuracy=round(data.accuracy))
        await self.s.commit()
        return st

    async def pending_pins(self) -> list[PinOut]:
        rows = (await self.s.execute(
            select(PollingStation, Ward.name, User.full_name)
            .join(Ward, Ward.id == PollingStation.ward_id)
            .outerjoin(User, User.id == PollingStation.pin_by_id)
            .where(PollingStation.pin_lat.is_not(None), ward_scope(self.ctx.user))
            .order_by(PollingStation.pin_at)
        )).all()
        return [PinOut(station_id=st.id, station=st.name, code=st.code, ward_id=st.ward_id, ward=wn, latitude=st.latitude,
                       longitude=st.longitude, location_quality=st.location_quality, pin_lat=st.pin_lat, pin_lng=st.pin_lng,
                       pin_accuracy=st.pin_accuracy, pin_by=by, pin_at=st.pin_at,
                       moved_m=round(metres(st.latitude, st.longitude, st.pin_lat, st.pin_lng)) if st.latitude is not None else None)
                for st, wn, by in rows]

    async def decide_pin(self, station_id: str, approve: bool) -> PollingStation:
        st = await self._station(station_id)
        await self._ward(st.ward_id)
        if st.pin_lat is None:
            raise HTTPException(409, "There is no pin waiting for this station")
        if st.pin_by_id == self.ctx.user.id:
            raise HTTPException(403, "Someone else has to approve your own pin")
        if approve:
            self._apply_pin(st, st.pin_lat, st.pin_lng)
        self._clear_pin(st)
        audit.record(self.s, actor_id=self.ctx.user.id, action="PIN_APPROVE" if approve else "PIN_REJECT",
                     entity="station", entity_id=st.id, ip=self.ctx.ip)
        await self.s.commit()
        return st

    async def _station(self, station_id: str) -> PollingStation:
        st = await self.s.get(PollingStation, station_id)
        if st is None:
            raise HTTPException(404, "Polling station not found")
        return st

    @staticmethod
    def _apply_pin(st: PollingStation, lat: float, lng: float) -> None:
        st.latitude, st.longitude, st.location_quality = round(lat, 6), round(lng, 6), "verified"

    @staticmethod
    def _clear_pin(st: PollingStation) -> None:
        st.pin_lat = st.pin_lng = st.pin_accuracy = st.pin_by_id = st.pin_at = None

    async def import_csv(self, raw: bytes) -> ImportResult:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(422, "The file must be UTF-8 CSV")
        result = await upsert_stations(self.s, csv.DictReader(io.StringIO(text)))
        audit.record(self.s, actor_id=self.ctx.user.id, action="IMPORT", entity="station", ip=self.ctx.ip,
                     created=result.created, updated=result.updated, errors=len(result.errors))
        await self.s.commit()
        return result


def metres(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 12_742_000 * math.asin(math.sqrt(a))


def _norm(name: str) -> str:
    return "".join(ch for ch in name.upper() if ch.isalnum())


# Older IEBC lists spell the same centre differently ("Changamwe Sec Sch" is
# "Changamwe Secondary School"; "Timbwini Baptist" is "Timbwani Babtist").
_ABBR = [(r"\bPRI(M|MARY|Y)?\b|\bPRY\b", "PRIMARY"), (r"\bSEC(ONDARY)?\b", "SECONDARY"), (r"\bSCH(OOL|L)?\b", "SCHOOL"),
         (r"\bGRO?U?N?DS?\b", "GROUND"), (r"\bB[AU]B?PTIST\b", "BAPTIST"), (r"\bPHD\b", "PUBLIC HEALTH DEPARTMENT"),
         (r"\bCENT(ER|RE)\b", "CENTRE"), (r"\bST\b", "SAINT")]
_FILLER = {"COMMUNITY", "MIXED", "DAY", "MUNICIPAL", "PUBLIC", "OPEN"}
_KINDS = ("PRIMARY", "SECONDARY", "NURSERY", "ACADEMY", "GROUND", "HALL", "CHURCH", "MOSQUE")


def _words(name: str) -> str:
    s = re.sub(r"[^A-Z0-9 ]", " ", name.upper().replace("'", "").replace('"', ""))
    for pattern, repl in _ABBR:
        s = re.sub(pattern, repl, s)
    return " ".join(s.split())


def same_centre(a: str, b: str) -> bool:
    """Two spellings of one polling centre: close letters, and never a primary vs a secondary school."""
    wa, wb = _words(re.sub(r"\(.*?\)", " ", a)), _words(re.sub(r"\(.*?\)", " ", b))  # "(PHD)", "(SOWETO)"
    ta, tb = set(wa.split()), set(wb.split())
    if {k for k in _KINDS if k in ta} != {k for k in _KINDS if k in tb}:
        return False
    if ta != tb and (ta < tb or tb < ta) and len(ta ^ tb) == 1 and (ta ^ tb) <= _FILLER:
        return True  # "Voroni Primary" / "Voroni Community Primary"
    return SequenceMatcher(None, wa, wb).ratio() >= 0.9


async def _relink_renamed(session: AsyncSession, stations: list[PollingStation]) -> None:
    """Captures and visits on a retired centre move to the current centre it was renamed to."""
    from app.modules.visits.models import Visit
    from app.modules.voters.models import Voter

    active: dict[str, list[PollingStation]] = {}
    for st in stations:
        if st.is_active:
            active.setdefault(st.ward_id, []).append(st)
    for old in (st for st in stations if not st.is_active and st.code.startswith(LEGACY_PREFIX)):
        match = [st for st in active.get(old.ward_id, []) if same_centre(old.name, st.name)]
        if len(match) != 1:
            continue
        for model in (Voter, Visit):
            await session.execute(update(model).where(model.station_id == old.id).values(station_id=match[0].id))
        if match[0].latitude is None and old.latitude is not None:
            match[0].latitude, match[0].longitude, match[0].location_quality = old.latitude, old.longitude, old.location_quality


async def upsert_stations(session: AsyncSession, rows) -> ImportResult:
    """Columns: code,name,ward_code[,streams,registered_voters,latitude,longitude,location].
    Matches an existing station by code, else by (ward, normalised name), so the
    official IEBC list can replace the bundled seed without creating duplicates.
    `location` is exact | approximate (default approximate when coordinates are given).
    A pin confirmed on site (verified) is never overwritten by a file."""
    wards = {w.code: w for w in (await session.execute(select(Ward))).scalars()}
    existing = list((await session.execute(select(PollingStation))).scalars())
    by_code = {st.code: st for st in existing}
    by_name = {(st.ward_id, _norm(st.name)): st for st in existing}
    created = updated = 0
    errors: list[str] = []
    seen: set[str] = set()

    def num(v, cast):
        return cast(v) if v not in (None, "") else None

    for i, row in enumerate(rows, start=2):
        try:
            code, name = (row.get("code") or "").strip(), " ".join((row.get("name") or "").split())
            ward = wards.get((row.get("ward_code") or "").strip().zfill(4))
            if not code or not name or ward is None:
                raise ValueError("code, name and a valid ward_code are required")
            if len(code) > 20 or len(name) > 160:
                raise ValueError("code or name too long")
            lat, lng = num(row.get("latitude"), float), num(row.get("longitude"), float)
            if (lat is None) != (lng is None) or (lat is not None and not (-90 <= lat <= 90 and -180 <= lng <= 180)):
                raise ValueError("latitude/longitude must be given together and be valid")
            # Only columns present in this file overwrite existing data.
            values = dict(name=name, ward_id=ward.id)
            for key, cast in (("streams", int), ("registered_voters", int)):
                if (v := num(row.get(key), cast)) is not None:
                    values[key] = v
            quality = (row.get("location") or "").strip().lower() or "approximate"
            if quality not in ("exact", "approximate"):
                raise ValueError("location must be exact or approximate")
            st = by_code.get(code) or by_name.get((ward.id, _norm(name)))
            if lat is not None and not (st is not None and st.location_quality == "verified"):
                values.update(latitude=lat, longitude=lng, location_quality=quality)
            if st is not None:
                for k, v in values.items():
                    setattr(st, k, v)
                if st.code != code and code not in by_code:
                    by_code.pop(st.code, None)
                    st.code = code
                    by_code[code] = st
                updated += 1
            else:
                st = PollingStation(code=code, **values)
                session.add(st)
                by_code[code] = by_name[(ward.id, _norm(name))] = st
                created += 1
        except (ValueError, TypeError) as exc:
            errors.append(f"Row {i}: {exc}")
        else:
            seen.add(st.code)
    await session.flush()
    return ImportResult(created=created, updated=updated, errors=errors[:50], seen=seen)


SEED_STATIONS = Path(__file__).resolve().parent / "data" / "mombasa_stations.csv"
LEGACY_PREFIX = "MSA-"  # codes of the pre-2022 bundled list


async def seed_stations(session: AsyncSession) -> ImportResult:
    """Load the official IEBC 2022 list (228 polling centres, 1,041 streams, 641,913 voters).

    Runs on every start, so it must be safe to repeat. Leftovers from the earlier bundled
    list (codes "MSA-…") that the 2022 list no longer has are retired: kept, since captures
    may point at them, but hidden. Centres HQ added or imported are never touched."""
    with SEED_STATIONS.open(encoding="utf-8") as f:
        result = await upsert_stations(session, csv.DictReader(f))
    retired = 0
    if not result.errors:
        stations = list((await session.execute(select(PollingStation))).scalars())
        for st in stations:
            if st.code.startswith(LEGACY_PREFIX) and st.code not in result.seen and st.is_active:
                st.is_active = False
                retired += 1
        await _relink_renamed(session, stations)
    # Ward totals follow the register only when the list itself changed, so a figure
    # HQ corrected by hand survives restarts.
    if not result.errors and (result.created or retired):
        await session.flush()
        totals = dict((await session.execute(
            select(PollingStation.ward_id, func.sum(PollingStation.registered_voters))
            .where(PollingStation.is_active.is_(True)).group_by(PollingStation.ward_id)
        )).all())
        for w in (await session.execute(select(Ward))).scalars():
            if totals.get(w.id):
                w.registered_voters = int(totals[w.id])
    await session.commit()
    return result
