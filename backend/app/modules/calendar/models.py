"""Calendar entries that aren't field visits: media slots, meetings, debates, deadlines.

Field events (rallies, town halls, market walks…) stay `Visit`s so they keep check-in,
attendance, photos and the SMS invitation; the calendar shows both side by side."""
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    title: Mapped[str] = mapped_column(String(140))
    kind: Mapped[str] = mapped_column(String(20))  # media | meeting | debate | fundraiser | deadline | travel | other
    starts_at: Mapped[datetime] = mapped_column(index=True)
    ends_at: Mapped[datetime | None]
    all_day: Mapped[bool] = mapped_column(default=False)
    # Area it concerns: none = county-wide.
    constituency_id: Mapped[str | None] = mapped_column(ForeignKey("constituencies.id"), index=True)
    ward_id: Mapped[str | None] = mapped_column(ForeignKey("wards.id"), index=True)
    location: Mapped[str | None] = mapped_column(String(160))
    notes: Mapped[str | None] = mapped_column(Text)
    hq_only: Mapped[bool] = mapped_column(default=False)  # strategy items only HQ administrators see
    status: Mapped[str] = mapped_column(String(12), default="planned")  # planned | done | cancelled
    series_id: Mapped[str | None] = mapped_column(String(36), index=True)  # repeats share one id
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
