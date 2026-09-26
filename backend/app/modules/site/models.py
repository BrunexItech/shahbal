"""The public website's content (edited by HQ) and volunteer sign-ups."""
from datetime import datetime

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SitePage(Base):
    """One editable page: about | agenda | contact."""

    __tablename__ = "site_pages"

    key: Mapped[str] = mapped_column(String(20), unique=True)
    title: Mapped[str] = mapped_column(String(140))
    body: Mapped[str] = mapped_column(Text, default="")  # light Markdown: ## headings, - bullets, **bold**
    updated_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class NewsPost(Base):
    __tablename__ = "news_posts"

    slug: Mapped[str] = mapped_column(String(90), unique=True)
    title: Mapped[str] = mapped_column(String(140))
    summary: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(default=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(index=True)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Volunteer(Base):
    __tablename__ = "volunteers"

    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(20), index=True)
    email: Mapped[str | None] = mapped_column(String(160))
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.id"), index=True)
    skills: Mapped[list] = mapped_column(JSON, default=list)
    availability: Mapped[str | None] = mapped_column(String(40))
    message: Mapped[str | None] = mapped_column(String(600))
    consent_at: Mapped[datetime]
    status: Mapped[str] = mapped_column(String(12), default="new", index=True)  # new | contacted | onboarded | declined
    note: Mapped[str | None] = mapped_column(String(500))
    handled_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
