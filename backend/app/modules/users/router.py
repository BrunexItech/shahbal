from fastapi import APIRouter, Depends

from app.core.deps import Ctx, require, require_step_up
from app.core.roles import MANAGERS
from app.modules.users.schemas import UserCreate, UserOut, UserUpdate
from app.modules.users.service import UserService

router = APIRouter(prefix="/api/v1/users", tags=["users"])
managers = require(*MANAGERS)
# Changing who can access what needs a fresh re-confirmation.
managers_confirmed = require_step_up(*MANAGERS)


@router.get("", response_model=list[UserOut])
async def list_users(ctx: Ctx = Depends(managers)):
    return await UserService(ctx).list()


@router.post("", response_model=UserOut, status_code=201)
async def create_user(payload: UserCreate, ctx: Ctx = Depends(managers_confirmed)):
    return await UserService(ctx).create(payload)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(user_id: str, payload: UserUpdate, ctx: Ctx = Depends(managers_confirmed)):
    return await UserService(ctx).update(user_id, payload)


@router.post("/{user_id}/revoke-sessions", status_code=204)
async def revoke_sessions(user_id: str, ctx: Ctx = Depends(managers_confirmed)):
    await UserService(ctx).revoke_sessions(user_id)
