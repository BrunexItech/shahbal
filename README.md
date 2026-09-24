# Campaign HQ: Mombasa field operations

Campaign HQ is a campaign operations platform for Mombasa County. It covers:
- field capture of supporters (works offline),
- a public sign-up portal,
- ward targets and gap tracking,
- verification,
- targeted SMS and WhatsApp messages,
- campaign visits with automatic ward notices,
- a call centre,
- election-day turnout,
- a live coverage map and a self-hosted GIS Lab.

Everything is restricted by area and recorded in an audit trail.

> This is a **campaign** tool, not an electoral-body system. The public portal says clearly that it is not IEBC voter registration.

## Stack

| Layer | Tech |
|---|---|
| API | FastAPI · SQLAlchemy 2 (async) · PostgreSQL 16 · Alembic · background worker |
| Web | Next.js 16 · React 19 · Tailwind CSS 4 · TanStack Query 5 · Recharts · MapLibre GL 6 |
| Maps | OpenFreeMap base tiles (free, no key) · IEBC ward boundaries · GeoLibre v3 GIS Lab (MIT, self-hosted) |
| Messaging | Africa's Talking (SMS) · WhatsApp Cloud API · sandbox provider for development |

## Architecture

Each module owns its `models / schemas / service / router` on the backend and a `features/<name>` folder on the frontend.

```
backend/app/
  core/        config, db, security (sessions, TOTP, password policy), crypto (PII),
               scope (area RBAC), audit, headers, clock (Africa/Nairobi), rate limit
  modules/
    auth/      cookie sessions, 2FA, password change, session management, GIS gate
    users/     team & roles, forced sign-out
    geo/       constituencies → wards → 210 polling stations (bundled), CSV import
    voters/    one write path for every channel, dedup, verify, offline idempotency, audiences
    portal/    public sign-up (anti-enumeration, honeypot, rate-limited)
    messaging/ campaigns, approval, providers, dispatcher, delivery/opt-out webhooks
    visits/    visit planning, automatic ward notices, check-in / completion
    calls/     call-centre queues (claim with SKIP LOCKED), outcomes
    election/  settings, turnout marking, rosters, GOTV reminder plan
    mapping/   coverage map read model, GIS exports, GeoLibre project, CSV export
    dashboard/ war-room aggregates   audit/  audit trail
  worker.py    message dispatch process
frontend/
  app/(app)/   war room, map, targets, GIS Lab, capture, registry, verification, messaging,
               visits, calls, election, stations, team, audit, account
  app/join     public portal       lib/outbox.ts  offline capture queue (IndexedDB)
deploy/        nginx gateway, encrypted backup script
```

## Security model

- **Sessions:**
  - Server-side sessions in an `httpOnly` `SameSite=Strict` cookie, which JavaScript never sees.
  - A CSRF header is required on writes.
  - Logout, disabling a user, a role change or a password change revokes sessions at once.
- **Logins:**
  - Accounts lock after repeated failures.
  - Unknown emails and wrong passwords get identical responses.
  - Passwords need 10+ characters with letters and numbers, and common ones are rejected.
- **2FA:** TOTP two-factor, mandatory for HQ admins in production. The secret is stored encrypted.
- **Personal data:**
  - National IDs are Fernet-encrypted, with an HMAC blind index used for dedup.
  - Staff see only the last 4 digits. A full reveal is admin-only and audited.
  - GIS exports contain only aggregates, and grid cells with fewer than 5 records are suppressed.
  - CSV exports keep IDs masked and are protected against spreadsheet formula injection.
- **Headers and edge protection:**
  - Static CSP + Subresource Integrity, `frame-ancestors 'none'`, no-store on the API, HSTS over HTTPS.
  - The API docs are disabled in production, and the app refuses to boot with default secrets.
  - The real client IP comes only from trusted proxy hops (`TRUSTED_PROXIES` / `CLIENT_IP_HEADER`).
  - Rate limits run both in the app and at the gateway.
- **Messaging:**
  - Coordinators' messages need HQ approval.
  - Audiences are always limited to the sender's area.
  - Opt-outs are honoured at send time, not just when the campaign is created.
  - Nothing sends between 21:00 and 08:00.

## Run locally (development)

```bash
docker compose up -d postgres
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/alembic upgrade head
.venv/bin/python -m scripts.seed --email admin@campaign.co.ke --password 'ChangeMe!2027'
.venv/bin/python -m scripts.demo            # optional: fictional demo data (empty DB only)
.venv/bin/uvicorn app.main:app --reload      # :8000 (API docs at /docs)
.venv/bin/python -m app.worker               # message dispatch (sandbox logs to console)

cd ../frontend && npm install && npm run dev   # :3000
```

Demo logins (password `DemoPass2027`): `agent.0001@demo.campaign.co.ke` (field agent) and `calls1@demo.campaign.co.ke` (call centre).

Tests: `cd backend && .venv/bin/pytest`. This needs a `shahbal_test` database on the compose Postgres.

## Production

`docker compose up -d --build` runs Postgres, the API, the worker, the frontend, the GeoLibre GIS Lab (built from the pinned v3.0.0 release with a `/gis/` base path) and the nginx gateway, all on **one origin** at `127.0.0.1:8090`. Put TLS in front, for example host nginx with Cloudflare Full (strict).

1. Copy `backend/.env.example` to `backend/.env` and generate every secret. `PII_KEY` and `PII_PEPPER` can **never** change once real data exists. Set `ENVIRONMENT=production`, `CORS_ORIGINS=["https://your-domain"]`, and `TRUSTED_PROXIES` to the number of proxies in front of the API (gateway = 1, plus 1 for host nginx). Behind Cloudflare, set `CLIENT_IP_HEADER=cf-connecting-ip` instead.
2. Messaging: set `SMS_PROVIDER=africastalking` with `AT_USERNAME`, `AT_API_KEY` and `AT_SENDER_ID`. Point Africa's Talking's delivery, inbound and opt-out callbacks at `https://your-domain/api/v1/messaging/webhooks/at/{delivery|inbound|optout}?token=<WEBHOOK_SECRET>`. WhatsApp needs a Meta-approved template named in `WA_TEMPLATE`, and must follow Meta's political-content policy.
3. First sign-in: the HQ admin must enrol 2FA before anything else unlocks.
4. Backups: run `BACKUP_PASSPHRASE=… ./deploy/backup.sh` nightly from cron. Backups are AES-256 encrypted with 14-day retention. Copy them off-site.
5. Optional: self-host the base map with a Protomaps extract and point `NEXT_PUBLIC_MAP_STYLE` at it.

## Geography data

- **Ward boundaries:** IEBC, via the `mikelmaron/kenya-election-data` extract. There are 30 Mombasa wards, matched to our ward codes 0001–0030.
- **Polling stations:** 210 Mombasa polling centres from the IEBC-derived list, bundled in `backend/app/modules/geo/data/mombasa_stations.csv`.
  - 81 have coordinates that were checked against their ward's boundary: 66 from the source data and 15 geocoded through OpenStreetMap Nominatim.
  - Coordinates that fell in the wrong ward were dropped rather than guessed.
  - Coordinators can pin the remaining stations from their phone's GPS.
- **Updating the list:** re-import the official IEBC list with *Polling Stations → Import CSV* (`code,name,ward_code[,streams,registered_voters,latitude,longitude]`). Rows match on code, or on ward plus name, so the bundled rows are updated, not duplicated.
