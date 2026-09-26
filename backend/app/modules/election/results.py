"""Election-night parallel tally from Form 34A: one form per polling stream.

Agents at the stream enter the declared votes and photograph the signed form; the
photo is re-encoded (metadata stripped) and stored encrypted. Coordinators verify or
dispute each form against its photo. The tally counts every form that isn't disputed,
and separately the verified ones only."""
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.core import audit, vault
from app.core.deps import Ctx, require, require_step_up
from app.core.roles import ADMINS, MANAGERS, OVERSIGHT, Role
from app.core.scope import can_touch_ward, ward_scope
from app.modules.election.models import Candidate, ResultForm
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.users.models import User
from app.modules.visits.photos import MAX_BYTES, clean

router = APIRouter(prefix="/api/v1/election", tags=["election results"])
NS = "result-forms"
MAX_STREAM_VOTES = 1000  # IEBC streams hold at most ~700 voters; anything above is a typo
submitters = require(*MANAGERS, Role.field_agent)
viewers = require(*OVERSIGHT, Role.field_agent)
managers = require(*MANAGERS)


# ---- candidates -----------------------------------------------------------------------
class CandidateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    party: str | None = Field(default=None, max_length=80)
    ours: bool = False
    color: str = Field(default="#64748b", pattern=r"^#[0-9a-fA-F]{6}$")


class CandidatesIn(BaseModel):
    candidates: list[CandidateIn] = Field(min_length=1, max_length=12)


def _cand(c: Candidate) -> dict:
    return {"id": c.id, "name": c.name, "party": c.party, "ours": c.ours, "color": c.color, "position": c.position}


@router.get("/candidates")
async def candidates(ctx: Ctx = Depends(viewers)):
    rows = (await ctx.session.execute(select(Candidate).order_by(Candidate.position))).scalars().all()
    return [_cand(c) for c in rows]


@router.put("/candidates")
async def set_candidates(payload: CandidatesIn, ctx: Ctx = Depends(require_step_up(*ADMINS))):
    """Replace the ballot. Refused once any result is in, so forms never point at a removed candidate."""
    if (await ctx.session.execute(select(func.count(ResultForm.id)))).scalar_one():
        raise HTTPException(409, "Results are already in; the ballot can't change now")
    if sum(c.ours for c in payload.candidates) != 1:
        raise HTTPException(422, "Mark exactly one candidate as ours")
    for c in (await ctx.session.execute(select(Candidate))).scalars():
        await ctx.session.delete(c)
    for i, c in enumerate(payload.candidates):
        ctx.session.add(Candidate(**c.model_dump(), position=i))
    audit.record(ctx.session, actor_id=ctx.user.id, action="UPDATE", entity="candidates", ip=ctx.ip, count=len(payload.candidates))
    await ctx.session.commit()
    return await candidates(ctx)


