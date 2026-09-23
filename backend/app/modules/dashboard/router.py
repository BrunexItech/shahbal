from fastapi import APIRouter, Depends

from app.core.deps import Ctx, any_user
from app.modules.dashboard.service import DashboardService

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


@router.get("/summary")
async def summary(ctx: Ctx = Depends(any_user)):
    return await DashboardService(ctx).summary()
