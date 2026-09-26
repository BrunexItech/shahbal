"""Public website: pages and news HQ writes, upcoming public events, volunteer sign-up.
Reading is open to everyone; writing is HQ only (communications content is HQ's call)."""
import re
import unicodedata
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
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
from app.core.roles import ADMINS, MANAGERS
from app.core.scope import can_touch_ward, ward_scope
from app.modules.geo.models import Constituency, Ward
from app.modules.site.models import NewsPost, SitePage, Volunteer
from app.modules.visits.models import Visit, VisitStatus

public = APIRouter(prefix="/api/v1/site", tags=["public website"])
router = APIRouter(prefix="/api/v1/site-admin", tags=["public website"])
hq = require(*ADMINS)
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
    return {"key": key, "title": p.title if p else PAGES[key], "body": p.body if p else "", "updated_at": p.updated_at.isoformat() if p else None}


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
def _post(p: NewsPost, full: bool = True) -> dict:
    out = {"id": p.id, "slug": p.slug, "title": p.title, "summary": p.summary, "published": p.published,
           "published_at": p.published_at.isoformat() if p.published_at else None}
    return out | ({"body": p.body} if full else {})


@public.get("/news")
async def news(limit: int = Query(20, ge=1, le=50), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(NewsPost).where(NewsPost.published.is_(True)).order_by(NewsPost.published_at.desc()).limit(limit))).scalars()
    return [_post(p, full=False) for p in rows]


@public.get("/news/{slug}")
async def news_post(slug: str, session: AsyncSession = Depends(get_session)):
    p = (await session.execute(select(NewsPost).where(NewsPost.slug == slug, NewsPost.published.is_(True)))).scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "Story not found")
    return _post(p)


class PostIn(BaseModel):
    title: str = Field(min_length=5, max_length=140)
    summary: str = Field(min_length=10, max_length=300)
    body: str = Field(min_length=20, max_length=20000)
    published: bool = False


@router.get("/news")
async def all_news(ctx: Ctx = Depends(hq)):
    rows = (await ctx.session.execute(select(NewsPost).order_by(NewsPost.created_at.desc()))).scalars()
    return [_post(p) for p in rows]


@router.post("/news", status_code=201)
async def create_post(payload: PostIn, ctx: Ctx = Depends(hq)):
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
    return _post(p)


@router.put("/news/{pid}")
async def update_post(pid: str, payload: PostIn, ctx: Ctx = Depends(hq)):
    p = await ctx.session.get(NewsPost, pid)
    if p is None:
        raise HTTPException(404, "Story not found")
    if payload.published and not p.published:
        p.published_at = utcnow()
    p.title, p.summary, p.body, p.published = payload.title, payload.summary, payload.body, payload.published
    audit.record(ctx.session, actor_id=ctx.user.id, action="UPDATE", entity="news", entity_id=p.id, ip=ctx.ip, published=p.published)
    await ctx.session.commit()
    return _post(p)


@router.delete("/news/{pid}", status_code=204)
async def delete_post(pid: str, ctx: Ctx = Depends(hq)):
    p = await ctx.session.get(NewsPost, pid)
    if p is None:
        raise HTTPException(404, "Story not found")
    await ctx.session.delete(p)
    audit.record(ctx.session, actor_id=ctx.user.id, action="DELETE", entity="news", entity_id=pid, ip=ctx.ip)
    await ctx.session.commit()


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
