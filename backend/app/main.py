from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  (register all tables)
from app.core.config import settings
from app.modules.audit.router import router as audit_router
from app.modules.auth.router import router as auth_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.geo.router import router as geo_router
from app.modules.portal.router import router as portal_router
from app.modules.users.router import router as users_router
from app.modules.voters.router import router as voters_router

app = FastAPI(title=f"{settings.app_name} API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Each module owns its router; adding a module = one line here.
for r in (auth_router, users_router, geo_router, voters_router, portal_router, dashboard_router, audit_router):
    app.include_router(r)


@app.get("/health")
async def health():
    return {"status": "ok"}
