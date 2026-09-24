from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, pg_enum
from app.core.roles import Role


class User(Base):
    __tablename__ = "users"

    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[Role] = mapped_column(pg_enum(Role, "role"), index=True)
    # Area assignment: coordinator -> constituency; ward roles -> ward.
    constituency_id: Mapped[str | None] = mapped_column(ForeignKey("constituencies.id"))
    ward_id: Mapped[str | None] = mapped_column(ForeignKey("wards.id"))
    is_active: Mapped[bool] = mapped_column(default=True)
    last_login_at: Mapped[datetime | None]

    # Brute-force protection
    failed_logins: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[datetime | None]

    # TOTP 2FA. The secret is Fernet-encrypted like other sensitive fields.
    totp_secret_enc: Mapped[str | None] = mapped_column(Text)
    totp_enabled: Mapped[bool] = mapped_column(default=False)
    # Denormalised so the per-request MFA-policy check needs no extra query.
    passkey_count: Mapped[int] = mapped_column(default=0)

    @property
    def has_second_factor(self) -> bool:
        return self.totp_enabled or self.passkey_count > 0


class UserSession(Base):
    """Server-side session behind each cookie, so logout / disable / password change
    revoke access immediately instead of waiting for a JWT to expire."""

    __tablename__ = "user_sessions"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    last_seen_at: Mapped[datetime | None]
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    auth_method: Mapped[str] = mapped_column(String(20), default="password")  # password | totp | passkey
    portal: Mapped[str] = mapped_column(String(10), default="command")  # command | field
    # Re-confirmed ("step-up") until: sensitive actions require this to be in the future.
    elevated_until: Mapped[datetime | None]
