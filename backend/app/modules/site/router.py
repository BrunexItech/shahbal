"""Public website: pages and news HQ writes, upcoming public events, volunteer sign-up.
Reading is open to everyone; writing is HQ only (communications content is HQ's call)."""
import re
import unicodedata
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.clock import TZ, utcnow
from app.core.config import settings
from app.core.db import get_session
from app.core.deps import Ctx, require
from app.core.phone import to_e164
from app.core.ratelimit import RateLimiter, client_ip
from app.core.roles import MANAGERS, PUBLISHERS
from app.core.scope import can_touch_ward, ward_scope
from app.modules.geo.models import Constituency, Ward
from app.modules.site import media as store
from app.modules.site.models import AgendaItem, NewsPost, SiteMedia, SitePage, Video, Volunteer
from app.modules.visits.models import Visit, VisitStatus

public = APIRouter(prefix="/api/v1/site", tags=["public website"])
router = APIRouter(prefix="/api/v1/site-admin", tags=["public website"])
hq = require(*PUBLISHERS)  # HQ administrators and the Communications role
managers = require(*MANAGERS)
_limit = RateLimiter(limit=settings.portal_rate_limit_per_hour, window_seconds=3600)

PAGES = {
    "about": "About Suleiman Shahbal",
    "agenda": "Our agenda for Mombasa",
    "contact": "Contact the campaign",
}
SKILLS = {"canvassing", "events", "driving", "social_media", "polling_agent", "call_centre", "logistics", "it"}


def slugify(title: str) -> str:
    s = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:70] or "post"


# ---- pages --------------------------------------------------------------------------------
@public.get("/pages/{key}")
async def page(key: str, session: AsyncSession = Depends(get_session)):
    if key not in PAGES:
        raise HTTPException(404, "Page not found")
    p = (await session.execute(select(SitePage).where(SitePage.key == key))).scalar_one_or_none()
    body = p.body if p else ""
    return {"key": key, "title": p.title if p else PAGES[key], "body": body, "media": await _media_in(session, body),
            "updated_at": p.updated_at.isoformat() if p else None}


class PageIn(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    body: str = Field(max_length=20000)


@router.put("/pages/{key}")
async def save_page(key: str, payload: PageIn, ctx: Ctx = Depends(hq)):
    if key not in PAGES:
        raise HTTPException(404, "Page not found")
    p = (await ctx.session.execute(select(SitePage).where(SitePage.key == key))).scalar_one_or_none()
    if p is None:
        p = SitePage(key=key, title=payload.title, body=payload.body)
        ctx.session.add(p)
    p.title, p.body, p.updated_by_id = payload.title.strip(), payload.body.strip(), ctx.user.id
    audit.record(ctx.session, actor_id=ctx.user.id, action="UPDATE", entity="site_page", entity_id=key, ip=ctx.ip)
    await ctx.session.commit()
    return await page(key, ctx.session)


# ---- news ---------------------------------------------------------------------------------
MEDIA_TOKEN = re.compile(r"^\[\[media:([0-9a-f-]{36})\]\]$", re.M)


def _media(m: SiteMedia, admin: bool = False) -> dict:
    out = {"id": m.id, "kind": m.kind, "content_type": m.content_type, "width": m.width, "height": m.height,
           "caption": m.caption, "has_thumb": bool(m.thumb), "duration": m.duration}
    # HQ's own file names stay inside the Command Centre.
    return out | ({"label": m.label, "size": m.size, "created_at": m.created_at.isoformat()} if admin else {})


async def _post(session: AsyncSession, p: NewsPost, full: bool = True) -> dict:
    out = {"id": p.id, "slug": p.slug, "title": p.title, "summary": p.summary, "published": p.published,
           "published_at": p.published_at.isoformat() if p.published_at else None, "cover_id": p.cover_id}
    if not full:
        return out
    return out | {"body": p.body, "media": await _media_in(session, p.body)}


async def _media_in(session: AsyncSession, body: str) -> dict:
    """The photos and videos a body places with [[media:id]] lines, keyed by id."""
    ids = set(MEDIA_TOKEN.findall(body))
    found = (await session.execute(select(SiteMedia).where(SiteMedia.id.in_(ids)))).scalars().all() if ids else []
    return {m.id: _media(m) for m in found}


async def _check_cover(session: AsyncSession, cover_id: str | None) -> None:
    if cover_id:
        c = await session.get(SiteMedia, cover_id)
        if c is None or c.kind != "image":
            raise HTTPException(422, "The cover must be one of your uploaded photos")


@public.get("/news")
async def news(limit: int = Query(20, ge=1, le=50), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(NewsPost).where(NewsPost.published.is_(True)).order_by(NewsPost.published_at.desc()).limit(limit))).scalars()
    return [await _post(session, p, full=False) for p in rows]


