# Local Clerk dashboard setup

The API and website both load the repository root `.env`. Keep existing database
and voice credentials. Use the publishable and secret keys from the same Clerk
development application; never commit them or put the secret in a `NEXT_PUBLIC_`
variable.

```dotenv
AUTH_MODE=clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_LOCALLY
CLERK_SECRET_KEY=sk_test_REPLACE_LOCALLY
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/onboarding
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding
```

Start Docker Desktop, then run these commands from the repository root:

```powershell
npm.cmd ci
npm.cmd run infra:up
npm.cmd run db:migrate
npm.cmd run dev
```

Open http://localhost:3000/sign-in. Create an account if needed, enter your
business name on the onboarding page, and open the dashboard. Restart development
processes after changing `.env`. The standalone Python voice worker and its test
page have separate startup commands in `apps/voice-worker/README.md`.

Use `localhost` for the website. Its dev/start scripts bind to that hostname so
Next.js URL normalization and Clerk's same-page rewrite use the same origin.
Binding as `127.0.0.1` caused a self-proxy loop and HTTP 500 with these installed
SDK versions. The Clerk entry point uses Next.js 16's `proxy.ts` convention.

## Onboarding migration repair

Migration 0002 originally had a timestamp earlier than 0001, so Drizzle skipped it
on an existing foundation database. Its journal timestamp now follows 0001. The
local database was inspected before this correction: only 0000 and 0001 had been
applied, and `agent_configs` did not exist. If another installation already applied
0002 with the old timestamp, reconcile its migration history before upgrading;
do not blindly reapply the table creation or drop existing data.

Migration 0003 adds explicit SELECT/INSERT policies for the migration owner on
organizations, users, and wallets so the auth helpers work under forced RLS.
It does not grant the runtime role migration-role membership or BYPASSRLS.
It also fixes the helpers' search path, serializes onboarding to avoid concurrent
workspace/slug creation races, and returns the exact existing identity's user ID.
The API must verify JWTs before passing issuer and subject to these helpers.
Database credentials remain trusted server credentials, not end-user credentials.

Automated tests were intentionally not run during this setup. Applying migrations
and starting servers does not establish successful sign-in or onboarding; complete
that browser flow manually with your Clerk account.
