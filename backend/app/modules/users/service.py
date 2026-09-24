from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.deps import Ctx
from app.core.roles import Role
from app.core.clock import utcnow
from app.modules.users import onboarding
from app.modules.geo.models import Ward
from app.modules.users.models import User, UserInvite, UserSession
from app.modules.users.schemas import UserCreate, UserUpdate

async def revoke_all_sessions(session: AsyncSession, user_id: str, except_id: str | None = None) -> None:
    stmt = update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    if except_id:
        stmt = stmt.where(UserSession.id != except_id)
    await session.execute(stmt.values(revoked_at=utcnow()))


# Which roles each manager may hand out. Coordinators grow their own teams,
# but only a super admin can mint coordinators or admins.
GRANTABLE: dict[Role, set[Role]] = {
    Role.super_admin: set(Role),
    Role.coordinator: {Role.ward_coordinator, Role.field_agent},
    Role.ward_coordinator: {Role.field_agent},
}


class UserService:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self.s = ctx.session

    def _visible(self):
        u = self.ctx.user
        if u.role == Role.coordinator:
            return (User.constituency_id == u.constituency_id) | User.ward_id.in_(
                select(Ward.id).where(Ward.constituency_id == u.constituency_id)
            )
        if u.role == Role.ward_coordinator:
            return User.ward_id == u.ward_id
        return User.id.is_not(None)

    async def list(self) -> list[User]:
        stmt = select(User).where(self._visible()).order_by(User.full_name)
        return list((await self.s.execute(stmt)).scalars().all())

    async def _normalise_area(self, role: Role, constituency_id: str | None, ward_id: str | None):
        """Derive/validate the area pair for a role and ensure the caller may assign it."""
        me = self.ctx.user
        if role in (Role.ward_coordinator, Role.field_agent):
            if not ward_id:
                raise HTTPException(422, "A ward is required for this role")
            ward = await self.s.get(Ward, ward_id)
            if ward is None:
                raise HTTPException(422, "Unknown ward")
            constituency_id = ward.constituency_id
        elif role == Role.coordinator:
            if not constituency_id:
                raise HTTPException(422, "A constituency is required for coordinators")
            ward_id = None
        else:
            constituency_id = ward_id = None

        if me.role == Role.coordinator and constituency_id != me.constituency_id:
            raise HTTPException(403, "You can only assign people inside your constituency")
        if me.role == Role.ward_coordinator and ward_id != me.ward_id:
            raise HTTPException(403, "You can only assign people inside your ward")
        return constituency_id, ward_id

    def _check_grant(self, role: Role):
        if role not in GRANTABLE.get(self.ctx.user.role, set()):
            raise HTTPException(403, f"You cannot assign the {role.value} role")

    async def create(self, data: UserCreate) -> tuple[User, str, UserInvite]:
        self._check_grant(data.role)
        exists = await self.s.execute(select(User.id).where(func.lower(User.email) == data.email.lower()))
        if exists.first():
            raise HTTPException(409, "A user with this email already exists")
        constituency_id, ward_id = await self._normalise_area(data.role, data.constituency_id, data.ward_id)
        user = User(
            full_name=data.full_name.strip(),
            email=data.email.lower(),
            phone=data.phone,
            password_hash=onboarding.unusable_password(),
            role=data.role,
            constituency_id=constituency_id,
            ward_id=ward_id,
        )
        self.s.add(user)
        await self.s.flush()
        token, inv = await onboarding.issue_invite(self.s, user, self.ctx.user)
        audit.record(self.s, actor_id=self.ctx.user.id, action="INVITE", entity="user", entity_id=user.id,
                     ip=self.ctx.ip, role=data.role.value)
        await self.s.commit()
        return user, token, inv

    async def reinvite(self, user_id: str) -> tuple[User, str, UserInvite]:
        """Resend the invitation, or reset access for an active account: the old
        password stops working and every session ends until they accept again."""
        user = (await self.s.execute(select(User).where(User.id == user_id, self._visible()))).scalar_one_or_none()
        if user is None:
            raise HTTPException(404, "User not found")
        if user.id == self.ctx.user.id:
            raise HTTPException(400, "Use My Account to change your own password")
        self._check_grant(user.role)
        if user.activated_at is not None:
            user.password_hash = onboarding.unusable_password()
            user.activated_at = None
            await revoke_all_sessions(self.s, user.id)
        token, inv = await onboarding.issue_invite(self.s, user, self.ctx.user)
        audit.record(self.s, actor_id=self.ctx.user.id, action="INVITE", entity="user", entity_id=user.id, ip=self.ctx.ip, resend=True)
        await self.s.commit()
        return user, token, inv

    async def revoke_invite(self, user_id: str) -> None:
        user = (await self.s.execute(select(User).where(User.id == user_id, self._visible()))).scalar_one_or_none()
        if user is None:
            raise HTTPException(404, "User not found")
        self._check_grant(user.role)
        await onboarding.revoke_invites(self.s, user.id)
        audit.record(self.s, actor_id=self.ctx.user.id, action="INVITE_REVOKE", entity="user", entity_id=user.id, ip=self.ctx.ip)
        await self.s.commit()

    async def visible_user(self, user_id: str) -> User:
        if user_id in ("me", self.ctx.user.id):
            return self.ctx.user
        user = (await self.s.execute(select(User).where(User.id == user_id, self._visible()))).scalar_one_or_none()
        if user is None:
            raise HTTPException(404, "User not found")
        return user

    async def update(self, user_id: str, data: UserUpdate) -> User:
        stmt = select(User).where(User.id == user_id, self._visible())
        user = (await self.s.execute(stmt)).scalar_one_or_none()
        if user is None:
            raise HTTPException(404, "User not found")
        if user.id == self.ctx.user.id and (data.role is not None or data.is_active is False):
            raise HTTPException(400, "You cannot change your own role or disable yourself")
        self._check_grant(user.role)
        role = data.role or user.role
        self._check_grant(role)
        fields = data.model_dump(exclude_unset=True)
        if {"role", "constituency_id", "ward_id"} & fields.keys():
            user.constituency_id, user.ward_id = await self._normalise_area(
                role, fields.get("constituency_id", user.constituency_id), fields.get("ward_id", user.ward_id)
            )
            user.role = role
        for key in ("full_name", "phone", "is_active"):
            if key in fields:
                setattr(user, key, fields[key])
        if data.is_active is False or "role" in fields:
            # Access changed: force re-authentication everywhere.
            await revoke_all_sessions(self.s, user.id)
        audit.record(self.s, actor_id=self.ctx.user.id, action="UPDATE", entity="user", entity_id=user.id,
                     ip=self.ctx.ip, fields=sorted(k for k in fields if k != "password"))
        await self.s.commit()
        return user

    async def revoke_sessions(self, user_id: str) -> None:
        user = (await self.s.execute(select(User).where(User.id == user_id, self._visible()))).scalar_one_or_none()
        if user is None:
            raise HTTPException(404, "User not found")
        self._check_grant(user.role)
        await revoke_all_sessions(self.s, user.id)
        audit.record(self.s, actor_id=self.ctx.user.id, action="SESSIONS_REVOKE", entity="user", entity_id=user.id, ip=self.ctx.ip)
        await self.s.commit()
