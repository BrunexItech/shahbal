from fastapi import APIRouter, Depends

from app.core.deps import Ctx, any_user
from app.modules.election.schemas import MarkIn, ReminderPlanIn, RosterRow, SettingsIn, SettingsOut, TurnoutOut
from app.modules.election.plan import PlanIn, plan_view, save_plan
from app.modules.election.service import ElectionService

router = APIRouter(prefix="/api/v1/election", tags=["election"])


@router.get("/settings", response_model=SettingsOut)
async def get_settings(ctx: Ctx = Depends(any_user)):
    return await ElectionService(ctx).get_settings()


@router.put("/settings", response_model=SettingsOut)
async def put_settings(payload: SettingsIn, ctx: Ctx = Depends(any_user)):
    return await ElectionService(ctx).update_settings(payload)


@router.get("/plan")
async def get_plan(ctx: Ctx = Depends(any_user)):
    return await plan_view(ctx)


@router.put("/plan")
async def put_plan(payload: PlanIn, ctx: Ctx = Depends(any_user)):
    return await save_plan(ctx, payload)


@router.post("/voters/{voter_id}/voted")
async def mark_voted(voter_id: str, payload: MarkIn, ctx: Ctx = Depends(any_user)):
    return await ElectionService(ctx).mark(voter_id, payload)


@router.get("/roster", response_model=list[RosterRow])
async def roster(station_id: str | None = None, ward_id: str | None = None, q: str | None = None, only_pending: bool = False,
                 ctx: Ctx = Depends(any_user)):
    return await ElectionService(ctx).roster(station_id, ward_id, q, only_pending)


@router.get("/turnout", response_model=TurnoutOut)
async def turnout(ward_id: str | None = None, ctx: Ctx = Depends(any_user)):
    return await ElectionService(ctx).turnout(ward_id)


@router.post("/reminders", response_model=list[str])
async def plan_reminders(payload: ReminderPlanIn, ctx: Ctx = Depends(any_user)):
    return await ElectionService(ctx).plan_reminders(payload)
