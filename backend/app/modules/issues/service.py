"""Community Voice cases: who sees what, the status workflow, SMS updates and numbers.

Visibility follows the area rules everywhere else in the platform: HQ and observers see
the county, a constituency coordinator their constituency, a ward coordinator their
ward. Agents see only the cases they logged themselves. The reporter's phone number is
shown to coordinators (who follow up), never to agents or observers."""
import hashlib
import hmac
import logging
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import ColumnElement, and_, case, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core import audit, vault
from app.core.clock import utcnow
from app.core.config import settings
from app.core.deps import Ctx
from app.core.roles import MANAGERS, Role
from app.core.scope import can_touch_ward
from app.modules.geo.locate import ward_code_at
from app.modules.geo.models import Constituency, Ward
from app.modules.issues.models import (
    OPEN_STATUSES,
    Category,
    Issue,
    IssuePhoto,
    IssueSource,
    IssueStatus,
    IssueUpdate,
    issue_ref_seq,
)
from app.modules.issues.schemas import (
    Assignee,
    IssueBase,
    IssueDetail,
    IssueOut,
    IssuePage,
    IssuePatch,
    IssuePhotoOut,
    IssueUpdateOut,
    StaffIssueIn,
)
from app.modules.messaging.providers import sms_live
from app.modules.users.models import User
from app.modules.visits.photos import clean
from app.modules.voters.models import Voter

log = logging.getLogger("issues")

NS = "issue-photos"
MAX_PHOTOS = 6
PUBLIC_MAX_PHOTOS = 3
UPLOAD_WINDOW = timedelta(minutes=30)

LABELS = {
    Category.water: "Water", Category.roads: "Roads", Category.health: "Health", Category.education: "Education",
    Category.jobs: "Jobs & youth", Category.waste: "Waste", Category.security: "Security", Category.drainage: "Drainage",
    Category.housing: "Housing", Category.transport: "Transport", Category.electricity: "Electricity",
    Category.environment: "Environment", Category.other: "Other",
}

# What the resident hears when their case moves (only if they asked for updates).
STATUS_SMS = {
    IssueStatus.acknowledged: "we have received your report {ref} ({cat}) and the {ward} team is looking into it.",
    IssueStatus.in_progress: "work has started on your report {ref} ({cat}).",
    IssueStatus.resolved: "your report {ref} ({cat}) is marked resolved. Thank you for speaking up for {ward}.",
}


def scope(user: User) -> ColumnElement[bool]:
    """Which cases a user may see (the query must join Ward)."""
    if user.role in (Role.super_admin, Role.viewer):
        return true()
    if user.role == Role.coordinator:
        return Ward.constituency_id == user.constituency_id
    if user.role == Role.ward_coordinator:
        return Issue.ward_id == user.ward_id
    return Issue.reported_by_id == user.id  # agents: their own reports


def upload_token(issue: Issue) -> str:
    return hmac.new(settings.jwt_secret.encode(), f"issue-upload:{issue.id}".encode(), hashlib.sha256).hexdigest()[:32]


async def next_reference(session: AsyncSession) -> str:
    seq = (await session.execute(select(issue_ref_seq.next_value()))).scalar_one()
    return f"ISS-{seq:05d}"


async def create_issue(session: AsyncSession, data: IssueBase, *, source: IssueSource, reporter: User | None,
                       voter_id: str | None = None, priority=None, client_ref: str | None = None) -> Issue:
    ward = await session.get(Ward, data.ward_id)
    if ward is None:
        raise HTTPException(422, "Choose a ward in Mombasa")
    if data.latitude is not None and ward_code_at(data.latitude, data.longitude) is None:
        # A pin outside the county is a mistake; keep the report, drop the pin.
        data.latitude = data.longitude = None
    issue = Issue(
        reference=await next_reference(session), category=data.category, summary=data.summary, description=data.description,
        ward_id=ward.id, area=data.area, latitude=data.latitude, longitude=data.longitude, source=source,
        reporter_name=data.reporter_name, reporter_phone=data.reporter_phone, contact_ok=data.contact_ok,
        consent_at=utcnow(), reported_by_id=reporter.id if reporter else None, voter_id=voter_id, client_ref=client_ref,
        updated_at=utcnow(),
    )
    if priority is not None:
        issue.priority = priority
    session.add(issue)
    await session.flush()
    session.add(IssueUpdate(issue_id=issue.id, author_id=issue.reported_by_id, kind="created", status=IssueStatus.new, public=True,
                            note="Report received"))
    return issue