# ---- submitting a form ----------------------------------------------------------------
@router.post("/results", status_code=201)
async def submit(station_id: str = Form(...), stream_no: int = Form(..., ge=1, le=60), votes: str = Form(...),
                 rejected: int = Form(0, ge=0, le=MAX_STREAM_VOTES), photo: UploadFile | None = File(None),
                 ctx: Ctx = Depends(submitters)):
    st = await ctx.session.get(PollingStation, station_id)
    if st is None or not st.is_active:
        raise HTTPException(404, "Polling centre not found")
    ward = await ctx.session.get(Ward, st.ward_id)
    if not can_touch_ward(ctx.user, ward):
        raise HTTPException(403, "You can submit results only for your own area")
    if stream_no > st.streams:
        raise HTTPException(422, f"{st.name} has {st.streams} stream{'s' if st.streams > 1 else ''}")
    ballot = {c.id for c in (await ctx.session.execute(select(Candidate))).scalars()}
    if not ballot:
        raise HTTPException(409, "HQ hasn't set up the candidates yet")
    try:
        parsed = {str(k): int(v) for k, v in json.loads(votes).items()}
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(422, "Votes must be numbers for each candidate")
    if set(parsed) != ballot or any(v < 0 for v in parsed.values()):
        raise HTTPException(422, "Enter the votes for every candidate on the ballot")
    if sum(parsed.values()) + rejected > MAX_STREAM_VOTES:
        raise HTTPException(422, "Those numbers are larger than any stream can hold. Check the form again.")
    form = (await ctx.session.execute(
        select(ResultForm).where(ResultForm.station_id == st.id, ResultForm.stream_no == stream_no)
    )).scalar_one_or_none()
    if form is not None and form.status == "verified" and ctx.user.role not in MANAGERS:
        raise HTTPException(409, "This stream's result is already verified. Ask your coordinator to change it.")
    raw = await photo.read(MAX_BYTES + 1) if photo else None
    if form is None and not raw:
        raise HTTPException(422, "Take a clear photo of the signed Form 34A")
    if raw:
        jpeg, _, _ = clean(raw)
        path, sha = vault.store(jpeg, ns=NS)
        if form is not None:
            vault.delete(form.photo_path, ns=NS)
    if form is None:
        form = ResultForm(station_id=st.id, stream_no=stream_no, votes=parsed, rejected=rejected, photo_path=path, photo_sha256=sha,
                          submitted_by_id=ctx.user.id)
        ctx.session.add(form)
    else:
        form.votes, form.rejected, form.submitted_by_id, form.status, form.reviewed_by_id, form.note = parsed, rejected, ctx.user.id, "submitted", None, None
        if raw:
            form.photo_path, form.photo_sha256 = path, sha
    await ctx.session.flush()
    audit.record(ctx.session, actor_id=ctx.user.id, action="RESULT_SUBMIT", entity="result_form", entity_id=form.id, ip=ctx.ip,
                 station=st.code, stream=stream_no)
    await ctx.session.commit()
    return {"id": form.id, "status": form.status}


# ---- the tally --------------------------------------------------------------------------
def _add(into: dict, votes: dict) -> None:
    for k, v in votes.items():
        into[k] = into.get(k, 0) + int(v)


