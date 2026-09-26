"""A field agent's plan for a day: where to go and what to do, set by a coordinator."""
from datetime import date, datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Assignment(Base):
    __tablename__ = "assignments"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)  # the agent
    day: Mapped[date] = mapped_column(index=True)  # campaign-local date
    title: Mapped[str] = mapped_column(String(140))  # e.g. "Door to door around Tudor Estate"
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.id"), index=True)
    station_id: Mapped[str | None] = mapped_column(ForeignKey("polling_stations.id", ondelete="SET NULL"))
    target_captures: Mapped[int | None]  # people to capture on this task
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending | done | skipped
    done_at: Mapped[datetime | None]
    report: Mapped[str | None] = mapped_column(String(500))  # the agent's note when finishing or skipping
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
