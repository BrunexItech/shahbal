# Campaign HQ: Mombasa field operations

Voter outreach and get-out-the-vote platform for a Mombasa County campaign. It covers field capture, a public supporter portal, ward targets and gap tracking, a verification queue, and a live war-room dashboard. Every step has area-scoped access control and an audit trail.

> This is a **campaign** tool, not an electoral-body system. The public portal says clearly that it is not IEBC voter registration.

## Stack

| Layer | Tech |
|---|---|
| API | FastAPI · SQLAlchemy 2 (async) · PostgreSQL 16 · Alembic |
| Web | Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · TanStack Query 5 · Recharts |
| Security | bcrypt · JWT · Fernet-encrypted national IDs + HMAC blind index · per-area RBAC · audit log |

## Architecture

The codebase is a modular monolith. Each backend module owns its `models / schemas / service / router`. Each frontend feature owns its `api.ts` hooks and components.

```
backend/app/
  core/        config, db, security, crypto (PII), scope (area RBAC), audit, clock, rate limit
  modules/
    auth/      login, me
    users/     team & roles (coordinators can grow their own teams)
    geo/       constituencies → wards → polling stations, CSV import, targets
    voters/    single write path for every channel, dedup, verify/reject, ID reveal
    portal/    public sign-up (anti-enumeration, honeypot, rate-limited)
    dashboard/ war-room aggregates (scoped to the caller's area)
    audit/     audit trail
frontend/
  app/(app)/   authenticated pages · app/join public portal · app/login
  features/    geo · voters · dashboard · users · audit  (hooks + components)
  components/  ui primitives · loaders · shell
```

To add a module, create its backend folder and include its router in `main.py`. Then add a `features/<name>` folder, an `app/(app)/<route>` page and one `NAV` entry.

## Roles

| Role | Sees | Can |
|---|---|---|
| HQ Administrator | everything | all actions, reveal IDs (audited), import stations, audit trail |
| Constituency Coordinator | own constituency | capture, verify, set targets, add ward coordinators and agents |
| Ward Coordinator | own ward | capture, verify, add field agents |
| Field Agent | own captures | capture in own ward |
| Call Centre Agent | county | capture, verify, update support level |
| Observer | county | read-only |

## Run locally

```bash
docker compose up -d postgres
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/alembic upgrade head
.venv/bin/python -m scripts.seed --email admin@campaign.co.ke --password 'ChangeMe!2027'
.venv/bin/python -m scripts.demo          # optional: 900 fictional voters, 10 agents
.venv/bin/uvicorn app.main:app --reload   # :8000  (docs at /docs)

cd ../frontend && npm install && npm run dev   # :3000
```

Or run the whole stack with `docker compose up --build`.

Tests: `cd backend && .venv/bin/pytest` (needs the `shahbal_test` database on the compose Postgres).

## Polling stations CSV

`code,name,ward_code[,streams,registered_voters,latitude,longitude]`. `ward_code` is the 4-digit code (0001–0030). Imports upsert on `code`, so the IEBC list can be re-imported safely.

## Data protection (Kenya DPA 2019)

- Consent is required on every capture channel and timestamped.
- National IDs are encrypted at rest. Staff see only the last 4 digits. Reveals are admin-only and audited.
- The portal never reveals whether an ID already exists.
- Every login, view, change, verification, reveal and import is logged.
- `opted_out` is tracked per voter, and messaging (Phase 2) must honour it.

## Roadmap

1. ✅ Foundation: capture, portal, dedup, ward targets and gaps, verification, war room, audit
2. SMS/WhatsApp targeted messaging (Africa's Talking) with STOP handling, visit announcements, coverage map
3. Call-centre queue with click-to-call, outcome logging, offline-first PWA capture
4. Election-day GOTV: reminders, turnout marking, re-targeting of non-voters
