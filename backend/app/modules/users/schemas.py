from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.roles import Role


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    email: str
    phone: str | None
    role: Role
    constituency_id: str | None
    ward_id: str | None
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime
    totp_enabled: bool = False
    status: str = "active"  # active | invited | disabled
    has_photo: bool = False
    invite_expires_at: datetime | None = None


class UserCreate(BaseModel):
    """No password: the person sets their own when they accept the invitation."""

    full_name: str = Field(min_length=3, max_length=120)
    email: EmailStr
    phone: str | None = None
    role: Role
    constituency_id: str | None = None
    ward_id: str | None = None


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=3, max_length=120)
    phone: str | None = None
    role: Role | None = None
    constituency_id: str | None = None
    ward_id: str | None = None
    is_active: bool | None = None


class InviteOut(BaseModel):
    url: str
    expires_at: datetime
    sent_via: list[str]
    qr_svg: str  # scan on the new person's own phone during in-person onboarding


class UserCreatedOut(BaseModel):
    user: UserOut
    invite: InviteOut


class InvitePreview(BaseModel):
    first_name: str
    email_hint: str
    role_label: str
    photo_required: bool
    expires_at: datetime
    portal: str
