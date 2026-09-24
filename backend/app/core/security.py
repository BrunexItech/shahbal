import re
from datetime import timedelta

import bcrypt
import jwt
import pyotp

from app.core.clock import utcnow
from app.core.config import settings

# A small deny-list of passwords that show up first in every credential-stuffing list.
_COMMON = {
    "password", "password1", "password123", "123456789", "1234567890", "qwerty123", "iloveyou",
    "admin123", "welcome1", "mombasa123", "kenya2027", "changeme", "letmein123",
}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


# Constant-time-ish decoy so unknown emails cost the same as wrong passwords.
_DECOY = bcrypt.hashpw(b"decoy-password", bcrypt.gensalt(rounds=12)).decode()


def burn_password_check(password: str) -> None:
    bcrypt.checkpw(password.encode(), _DECOY.encode())


def password_problems(password: str, email: str | None = None) -> str | None:
    if len(password) < 10:
        return "Password must be at least 10 characters"
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Password must include letters and numbers"
    if password.lower() in _COMMON:
        return "That password is too common"
    if email and email.split("@")[0].lower() in password.lower():
        return "Password must not contain your email name"
    return None


def create_session_token(user_id: str, session_id: str, hours: int | None = None) -> str:
    exp = utcnow() + timedelta(hours=hours or settings.session_hours)
    return jwt.encode({"sub": user_id, "sid": session_id, "typ": "session", "exp": exp}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_mfa_token(user_id: str, portal: str) -> str:
    """Short-lived proof that the password step passed, bound to the portal it started on."""
    exp = utcnow() + timedelta(minutes=5)
    return jwt.encode({"sub": user_id, "typ": "mfa", "portal": portal, "exp": exp}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, typ: str) -> dict:
    """Raises jwt.PyJWTError when invalid, expired or of the wrong type."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("typ") != typ:
        raise jwt.InvalidTokenError("wrong token type")
    return payload


def new_totp_secret() -> str:
    return pyotp.random_base32()


def verify_totp(secret: str, code: str) -> bool:
    code = code.replace(" ", "")
    return code.isdigit() and pyotp.TOTP(secret).verify(code, valid_window=1)


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=settings.app_name)
