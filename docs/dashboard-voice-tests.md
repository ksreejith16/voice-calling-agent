# Dashboard agent voice tests

## What is available

Open `http://localhost:3000/dashboard/agents`, then **Edit / Test voice** on an
agent. You can edit, save, archive, and start a browser conversation using that
agent's saved language, voice, instructions, and opening message. Unsaved changes
must be saved before testing. The LLM model and credentials stay server-configured.

The page provides start/end, microphone mute, audio unlock, connection status,
live transcripts, and the most recent 20 session outcomes. Transcripts stay in
browser memory; they are not saved as customer call records. API-created snapshots
and session outcomes are stored in PostgreSQL with forced tenant RLS. Snapshots
contain business instructions; treat database backups as private business data.

## Start on Windows

Docker Desktop must be running. From the repository root:

```powershell
npm.cmd ci
npm.cmd run dev:platform
```

This starts containers, applies migrations, builds the database package, and runs
the API, website, and Python worker together. The worker virtual environment must
already exist; see `apps/voice-worker/README.md`. Stop any older API/web/worker
processes before using this command to avoid occupied ports or mixed worker code.
The old browser harness on port 8765 is optional and does not use saved agents.

Root `.env` needs the existing Clerk, database, Sarvam, LLM, and LiveKit settings,
plus:

```dotenv
VOICE_TEST_ENABLED=true
VOICE_API_URL=http://127.0.0.1:3001
```

The first setting is enabled locally and defaults to false in `.env.example`.
Unbilled browser tests are blocked when the API runs with NODE_ENV=production.
A production web build can still be generated; it does not launch the API.
The worker and API must share LIVEKIT_API_SECRET and VOICE_AGENT_NAME.
No new external service account is required for this milestone.

## Security and lifecycle

- Clerk authentication derives the organization; callers cannot submit tenant IDs
  or room names to start/end APIs. Agent lookup and session queries use tenant RLS.
- Viewers cannot modify agents or start tests. Only the session creator and
  organization owner/admin can explicitly end a session.
- Strict agent validation bounds instruction length, opening text, language, and
  the supported voice allowlist. The worker validates dispatch snapshots again.
- Two concurrent tests per organization, a ten-minute session cap, microphone-only
  browser publishing, no browser metadata updates/data publishing, and two-minute
  join tokens. The cap is not a production spending-control system.
- Server-owned timers remove expired rooms. Ending a session schedules repeated
  deletion through the join-token window. The UI disconnects microphone/playback
  immediately; it does not claim confirmed server deletion.
- On API startup and during periodic recovery, dashboard rooms are matched to their tenant-scoped database
  records before recovering expiration timers. Worker TTL is an independent limit.
- Worker callbacks use timestamped HMAC signatures and bounded fields. The API
  preserves terminal outcomes against late active/ended callbacks. Callback
  failures are retried, then logged without credentials or conversation text.
- SDK VAD interruption handling remains enabled and false-interruption resume is
  disabled. Browser generation guards ignore events from obsolete sessions.
- Provider connection timeout uses VOICE_PROVIDER_TIMEOUT_SECONDS with two retries.
  The worker cancels background tasks and closes the session on shutdown.

## Manual acceptance checklist (not yet executed)

1. Sign in, create two agents with distinct instructions and opening messages.
2. Save the first, start a test, allow the microphone, and click Enable audio if
   browser autoplay is blocked. Confirm its opening message and behavior.
3. End the test. Confirm microphone use stops and the history updates.
4. Start the second agent and verify its different instructions are used.
5. Try Telugu, Hindi, English, and Telugu-English code-switching.
6. Interrupt a long answer; discarded speech must not resume.
7. End while connecting, navigate away during startup, then start another test.
   Check there is no old playback, duplicate transcript, or active microphone.
8. Briefly interrupt the network and verify a useful reconnect/failure state.
9. Stop the worker before starting: the test should fail with worker-unavailable
   after the readiness window. Restore it and try again.
10. Verify a provider failure produces a useful error and a failed session outcome.
11. Repeat with a viewer and another organization: cross-tenant access must fail;
    viewers must not start, edit, or archive. These security paths need automated
    coverage before release, which was not run at the user's request.
12. Restart the API during an active test and verify recovered expiration cleanup.

## Timing and limits

Existing content-free SDK timing records are written to
`.local/voice-metrics/session-<session-id>.jsonl` for dashboard tests. They include
endpointing, STT, LLM, TTS and conversation playback-related metrics when the SDK
emits them. These overlap and must not be summed as caller latency. Browser
connection/transcript events do not establish when a reply became audible.
The caller-perceived p95 under 500 ms acceptance target remains unmeasured.

Remaining work includes automated cancellation/race/security/failure tests,
verified audible latency and language quality, durable reconciliation when both
API and worker fail, daily spend limits, and production hardening. If callbacks
are lost and the room has already disappeared, history can remain nonterminal;
the UI labels elapsed sessions as expired pending reconciliation.

Wallets, reservations, payment processing, billable call logs, campaign execution,
PSTN, WhatsApp, recordings, and bookings are unchanged. Browser tests can incur
provider charges but do not debit the platform wallet. This feature is not a
production prepaid-exposure guarantee.

## Documentation used

- https://docs.livekit.io/agents/server/agent-dispatch/
- https://docs.livekit.io/reference/server-sdk-js/classes/AgentDispatchClient.html
- https://docs.livekit.io/reference/agents/events/
- https://docs.livekit.io/agents/server/job/

SDK signatures were also inspected in installed LiveKit packages. The Node server
SDK is pinned to 2.19.0 and the browser SDK to 2.17.0.

## Actual verification for this implementation

- Migration 0004 applied successfully to the local development database.
- Database package build: passed.
- API build: passed, including final recovery changes.
- Web typecheck: passed, including final browser cleanup changes.
- Web production build: passed; includes the agent detail and workspace API routes.
- Running sign-in page: HTTP 200.
- Running API readiness: HTTP 200, PostgreSQL and Redis up.
- Updated Python worker: started and registered with local LiveKit.
- Automated tests: not run, as requested.
- Authenticated saved-agent conversation, interruptions, provider failures, tenant
  isolation, and restart races: not exercised live in this implementation run.
  The manual checklist above is pending; startup is not evidence these paths pass.
