"""Load clearly-fictional demo data for local walkthroughs. Never run in production.

    python -m scripts.demo

Uses the real ward boundaries and bundled polling stations; every person,
phone number and ID is invented.
"""
import asyncio
import random
from datetime import timedelta

from sqlalchemy import func, select

from app import models  # noqa: F401
from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.roles import Role
from app.core.security import hash_password
from app.modules.calls.models import CallLog, Outcome, Queue
from app.modules.geo.models import PollingStation, Ward
from app.modules.geo.service import seed_geography, seed_stations
from app.modules.mapping.service import ward_boundaries
from app.modules.messaging.models import CampaignStatus, Channel, Kind, MessageCampaign
from app.modules.users.models import User
from app.modules.visits.models import Visit, VisitStatus
from app.modules.voters.models import Source, Status, Support, Voter
from app.modules.voters.schemas import VoterCreate
from app.modules.voters.service import DuplicateVoter, register_voter

FIRST = ["Amina", "Fatma", "Hassan", "Omar", "Mwanajuma", "Baraka", "Neema", "Juma", "Zawadi", "Salim", "Rehema", "Kassim",
         "Halima", "Ali", "Mercy", "Brian", "Khadija", "Swaleh", "Grace", "Rashid"]
LAST = ["Mohamed", "Said", "Mwangi", "Otieno", "Kahindi", "Chengo", "Salim", "Karisa", "Njeri", "Abdalla", "Wanjiku", "Baya",
        "Kombe", "Achieng", "Bakari", "Mwinyi"]
VENUES = ["Social Hall", "Market Grounds", "Primary School Field", "Mosque Grounds", "Stage", "Community Centre"]


def point_in_ring(x, y, ring):
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def random_point_in_ward(rnd, geom):
    """Rejection-sample a point inside the ward polygon (so demo GPS never lands in the sea)."""
    ring = geom["coordinates"][0][0]
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    for _ in range(200):
        x, y = rnd.uniform(min(xs), max(xs)), rnd.uniform(min(ys), max(ys))
        if point_in_ring(x, y, ring):
            return round(y, 6), round(x, 6)
    return round(sum(ys) / len(ys), 6), round(sum(xs) / len(xs), 6)


