# India Voice — Python LiveKit Voice Worker

Standalone Python service that handles live voice conversations via LiveKit.
Connects browser microphone audio to Sarvam Saaras Realtime STT → a configurable
OpenAI-compatible LLM → Sarvam Bulbul v3 TTS → browser speaker.

## What is implemented (Deliverable 3)

- `src/india_voice/worker.py` — LiveKit Agents entry point (`india-voice-worker`)
- `src/india_voice/config.py` — validated provider settings
- `src/india_voice/guards.py` — epoch-based interruption and stream guards
- `src/india_voice/telemetry.py` — JSONL timing recorder and percentile reporter
- `src/india_voice/browser.py` — local test harness (`india-voice-browser`)
- `browser/` — browser test page loaded by the harness

## What is not yet implemented

- Exotel SIP/PSTN telephony integration
- Production load or concurrency testing
- Measured caller-perceived p95 latency (current profile: `unmeasured`)
- Non-browser/telephone audio format handling
- Live language quality evaluation for Telugu/Hindi/Tenglish

## Setup

**Prerequisites:** Python 3.11–3.14 (3.12 confirmed working), the LiveKit local
infrastructure running (`npm run infra:up` from the repo root).

### 1. Install the Python package

From the repo root, run once (or after changing `pyproject.toml`):

```powershell
apps\voice-worker\.venv\Scripts\python.exe -m pip install -e "apps/voice-worker[dev]"
```

If the virtual environment does not exist yet:

```powershell
python -m venv apps\voice-worker\.venv
apps\voice-worker\.venv\Scripts\python.exe -m pip install --upgrade pip
apps\voice-worker\.venv\Scripts\python.exe -m pip install -e "apps/voice-worker[dev]"
```

### 2. Configure local environment

Add the following to your local `.env` file (copy from `.env.example`):

```
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret-which-must-be-at-least-32-chars

SARVAM_API_KEY=your-sarvam-key-here

LLM_BASE_URL=https://your-llm-endpoint
LLM_API_KEY=your-llm-key
LLM_MODEL=your-model-name
```

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` must match what is
configured in `infra/compose.yaml` for the local LiveKit server.

The browser harness only needs the LiveKit variables. A complete voice conversation
also requires the Sarvam and LLM credentials.

### 3. Start the infrastructure

```powershell
npm.cmd run infra:up
```

This starts PostgreSQL, Redis, and the local LiveKit server via Docker Compose.

### 4. Start the voice worker

```powershell
apps\voice-worker\.venv\Scripts\india-voice-worker start
```

The worker connects to the LiveKit server and waits for dispatch.
If configuration is missing, it reports the missing variable names without values.

### 5. Start the browser harness

In a separate terminal:

```powershell
apps\voice-worker\.venv\Scripts\india-voice-browser
```

### 6. Open the test page

Open `http://127.0.0.1:8765` in a browser. Click **Start voice test**, allow
microphone access, and speak. The agent should respond with audio and show a
transcript.

### 7. Generate a timing report

After a session, timing data is written to the `VOICE_METRICS_DIRECTORY`
(default: `.local/voice-metrics/`):

```powershell
apps\voice-worker\.venv\Scripts\india-voice-report .local\voice-metrics\session-<id>.jsonl
```

Reports separate internal stage timings from any externally measured caller samples.
Caller-perceived latency is currently `unmeasured`; see `telemetry.py` for how to
submit acoustic measurements.

### 8. Shut down

Press Ctrl-C in the worker terminal, then Ctrl-C in the harness terminal.

```powershell
npm.cmd run infra:down
```

## Offline tests

These tests do not contact any external service:

```powershell
# Python suite (63 passed, 0 failed expected)
apps\voice-worker\.venv\Scripts\python.exe -m pytest -c apps\voice-worker\pyproject.toml apps\voice-worker\tests -q

# Browser JavaScript suite (6 passed, 0 failed expected)
node --test apps\voice-worker\browser\app.test.cjs

# Linting (0 errors expected)
apps\voice-worker\.venv\Scripts\python.exe -m ruff check apps\voice-worker\src apps\voice-worker\tests

# Dependency consistency
apps\voice-worker\.venv\Scripts\python.exe -m pip check
```

Or run all suites including the foundation:

```powershell
npm.cmd run verify
```

## Live provider tests

Live tests require Sarvam and LLM credentials in `.env` and are not run by default.
Mark tests with `@pytest.mark.live` and opt in with `-m live`. A complete browser
conversation is the primary live verification path.

## Latency target

The agreed acceptance target is p95 under 500 ms from the caller's actual end of
speech to the first meaningful audible agent response at the caller endpoint, measured
acoustically (not from server-side logs alone). This target has not been demonstrated.
Measure with the language, network conditions, region, and concurrency documented.

## Review boundary

Stop for review after Deliverable 3 is complete. Do not proceed to Phase 2
(authentication, billing, campaign execution) without explicit approval.