RECEIPT_SMS = "we have received your report {ref} ({cat}). We'll text you as it moves."


def _track_hint() -> str:
    """Where residents can follow their case (left out while the app has no public address yet)."""
    host = settings.app_url.split("://", 1)[-1].rstrip("/")
    return "" if host.startswith(("localhost", "127.")) else f" Track it at {host}/?track=1"


def _masked(phone: str) -> str:
    local = "0" + phone[4:] if phone.startswith("+254") else phone
    return f"{local[:4]}•••{local[-3:]}"


async def notify_reporter(session: AsyncSession, issue: Issue, status: IssueStatus | None, note: str | None, *,
                          receipt: bool = False, direct: str | None = None, author_id: str | None = None) -> str:
    """Texts the resident about their case when they asked for updates, and records what really happened
    on the case history: sent (then delivered or failed, from the gateway's report), or why not.
    `direct` is a message a coordinator typed to the resident. Call after the change itself is committed;
    commits the outcome. Returns sent | failed | not_requested | opted_out | no_phone."""
    if not issue.reporter_phone:
        return "no_phone"
    if not issue.contact_ok:
        return "not_requested"
    who = _masked(issue.reporter_phone)
    opted_out = (await session.execute(
        select(Voter.id).where(Voter.phone == issue.reporter_phone, Voter.opted_out.is_(True)).limit(1)
    )).first()
    if opted_out:
        session.add(IssueUpdate(issue_id=issue.id, author_id=author_id, kind="sms_failed", public=False, sms_status="failed",
                                note=f"SMS to {who} not sent: they have asked not to be contacted"))
        await session.commit()
        return "opted_out"
    ward = await session.get(Ward, issue.ward_id)
    fields = {"ref": issue.reference, "cat": LABELS[issue.category], "ward": ward.name if ward else "Mombasa"}
    if direct:
        text = f"{settings.sms_sender_name}: about your report {issue.reference}: {direct.strip()}"
    else:
        head = RECEIPT_SMS if receipt else STATUS_SMS.get(status, "there's an update on your report {ref} ({cat}).") if status else "there's an update on your report {ref} ({cat})."
        text = f"{settings.sms_sender_name}: " + head.format(**fields)
        if note:
            text += f" {note.strip()[:200]}"
    text += _track_hint()
    from app.modules.messaging.transactional import send_system_sms

    sent = await send_system_sms(issue.reporter_phone, text)
    if sent.ok:
        session.add(IssueUpdate(issue_id=issue.id, author_id=author_id, kind="sms", public=False, note=f"SMS to {who}: “{text}”",
                                sms_status="delivered" if sent.delivered else "sent", provider_ref=sent.provider_id))
    else:
        session.add(IssueUpdate(issue_id=issue.id, author_id=author_id, kind="sms_failed", public=False, sms_status="failed",
                                note=f"SMS to {who} not sent: {sent.error or 'the SMS service refused it'}"))
    await session.commit()
    return "sent" if sent.ok else "failed"


