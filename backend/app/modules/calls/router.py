from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from pydantic import BaseModel, Field

from app.core.deps import Ctx, any_user, require, require_step_up
from app.core.roles import ADMINS, MANAGERS, Role
from app.modules.calls import telephony
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


# ---- softphone & phone lines -------------------------------------------------------
callers = require(*MANAGERS, Role.call_agent)


@router.get("/softphone")
async def softphone(ctx: Ctx = Depends(callers)):
    return await telephony.softphone_config(ctx)


class SipAccountIn(BaseModel):
    sip_user: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9_.+-]+$")
    sip_password: str = Field(min_length=6, max_length=128)


@router.get("/sip-accounts")
async def sip_accounts(ctx: Ctx = Depends(require(*ADMINS))):
    return await telephony.list_sip_accounts(ctx)


@router.put("/sip-accounts/{user_id}", status_code=204)
async def put_sip_account(user_id: str, payload: SipAccountIn, ctx: Ctx = Depends(require_step_up(*ADMINS))):
    await telephony.set_sip_account(ctx, user_id, payload.sip_user, payload.sip_password)


# ---- recordings ----------------------------------------------------------------------
@router.post("/recordings", status_code=201)
async def upload_recording(file: UploadFile = File(...), voter_id: str | None = Form(None), dialled: str | None = Form(None),
                           duration_seconds: int = Form(0), line: str = Form("sandbox"), ctx: Ctx = Depends(callers)):
    rec = await telephony.save_recording(ctx, file, voter_id or None, dialled, duration_seconds, line)
    return {"id": rec.id}


@router.get("/recordings")
async def recordings(agent_id: str | None = None, voter_id: str | None = None, page: int = Query(1, ge=1),
                     size: int = Query(25, ge=1, le=100), ctx: Ctx = Depends(require(*MANAGERS))):
    items, total = await telephony.list_recordings(ctx, agent_id, voter_id, page, size)
    return {"items": items, "total": total, "page": page, "size": size}


@router.get("/recordings/{rec_id}/audio")
async def recording_audio(rec_id: str, ctx: Ctx = Depends(require_step_up(*MANAGERS))):
    data, mime = await telephony.play_recording(ctx, rec_id)
    return Response(data, media_type=mime, headers={"Cache-Control": "no-store", "Content-Disposition": "inline"})


@router.delete("/recordings/{rec_id}", status_code=204)
async def remove_recording(rec_id: str, ctx: Ctx = Depends(require_step_up(*ADMINS))):
    await telephony.delete_recording(ctx, rec_id)
