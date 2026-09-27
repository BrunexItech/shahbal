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


class SiteMedia(Base):
    """A photo or video for the public website. Public by nature, so stored as plain files
    (not in the encrypted vault); photos are re-encoded, which strips location metadata."""

    __tablename__ = "site_media"

    kind: Mapped[str] = mapped_column(String(8))  # image | video
    content_type: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(80))  # file name on disk
    thumb: Mapped[str | None] = mapped_column(String(80))  # smaller copy of a photo
    size: Mapped[int]
    width: Mapped[int | None]
    height: Mapped[int | None]
    duration: Mapped[int | None]  # seconds, for videos
    caption: Mapped[str | None] = mapped_column(String(200))  # shown under it on the website
    label: Mapped[str | None] = mapped_column(String(120))  # HQ's own name for finding it; never public
    uploaded_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class NewsPost(Base):
    __tablename__ = "news_posts"

    slug: Mapped[str] = mapped_column(String(90), unique=True)
    title: Mapped[str] = mapped_column(String(140))
    summary: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(default=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(index=True)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    cover_id: Mapped[str | None] = mapped_column(ForeignKey("site_media.id", ondelete="SET NULL"))


class Video(Base):
    """An entry on the public Videos page: an uploaded video from the library, or a YouTube link."""

    __tablename__ = "videos"

    title: Mapped[str] = mapped_column(String(140))
    description: Mapped[str | None] = mapped_column(String(600))
    topic: Mapped[str] = mapped_column(String(20), default="other", index=True)
    media_id: Mapped[str | None] = mapped_column(ForeignKey("site_media.id", ondelete="CASCADE"))
    youtube_id: Mapped[str | None] = mapped_column(String(11))
    published: Mapped[bool] = mapped_column(default=True, index=True)
    published_at: Mapped[datetime] = mapped_column(index=True)  # newest first on the page
    added_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class AgendaItem(Base):
    """One pledge on the Our Agenda page (water, jobs, health…), ordered by HQ."""

    __tablename__ = "agenda_items"

    title: Mapped[str] = mapped_column(String(120))
    summary: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    cover_id: Mapped[str | None] = mapped_column(ForeignKey("site_media.id", ondelete="SET NULL"))
    position: Mapped[int] = mapped_column(default=0, index=True)
    published: Mapped[bool] = mapped_column(default=True)
    updated_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


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
