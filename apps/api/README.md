# API foundation

NestJS runs on its Fastify adapter at `http://127.0.0.1:3001` by default.
From the repository root, use `npm run dev:api` after dependency installation
and local infrastructure/migration setup described in the root README.

## Public routes

| Route | Response |
| --- | --- |
| `GET /health` | HTTP 200 when the application is running. No database, Redis, or external provider call is made. |
| `GET /ready` | HTTP 200 only when PostgreSQL and Redis checks pass; HTTP 503 with the failed component names otherwise. |

PostgreSQL readiness checks the connected role, the eight foundation tables,
SELECT permissions, forced row-level security, and separation from table ownership.
Redis readiness sends `PING` with a bounded timeout. Readiness does not prove
billing correctness or provider readiness. Responses contain no connection
strings, credentials, tenant records, or raw infrastructure errors.

## Configuration and authorization boundary

The root `.env` is loaded by the start/development scripts. Configuration is
validated before startup. `DATABASE_URL` must use `voice_app`; migration/admin
credentials are not used. The health process can start even when local services
are unavailable; `/ready` then reports HTTP 503.

`AUTH_MODE=disabled` is the only implemented mode. There are no tenant, campaign,
wallet, payment, or voice HTTP routes. Production startup fails until an
authentication adapter is implemented. Future business routes must verify the
authentication identity and organization membership before calling the shared
database tenant-transaction helper. A client tenant header alone grants no access.

`WEB_ORIGIN` is one explicit browser origin, with no credential sharing. All
provider secrets remain server-only. See the root `.env.example` for future
provider and authentication settings; those integrations are deferred.

## Verification

`npm run test -w @india-voice/api` compiles the source and runs the Node test
runner against real Nest/Fastify request injection with controlled dependency
checks. It verifies startup, health/readiness behavior, shutdown, error redaction,
configuration rejection, and the absent tenant routes. Live PostgreSQL/Redis
verification is a separate root smoke/integration check.

Implementation references: [Nest testing](https://docs.nestjs.com/fundamentals/testing),
[node-postgres pools](https://node-postgres.com/apis/pool), and
[node-redis configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md).
