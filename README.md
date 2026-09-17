# India Voice Platform

Phase 1 Deliverables 1 and 2: a runnable TypeScript monorepo and tenant-isolated
PostgreSQL foundation. The Python voice worker is reserved for review and is **not implemented**.

## Quick start on Windows / VS Code

Prerequisites: Node.js 22.12+ on the 22.x line (tested with 22.20.0), npm 10+,
and Docker Desktop using Linux containers. Open this directory in VS Code and use
its PowerShell terminal. Use `npm.cmd` if PowerShell blocks `npm.ps1`; no execution
policy change is needed. Docker Desktop must be running.

```powershell
Copy-Item .env.example .env
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

- Web: http://localhost:3000 — overview, real API status, setup guide.
- API: http://localhost:3001/health — process liveness, independent of services.
- API: http://localhost:3001/ready — PostgreSQL role/schema/RLS and Redis checks;
  returns HTTP 503 if dependencies are unavailable or the DB role is unsafe.
- PostgreSQL: `127.0.0.1:5432`; Redis: `127.0.0.1:6379`.

The shell contains no simulated tenant data. External provider credentials can
remain empty. For separate terminals use `npm.cmd run dev:api` and
`npm.cmd run dev:web`. Run `npm.cmd run infra:down` to stop containers while
preserving their data.

## Repository layout

```text
apps/
  api/                  NestJS + Fastify, config, health/readiness, HTTP tests
  web/                  Next.js + React + TypeScript, overview/setup, responsive CSS
  voice-worker/
    README.md           Reserved scope and Deliverable 3 review boundary
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

## Review checkpoint

Review Deliverables 1 and 2 before authorizing Deliverable 3. Authentication,
payment verification, atomic credit/reserve/settle services, reconciliation
workers, campaign execution, telephony, voice and WhatsApp adapters remain future
work. The agreed caller-endpoint p95 target is **under 500 ms** and is unmeasured.
No prepaid-exposure guarantee is established until independent provider duration
enforcement and the full accounting workflow are verified.
