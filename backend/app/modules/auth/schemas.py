from typing import Literal

from pydantic import BaseModel, Field

from app.modules.users.schemas import UserOut

Portal = Literal["command", "field"]


class LoginIn(BaseModel):
    email: str = Field(max_length=160)  # matched, not validated: format rules belong to account creation
    password: str = Field(max_length=200)
    portal: Portal


class MfaIn(BaseModel):
    mfa_token: str
    code: str = Field(min_length=6, max_length=8)
    portal: Portal


class LoginOut(BaseModel):
    user: UserOut | None = None
    mfa_required: bool = False
    mfa_token: str | None = None
    mfa_methods: list[str] = []  # "passkey", "totp"


class MeOut(UserOut):
    mfa_setup_required: bool
    portal: str = "command"
    passkey_count: int = 0
    session_method: str = "password"
    elevated_until: str | None = None
    idle_minutes: int = 30


class PasskeyOptionsIn(BaseModel):
    mfa_token: str | None = None  # present = second factor after a password; absent = passwordless
    portal: Portal


class PasskeyVerifyIn(BaseModel):
    flow_id: str = Field(max_length=64)
    credential: dict
    mfa_token: str | None = None
    portal: Portal


class PasskeyRegisterOptionsIn(BaseModel):
    kind: str = Field(default="platform", pattern="^(platform|security_key)$")


class PasskeyRegisterIn(BaseModel):
    flow_id: str = Field(max_length=64)
    credential: dict
    name: str = Field(default="My passkey", min_length=1, max_length=60)


class OptionsOut(BaseModel):
    flow_id: str
    options: dict


class StepUpOptionsOut(BaseModel):
    methods: list[str]
    flow_id: str | None = None
    options: dict | None = None


class StepUpIn(BaseModel):
    method: str = Field(pattern="^(passkey|totp|password)$")
    flow_id: str | None = Field(default=None, max_length=64)
    credential: dict | None = None
    code: str | None = Field(default=None, max_length=8)
    password: str | None = Field(default=None, max_length=200)


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
