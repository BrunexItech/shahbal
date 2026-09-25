import enum
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, pg_enum


class VisitStatus(str, enum.Enum):
    scheduled = "scheduled"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class Visit(Base):
    __tablename__ = "visits"

    title: Mapped[str] = mapped_column(String(140))
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.id"), index=True)
    station_id: Mapped[str | None] = mapped_column(ForeignKey("polling_stations.id"))
    venue: Mapped[str] = mapped_column(String(160))
    scheduled_at: Mapped[datetime] = mapped_column(index=True)
    status: Mapped[VisitStatus] = mapped_column(pg_enum(VisitStatus, "visit_status"), default=VisitStatus.scheduled, index=True)
    lead_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    notes: Mapped[str | None] = mapped_column(Text)

    announce: Mapped[bool] = mapped_column(default=True)
    announce_hours_before: Mapped[int] = mapped_column(default=24)
    announcement_campaign_id: Mapped[str | None] = mapped_column(ForeignKey("message_campaigns.id"))

    checkin_at: Mapped[datetime | None]
    checkin_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    checkin_lat: Mapped[float | None]
    checkin_lng: Mapped[float | None]
    completed_at: Mapped[datetime | None]
    attendance: Mapped[int | None]
    outcome: Mapped[str | None] = mapped_column(Text)

    created_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))


class VisitPhoto(Base):
    """A photo taken at a visit. Stored encrypted in the vault (ns "visit-photos"),
    re-encoded so phone metadata (including GPS) never survives."""

    __tablename__ = "visit_photos"

    visit_id: Mapped[str] = mapped_column(ForeignKey("visits.id", ondelete="CASCADE"), index=True)
    path: Mapped[str] = mapped_column(String(80))
    sha256: Mapped[str] = mapped_column(String(64))
    width: Mapped[int]
    height: Mapped[int]
    taken_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
