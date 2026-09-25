from fastapi import APIRouter, Depends, Query

from app.core.deps import Ctx, any_user, require
from app.core.roles import OVERSIGHT, Role
from app.modules.dashboard import analytics
from app.modules.dashboard.breakdown import breakdown
from app.modules.dashboard.service import DashboardService

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])
oversight = require(*OVERSIGHT)


@router.get("/summary")
async def summary(ctx: Ctx = Depends(oversight)):
    return await DashboardService(ctx).summary()


@router.get("/breakdown")
async def area_breakdown(ctx: Ctx = Depends(oversight)):
    """Captures by constituency → ward → polling station, with visits, for the Targets page."""
    return await breakdown(ctx)


@router.get("/trends")
async def capture_trends(days: int = Query(30, ge=7, le=180), ctx: Ctx = Depends(oversight)):
    return await analytics.trends(ctx, days)


@router.get("/supporters")
async def supporter_profile(ctx: Ctx = Depends(oversight)):
    return await analytics.supporters(ctx)


@router.get("/my-area")
async def my_area(ctx: Ctx = Depends(require(Role.field_agent))):
    """A field agent's own workspace: their ward, their numbers, today's visits."""
    return await analytics.my_area(ctx)