@router.get("/results/tally")
async def tally(verified_only: bool = False, ctx: Ctx = Depends(require(*OVERSIGHT))):
    cands = [_cand(c) for c in (await ctx.session.execute(select(Candidate).order_by(Candidate.position))).scalars()]
    stations = (await ctx.session.execute(
        select(PollingStation.id, PollingStation.ward_id, PollingStation.streams, Ward.name, Ward.constituency_id, Constituency.name)
        .join(Ward, Ward.id == PollingStation.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
        .where(PollingStation.is_active.is_(True), ward_scope(ctx.user))
    )).all()
    where = [ResultForm.station_id.in_([s[0] for s in stations])] if stations else [ResultForm.id.is_(None)]
    where.append(ResultForm.status == "verified" if verified_only else ResultForm.status != "disputed")
    forms = (await ctx.session.execute(select(ResultForm.station_id, ResultForm.votes, ResultForm.rejected, ResultForm.status).where(*where))).all()
    counts = dict((await ctx.session.execute(
        select(ResultForm.status, func.count()).where(ResultForm.station_id.in_([s[0] for s in stations]) if stations else ResultForm.id.is_(None))
        .group_by(ResultForm.status)
    )).all())
    meta = {sid: (wid, wname, cid, cname) for sid, wid, _, wname, cid, cname in stations}
    total, rej = {}, 0
    wards: dict[str, dict] = {}
    cons: dict[str, dict] = {}
    for sid, wid, streams, wname, cid, cname in stations:
        wards.setdefault(wid, {"id": wid, "name": wname, "constituency": cname, "streams": 0, "reported": 0, "votes": {}})["streams"] += streams
        cons.setdefault(cid, {"id": cid, "name": cname, "streams": 0, "reported": 0, "votes": {}})["streams"] += streams
    for sid, votes, rejected, _ in forms:
        wid, _, cid, _ = meta[sid]
        _add(total, votes)
        _add(wards[wid]["votes"], votes)
        _add(cons[cid]["votes"], votes)
        wards[wid]["reported"] += 1
        cons[cid]["reported"] += 1
        rej += rejected
    streams_total = sum(s[2] for s in stations)
    return {
        "candidates": cands, "totals": total, "rejected": rej, "valid": sum(total.values()),
        "streams_total": streams_total, "streams_reported": len(forms), "verified_only": verified_only,
        "forms": {"submitted": counts.get("submitted", 0), "verified": counts.get("verified", 0), "disputed": counts.get("disputed", 0)},
        "constituencies": sorted(cons.values(), key=lambda c: c["name"]),
        "wards": sorted(wards.values(), key=lambda w: (w["constituency"], w["name"])),
    }


# ---- the forms themselves ----------------------------------------------------------------
@router.get("/results")
async def forms(ward_id: str | None = None, status: str | None = Query(None, pattern="^(submitted|verified|disputed)$"),
                mine: bool = False, ctx: Ctx = Depends(viewers)):
    by, rev = aliased(User), aliased(User)
    q = (select(ResultForm, PollingStation.name, PollingStation.code, PollingStation.streams, Ward.name, by.full_name, rev.full_name)
         .join(PollingStation, PollingStation.id == ResultForm.station_id).join(Ward, Ward.id == PollingStation.ward_id)
         .outerjoin(by, by.id == ResultForm.submitted_by_id).outerjoin(rev, rev.id == ResultForm.reviewed_by_id)
         .where(ward_scope(ctx.user)))
    if ctx.user.role == Role.field_agent or mine:
        q = q.where(ResultForm.submitted_by_id == ctx.user.id)
    if ward_id:
        q = q.where(PollingStation.ward_id == ward_id)
    if status:
        q = q.where(ResultForm.status == status)
    rows = (await ctx.session.execute(q.order_by(ResultForm.updated_at.desc()).limit(300))).all()
    return [{"id": f.id, "station_id": f.station_id, "station": sn, "code": sc, "streams": ss, "stream_no": f.stream_no, "ward": wn,
             "votes": f.votes, "rejected": f.rejected, "status": f.status, "note": f.note, "submitted_by": bn, "reviewed_by": rn,
             "updated_at": f.updated_at.isoformat() if f.updated_at else None, "photo_url": f"/api/v1/election/results/{f.id}/photo"}
            for f, sn, sc, ss, wn, bn, rn in rows]


async def _form_in_scope(ctx: Ctx, fid: str) -> tuple[ResultForm, Ward]:
    f = await ctx.session.get(ResultForm, fid)
    if f is None:
        raise HTTPException(404, "Form not found")
    st = await ctx.session.get(PollingStation, f.station_id)
    ward = await ctx.session.get(Ward, st.ward_id)
    if not can_touch_ward(ctx.user, ward) or (ctx.user.role == Role.field_agent and f.submitted_by_id != ctx.user.id):
        raise HTTPException(404, "Form not found")
    return f, ward


@router.get("/results/{fid}/photo")
async def form_photo(fid: str, ctx: Ctx = Depends(viewers)):
    f, _ = await _form_in_scope(ctx, fid)
    try:
        data = vault.load(f.photo_path, f.photo_sha256, ns=NS)
    except FileNotFoundError:
        raise HTTPException(404, "Photo not found")
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=600"})


class ReviewIn(BaseModel):
    status: str = Field(pattern="^(verified|disputed|submitted)$")
    note: str | None = Field(default=None, max_length=300)


@router.post("/results/{fid}/review")
async def review(fid: str, payload: ReviewIn, ctx: Ctx = Depends(managers)):
    f, _ = await _form_in_scope(ctx, fid)
    if payload.status == "disputed" and not (payload.note or "").strip():
        raise HTTPException(422, "Say what's wrong with this form")
    f.status, f.note, f.reviewed_by_id = payload.status, (payload.note or "").strip() or None, ctx.user.id
    audit.record(ctx.session, actor_id=ctx.user.id, action=f"RESULT_{payload.status.upper()}", entity="result_form", entity_id=f.id, ip=ctx.ip)
    await ctx.session.commit()
    return {"id": f.id, "status": f.status}
