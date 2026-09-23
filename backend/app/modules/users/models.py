from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, pg_enum
from app.core.roles import Role


class User(Base):
    __tablename__ = "users"

    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[Role] = mapped_column(pg_enum(Role, "role"), index=True)
    # Area assignment: coordinator -> constituency; ward roles -> ward.
    constituency_id: Mapped[str | None] = mapped_column(ForeignKey("constituencies.id"))
    ward_id: Mapped[str | None] = mapped_column(ForeignKey("wards.id"))
    is_active: Mapped[bool] = mapped_column(default=True)
    last_login_at: Mapped[datetime | None]
