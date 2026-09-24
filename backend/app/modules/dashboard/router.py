from fastapi import APIRouter, Depends

from app.core.deps import Ctx, any_user
from app.modules.dashboard.breakdown import breakdown
from app.modules.dashboard.service import DashboardService

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


@router.get("/summary")
async def summary(ctx: Ctx = Depends(any_user)):
    return await DashboardService(ctx).summary()


@router.get("/breakdown")
async def area_breakdown(ctx: Ctx = Depends(any_user)):
    """Captures by constituency → ward → polling station, with visits, for the Targets page."""
    return await breakdown(ctx)
