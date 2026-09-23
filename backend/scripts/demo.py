"""Load clearly-fictional demo data for local walkthroughs. Never run in production.

    python -m scripts.demo
"""
import asyncio
import random
from datetime import timedelta

from sqlalchemy import select, update

from app import models  # noqa: F401
from app.core.clock import utcnow
from app.core.db import SessionLocal
from app.core.roles import Role
from app.core.security import hash_password
from app.modules.geo.models import PollingStation, Ward
from app.modules.geo.service import seed_geography
from app.modules.users.models import User
from app.modules.voters.models import Source, Status, Support, Voter
from app.modules.voters.schemas import VoterCreate
from app.modules.voters.service import DuplicateVoter, register_voter

FIRST = ["Amina", "Fatma", "Hassan", "Omar", "Mwanajuma", "Baraka", "Neema", "Juma", "Zawadi", "Salim", "Rehema", "Kassim", "Halima", "Ali", "Mercy", "Brian"]
LAST = ["Mohamed", "Said", "Mwangi", "Otieno", "Kahindi", "Chengo", "Salim", "Karisa", "Njeri", "Abdalla", "Wanjiku", "Baya", "Kombe", "Achieng"]


async def main():
    rnd = random.Random(2027)
    async with SessionLocal() as s:
        await seed_geography(s)
        wards = list((await s.execute(select(Ward).order_by(Ward.code))).scalars())
        for w in wards:
            w.target = rnd.choice([400, 500, 600, 750, 800])
            w.registered_voters = w.target * rnd.randint(8, 12)
            for n in range(1, 4):
                code = f"{w.code}{n:03d}"
                if not (await s.execute(select(PollingStation.id).where(PollingStation.code == code))).first():
                    s.add(PollingStation(code=code, name=f"{w.name} {['Primary School', 'Social Hall', 'Secondary School'][n - 1]}",
                                         ward_id=w.id, streams=rnd.randint(1, 5), registered_voters=rnd.randint(800, 3500)))
        await s.commit()

        agents = []
        for w in wards[::3]:
            email = f"agent.{w.code}@demo.campaign.co.ke"
            u = (await s.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if u is None:
                u = User(full_name=f"{rnd.choice(FIRST)} {rnd.choice(LAST)}", email=email, password_hash=hash_password("Password!1"),
                         role=Role.field_agent, ward_id=w.id, constituency_id=w.constituency_id)
                s.add(u)
            agents.append(u)
        await s.commit()

        stations = {}
        for st in (await s.execute(select(PollingStation))).scalars():
            stations.setdefault(st.ward_id, []).append(st.id)

        created = 0
        for i in range(900):
            agent = rnd.choice(agents + [None] * 3)
            ward = next(w for w in wards if w.id == agent.ward_id) if agent else rnd.choice(wards)
            data = VoterCreate(
                full_name=f"{rnd.choice(FIRST)} {rnd.choice(LAST)}", phone=f"07{rnd.randint(10000000, 99999999)}",
                national_id=str(20000000 + i * 7919 % 9000000 + i), ward_id=ward.id, station_id=rnd.choice(stations[ward.id]),
                gender=rnd.choice(["female", "male"]), birth_year=rnd.randint(1960, 2006), consent=True,
                support=rnd.choices(list(Support), weights=[45, 20, 20, 5, 10])[0],
            )
            try:
                v = await register_voter(s, data, source=Source.field if agent else Source.portal, captured_by=agent)
            except DuplicateVoter:
                continue
            v.created_at = v.consent_at = utcnow() - timedelta(days=rnd.triangular(0, 13, 1), hours=rnd.random() * 10)
            v.status = rnd.choices([Status.verified, Status.pending, Status.rejected], weights=[55, 38, 7])[0]
            created += 1
        await s.commit()
        print(f"demo: {created} voters, {len(agents)} agents (password Password!1)")


if __name__ == "__main__":
    asyncio.run(main())
