from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.orm import aliased

from app.core import audit
from app.core.clock import local_midnight, utcnow
from app.core.deps import Ctx
from app.core.roles import MANAGERS, Role
from app.core.scope import voter_scope
from app.modules.calls.models import CallLog, CallRecording, Outcome, Queue
from app.modules.calls.schemas import AgentStat, CallIn, CallOut, Claim, NextIn, QueueCounts
from app.modules.messaging.service import as_utc
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.users.models import User
from app.modules.voters.audience import Audience, audience_filter
from app.modules.voters.models import Status, Support, Voter
from app.modules.voters.service import STATUS_ACTIONS, VoterService

CALLERS = MANAGERS | {Role.call_agent}
LOCK = timedelta(minutes=10)
COOLDOWN = timedelta(hours=20)  # don't re-ring the same person the same day


class CallService:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self.s = ctx.session
        self.user = ctx.user
        if self.user.role not in CALLERS:
            raise HTTPException(403, "You do not have access to the call centre")

    def _queue_filter(self, q: Queue, ward_id: str | None = None, constituency_id: str | None = None) -> list:
        now = utcnow()
        a = Audience(ward_ids=[ward_id] if ward_id else [], constituency_ids=[constituency_id] if constituency_id else [])
        conds = audience_filter(self.user, a, for_calls=True)
        if q == Queue.follow_up:
            due = select(CallLog.voter_id).where(CallLog.follow_up_done.is_(False), CallLog.follow_up_at <= now)
            conds.append(Voter.id.in_(due))
        else:
            conds.append(or_(Voter.last_contacted_at.is_(None), Voter.last_contacted_at < now - COOLDOWN))
            if q == Queue.verify:
                conds.append(Voter.status == Status.pending)
            elif q == Queue.persuade:
                conds += [Voter.status == Status.verified, Voter.support.in_([Support.undecided, Support.leaning, Support.unknown])]
            elif q == Queue.gotv:
                conds += [Voter.support.in_([Support.supporter, Support.leaning]), Voter.voted_at.is_(None)]
        conds.append(or_(Voter.call_locked_until.is_(None), Voter.call_locked_until < now, Voter.call_locked_by_id == self.user.id))
        return conds

    async def counts(self) -> QueueCounts:
        out = {}
        for q in Queue:
            out[q.value] = (await self.s.execute(select(func.count(Voter.id)).where(*self._queue_filter(q)))).scalar_one()
        return QueueCounts(**out)

    async def _history(self, voter_id: str) -> list[CallOut]:
        rows = (await self.s.execute(
            select(CallLog, User.full_name, CallRecording.id).join(User, User.id == CallLog.agent_id)
            .outerjoin(CallRecording, CallRecording.call_log_id == CallLog.id)
            .where(CallLog.voter_id == voter_id).order_by(CallLog.created_at.desc()).limit(20)
        )).all()
        return [CallOut.model_validate(c).model_copy(update={"agent_name": n, "recording_id": rid}) for c, n, rid in rows]

    async def claim_next(self, data: NextIn) -> Claim | None:
        """Atomically claims one voter for this agent (SKIP LOCKED) so parallel
        agents never get the same person."""
        conds = self._queue_filter(data.queue, data.ward_id, data.constituency_id)
        order = [Voter.last_contacted_at.asc().nulls_first(), Voter.created_at.asc()]
        # Release anything this agent was still holding.
        await self._release_mine()
        v = (await self.s.execute(select(Voter).where(*conds).order_by(*order).limit(1).with_for_update(skip_locked=True))).scalar_one_or_none()
        if v is None:
            await self.s.commit()
            return None
        v.call_locked_by_id, v.call_locked_until = self.user.id, utcnow() + LOCK
        await self.s.commit()
        remaining = (await self.s.execute(select(func.count(Voter.id)).where(*self._queue_filter(data.queue, data.ward_id, data.constituency_id)))).scalar_one()
        voter = await VoterService(self.ctx).get(v.id)  # audited VIEW
        return Claim(voter=voter, history=await self._history(v.id), locked_until=v.call_locked_until, remaining=remaining)

    async def directory(self, *, constituency_id: str | None, ward_id: str | None, station_id: str | None, q: str | None,
                        called: str | None, page: int, size: int) -> dict:
        """Everyone this agent may call, by place, with their call record: how many times,
        when last, what happened, and whether a colleague is on the line with them now."""
        a = Audience(constituency_ids=[constituency_id] if constituency_id else [], ward_ids=[ward_id] if ward_id else [],
                     station_ids=[station_id] if station_id else [])
        conds = audience_filter(self.user, a, for_calls=True)
        if q:
            like = f"%{q.strip()}%"
            conds.append(or_(Voter.full_name.ilike(like), Voter.reference.ilike(like), Voter.phone.ilike(like)))
        stats = (select(CallLog.voter_id, func.count().label("calls"), func.max(CallLog.created_at).label("last_at"))
                 .group_by(CallLog.voter_id).subquery())
        last = (select(CallLog.voter_id, CallLog.outcome, User.full_name.label("agent"),
                       func.row_number().over(partition_by=CallLog.voter_id, order_by=CallLog.created_at.desc()).label("rn"))
                .join(User, User.id == CallLog.agent_id).subquery())
        if called == "never":
            conds.append(stats.c.calls.is_(None))
        elif called == "called":
            conds.append(stats.c.calls.is_not(None))
        elif called in {o.value for o in Outcome}:
            conds.append(last.c.outcome == Outcome(called))
        locker = aliased(User)
        base = (select(Voter, Ward.name, Constituency.name, PollingStation.name, stats.c.calls, stats.c.last_at, last.c.outcome, last.c.agent, locker.full_name)
                .join(Ward, Ward.id == Voter.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
                .outerjoin(PollingStation, PollingStation.id == Voter.station_id)
                .outerjoin(stats, stats.c.voter_id == Voter.id)
                .outerjoin(last, and_(last.c.voter_id == Voter.id, last.c.rn == 1))
                .outerjoin(locker, and_(locker.id == Voter.call_locked_by_id, Voter.call_locked_until > utcnow()))
                .where(*conds))
        total = (await self.s.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
        rows = (await self.s.execute(base.order_by(stats.c.last_at.asc().nulls_first(), Voter.full_name).offset((page - 1) * size).limit(size))).all()
        audit.record(self.s, actor_id=self.user.id, action="DIRECTORY", entity="calls", entity_id="directory", ip=self.ctx.ip,
                     ward_id=ward_id, constituency_id=constituency_id, station_id=station_id, results=len(rows))
        await self.s.commit()
        return {"total": total, "page": page, "size": size, "items": [{
            "id": v.id, "reference": v.reference, "full_name": v.full_name, "phone": v.phone, "support": v.support.value,
            "status": v.status.value, "ward": w, "constituency": c, "station": st, "calls": n or 0,
            "last_call_at": la.isoformat() if la else None, "last_outcome": lo.value if lo else None, "last_agent": ag,
            "busy_with": lk if lk and v.call_locked_by_id != self.user.id else None,
        } for v, w, c, st, n, la, lo, ag, lk in rows]}

    async def claim_one(self, voter_id: str) -> Claim:
        """Pick a specific person from the directory: reserved for this agent unless a
        colleague is already on the line with them."""
        v = (await self.s.execute(select(Voter).where(Voter.id == voter_id, *audience_filter(self.user, Audience(), for_calls=True))
                                  .with_for_update())).scalar_one_or_none()
        if v is None:
            raise HTTPException(404, "Not found, or this person asked not to be called")
        now = utcnow()
        if v.call_locked_by_id and v.call_locked_by_id != self.user.id and v.call_locked_until and v.call_locked_until > now:
            other = await self.s.get(User, v.call_locked_by_id)
            raise HTTPException(409, f"{other.full_name if other else 'A colleague'} is calling this person right now")
        await self._release_mine()
        v.call_locked_by_id, v.call_locked_until = self.user.id, now + LOCK
        await self.s.commit()
        voter = await VoterService(self.ctx).get(v.id)  # audited VIEW
        return Claim(voter=voter, history=await self._history(v.id), locked_until=v.call_locked_until, remaining=0)

    async def _release_mine(self) -> None:
        await self.s.execute(update(Voter).where(Voter.call_locked_by_id == self.user.id).values(call_locked_by_id=None, call_locked_until=None))

    async def release(self) -> None:
        await self._release_mine()
        await self.s.commit()

    async def log(self, data: CallIn) -> CallOut:
        vs = VoterService(self.ctx)
        voter: Voter = (await vs._row(data.voter_id))[0]  # scope check
        now = utcnow()
        call = CallLog(voter_id=voter.id, agent_id=self.user.id, queue=data.queue, outcome=data.outcome,
                       support_after=data.support.value if data.support else None, notes=data.notes, issue=data.issue,
                       duration_seconds=data.duration_seconds,
                       follow_up_at=as_utc(data.follow_up_at) if data.follow_up_at else None)
        self.s.add(call)
        await self.s.flush()
        if data.recording_id:
            rec = await self.s.get(CallRecording, data.recording_id)
            if rec is None or rec.agent_id != self.user.id or rec.call_log_id is not None:
                raise HTTPException(422, "That recording can't be attached to this call")
            rec.call_log_id, rec.voter_id = call.id, voter.id
        # Any earlier promised call-back is now handled.
        # Any *earlier* promised call-back is now handled (never the one being logged now).
        await self.s.execute(update(CallLog).where(CallLog.voter_id == voter.id, CallLog.follow_up_done.is_(False), CallLog.id != call.id)
                             .values(follow_up_done=True))
        voter.last_contacted_at = now
        voter.call_locked_by_id = voter.call_locked_until = None
        if data.support and data.outcome == Outcome.answered:
            voter.support = data.support
        if data.outcome == Outcome.do_not_call:
            voter.do_not_call = True
            voter.opted_out = True  # asked not to be contacted: stop messages too
        if data.outcome == Outcome.wrong_number and voter.status == Status.pending:
            voter.status, voter.rejection_reason = Status.rejected, "Wrong number (call centre)"
            voter.verified_by_id, voter.verified_at = self.user.id, now
            audit.record(self.s, actor_id=self.user.id, action=STATUS_ACTIONS[Status.rejected], entity="voter", entity_id=voter.id,
                         ip=self.ctx.ip, reason="wrong number")
        if data.verify and data.outcome == Outcome.answered and voter.status == Status.pending:
            voter.status, voter.verified_by_id, voter.verified_at = Status.verified, self.user.id, now
            audit.record(self.s, actor_id=self.user.id, action="VERIFY", entity="voter", entity_id=voter.id, ip=self.ctx.ip, via="call")
        await self.s.flush()
        audit.record(self.s, actor_id=self.user.id, action="CALL", entity="voter", entity_id=voter.id, ip=self.ctx.ip,
                     outcome=data.outcome.value, queue=data.queue.value, recorded=bool(data.recording_id),
                     recording_declined=data.recording_declined or None)
        await self.s.commit()
        return CallOut.model_validate(call).model_copy(update={"agent_name": self.user.full_name})

    async def history(self, voter_id: str) -> list[CallOut]:
        await VoterService(self.ctx)._row(voter_id)
        return await self._history(voter_id)

    async def agent_stats(self) -> list[AgentStat]:
        since = local_midnight()
        scope = [CallLog.created_at >= since]
        if self.user.role == Role.call_agent:
            scope.append(CallLog.agent_id == self.user.id)
        elif self.user.role != Role.super_admin:
            scope.append(CallLog.voter_id.in_(select(Voter.id).where(voter_scope(self.user))))
        rows = (await self.s.execute(
            select(User.id, User.full_name, func.count(CallLog.id),
                   func.count(case((CallLog.outcome == Outcome.answered, 1))),
                   func.count(case((and_(CallLog.outcome == Outcome.answered, CallLog.queue == Queue.verify), 1))))
            .join(User, User.id == CallLog.agent_id).where(*scope).group_by(User.id).order_by(func.count(CallLog.id).desc())
        )).all()
        return [AgentStat(agent_id=i, agent_name=n, calls=c, answered=a, verified=v) for i, n, c, a, v in rows]