async def main():
    if settings.is_production:
        raise SystemExit("Refusing to load demo data in production")
    rnd = random.Random(2027)
    geoms = {f["properties"]["code"]: f["geometry"] for f in ward_boundaries()["features"]}
    async with SessionLocal() as s:
        if (await s.execute(select(func.count(Voter.id)))).scalar_one():
            raise SystemExit("Database already has voters; demo data is only for an empty database")
        await seed_geography(s)
        await seed_stations(s)
        wards = list((await s.execute(select(Ward).order_by(Ward.code))).scalars())
        for w in wards:
            w.target = rnd.choice([400, 500, 600, 750, 800])
            w.registered_voters = w.target * rnd.randint(8, 12)
        admin = (await s.execute(select(User).where(User.role == Role.super_admin))).scalars().first()
        agents, callers = [], []
        for w in wards[::3]:
            email = f"agent.{w.code}@demo.campaign.co.ke"
            u = (await s.execute(select(User).where(User.email == email))).scalar_one_or_none() or User(
                full_name=f"{rnd.choice(FIRST)} {rnd.choice(LAST)}", email=email, password_hash=hash_password("DemoPass2027"),
                role=Role.field_agent, ward_id=w.id, constituency_id=w.constituency_id, activated_at=utcnow())
            s.add(u)
            agents.append(u)
        for i in (1, 2):
            email = f"calls{i}@demo.campaign.co.ke"
            u = (await s.execute(select(User).where(User.email == email))).scalar_one_or_none() or User(
                full_name=f"{rnd.choice(FIRST)} {rnd.choice(LAST)}", email=email, password_hash=hash_password("DemoPass2027"),
                role=Role.call_agent, activated_at=utcnow())
            s.add(u)
            callers.append(u)
        await s.commit()

        stations: dict[str, list[PollingStation]] = {}
        for st in (await s.execute(select(PollingStation))).scalars():
            stations.setdefault(st.ward_id, []).append(st)

        # Uneven effort across wards makes the map tell a story.
        weight = {w.id: rnd.choice([0.3, 0.6, 1, 1.5, 2.5]) for w in wards}
        voters = []
        for i in range(1400):
            agent = rnd.choice(agents + [None] * 3)
            ward = next(w for w in wards if w.id == agent.ward_id) if agent else rnd.choices(wards, [weight[w.id] for w in wards])[0]
            st = rnd.choice(stations[ward.id]) if stations.get(ward.id) else None
            lat, lng = random_point_in_ward(rnd, geoms[ward.code]) if agent else (None, None)
            data = VoterCreate(
                full_name=f"{rnd.choice(FIRST)} {rnd.choice(LAST)}", phone=f"07{rnd.randint(10000000, 99999999)}",
                national_id=str(21000000 + i * 7919 % 8000000 + i), ward_id=ward.id, station_id=st.id if st else None,
                gender=rnd.choice(["female", "male"]), birth_year=rnd.randint(1960, 2006), consent=True,
                support=rnd.choices(list(Support), weights=[45, 20, 20, 5, 10])[0], capture_lat=lat, capture_lng=lng,
            )
            try:
                v = await register_voter(s, data, source=Source.field if agent else Source.portal, captured_by=agent)
            except DuplicateVoter:
                continue
            v.created_at = v.consent_at = utcnow() - timedelta(days=rnd.triangular(0, 13, 1), hours=rnd.random() * 10)
            v.status = rnd.choices([Status.verified, Status.pending, Status.rejected], weights=[55, 38, 7])[0]
            voters.append(v)
        await s.commit()

        now = utcnow()
        for w in rnd.sample(wards, 14):
            done = rnd.random() < 0.7
            st = rnd.choice(stations.get(w.id) or [None])
            when = now - timedelta(days=rnd.randint(1, 12)) if done else now + timedelta(days=rnd.randint(1, 10), hours=rnd.randint(0, 8))
            s.add(Visit(title=f"{w.name} {'town hall' if rnd.random() < .5 else 'door-to-door'}", ward_id=w.id,
                        station_id=st.id if st else None, venue=f"{w.name} {rnd.choice(VENUES)}", scheduled_at=when,
                        status=VisitStatus.completed if done else VisitStatus.scheduled, announce=False,
                        completed_at=when + timedelta(hours=2) if done else None,
                        attendance=rnd.randint(80, 900) if done else None, created_by_id=admin.id if admin else agents[0].id))
        if admin:
            s.add(MessageCampaign(name="Launch rally invitation", channel=Channel.sms, kind=Kind.broadcast,
                                  body="Habari {first_name}! Join us this Saturday at Tononoka Grounds. Tuko pamoja!",
                                  audience={"statuses": ["verified", "pending"]}, status=CampaignStatus.sent,
                                  scheduled_at=now - timedelta(days=3), started_at=now - timedelta(days=3),
                                  completed_at=now - timedelta(days=3), created_by_id=admin.id, reviewed_by_id=admin.id,
                                  recipients=812, sent=812, delivered=779, failed=33))
            s.add(MessageCampaign(name="Kisauni youth forum", channel=Channel.sms, kind=Kind.broadcast,
                                  body="{first_name}, youth forum in {ward} next week. Karibu!", audience={"support": ["undecided", "leaning"]},
                                  status=CampaignStatus.pending_approval, scheduled_at=now + timedelta(days=1), created_by_id=agents[0].id))
        for v in rnd.sample(voters, 60):
            c = rnd.choice(callers)
            outcome = rnd.choices(list(Outcome), weights=[55, 20, 8, 8, 5, 4])[0]
            s.add(CallLog(voter_id=v.id, agent_id=c.id, queue=Queue.verify, outcome=outcome,
                          created_at=now - timedelta(hours=rnd.randint(0, 30))))
            v.last_contacted_at = now - timedelta(hours=rnd.randint(0, 30))
        await s.commit()
        print(f"demo: {len(voters)} voters, {len(agents)} field agents, {len(callers)} call agents (password DemoPass2027)")


if __name__ == "__main__":
    asyncio.run(main())