class IssueService:
    def __init__(self, ctx: Ctx):
        self.ctx, self.s, self.user = ctx, ctx.session, ctx.user

    @property
    def is_manager(self) -> bool:
        return self.user.role in MANAGERS

    # ---- reading ----------------------------------------------------------------
    def _base(self):
        assignee, reporter = aliased(User), aliased(User)
        photos = select(func.count(IssuePhoto.id)).where(IssuePhoto.issue_id == Issue.id).correlate(Issue).scalar_subquery()
        return (select(Issue, Ward.name, Constituency.name, assignee.full_name, reporter.full_name, photos)
                .join(Ward, Ward.id == Issue.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
                .outerjoin(assignee, assignee.id == Issue.assigned_to_id).outerjoin(reporter, reporter.id == Issue.reported_by_id)
                .where(scope(self.user)))

    def _out(self, row) -> IssueOut:
        i, ward, cons, assignee, reporter, photos = row
        phone = i.reporter_phone if self.is_manager or i.reported_by_id == self.user.id else (
            f"•••• {i.reporter_phone[-3:]}" if i.reporter_phone else None)
        return IssueOut(
            id=i.id, reference=i.reference, category=i.category, summary=i.summary, description=i.description, ward_id=i.ward_id,
            ward=ward, constituency=cons, area=i.area, latitude=i.latitude, longitude=i.longitude, source=i.source, status=i.status,
            priority=i.priority, assigned_to_id=i.assigned_to_id, assigned_to=assignee, reporter_name=i.reporter_name,
            reporter_phone=phone, contact_ok=i.contact_ok, reported_by=reporter, photos=photos or 0, created_at=i.created_at,
            updated_at=i.updated_at, resolved_at=i.resolved_at,
        )

    async def search(self, *, status: str | None, category: Category | None, ward_id: str | None, constituency_id: str | None,
                   source: IssueSource | None, mine: bool, q: str | None, page: int, size: int) -> IssuePage:
        stmt = self._base()
        if status == "open":
            stmt = stmt.where(Issue.status.in_(OPEN_STATUSES))
        elif status:
            stmt = stmt.where(Issue.status == IssueStatus(status))
        if category:
            stmt = stmt.where(Issue.category == category)
        if ward_id:
            stmt = stmt.where(Issue.ward_id == ward_id)
        if constituency_id:
            stmt = stmt.where(Ward.constituency_id == constituency_id)
        if source:
            stmt = stmt.where(Issue.source == source)
        if mine:
            stmt = stmt.where(Issue.assigned_to_id == self.user.id)
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(Issue.reference.ilike(like), Issue.summary.ilike(like), Issue.area.ilike(like), Issue.description.ilike(like)))
        total = (await self.s.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
        # Urgent first, then open before closed, newest first.
        order = (case((Issue.status.in_(OPEN_STATUSES), 0), else_=1), case((Issue.priority == "urgent", 0), (Issue.priority == "high", 1), else_=2),
                 Issue.created_at.desc())
        rows = (await self.s.execute(stmt.order_by(*order).offset((page - 1) * size).limit(size))).all()
        return IssuePage(items=[self._out(r) for r in rows], total=total)

    async def _row(self, issue_id: str):
        row = (await self.s.execute(self._base().where(Issue.id == issue_id))).first()
        if row is None:
            raise HTTPException(404, "Case not found")
        return row

    def _can_manage(self, issue: Issue, ward: Ward) -> bool:
        return self.is_manager and can_touch_ward(self.user, ward)

    async def detail(self, issue_id: str) -> IssueDetail:
        row = await self._row(issue_id)
        issue = row[0]
        ward = await self.s.get(Ward, issue.ward_id)
        updates = (await self.s.execute(
            select(IssueUpdate, User.full_name).outerjoin(User, User.id == IssueUpdate.author_id)
            .where(IssueUpdate.issue_id == issue.id).order_by(IssueUpdate.created_at, IssueUpdate.id)
        )).all()
        photos = (await self.s.execute(select(IssuePhoto).where(IssuePhoto.issue_id == issue.id).order_by(IssuePhoto.created_at))).scalars().all()
        return IssueDetail(
            **self._out(row).model_dump(),
            updates=[IssueUpdateOut(id=u.id, kind=u.kind, status=u.status, note=u.note, public=u.public, author=name, created_at=u.created_at,
                                    sms_status=u.sms_status) for u, name in updates],
            photo_list=[IssuePhotoOut(id=p.id, url=f"/api/v1/issues/{issue.id}/photos/{p.id}", width=p.width, height=p.height,
                                      by_resident=p.added_by_id is None, created_at=p.created_at) for p in photos],
            can_manage=self._can_manage(issue, ward),
            sms_live=sms_live(),
        )

    # ---- writing ----------------------------------------------------------------
    async def create(self, data: StaffIssueIn) -> IssueDetail:
        if data.client_ref:
            replay = (await self.s.execute(select(Issue).where(Issue.client_ref == data.client_ref))).scalar_one_or_none()
            if replay is not None:
                return await self.detail(replay.id)
        ward = await self.s.get(Ward, data.ward_id)
        if ward is None or (self.user.role != Role.call_agent and not can_touch_ward(self.user, ward)):
            raise HTTPException(422, "You can only log cases in your own area")
        source = IssueSource.call_centre if self.user.role == Role.call_agent else IssueSource.field
        issue = await create_issue(self.s, data, source=source, reporter=self.user, voter_id=data.voter_id,
                                   priority=data.priority, client_ref=data.client_ref)
        audit.record(self.s, actor_id=self.user.id, action="CREATE", entity="issue", entity_id=issue.id, ip=self.ctx.ip,
                     category=issue.category.value, source=source.value)
        await self.s.commit()
        await notify_reporter(self.s, issue, None, None, receipt=True)  # the resident gets their reference straight away
        return await self.detail(issue.id)

    async def _managed(self, issue_id: str) -> tuple[Issue, Ward]:
        issue = (await self._row(issue_id))[0]
        ward = await self.s.get(Ward, issue.ward_id)
        if not self._can_manage(issue, ward):
            raise HTTPException(403, "Only coordinators for this area can update the case")
        return issue, ward

    async def patch(self, issue_id: str, data: IssuePatch) -> IssueDetail:
        issue, ward = await self._managed(issue_id)
        note = (data.note or "").strip() or None
        changed: list[str] = []
        if data.category and data.category != issue.category:
            self.s.add(IssueUpdate(issue_id=issue.id, author_id=self.user.id, kind="category",
                                   note=f"Category: {LABELS[issue.category]} → {LABELS[data.category]}"))
            issue.category = data.category
            changed.append("category")
        if data.priority and data.priority != issue.priority:
            self.s.add(IssueUpdate(issue_id=issue.id, author_id=self.user.id, kind="priority", note=f"Priority: {data.priority.value}"))
            issue.priority = data.priority
            changed.append("priority")
        if data.unassign and issue.assigned_to_id:
            issue.assigned_to_id = None
            self.s.add(IssueUpdate(issue_id=issue.id, author_id=self.user.id, kind="assigned", note="Unassigned"))
            changed.append("assignee")
        elif data.assigned_to_id and data.assigned_to_id != issue.assigned_to_id:
            person = await self.s.get(User, data.assigned_to_id)
            if person is None or not person.is_active or person.role in (Role.viewer, Role.call_agent) or not can_touch_ward(person, ward):
                raise HTTPException(422, "Assign the case to someone who works in this ward")
            issue.assigned_to_id = person.id
            self.s.add(IssueUpdate(issue_id=issue.id, author_id=self.user.id, kind="assigned", note=f"Assigned to {person.full_name}"))
            if issue.status == IssueStatus.new and not data.status:
                data.status = IssueStatus.acknowledged
            changed.append("assignee")
        status_changed = bool(data.status and data.status != issue.status)
        if status_changed:
            issue.status = data.status
            issue.resolved_at = utcnow() if data.status in (IssueStatus.resolved, IssueStatus.closed) else None
            self.s.add(IssueUpdate(issue_id=issue.id, author_id=self.user.id, kind="status", status=data.status, note=note,
                                   public=data.public or data.status != IssueStatus.closed))
            changed.append("status")
        elif note:
            self.s.add(IssueUpdate(issue_id=issue.id, author_id=self.user.id, kind="note", note=note, public=data.public))
            changed.append("note")
        if not changed:
            return await self.detail(issue.id)
        issue.updated_at = utcnow()
        audit.record(self.s, actor_id=self.user.id, action="UPDATE", entity="issue", entity_id=issue.id, ip=self.ctx.ip,
                     fields=changed, status=issue.status.value)
        await self.s.commit()
        # The resident hears about progress (never about a case being closed as spam or a duplicate).
        # Sent after the change is saved, and the outcome goes on the case history either way.
        if (status_changed and issue.status in STATUS_SMS) or (not status_changed and note and data.public):
            await notify_reporter(self.s, issue, issue.status if status_changed else None, note if data.public else None)
        return await self.detail(issue.id)

    async def send_sms(self, issue_id: str, message: str) -> tuple[IssueDetail, str]:
        """A coordinator texts the resident about their case directly. Only when the resident gave a number
        and asked for updates; the outcome (sent, delivered or failed, with the reason) goes on the history."""
        issue, _ = await self._managed(issue_id)
        if not issue.reporter_phone:
            raise HTTPException(409, "This resident didn't leave a phone number")
        if not issue.contact_ok:
            raise HTTPException(409, "This resident didn't ask for SMS updates. Share the update on their tracking page instead.")
        audit.record(self.s, actor_id=self.user.id, action="SMS", entity="issue", entity_id=issue.id, ip=self.ctx.ip)
        await self.s.commit()
        outcome = await notify_reporter(self.s, issue, None, None, direct=message, author_id=self.user.id)
        return await self.detail(issue.id), outcome

    async def assignees(self, issue_id: str) -> list[Assignee]:
        _, ward = await self._managed(issue_id)
        people = (await self.s.execute(
            select(User).where(User.is_active.is_(True), User.role.in_([Role.super_admin, Role.coordinator, Role.ward_coordinator, Role.field_agent]))
            .order_by(User.full_name)
        )).scalars().all()
        return [Assignee(id=p.id, full_name=p.full_name, role=p.role.value) for p in people if can_touch_ward(p, ward)
                and (p.role != Role.super_admin or self.user.role == Role.super_admin)]

    # ---- photos -----------------------------------------------------------------
    async def add_photo(self, issue_id: str, raw: bytes) -> IssuePhotoOut:
        issue = (await self._row(issue_id))[0]
        return await store_photo(self.s, issue, raw, added_by=self.user, ip=self.ctx.ip)

    async def read_photo(self, issue_id: str, photo_id: str) -> bytes:
        await self._row(issue_id)
        p = await self.s.get(IssuePhoto, photo_id)
        if p is None or p.issue_id != issue_id:
            raise HTTPException(404, "Photo not found")
        try:
            return vault.load(p.path, p.sha256, ns=NS)
        except FileNotFoundError:
            raise HTTPException(404, "Photo not found")

    # ---- numbers ----------------------------------------------------------------
    async def map_points(self) -> list[dict]:
        rows = (await self.s.execute(
            select(Issue.id, Issue.reference, Issue.category, Issue.status, Issue.priority, Issue.summary, Issue.latitude, Issue.longitude,
                   Issue.ward_id, Issue.created_at)
            .join(Ward, Ward.id == Issue.ward_id)
            .where(scope(self.user), Issue.latitude.is_not(None), Issue.status != IssueStatus.closed)
        )).all()
        return [{"id": i, "reference": r, "category": c.value, "status": s.value, "priority": p.value, "summary": sm, "lat": la, "lng": lo,
                 "ward_id": w, "created_at": at.isoformat()} for i, r, c, s, p, sm, la, lo, w, at in rows]

    async def stats(self, days: int) -> dict:
        since = utcnow() - timedelta(days=days)
        base = select(Issue).join(Ward, Ward.id == Issue.ward_id).where(scope(self.user)).subquery()
        I = aliased(Issue, base)
        totals = (await self.s.execute(select(
            func.count(), func.count().filter(I.status.in_(OPEN_STATUSES)), func.count().filter(I.status == IssueStatus.new),
            func.count().filter(I.status == IssueStatus.resolved), func.count().filter(I.created_at >= since),
            func.count().filter(and_(I.status.in_(OPEN_STATUSES), I.priority == "urgent")),
            func.percentile_cont(0.5).within_group(func.extract("epoch", I.resolved_at - I.created_at) / 3600)
            .filter(I.status == IssueStatus.resolved),
            func.min(I.created_at).filter(I.status.in_(OPEN_STATUSES)),
        ))).one()
        total, open_, new, resolved, recent, urgent, median_h, oldest = totals
        by_cat = (await self.s.execute(
            select(I.category, func.count(), func.count().filter(I.status.in_(OPEN_STATUSES)), func.count().filter(I.status == IssueStatus.resolved))
            .group_by(I.category).order_by(func.count().desc())
        )).all()
        by_ward = (await self.s.execute(
            select(Ward.id, Ward.name, Constituency.name, func.count(I.id), func.count(I.id).filter(I.status.in_(OPEN_STATUSES)),
                   func.count(I.id).filter(I.status == IssueStatus.resolved), func.mode().within_group(I.category))
            .join(I, I.ward_id == Ward.id).join(Constituency, Constituency.id == Ward.constituency_id)
            .group_by(Ward.id, Ward.name, Constituency.name).order_by(func.count(I.id).desc())
        )).all()
        by_source = dict((await self.s.execute(select(I.source, func.count()).group_by(I.source))).all())
        tz = "Africa/Nairobi"
        wk = lambda col: func.date_trunc("week", func.timezone(tz, col))  # noqa: E731
        start = utcnow() - timedelta(weeks=12)
        rw, cw = wk(I.created_at), wk(I.resolved_at)
        reported = dict((await self.s.execute(select(rw, func.count()).where(I.created_at >= start).group_by(rw))).all())
        closed = dict((await self.s.execute(
            select(cw, func.count()).where(I.resolved_at >= start, I.status == IssueStatus.resolved).group_by(cw))).all())
        weeks = sorted(set(reported) | set(closed))
        return {
            "total": total, "open": open_, "new": new, "resolved": resolved, "recent": recent, "urgent": urgent, "days": days,
            "median_hours_to_resolve": round(median_h, 1) if median_h is not None else None,
            "oldest_open_at": oldest.isoformat() if oldest else None,
            "by_category": [{"category": c.value, "label": LABELS[c], "total": t, "open": o, "resolved": r} for c, t, o, r in by_cat],
            "by_ward": [{"ward_id": w, "ward": n, "constituency": cn, "total": t, "open": o, "resolved": r, "top": top.value if top else None}
                        for w, n, cn, t, o, r, top in by_ward],
            "by_source": {k.value: v for k, v in by_source.items()},
            "weekly": [{"week": w.date().isoformat(), "reported": reported.get(w, 0), "resolved": closed.get(w, 0)} for w in weeks],
        }


async def store_photo(session: AsyncSession, issue: Issue, raw: bytes, *, added_by: User | None, ip: str) -> IssuePhotoOut:
    limit = MAX_PHOTOS if added_by else PUBLIC_MAX_PHOTOS
    count = (await session.execute(select(func.count()).where(IssuePhoto.issue_id == issue.id))).scalar_one()
    if count >= limit:
        raise HTTPException(409, f"A report can have at most {limit} photos")
    jpeg, w, h = clean(raw)
    path, sha = vault.store(jpeg, ns=NS)
    p = IssuePhoto(issue_id=issue.id, path=path, sha256=sha, width=w, height=h, added_by_id=added_by.id if added_by else None)
    session.add(p)
    await session.flush()
    audit.record(session, actor_id=added_by.id if added_by else None, action="PHOTO_ADD", entity="issue", entity_id=issue.id, ip=ip, photo_id=p.id)
    await session.commit()
    return IssuePhotoOut(id=p.id, url=f"/api/v1/issues/{issue.id}/photos/{p.id}", width=w, height=h, by_resident=added_by is None,
                         created_at=p.created_at)
