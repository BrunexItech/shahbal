from pydantic import BaseModel

from app.modules.users.schemas import UserOut


class LoginIn(BaseModel):
    email: str  # matched, not validated: format rules belong to account creation
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
