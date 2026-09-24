import enum
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, pg_enum


class Source(str, enum.Enum):
    field = "field"
    portal = "portal"
    call_centre = "call_centre"
    import_ = "import"


class Status(str, enum.Enum):
    """Contact verification — NOT IEBC registration status."""

    pending = "pending"
    verified = "verified"
    rejected = "rejected"


class Support(str, enum.Enum):
    supporter = "supporter"
    leaning = "leaning"
    undecided = "undecided"
    opposed = "opposed"
    unknown = "unknown"


class Gender(str, enum.Enum):
    female = "female"
    male = "male"
    other = "other"


class Voter(Base):
    __tablename__ = "voters"

    reference: Mapped[str] = mapped_column(String(20), unique=True)
    full_name: Mapped[str] = mapped_column(String(160), index=True)
    phone: Mapped[str] = mapped_column(String(20), index=True)
    national_id_enc: Mapped[str] = mapped_column(Text)
    national_id_hash: Mapped[str] = mapped_column(String(64), unique=True)
    national_id_last4: Mapped[str] = mapped_column(String(4))
    voter_card_no: Mapped[str | None] = mapped_column(String(40))
    gender: Mapped[Gender | None] = mapped_column(pg_enum(Gender, "gender"))
    birth_year: Mapped[int | None]

    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.id"), index=True)
    station_id: Mapped[str | None] = mapped_column(ForeignKey("polling_stations.id"), index=True)

    support: Mapped[Support] = mapped_column(pg_enum(Support, "support"), default=Support.unknown, index=True)
    source: Mapped[Source] = mapped_column(pg_enum(Source, "source"), index=True)
    status: Mapped[Status] = mapped_column(pg_enum(Status, "status"), default=Status.pending, index=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(240))

    consent_at: Mapped[datetime]
    opted_out: Mapped[bool] = mapped_column(default=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    capture_lat: Mapped[float | None]
    capture_lng: Mapped[float | None]

    # Offline capture: the device's UUID for this record, so a retried sync is idempotent.
    client_ref: Mapped[str | None] = mapped_column(String(64), unique=True)
    do_not_call: Mapped[bool] = mapped_column(default=False)
    last_contacted_at: Mapped[datetime | None]
    # Call-centre claim, so two agents never ring the same voter.
    call_locked_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    call_locked_until: Mapped[datetime | None]
    # Election day
    voted_at: Mapped[datetime | None] = mapped_column(index=True)
    voted_marked_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))

    captured_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    verified_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[datetime | None]
