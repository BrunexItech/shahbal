from datetime import date

from sqlalchemy import String
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