@public.get("/news/{slug}")
async def news_post(slug: str, session: AsyncSession = Depends(get_session)):
    p = (await session.execute(select(NewsPost).where(NewsPost.slug == slug, NewsPost.published.is_(True)))).scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "Story not found")
    return await _post(session, p)


class PostIn(BaseModel):
    title: str = Field(min_length=5, max_length=140)
    summary: str = Field(min_length=10, max_length=300)
    body: str = Field(min_length=20, max_length=20000)
    published: bool = False
    cover_id: str | None = None


@router.get("/news")
async def all_news(ctx: Ctx = Depends(hq)):
    rows = (await ctx.session.execute(select(NewsPost).order_by(NewsPost.created_at.desc()))).scalars()
    return [await _post(ctx.session, p) for p in rows]


@router.post("/news", status_code=201)
async def create_post(payload: PostIn, ctx: Ctx = Depends(hq)):
    await _check_cover(ctx.session, payload.cover_id)
    base, n = slugify(payload.title), 1
    slug = base
    while (await ctx.session.execute(select(NewsPost.id).where(NewsPost.slug == slug))).first():
        n += 1
        slug = f"{base}-{n}"
    p = NewsPost(slug=slug, **payload.model_dump(), author_id=ctx.user.id, published_at=utcnow() if payload.published else None)
    ctx.session.add(p)
    await ctx.session.flush()
    audit.record(ctx.session, actor_id=ctx.user.id, action="CREATE", entity="news", entity_id=p.id, ip=ctx.ip, published=p.published)
    await ctx.session.commit()
    return await _post(ctx.session, p)


@router.put("/news/{pid}")
async def update_post(pid: str, payload: PostIn, ctx: Ctx = Depends(hq)):
    p = await ctx.session.get(NewsPost, pid)
    if p is None:
        raise HTTPException(404, "Story not found")
    await _check_cover(ctx.session, payload.cover_id)
    if payload.published and not p.published:
        p.published_at = utcnow()
    p.title, p.summary, p.body, p.published, p.cover_id = payload.title, payload.summary, payload.body, payload.published, payload.cover_id
    audit.record(ctx.session, actor_id=ctx.user.id, action="UPDATE", entity="news", entity_id=p.id, ip=ctx.ip, published=p.published)
    await ctx.session.commit()
    return await _post(ctx.session, p)


@router.delete("/news/{pid}", status_code=204)
async def delete_post(pid: str, ctx: Ctx = Depends(hq)):
    p = await ctx.session.get(NewsPost, pid)
    if p is None:
        raise HTTPException(404, "Story not found")
    await ctx.session.delete(p)
    audit.record(ctx.session, actor_id=ctx.user.id, action="DELETE", entity="news", entity_id=pid, ip=ctx.ip)
    await ctx.session.commit()


