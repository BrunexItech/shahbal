"""Seed Mombasa geography + a first super admin.

    python -m scripts.seed --email admin@campaign.local --password 'S3cure!pass' --name 'HQ Admin'
"""
import argparse
import asyncio

from sqlalchemy import select

from app import models  # noqa: F401
from app.core.db import SessionLocal
from app.core.roles import Role
from app.core.security import hash_password
from app.modules.geo.service import seed_geography, seed_stations
from app.modules.users.models import User


async def main(email: str | None, password: str | None, name: str) -> None:
    async with SessionLocal() as session:
        created = await seed_geography(session)
        print(f"geography: {created} new rows")
        st = await seed_stations(session)
        print(f"polling stations: {st.created} new, {st.updated} refreshed, {len(st.errors)} skipped")
        if email and password:
            if (await session.execute(select(User).where(User.email == email.lower()))).scalar_one_or_none():
                print(f"admin {email} already exists")
            else:
                session.add(User(full_name=name, email=email.lower(), password_hash=hash_password(password), role=Role.super_admin))
                await session.commit()
                print(f"admin {email} created")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--email")
    p.add_argument("--password")
    p.add_argument("--name", default="HQ Administrator")
    a = p.parse_args()
    asyncio.run(main(a.email, a.password, a.name))
