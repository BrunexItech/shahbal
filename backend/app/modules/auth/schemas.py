from pydantic import BaseModel, Field

from app.modules.users.schemas import UserOut


class LoginIn(BaseModel):
    email: str = Field(max_length=160)  # matched, not validated: format rules belong to account creation
    password: str = Field(max_length=200)


class MfaIn(BaseModel):
    mfa_token: str
    code: str = Field(min_length=6, max_length=8)


class LoginOut(BaseModel):
    user: UserOut | None = None
    mfa_required: bool = False
    mfa_token: str | None = None


class MeOut(UserOut):
    mfa_setup_required: bool


class TotpSetupOut(BaseModel):
    secret: str
    otpauth_uri: str
    qr_svg: str


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(max_length=200)


class SessionOut(BaseModel):
    id: str
    ip: str | None
    user_agent: str | None
    created_at: str
    last_seen_at: str | None
    current: bool
