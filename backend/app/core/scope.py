"""Area-based access. Every query over area-owned data passes through
`voter_scope` / `ward_scope`, so a ward coordinator can never page into another
ward regardless of which endpoint they hit."""
from sqlalchemy import ColumnElement, select, true

from app.core.roles import Role
from app.modules.geo.models import Ward
from app.modules.users.models import User
from app.modules.voters.models import Voter


def ward_scope(user: User) -> ColumnElement[bool]:
    if user.role == Role.coordinator:
        return Ward.constituency_id == user.constituency_id
    if user.role in (Role.ward_coordinator, Role.field_agent):
        return Ward.id == user.ward_id
    return true()


def voter_scope(user: User) -> ColumnElement[bool]:
    if user.role == Role.field_agent:
        return Voter.captured_by_id == user.id
    if user.role == Role.coordinator:
        return Voter.ward_id.in_(select(Ward.id).where(Ward.constituency_id == user.constituency_id))
    if user.role == Role.ward_coordinator:
        return Voter.ward_id == user.ward_id
    return true()


def can_touch_ward(user: User, ward: Ward) -> bool:
    if user.role == Role.coordinator:
        return ward.constituency_id == user.constituency_id
    if user.role in (Role.ward_coordinator, Role.field_agent):
        return ward.id == user.ward_id
    return True
