# India Voice Platform

Multi-tenant AI voice calling SaaS for Indian businesses. Phase 1 is complete:
TypeScript API + Next.js web, tenant-isolated PostgreSQL database, and a standalone
Python LiveKit voice worker (Sarvam Saaras STT + Bulbul TTS, Telugu/Hindi/Tenglish).

## Quick start on Windows / VS Code

Prerequisites: Node.js 22.12+, npm 10+, Python 3.11–3.14, and Docker Desktop
(Linux containers). Open this directory in VS Code and use its PowerShell terminal.
Use `npm.cmd` if PowerShell blocks `npm.ps1`. Docker Desktop must be running.

```powershell
Copy-Item .env.example .env   # first time only; fill in API keys
npm.cmd ci
npm.cmd run infra:up
npm.cmd run db:migrate
npm.cmd run dev
```

Only copy `.env.example` on initial setup; keep your existing `.env` on subsequent
runs. The included passwords are intentionally local development values and all
published container ports bind to loopback. PostgreSQL role initialization runs
once when its volume is created. Editing passwords in `.env` does not change an
existing database role's password.

- **Web (landing page):** http://localhost:3000
- **API health:** http://localhost:3001/health
- **API readiness:** http://localhost:3001/ready (HTTP 503 if DB or Redis are down)
- PostgreSQL: `127.0.0.1:5432` · Redis: `127.0.0.1:6379` · LiveKit: `127.0.0.1:7880`

### Voice worker (after adding API keys to `.env`)

```powershell
# Create the Python virtual environment once
python -m venv apps\voice-worker\.venv
apps\voice-worker\.venv\Scripts\python.exe -m pip install -e "apps/voice-worker[dev]"

# Start everything (3 separate terminals)
npm.cmd run infra:up
apps\voice-worker\.venv\Scripts\india-voice-worker start
apps\voice-worker\.venv\Scripts\india-voice-browser
# Then open http://127.0.0.1:8765 in a browser and speak
```

Required voice credentials in `.env`:
```
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret-which-must-be-at-least-32-chars
SARVAM_API_KEY=          # from sarvam.ai
LLM_BASE_URL=            # e.g. https://api.groq.com/openai/v1
LLM_API_KEY=             # from console.groq.com
LLM_MODEL=               # e.g. llama-3.1-8b-instant
```

For separate terminals use `npm.cmd run dev:api` and `npm.cmd run dev:web`.
Run `npm.cmd run infra:down` to stop containers while preserving their data.

## Repository layout

```text
apps/
  api/                  NestJS + Fastify, config, health/readiness, HTTP tests
  web/                  Next.js + React + TypeScript, overview/setup, responsive CSS
  voice-worker/
    src/india_voice/
      worker.py         LiveKit Agents entry point (india-voice-worker)
      config.py         Validated provider settings
      guards.py         Epoch-based interruption and stream guards
      telemetry.py      JSONL timing recorder and percentile reporter
      browser.py        Local test harness (india-voice-browser)
    browser/            Browser test page loaded by the harness
    tests/              67 offline Python tests (63 core + 4 worker)
    requirements.lock   Reproducible Python dependency lock
    pyproject.toml      Python package and entry points
packages/
  database/
    src/schema.ts       Eight tables, enums, relations, checks and indexes
    src/client.ts       Drizzle/pg client and transaction-local tenant helper
    src/validation.ts   Runtime JSON and decimal-string paise validation
    src/billing.ts      Pure integer arithmetic; no billing service
    drizzle/            Generated SQL, custom security migration, snapshots/journal
    sql/                Review copy of custom RLS and trigger SQL
    drizzle.config.ts   Migration configuration using the owner credential
infra/
  compose.yaml          Local PostgreSQL and Redis with persistent volumes
  postgres/01-roles.sh  Restricted runtime/migration roles and test DB setup
docs/
  architecture.md      Decisions, trust boundaries, data and billing contracts
  verification.md      Reproducible checks and actual verification results
scripts/
  run-web.cjs           Root env loader compatible with Next build workers
  pin-dependencies.cjs Maintainer helper to pin installed direct dependencies
tests/
  database.unit.test.cjs
  database.integration.test.cjs
  smoke.test.cjs
.env.example
package.json
package-lock.json
tsconfig.base.json
```

## Database and authentication boundaries

`MIGRATION_DATABASE_URL` uses **voice_migrator**, which owns tables and migrations.
`DATABASE_URL` uses **voice_app**, which is not an owner, superuser, or BYPASSRLS
role and cannot assume the migration role. Every table has forced row-level
security. The runtime role cannot provision organizations or mutate ledger rows.
Local test organization creation uses a separate PostgreSQL admin connection.

Tenant identity must come from verified server authorization. Use
`withTenantTransaction(db, authorizedOrganizationId, callback)` and issue all
business queries through the supplied transaction. It calls `set_config` with
transaction-local scope, which clears on commit/rollback. A raw tenant header is
never authorization. RLS protects tenant-scoped queries; a stolen runtime DB
credential could set its own context and must be protected.

This foundation implements no sign-in or tenant HTTP endpoints. `AUTH_MODE=disabled`
is the only scaffold mode; API production startup is blocked pending a real
authentication adapter. Future OIDC issuer/audience/JWKS/session settings are
documented in `.env.example` and are not yet consumed.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run test:database
npm.cmd run test:smoke
```

Or run `npm.cmd run verify` after infrastructure and migrations are ready.
Database integration tests reset **only the local `voice_platform_test` database**,
apply versioned migrations twice to check replay, then use restricted runtime
connections for fixtures and assertions. They never reset `voice_platform`.
Smoke tests launch and stop temporary API/web processes on available ports.

See [actual results and test limitations](docs/verification.md). To generate a new
schema migration use `npm.cmd run db:generate`, review the SQL, then
`npm.cmd run db:migrate`. Security policies/triggers are explicit versioned SQL;
changes to them need a new custom migration. Do not use schema push as a substitute.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run test:database
npm.cmd run test:smoke      # requires built API + Next.js + running DB + Redis
npm.cmd run test:voice      # Python suite (67 tests) + browser JS suite (6 tests)
```

Or run all at once: `npm.cmd run verify`

See [actual results and test limitations](docs/verification.md).

## Remaining before live use

1. **Add API keys** to `.env` (Sarvam, LLM provider, LiveKit)
2. **Run the browser voice test** at `http://127.0.0.1:8765` and confirm audio replies
3. **Evaluate language quality** for Telugu, Hindi, and Tenglish with real speech
4. **Measure caller-perceived p95 latency** — target is < 500 ms; currently unmeasured
5. **Phase 2 review** before adding authentication, billing, or campaign execution

Authentication, payment verification, atomic accounting services, campaign execution,
telephony, and WhatsApp adapters remain future phases. No prepaid-exposure guarantee
exists until provider duration enforcement and the full accounting workflow are verified.
