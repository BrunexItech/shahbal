import enum
from datetime import datetime

from sqlalchemy import JSON, ForeignKey, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, pg_enum


class Passkey(Base):
    """A WebAuthn credential: platform (fingerprint/face/PIN on a phone or laptop)
    or roaming (hardware security key). Only the public key is stored; biometrics
    never leave the user's device."""

    __tablename__ = "passkeys"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    sign_count: Mapped[int] = mapped_column(default=0)
    transports: Mapped[list | None] = mapped_column(JSON)
    aaguid: Mapped[str | None] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(60))
    kind: Mapped[str] = mapped_column(String(20))  # platform | security_key
    backed_up: Mapped[bool] = mapped_column(default=False)  # synced passkey (e.g. Google Password Manager / iCloud)
    last_used_at: Mapped[datetime | None]


class ChallengePurpose(str, enum.Enum):
    register = "register"
    login = "login"
    second_factor = "second_factor"
    step_up = "step_up"
    gis_link = "gis_link"  # one-time signed GIS Lab project link


class AuthChallenge(Base):
    """Server-side, single-use, short-lived WebAuthn challenge (replay protection)."""

    __tablename__ = "auth_challenges"

    purpose: Mapped[ChallengePurpose] = mapped_column(pg_enum(ChallengePurpose, "challenge_purpose"))
    challenge: Mapped[bytes] = mapped_column(LargeBinary)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    meta: Mapped[dict | None] = mapped_column(JSON)
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]


class KnownDevice(Base):
    """Browsers a user has signed in from, recognised by a random httpOnly cookie
    (stored hashed). A sign-in from an unknown device triggers an alert."""

    __tablename__ = "known_devices"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_hash: Mapped[str] = mapped_column(String(64), index=True)
    user_agent: Mapped[str | None] = mapped_column(String(300))
    first_ip: Mapped[str | None] = mapped_column(String(64))
    last_seen_at: Mapped[datetime | None]
