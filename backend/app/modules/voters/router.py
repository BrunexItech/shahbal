from fastapi import APIRouter, Depends, Query

from app.core.deps import Ctx, any_user, require, require_step_up
from app.core.pagination import Page
from app.core.roles import ADMINS, CAPTURERS, VERIFIERS, Role
from app.modules.voters.models import Source, Status, Support
from app.modules.voters.schemas import DuplicateCheck, RejectIn, VoterCreate, VoterOut, VoterUpdate
from app.modules.voters.service import VoterService

router = APIRouter(prefix="/api/v1/voters", tags=["voters"])
capturers = require(*CAPTURERS)
verifiers = require(*VERIFIERS)
editors = require(Role.super_admin, Role.coordinator, Role.ward_coordinator, Role.call_agent)


@router.get("", response_model=Page[VoterOut])
async def search_voters(
    q: str | None = None,
    status: Status | None = None,
    support: Support | None = None,
    source: Source | None = None,
    ward_id: str | None = None,
    constituency_id: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=100),
    ctx: Ctx = Depends(any_user),
):
    items, total = await VoterService(ctx).search(
        q=q, status=status, support=support, source=source, ward_id=ward_id,
        constituency_id=constituency_id, page=page, size=size,
    )
    return Page(items=items, total=total, page=page, size=size)


@router.get("/check-duplicate", response_model=DuplicateCheck)
async def check_duplicate(national_id: str = Query(min_length=6, max_length=12), ctx: Ctx = Depends(capturers)):
    return await VoterService(ctx).check_duplicate(national_id)


@router.post("", response_model=VoterOut, status_code=201)
async def create_voter(payload: VoterCreate, ctx: Ctx = Depends(capturers)):
    return await VoterService(ctx).create(payload)


@router.get("/{voter_id}", response_model=VoterOut)
async def get_voter(voter_id: str, ctx: Ctx = Depends(any_user)):
    return await VoterService(ctx).get(voter_id)


@router.patch("/{voter_id}", response_model=VoterOut)
async def update_voter(voter_id: str, payload: VoterUpdate, ctx: Ctx = Depends(editors)):
    return await VoterService(ctx).update(voter_id, payload)


@router.post("/{voter_id}/verify", response_model=VoterOut)
async def verify_voter(voter_id: str, ctx: Ctx = Depends(verifiers)):
    return await VoterService(ctx).set_status(voter_id, Status.verified)


@router.post("/{voter_id}/reject", response_model=VoterOut)
async def reject_voter(voter_id: str, payload: RejectIn, ctx: Ctx = Depends(verifiers)):
    return await VoterService(ctx).set_status(voter_id, Status.rejected, payload.reason)


@router.post("/{voter_id}/reopen", response_model=VoterOut)
async def reopen_voter(voter_id: str, ctx: Ctx = Depends(verifiers)):
    return await VoterService(ctx).set_status(voter_id, Status.pending)


@router.post("/{voter_id}/reveal-id")
async def reveal_national_id(voter_id: str, ctx: Ctx = Depends(require_step_up(*ADMINS))):
    return {"national_id": await VoterService(ctx).reveal_national_id(voter_id)}
