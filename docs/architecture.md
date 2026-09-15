# Foundation architecture and data contract

## Approved responsibilities

The Next.js frontend talks to the NestJS API (Fastify). PostgreSQL is authoritative
for tenant and financial state. Redis is available for later BullMQ campaign jobs;
no queue handlers are implemented. The standalone Python LiveKit/Sarvam worker has
only a reserved directory. Simple responsive CSS implements the minimal shell;
Tailwind/shadcn can be adopted when the actual product workflows are built.

Node 22, current compatible Nest/Next packages and stable Drizzle releases were
selected using the official [Nest prerequisites](https://docs.nestjs.com/first-steps),
[Next installation guide](https://nextjs.org/docs/app/getting-started/installation),
and [Drizzle PostgreSQL guide](https://orm.drizzle.team/docs/get-started-postgresql),
then resolved and pinned through npm. Exact versions are in package manifests and
the root lockfile.

## Tenancy and trust

`organizations.id` is the tenant root. All seven owned tables have non-null
`organizationId` mapped to PostgreSQL `organization_id`. Composite foreign keys
include organization ID, and calls reference `(organization_id, campaign_id,
lead_id)` so the wrong campaign is rejected even within the same tenant.
Reservations and ledger entries also preserve wallet/call ownership through
composite keys. Deletions use `RESTRICT`, with no cascading loss of financial history.

All eight tables have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
Policies for `voice_app` use a transaction-local `app.organization_id` UUID.
Missing or empty context matches no rows; malformed UUID context fails closed.
`voice_migrator` owns DDL, has no BYPASSRLS, and is intentionally not covered by the
runtime policy. Provisioning organizations requires a separate trusted admin path;
only the synthetic test fixture currently uses one. See PostgreSQL's
[row-security behavior](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

The local PostgreSQL bootstrap superuser creates `voice_migrator` and `voice_app`.
Runtime grants omit DELETE/TRUNCATE and allow ledger SELECT/INSERT only. The role
cannot create tables or assume the owner role. No `SECURITY DEFINER` billing
functions or provider write APIs exist. Trigger functions run with caller rights.
Changing a tenant context is possible for a holder of the runtime credential;
authentication, query parameterization, and credential protection remain essential.

All tenant operations must use `withTenantTransaction` after authenticating a
caller and verifying organization membership. Tokens, signed webhooks, queue jobs
and future AI tools require their own server authorization. The scaffold offers
only public health/readiness routes and no route accepting tenant identity.

## Eight-table model

| Table | Contract |
| --- | --- |
| organizations | Tenant name, slug, lifecycle, defaults, closure and audit dates |
| users | Organization membership, issuer/subject identity, role/status and email |
| wallets | One INR wallet per tenant; posted/reserved bigint paise; monotonic version |
| wallet_transactions | Append-only reason/direction entries, immutable balance snapshots, provider/call identity and idempotency |
| wallet_reservations | One fixed authorization per call, rate/quantum/duration snapshots, terminal accounting and reconciliation evidence |
| campaigns | Goals/persona/script, language/voice, capture/retry/calling settings, concurrency and billing defaults |
| leads | Campaign-owned E.164 contact, source/idempotency, separate voice/WhatsApp consent, qualification and retry schedule |
| call_logs | Attempt/provider identity, authoritative duration evidence, immutable billing snapshots, settlement, transcript/recording references and analysis |

Provider event and payment identity uniqueness is global to
`(provider, provider_account_id, event_or_payment_id)` because a shared provider
account must not credit the same payment to two organizations. Tenant idempotency
keys are unique per organization. Call charges are unique per organization/call.
Provider call IDs are unique per provider/account. Queue, CRM, history and
reconciliation indexes are defined in the schema.

## Money and fixed reservations

Amounts use PostgreSQL BIGINT mapped to JavaScript bigint. Parse HTTP amounts as
nonnegative decimal strings with `parsePaise`; serialize with
`JSON.stringify(value, serializeBigInts)`. Never convert rupees or paise through
JavaScript floating-point numbers. Duration/rate multiplication in SQL uses exact
`numeric` arithmetic where an intermediate bigint could overflow.

Available funds = posted balance minus reserved funds. Database checks reject
negative amounts and reserved funds exceeding posted funds. Wallet version and
updated timestamps advance on updates. These per-row rules **do not enforce the
sum of reservations/ledger against the wallet**; later services must lock the
wallet and change all relevant rows in one transaction.

For connected duration `d > 0`, quantum `q` (30 or 60 seconds), and rate `r` paise
per minute, charge is `ceil(d/q) * q * r / 60`. Zero duration charges zero. A
30-second quantum requires an even integer rate, avoiding fractional paise.
Fixed reservation amount covers the snapshotted maximum connected duration plus
termination margin, rounded to the billing quantum, and at least one minute.
No metered extensions are implemented; authorization snapshots are immutable.
Campaign edits never modify existing call/reservation snapshots.

### Reservation lifecycle

```text
active -> awaiting_settlement -> settled
                             -> released
                             -> expired
```

- New reservations start active. Active/awaiting rows have zero settled/released
  amounts. Both states retain the entire hold.
- A terminal transition requires a finished call and verified authoritative
  duration evidence. A connected call that failed still needs settlement.
- Settled amount equals the exact charge from that evidence. Settled plus released
  amounts equal the authorization. Unused funds have an explicit release timestamp.
- Released and expired mean zero connected duration and full release. Expired also
  requires an elapsed expiry time, reconciliation request/completion times and a
  reference. A timer never automatically releases a hold.
- Terminal reservations cannot be changed, reopened or deleted. Verified call
  duration and completed settlement accounting cannot be edited. Ledger update,
  delete and truncate are guarded with permissions and triggers.
- A call-charge ledger entry must reference a settled reservation with the same
  charge amount. A never-connected zero charge has no zero-value ledger entry;
  call and reservation records preserve its audit history.

Timestamps labeled verified are **evidence fields**, not cryptographic verification
performed by a database. Later services must verify Razorpay signatures/success and
authoritative telephony CDRs. Duplicate-event constraints do not implement provider
webhook processing. No full aggregate accounting, concurrency reservation engine,
campaign pause notification, or reconciliation worker is claimed here.

## Structured fields and storage

Runtime Zod schemas validate captured field types/unique keys, choices, calling
windows/timezones, retry delays, separate voice/WhatsApp consent, timestamped
transcripts, and score/classification/summary/objection analysis. JSONB SQL checks
enforce outer object/array shapes only. Every later API, worker and model-output
adapter must call the exported runtime schemas before persisting nested data.

Recordings/transcripts use private object keys, never public URLs. A recording key
requires the recording-consent flag. Actual consent capture, encryption, retention,
and short-lived authorized S3 access remain unimplemented. No provider credentials
or admin database URL are exposed through frontend public environment variables.

## Deferred integrations and acceptance

`.env.example` lists the future LiveKit, Sarvam, Exotel, Razorpay, Meta WhatsApp,
S3 and replaceable LLM credentials without invented external secrets. Their API
interfaces and telephony registrations need current provider verification when
implemented. The prototype's latency definition includes endpointing, all network
and media legs, and actual playback at the caller endpoint, with languages/load
stated and tool-dependent turns reported separately. No voice benchmark ran in
this phase.