# ---- media --------------------------------------------------------------------------------
@public.get("/media/{mid}")
async def media_file(mid: str, thumb: bool = False, session: AsyncSession = Depends(get_session)):
    m = await session.get(SiteMedia, mid)
    if m is None:
        raise HTTPException(404, "Not found")
    small = bool(thumb and m.thumb)  # a photo's smaller copy, or a video's preview picture
    path = store.path_of(m.thumb if small else m.name)
    if not path.exists():
        raise HTTPException(404, "Not found")
    # Names are random and files never change, so browsers and proxies may keep them.
    return FileResponse(path, media_type="image/webp" if small else m.content_type, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/media")
async def media_library(q: str | None = Query(None, max_length=80), ctx: Ctx = Depends(hq)):
    stmt = select(SiteMedia).order_by(SiteMedia.created_at.desc()).limit(300)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(SiteMedia.label.ilike(like) | SiteMedia.caption.ilike(like))
    return [_media(m, admin=True) for m in (await ctx.session.execute(stmt)).scalars()]


def _default_label(filename: str | None) -> str | None:
    stem = (filename or "").rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return " ".join(re.sub(r"[_\-]+", " ", stem).split())[:120] or None


@router.post("/media", status_code=201)
async def upload_media(file: UploadFile = File(...), caption: str | None = Form(None, max_length=200),
                       label: str | None = Form(None, max_length=120), ctx: Ctx = Depends(hq)):
    video = (file.content_type or "").startswith("video/")
    info = await (store.save_video(file) if video else store.save_image(file))
    m = SiteMedia(**info, caption=(caption or "").strip() or None, label=(label or "").strip() or _default_label(file.filename),
                  uploaded_by_id=ctx.user.id)
    ctx.session.add(m)
    await ctx.session.flush()
    audit.record(ctx.session, actor_id=ctx.user.id, action="UPLOAD", entity="site_media", entity_id=m.id, ip=ctx.ip, kind=m.kind, size=m.size)
    await ctx.session.commit()
    await ctx.session.refresh(m)
    return _media(m, admin=True)


class MediaPatch(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    caption: str | None = Field(default=None, max_length=200)


@router.patch("/media/{mid}")
async def update_media(mid: str, payload: MediaPatch, ctx: Ctx = Depends(hq)):
    m = await ctx.session.get(SiteMedia, mid)
    if m is None:
        raise HTTPException(404, "Not found")
    for field in payload.model_fields_set:
        setattr(m, field, (getattr(payload, field) or "").strip() or None)
    audit.record(ctx.session, actor_id=ctx.user.id, action="UPDATE", entity="site_media", entity_id=m.id, ip=ctx.ip)
    await ctx.session.commit()
    await ctx.session.refresh(m)
    return _media(m, admin=True)


@router.delete("/media/{mid}", status_code=204)
async def delete_media(mid: str, ctx: Ctx = Depends(hq)):
    m = await ctx.session.get(SiteMedia, mid)
    if m is None:
        raise HTTPException(404, "Not found")
    names = (m.name, m.thumb)
    await ctx.session.delete(m)  # stories that used it as a cover lose the cover
    audit.record(ctx.session, actor_id=ctx.user.id, action="DELETE", entity="site_media", entity_id=mid, ip=ctx.ip)
    await ctx.session.commit()
    for n in names:
        store.remove(n)


# ---- videos -------------------------------------------------------------------------------
TOPICS = {"rallies": "Rallies", "town_halls": "Town halls", "interviews": "Interviews", "agenda": "Our agenda",
          "community": "In the community", "other": "Other"}
YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _video(v: Video, m: SiteMedia | None) -> dict:
    return {"id": v.id, "title": v.title, "description": v.description, "topic": v.topic, "published": v.published,
            "published_at": v.published_at.isoformat(), "youtube_id": v.youtube_id, "media_id": v.media_id,
            "has_poster": bool(m and m.thumb), "duration": m.duration if m else None, "content_type": m.content_type if m else None}


@public.get("/videos")
async def videos(topic: str | None = Query(None, max_length=20), q: str | None = Query(None, max_length=80),
                 page: int = Query(1, ge=1, le=500), size: int = Query(12, ge=1, le=48), session: AsyncSession = Depends(get_session)):
    """The Videos page: newest first, by topic, searchable, a page at a time."""
    base = [Video.published.is_(True)]
    if q and q.strip():
        like = f"%{q.strip()}%"
        base.append(Video.title.ilike(like) | Video.description.ilike(like))
    counts = dict((await session.execute(select(Video.topic, func.count()).where(*base).group_by(Video.topic))).all())
    stmt = select(Video, SiteMedia).outerjoin(SiteMedia, SiteMedia.id == Video.media_id).where(*base)
    if topic:
        stmt = stmt.where(Video.topic == topic)
    rows = (await session.execute(stmt.order_by(Video.published_at.desc(), Video.id).offset((page - 1) * size).limit(size + 1))).all()
    return {"items": [_video(v, m) for v, m in rows[:size]], "more": len(rows) > size,
            "topics": [{"id": k, "label": TOPICS[k], "count": counts.get(k, 0)} for k in TOPICS if counts.get(k)]}


@public.get("/videos/{vid}")
async def video(vid: str, session: AsyncSession = Depends(get_session)):
    row = (await session.execute(select(Video, SiteMedia).outerjoin(SiteMedia, SiteMedia.id == Video.media_id)
                                 .where(Video.id == vid, Video.published.is_(True)))).first()
    if row is None:
        raise HTTPException(404, "Video not found")
    return _video(*row)


class VideoIn(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    description: str | None = Field(default=None, max_length=600)
    topic: str = "other"
    media_id: str | None = None
    youtube: str | None = Field(default=None, max_length=200)  # a YouTube link or id
    published: bool = True

    @field_validator("topic")
    @classmethod
    def _topic(cls, v: str) -> str:
        if v not in TOPICS:
            raise ValueError("Choose a topic")
        return v


def _youtube_id(raw: str | None) -> str | None:
    if not raw or not raw.strip():
        return None
    raw = raw.strip()
    if YOUTUBE_ID.match(raw):
        return raw
    m = re.search(r"(?:youtu\.be/|youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/))([A-Za-z0-9_-]{11})", raw)
    if not m:
        raise HTTPException(422, "That doesn't look like a YouTube link")
    return m.group(1)


async def _video_source(session: AsyncSession, payload: VideoIn) -> tuple[str | None, str | None]:
    yt = _youtube_id(payload.youtube)
    if bool(yt) == bool(payload.media_id):
        raise HTTPException(422, "Upload a video or paste a YouTube link (one of them)")
    if payload.media_id:
        m = await session.get(SiteMedia, payload.media_id)
        if m is None or m.kind != "video":
            raise HTTPException(422, "Pick one of your uploaded videos")
    return payload.media_id, yt


@router.get("/videos")
async def all_videos(ctx: Ctx = Depends(hq)):
    rows = (await ctx.session.execute(select(Video, SiteMedia).outerjoin(SiteMedia, SiteMedia.id == Video.media_id)
                                      .order_by(Video.published_at.desc()))).all()
    return [_video(v, m) for v, m in rows]


@router.post("/videos", status_code=201)
async def add_video(payload: VideoIn, ctx: Ctx = Depends(hq)):
    media_id, yt = await _video_source(ctx.session, payload)
    v = Video(title=payload.title.strip(), description=(payload.description or "").strip() or None, topic=payload.topic,
              media_id=media_id, youtube_id=yt, published=payload.published, published_at=utcnow(), added_by_id=ctx.user.id)
    ctx.session.add(v)
    await ctx.session.flush()
    audit.record(ctx.session, actor_id=ctx.user.id, action="CREATE", entity="video", entity_id=v.id, ip=ctx.ip)
    await ctx.session.commit()
    m = await ctx.session.get(SiteMedia, media_id) if media_id else None
    return _video(v, m)


@router.put("/videos/{vid}")
async def update_video(vid: str, payload: VideoIn, ctx: Ctx = Depends(hq)):
    v = await ctx.session.get(Video, vid)
    if v is None:
        raise HTTPException(404, "Video not found")
    v.media_id, v.youtube_id = await _video_source(ctx.session, payload)
    if payload.published and not v.published:
        v.published_at = utcnow()  # published now = newest now
    v.title, v.description, v.topic, v.published = payload.title.strip(), (payload.description or "").strip() or None, payload.topic, payload.published
    audit.record(ctx.session, actor_id=ctx.user.id, action="UPDATE", entity="video", entity_id=v.id, ip=ctx.ip)
    await ctx.session.commit()
    m = await ctx.session.get(SiteMedia, v.media_id) if v.media_id else None
    return _video(v, m)


@router.delete("/videos/{vid}", status_code=204)
async def delete_video(vid: str, ctx: Ctx = Depends(hq)):
    """Takes it off the Videos page. An uploaded file stays in the media library until deleted there."""
    v = await ctx.session.get(Video, vid)
    if v is None:
        raise HTTPException(404, "Video not found")
    await ctx.session.delete(v)
    audit.record(ctx.session, actor_id=ctx.user.id, action="DELETE", entity="video", entity_id=vid, ip=ctx.ip)
    await ctx.session.commit()


# ---- agenda -------------------------------------------------------------------------------
async def _item(session: AsyncSession, a: AgendaItem) -> dict:
    return {"id": a.id, "title": a.title, "summary": a.summary, "body": a.body, "cover_id": a.cover_id, "position": a.position,
            "published": a.published, "media": await _media_in(session, a.body), "updated_at": a.updated_at.isoformat()}


@public.get("/agenda")
async def agenda(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(AgendaItem).where(AgendaItem.published.is_(True))
                                  .order_by(AgendaItem.position, AgendaItem.created_at))).scalars().all()
    return [await _item(session, a) for a in rows]


class AgendaIn(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    summary: str = Field(min_length=10, max_length=300)
    body: str = Field(default="", max_length=20000)
    cover_id: str | None = None
    published: bool = True


@router.get("/agenda")
async def all_agenda(ctx: Ctx = Depends(hq)):
    rows = (await ctx.session.execute(select(AgendaItem).order_by(AgendaItem.position, AgendaItem.created_at))).scalars().all()
    return [await _item(ctx.session, a) for a in rows]


@router.post("/agenda", status_code=201)
async def create_agenda(payload: AgendaIn, ctx: Ctx = Depends(hq)):
    await _check_cover(ctx.session, payload.cover_id)
    last = (await ctx.session.execute(select(func.max(AgendaItem.position)))).scalar() or 0
    a = AgendaItem(**payload.model_dump(), position=last + 1, updated_by_id=ctx.user.id)
    ctx.session.add(a)
    await ctx.session.flush()
    audit.record(ctx.session, actor_id=ctx.user.id, action="CREATE", entity="agenda_item", entity_id=a.id, ip=ctx.ip)
    await ctx.session.commit()
    await ctx.session.refresh(a)
    return await _item(ctx.session, a)


@router.put("/agenda/{aid}")
async def update_agenda(aid: str, payload: AgendaIn, ctx: Ctx = Depends(hq)):
    a = await ctx.session.get(AgendaItem, aid)
    if a is None:
        raise HTTPException(404, "Agenda item not found")
    await _check_cover(ctx.session, payload.cover_id)
    for k, v in payload.model_dump().items():
        setattr(a, k, v)
    a.updated_by_id = ctx.user.id
    audit.record(ctx.session, actor_id=ctx.user.id, action="UPDATE", entity="agenda_item", entity_id=a.id, ip=ctx.ip)
    await ctx.session.commit()
    await ctx.session.refresh(a)
    return await _item(ctx.session, a)


@router.delete("/agenda/{aid}", status_code=204)
async def delete_agenda(aid: str, ctx: Ctx = Depends(hq)):
    a = await ctx.session.get(AgendaItem, aid)
    if a is None:
        raise HTTPException(404, "Agenda item not found")
    await ctx.session.delete(a)
    audit.record(ctx.session, actor_id=ctx.user.id, action="DELETE", entity="agenda_item", entity_id=aid, ip=ctx.ip)
    await ctx.session.commit()


class OrderIn(BaseModel):
    ids: list[str] = Field(max_length=100)


@router.post("/agenda/order")
async def reorder_agenda(payload: OrderIn, ctx: Ctx = Depends(hq)):
    items = {a.id: a for a in (await ctx.session.execute(select(AgendaItem))).scalars()}
    if set(payload.ids) != set(items):
        raise HTTPException(422, "Send every agenda item once")
    for i, aid in enumerate(payload.ids, start=1):
        items[aid].position = i
    await ctx.session.commit()
    return {"ok": True}


# ---- events -------------------------------------------------------------------------------
@public.get("/events")
async def events(session: AsyncSession = Depends(get_session)):
    """Upcoming field events HQ chose to publish. Place and time only: no team names."""
    rows = (await session.execute(
        select(Visit.id, Visit.title, Visit.kind, Visit.venue, Visit.scheduled_at, Visit.ends_at, Ward.name, Constituency.name)
        .join(Ward, Ward.id == Visit.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
        .where(Visit.public.is_(True), Visit.status.in_([VisitStatus.scheduled, VisitStatus.in_progress]),
               Visit.scheduled_at >= utcnow() - timedelta(hours=3))
        .order_by(Visit.scheduled_at).limit(60)
    )).all()
    return [{"id": i, "title": t, "kind": k, "venue": v, "starts_at": s.isoformat(), "ends_at": e.isoformat() if e else None, "ward": w, "constituency": c}
            for i, t, k, v, s, e, w, c in rows]


# ---- volunteers ---------------------------------------------------------------------------
class VolunteerIn(BaseModel):
    full_name: str = Field(min_length=3, max_length=120)
    phone: str
    email: EmailStr | None = None
    ward_id: str
    skills: list[str] = Field(default_factory=list, max_length=8)
    availability: str | None = Field(default=None, pattern="^(weekdays|weekends|evenings|any)$")
    message: str | None = Field(default=None, max_length=600)
    consent: bool
    website: str | None = None  # honeypot

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return to_e164(v)

    @field_validator("skills")
    @classmethod
    def _skills(cls, v: list[str]) -> list[str]:
        return sorted({s for s in v if s in SKILLS})


@public.post("/volunteers", status_code=201)
async def volunteer(payload: VolunteerIn, request: Request, session: AsyncSession = Depends(get_session)):
    _limit.hit(client_ip(request))
    thanks = {"message": "Asante! The team in your ward will call you to get you started."}
    if payload.website:
        return thanks
    if not payload.consent:
        raise HTTPException(422, "Please agree so the team can contact you")
    if await session.get(Ward, payload.ward_id) is None:
        raise HTTPException(422, "Choose your ward")
    since = utcnow() - timedelta(days=30)
    if (await session.execute(select(Volunteer.id).where(Volunteer.phone == payload.phone, Volunteer.created_at >= since))).first():
        return thanks  # already signed up recently: same answer, no duplicate
    v = Volunteer(full_name=" ".join(payload.full_name.split()).title(), phone=payload.phone, email=payload.email, ward_id=payload.ward_id,
                  skills=payload.skills, availability=payload.availability, message=(payload.message or "").strip() or None, consent_at=utcnow())
    session.add(v)
    await session.flush()
    audit.record(session, actor_id=None, action="CREATE", entity="volunteer", entity_id=v.id, ip=client_ip(request))
    await session.commit()
    return thanks


@router.get("/volunteers")
async def volunteers(status: str | None = Query(None, pattern="^(new|contacted|onboarded|declined)$"), ctx: Ctx = Depends(managers)):
    q = (select(Volunteer, Ward.name, Constituency.name).join(Ward, Ward.id == Volunteer.ward_id)
         .join(Constituency, Constituency.id == Ward.constituency_id).where(ward_scope(ctx.user)))
    if status:
        q = q.where(Volunteer.status == status)
    rows = (await ctx.session.execute(q.order_by(Volunteer.created_at.desc()).limit(500))).all()
    counts = dict((await ctx.session.execute(
        select(Volunteer.status, func.count()).join(Ward, Ward.id == Volunteer.ward_id).where(ward_scope(ctx.user)).group_by(Volunteer.status)
    )).all())
    return {"counts": counts, "items": [{
        "id": v.id, "full_name": v.full_name, "phone": v.phone, "email": v.email, "ward_id": v.ward_id, "ward": wn, "constituency": cn,
        "skills": v.skills, "availability": v.availability, "message": v.message, "status": v.status, "note": v.note,
        "created_at": v.created_at.astimezone(TZ).isoformat()} for v, wn, cn in rows]}


class VolunteerPatch(BaseModel):
    status: str = Field(pattern="^(new|contacted|onboarded|declined)$")
    note: str | None = Field(default=None, max_length=500)


@router.patch("/volunteers/{vid}")
async def update_volunteer(vid: str, payload: VolunteerPatch, ctx: Ctx = Depends(managers)):
    v = await ctx.session.get(Volunteer, vid)
    ward = await ctx.session.get(Ward, v.ward_id) if v else None
    if v is None or not can_touch_ward(ctx.user, ward):
        raise HTTPException(404, "Volunteer not found")
    v.status, v.handled_by_id = payload.status, ctx.user.id
    if payload.note is not None:
        v.note = payload.note.strip() or None
    audit.record(ctx.session, actor_id=ctx.user.id, action="UPDATE", entity="volunteer", entity_id=v.id, ip=ctx.ip, status=v.status)
    await ctx.session.commit()
    return {"ok": True}
