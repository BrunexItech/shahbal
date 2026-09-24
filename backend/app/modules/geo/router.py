from fastapi import APIRouter, Depends, UploadFile

from app.core.deps import Ctx, any_user, require, require_step_up
from app.core.roles import ADMINS, MANAGERS, Role
from app.modules.geo.schemas import (
    ConstituencyOut,
    ImportResult,
    StationIn,
    StationOut,
    StationUpdate,
    WardOut,
    WardUpdate,
)
from app.modules.geo.service import GeoService

router = APIRouter(prefix="/api/v1/geo", tags=["geo"])
managers = require(*MANAGERS)
target_setters = require(Role.super_admin, Role.coordinator)


@router.get("/tree", response_model=list[ConstituencyOut])
async def tree(ctx: Ctx = Depends(any_user)):
    return await GeoService(ctx).tree()


@router.patch("/wards/{ward_id}", response_model=WardOut)
async def update_ward(ward_id: str, payload: WardUpdate, ctx: Ctx = Depends(target_setters)):
    return await GeoService(ctx).update_ward(ward_id, payload)


@router.get("/stations", response_model=list[StationOut])
async def stations(ward_id: str | None = None, q: str | None = None, ctx: Ctx = Depends(any_user)):
    return await GeoService(ctx).stations(ward_id, q)


@router.post("/stations", response_model=StationOut, status_code=201)
async def create_station(payload: StationIn, ctx: Ctx = Depends(managers)):
    return await GeoService(ctx).create_station(payload)


@router.patch("/stations/{station_id}", response_model=StationOut)
async def update_station(station_id: str, payload: StationUpdate, ctx: Ctx = Depends(managers)):
    return await GeoService(ctx).update_station(station_id, payload)


@router.post("/stations/import", response_model=ImportResult)
async def import_stations(file: UploadFile, ctx: Ctx = Depends(require_step_up(*ADMINS))):
    return await GeoService(ctx).import_csv(await file.read())
