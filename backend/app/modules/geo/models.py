from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Constituency(Base):
    __tablename__ = "constituencies"

    code: Mapped[str] = mapped_column(String(10), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    county: Mapped[str] = mapped_column(String(80), default="Mombasa")


class Ward(Base):
    __tablename__ = "wards"

    code: Mapped[str] = mapped_column(String(10), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    constituency_id: Mapped[str] = mapped_column(ForeignKey("constituencies.id"), index=True)
    registered_voters: Mapped[int | None]
    target: Mapped[int] = mapped_column(default=0)


class PollingStation(Base):
    """IEBC polling centre; `streams` holds the number of stations (streams) inside it."""

    __tablename__ = "polling_stations"
    __table_args__ = (UniqueConstraint("code"),)

    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(160))
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.id"), index=True)
    streams: Mapped[int] = mapped_column(default=1)
    registered_voters: Mapped[int | None]
    target: Mapped[int] = mapped_column(default=0)
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    is_active: Mapped[bool] = mapped_column(default=True)
