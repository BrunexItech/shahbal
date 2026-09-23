from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.clock import utcnow
from app.core.db import get_session
from app.core.deps import current_user
from app.core.ratelimit import RateLimiter, client_ip
from app.core.security import create_access_token, verify_password
from app.modules.auth.schemas import LoginIn, TokenOut
from app.modules.users.models import User
from app.modules.users.schemas import UserOut

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_login_limiter = RateLimiter(limit=20, window_seconds=15 * 60)


@router.post("/login", response_model=TokenOut)
async def login(payload: LoginIn, request: Request, session: AsyncSession = Depends(get_session)):
    ip = client_ip(request)
    _login_limiter.hit(f"{ip}:{payload.email.lower()}")
    user = (
        await session.execute(select(User).where(func.lower(User.email) == payload.email.lower()))
    ).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    if not user.is_active:
        raise HTTPException(403, "This account has been disabled")
    user.last_login_at = utcnow()
    audit.record(session, actor_id=user.id, action="LOGIN", entity="user", entity_id=user.id, ip=ip)
    await session.commit()
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return user
