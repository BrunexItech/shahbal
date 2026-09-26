"""Community Voice: problems residents raise (water, roads, security…) as trackable cases.

A case comes from the public site, a field agent or the call centre, belongs to one
ward, and moves new → acknowledged → in progress → resolved (or closed). Every change
is an `IssueUpdate`, so the timeline is the history; `public` updates are the ones the
reporter may see when they track their case."""
import enum
from datetime import datetime

from sqlalchemy import ForeignKey, Sequence, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, pg_enum


class Category(str, enum.Enum):
    water = "water"
    roads = "roads"
    health = "health"
    education = "education"
    jobs = "jobs"
    waste = "waste"
    security = "security"
    drainage = "drainage"
    housing = "housing"
    transport = "transport"
    electricity = "electricity"
    environment = "environment"
    other = "other"


class IssueStatus(str, enum.Enum):
    new = "new"
    acknowledged = "acknowledged"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"  # not actionable: duplicate, spam, outside Mombasa


OPEN_STATUSES = (IssueStatus.new, IssueStatus.acknowledged, IssueStatus.in_progress)


class Priority(str, enum.Enum):
    normal = "normal"
    high = "high"
    urgent = "urgent"


class IssueSource(str, enum.Enum):
    public = "public"
    field = "field"
    call_centre = "call_centre"


issue_ref_seq = Sequence("issue_ref_seq", metadata=Base.metadata)


class Issue(Base):
    __tablename__ = "issues"

    reference: Mapped[str] = mapped_column(String(16), unique=True)
    category: Mapped[Category] = mapped_column(pg_enum(Category, "issue_category"), index=True)
    summary: Mapped[str] = mapped_column(String(140))
    description: Mapped[str] = mapped_column(Text)
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.id"), index=True)
    area: Mapped[str | None] = mapped_column(String(120))  # estate, street or landmark
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    source: Mapped[IssueSource] = mapped_column(pg_enum(IssueSource, "issue_source"), index=True)
    status: Mapped[IssueStatus] = mapped_column(pg_enum(IssueStatus, "issue_status"), default=IssueStatus.new, index=True)
    priority: Mapped[Priority] = mapped_column(pg_enum(Priority, "issue_priority"), default=Priority.normal)
    assigned_to_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    # The resident. Optional: people may report anonymously.
    reporter_name: Mapped[str | None] = mapped_column(String(120))
    reporter_phone: Mapped[str | None] = mapped_column(String(20), index=True)
    contact_ok: Mapped[bool] = mapped_column(default=False)  # agreed to SMS updates
    consent_at: Mapped[datetime]
    reported_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)  # staff
    voter_id: Mapped[str | None] = mapped_column(ForeignKey("voters.id", ondelete="SET NULL"))
    client_ref: Mapped[str | None] = mapped_column(String(64), unique=True)  # offline replay guard
    resolved_at: Mapped[datetime | None]


class IssueUpdate(Base):
    __tablename__ = "issue_updates"

    issue_id: Mapped[str] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(16))  # created | status | assigned | priority | category | note | sms
    status: Mapped[IssueStatus | None] = mapped_column(pg_enum(IssueStatus, "issue_status"))
    note: Mapped[str | None] = mapped_column(Text)
    public: Mapped[bool] = mapped_column(default=False)  # shown to the reporter when they track the case


class IssuePhoto(Base):
    __tablename__ = "issue_photos"

    issue_id: Mapped[str] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    path: Mapped[str] = mapped_column(String(80))
    sha256: Mapped[str] = mapped_column(String(64))
    width: Mapped[int]
    height: Mapped[int]
    added_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))  # None = the resident
