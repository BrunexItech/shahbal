from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.ratelimit import client_ip
from app.core.roles import Role
from app.core.security import decode_token
from app.modules.users.models import User

bearer = HTTPBearer(auto_error=False)


@dataclass
class Ctx:
    """Everything a service needs about the caller for one request."""

    session: AsyncSession
    user: User
    ip: str


async def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if creds is None:
        raise HTTPException(401, "Not authenticated")
    try:
        user_id = decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired, please sign in again")
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Account disabled")
    return user


def require(*roles: Role):
    allowed = set(roles)

    async def dep(
        request: Request,
        user: User = Depends(current_user),
        session: AsyncSession = Depends(get_session),
    ) -> Ctx:
        if allowed and user.role not in allowed:
            raise HTTPException(403, "You do not have access to this action")
        return Ctx(session=session, user=user, ip=client_ip(request))

    return dep


any_user = require()
