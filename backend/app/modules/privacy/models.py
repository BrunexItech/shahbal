"""Data-subject requests under Kenya's Data Protection Act, 2019: see, correct, erase, stop contact."""
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DataRequest(Base):
    __tablename__ = "data_requests"

    phone: Mapped[str] = mapped_column(String(20), index=True)  # the number the person proved they hold
    kind: Mapped[str] = mapped_column(String(10), default="access")  # access | correct | erase | stop
    status: Mapped[str] = mapped_column(String(10), default="verifying", index=True)  # verifying | open | done | rejected
    code_hash: Mapped[str | None] = mapped_column(String(64))
    code_expires_at: Mapped[datetime | None]
    attempts: Mapped[int] = mapped_column(default=0)
    verified_at: Mapped[datetime | None]
    details: Mapped[str | None] = mapped_column(Text)  # what to correct, or anything they want HQ to know
    handled_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    handled_at: Mapped[datetime | None]
    note: Mapped[str | None] = mapped_column(String(500))  # HQ's reply / what was done
