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


class UserCreate(BaseModel):
    full_name: str = Field(min_length=3, max_length=120)
    email: EmailStr
    phone: str | None = None
    password: str = Field(min_length=10, max_length=200)
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
    password: str | None = Field(default=None, min_length=10, max_length=200)
