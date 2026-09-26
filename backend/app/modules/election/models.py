from datetime import date

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ElectionSettings(Base):
    """Single row (id='default')."""

    __tablename__ = "election_settings"

    election_date: Mapped[date | None]
    polls_open: Mapped[str] = mapped_column(String(5), default="06:00")
    polls_close: Mapped[str] = mapped_column(String(5), default="17:00")
    candidate_label: Mapped[str] = mapped_column(String(80), default="our candidate")


class PlanWeek(Base):
    """The campaign's week-by-week capture plan up to election day (week starts Monday)."""

    __tablename__ = "plan_weeks"

    week_start: Mapped[date] = mapped_column(unique=True, index=True)
    target: Mapped[int] = mapped_column(default=0)  # people to capture during this week


class Candidate(Base):
    """Someone on the ballot for the race we tally (Governor, Mombasa)."""

    __tablename__ = "candidates"

    name: Mapped[str] = mapped_column(String(120))
    party: Mapped[str | None] = mapped_column(String(80))
    ours: Mapped[bool] = mapped_column(default=False)
    color: Mapped[str] = mapped_column(String(9), default="#64748b")
    position: Mapped[int] = mapped_column(default=0)  # ballot order


class ResultForm(Base):
    """Form 34A for one polling stream: votes per candidate as declared, and a photo of the
    signed form. One per stream; resubmitting replaces it until it is verified."""

    __tablename__ = "result_forms"
    __table_args__ = (UniqueConstraint("station_id", "stream_no"),)

    station_id: Mapped[str] = mapped_column(ForeignKey("polling_stations.id", ondelete="CASCADE"), index=True)
    stream_no: Mapped[int]
    votes: Mapped[dict] = mapped_column(JSON)  # {candidate_id: votes}
    rejected: Mapped[int] = mapped_column(default=0)
    photo_path: Mapped[str] = mapped_column(String(80))
    photo_sha256: Mapped[str] = mapped_column(String(64))
    submitted_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(10), default="submitted")  # submitted | verified | disputed
    reviewed_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(300))
