from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  (register all tables)
from app.core.config import settings
from app.core.headers import SecurityHeaders
from app.modules.audit.router import router as audit_router
from app.modules.auth.router import router as auth_router
from app.modules.audience.router import router as audience_router
from app.modules.calls.router import router as calls_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.election.router import router as election_router
from app.modules.geo.router import router as geo_router
from app.modules.live.router import router as live_router
from app.modules.mapping.router import router as map_router
from app.modules.messaging.router import router as messaging_router
from app.modules.portal.router import router as portal_router
from app.modules.users.router import invites_router
from app.modules.users.router import router as users_router
from app.modules.visits.router import router as visits_router
from app.modules.voters.router import router as voters_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.assert_production_safe()
    yield


app = FastAPI(
    title=f"{settings.app_name} API",
    version="0.2.0",
    lifespan=lifespan,
    # No public schema/docs in production: don't hand attackers a map of the API.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(SecurityHeaders)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[*settings.cors_origins, settings.gis_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Requested-With", "Authorization"],
)

# Each module owns its router; adding a module = one line here.
for r in (auth_router, users_router, geo_router, voters_router, portal_router, dashboard_router, audit_router,
          messaging_router, visits_router, calls_router, election_router, map_router, live_router, invites_router, audience_router):
    app.include_router(r)


@app.get("/health")
async def health():
    return {"status": "ok"}
