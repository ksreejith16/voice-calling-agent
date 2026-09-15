# Verification results — 15 September 2026

Executed in this workspace on Windows with Node **22.20.0**, npm **10.9.3**,
Docker Desktop Linux containers, PostgreSQL **17.9** and Redis **7.4.8**.
The local/test databases were created specifically for this scaffold. No external
provider credentials, production databases, payments, calls or messages were used.

## Actual results

| Check | Actual result |
| --- | --- |
| `npm.cmd install` | Passed; dependencies installed, exact versions pinned, root lockfile written |
| Lockfile refresh after pinning | Passed (`npm.cmd install --package-lock-only --ignore-scripts --no-fund`) |
| `npm.cmd run infra:up` equivalent Compose command | Passed; PostgreSQL and Redis containers healthy |
| `npm.cmd run db:generate` | Generated the eight-table migration; repeat reported no schema changes |
| Custom Drizzle migration generation | Generated `0001_tenant_security.sql`, populated with reviewed roles/grants/RLS/triggers |
| `npm.cmd run db:migrate` | Passed on fresh local application DB as `voice_migrator` |
| `npm.cmd run typecheck` | Passed for database, API and web |
| Database and API TypeScript builds | Passed |
| Next.js production build | Passed; `/` dynamic, `/setup` and not-found static |
| Database arithmetic/validation tests | **7 passed, 0 failed** |
| API HTTP/configuration tests | **7 passed, 0 failed** after malformed-URL handling fix |
| Real PostgreSQL integration tests | **19 passed, 0 failed** |
| Built-process HTTP smoke test | **1 passed, 0 failed** |

Total: **34 passing tests**, with no skipped tests in these suites. This count
excludes builds, migrations and dependency audit checks.

## What the tests demonstrate

The PostgreSQL suite drops/recreates only the local `voice_platform_test` public
and migration schemas, applies both migrations, then applies them again to check
idempotent migration replay. Safety guards require the exact test DB name,
loopback hostnames and expected role names. Test organization provisioning uses
`TEST_ADMIN_DATABASE_URL`; all tenant fixtures and assertions use real
`voice_app` logins. It tests:

- Restricted non-owner/non-superuser/non-BYPASSRLS runtime role and forced RLS on
  all eight tables; owner-role assumption is rejected.
- Two tenants' reads across every table, missing context, forbidden writes,
  pooled connection context cleared after both commit and rollback.
- Cross-tenant foreign keys and wrong-campaign lead/call references.
- Nonnegative balances/holds, holds within posted balance, one wallet per tenant.
- Duplicate provider events, payment credits, tenant idempotency keys, call charges
  and provider call IDs, including a duplicate credit attempted by another tenant.
- Runtime ledger update/delete/truncate denied; an admin edit also hits the
  append-only trigger.
- Fixed-duration authorization with margin, immutable billing snapshots, legal
  reservation transitions and terminal accounting.
- Connected-but-failed calls require exact authoritative-duration settlement;
  their hold cannot be fully released as though they never connected.
- Expired reservations retain their accounting state until zero-duration evidence
  and reconciliation are present; terminal rows cannot reopen.
- Odd paise rates for 30-second billing, malformed phones, charged zero-duration
  calls and settlement without verified duration are rejected.

Pure unit checks cover exact rounding at 0/1/30/31/60/61 seconds, amounts above
JavaScript's safe integer range, overflow, decimal-string parsing, JSON bigint
serialization, capture definitions, transcripts, qualification and consent.

API tests use Fastify request injection to check HTTP 200/503 behavior, liveness
independence, missing tenant routes, explicit CORS, secret-redacted configuration
errors and rejection of production startup without authentication. The separate
smoke test launches the compiled API and Next server on available loopback ports,
checks actual `/health` and `/ready` responses against running PostgreSQL/Redis,
loads `/` and `/setup`, verifies real API status and checks that sample credentials
are absent from the returned HTML. It shuts down both temporary processes.

## Issues found and fixed during verification

- Used `npm.cmd` because the local PowerShell policy blocks `npm.ps1`.
- Started the installed Docker Desktop engine before running local services.
- Aligned the migration config to `MIGRATION_DATABASE_URL`.
- Replaced bigint JavaScript defaults with SQL integer literals because Drizzle
  Kit could not serialize the bigint default while generating snapshots.
- Corrected the SQL E.164 regex to avoid TypeScript string-escape ambiguity.
- Loaded the web environment programmatically because Next worker propagation
  rejected `--env-file-if-exists` inside `NODE_OPTIONS`.
- Guarded URL refinements with `URL.canParse` so malformed configuration produces
  the intended redacted configuration error instead of throwing unexpectedly.

## Dependency audit

The initial `npm.cmd audit --json` reported **four moderate development dependency
advisories**, all from Drizzle Kit's legacy esbuild loader chain and the esbuild
development-server advisory [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
No esbuild development server is exposed by this scaffold. npm's suggested forced
fix would downgrade Drizzle Kit to an incompatible older major; it was not applied.
Keep this tooling advisory visible when upgrading Drizzle.
`npm.cmd audit --omit=dev --json` passed with **zero production vulnerabilities**.

## Reproduce

```powershell
# First installation only; do not overwrite an existing .env.
Copy-Item .env.example .env
npm.cmd ci
npm.cmd run infra:up
npm.cmd run db:migrate
npm.cmd run verify
```

Integration tests reset the disposable test DB every run. Do not repoint these
variables at a production host or remove their safety checks. PostgreSQL init
creates both databases and roles only on a new local volume. Existing volumes need
deliberate role/password changes; do not delete volumes to fix configuration unless
their contents are disposable.

## Limits of this checkpoint

The financial fixtures are synthetic rows, not provider-verified payment/CDR
events. These tests verify schema constraints and lifecycle guards, not an atomic
billing service or aggregate wallet/ledger/reservation correctness under concurrency.
Application startup tests are not browser interaction/accessibility or load tests.
The frontend uses minimal responsive CSS; no production design system is claimed.

Authentication, provider webhooks, true prepaid settlement/reservation services,
telephony duration enforcement, voice, WhatsApp, recordings and background workers
remain unimplemented. No latency, voice quality, code-switching, barge-in or
concurrency capacity measurement exists. Review Deliverables 1 and 2 before
authorizing the Python LiveKit/Sarvam worker (Deliverable 3).
