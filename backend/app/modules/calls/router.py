from fastapi import APIRouter, Depends, Response

from app.core.deps import Ctx, any_user
from app.modules.calls.schemas import AgentStat, CallIn, CallOut, Claim, NextIn, QueueCounts
from app.modules.calls.service import CallService

router = APIRouter(prefix="/api/v1/calls", tags=["calls"])


@router.get("/queues", response_model=QueueCounts)
async def queue_counts(ctx: Ctx = Depends(any_user)):
    return await CallService(ctx).counts()


@router.post("/next", response_model=Claim | None)
async def claim_next(payload: NextIn, response: Response, ctx: Ctx = Depends(any_user)):
    claim = await CallService(ctx).claim_next(payload)
    if claim is None:
        response.status_code = 204
    return claim


@router.post("/release", status_code=204)
async def release(ctx: Ctx = Depends(any_user)):
    await CallService(ctx).release()


@router.post("", response_model=CallOut, status_code=201)
async def log_call(payload: CallIn, ctx: Ctx = Depends(any_user)):
    return await CallService(ctx).log(payload)


@router.get("/voter/{voter_id}", response_model=list[CallOut])
async def voter_calls(voter_id: str, ctx: Ctx = Depends(any_user)):
    return await CallService(ctx).history(voter_id)


@router.get("/stats/today", response_model=list[AgentStat])
async def agent_stats(ctx: Ctx = Depends(any_user)):
    return await CallService(ctx).agent_stats()
