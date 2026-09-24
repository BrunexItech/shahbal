import enum


class Role(str, enum.Enum):
    """Ordered roughly from widest to narrowest reach. Area reach is decided by
    `app.core.scope`, not by the role name alone."""

    super_admin = "super_admin"
    coordinator = "coordinator"  # one constituency
    ward_coordinator = "ward_coordinator"  # one ward
    field_agent = "field_agent"  # captures in one ward, sees own captures
    call_agent = "call_agent"  # county-wide queue, masked PII
    viewer = "viewer"  # read-only war room


ADMINS = {Role.super_admin}
MANAGERS = {Role.super_admin, Role.coordinator, Role.ward_coordinator}
VERIFIERS = MANAGERS | {Role.call_agent}
CAPTURERS = MANAGERS | {Role.field_agent, Role.call_agent}

# Sign-in portals. HQ/management and field staff never share a sign-in page:
# each portal accepts only its roles, and every session stays bound to its portal.
PORTAL_ROLES: dict[str, set[Role]] = {
    "command": {Role.super_admin, Role.coordinator, Role.ward_coordinator, Role.viewer},
    "field": {Role.field_agent, Role.call_agent},
}


def portal_for(role: Role) -> str:
    return next(p for p, roles in PORTAL_ROLES.items() if role in roles)
