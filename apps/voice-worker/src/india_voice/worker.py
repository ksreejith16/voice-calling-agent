"""India Voice Platform: standalone LiveKit voice worker.

Wire together: browser mic → LiveKit room → Silero VAD + Sarvam Saaras STT
→ configurable LLM → Sarvam Bulbul TTS → LiveKit room → browser speaker.

Loaded via the `india-voice-worker` console entry point declared in pyproject.toml.
All provider credentials come from the validated Settings; none are hardcoded here.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import openai as oai_plugin
from livekit.plugins import sarvam, silero

from india_voice.config import ConfigurationError, Settings
from india_voice.telemetry import Recorder

LOGGER = logging.getLogger("india_voice.worker")


class IndiaVoiceAgent(Agent):
    """Conversational agent using the configured OpenAI-compatible LLM."""

    def __init__(self, settings: Settings) -> None:
        model_options = {}
        if (urlsplit(settings.llm_base_url).hostname == "api.groq.com"
                and settings.llm_model in {"openai/gpt-oss-20b", "openai/gpt-oss-120b"}):
            # Groq GPT-OSS uses include_reasoning, not reasoning_format. Keep
            # reasoning out of speech and leave token room for the final answer.
            model_options = {"reasoning_effort": "low", "extra_body": {"include_reasoning": False}}
        super().__init__(
            instructions=settings.instructions(),
            llm=oai_plugin.LLM(
                model=settings.llm_model,
                api_key=settings.llm_api_key.get_secret_value(),
                base_url=settings.llm_base_url,
                # Enforce provider timeout so a slow LLM cannot stall the pipeline.
                timeout=httpx.Timeout(settings.voice_provider_timeout_seconds),
                # Provider completion tokens include reasoning; a character-based
                # estimate can exhaust the budget before any spoken answer.
                max_completion_tokens=settings.llm_max_completion_tokens,
                **model_options,
            ),
        )


async def entrypoint(ctx: JobContext) -> None:
    """Per-session entrypoint.

    Defined at module level so the SDK can pickle it for process-based job
    execution on Linux/macOS. Closures returned by a factory cannot be pickled
    and will fail under the default multiprocessing executor on those platforms.
    Windows uses threads (the installed SDK default), so the closure would have
    worked there, but this form is portable.
    """
    settings = Settings.from_env()

    metrics_dir = Path(settings.voice_metrics_directory)
    recorder = Recorder(metrics_dir / f"session-{uuid.uuid4().hex}.jsonl")

    async def _on_shutdown() -> None:
        recorder.close()

    ctx.add_shutdown_callback(_on_shutdown)

    await ctx.connect()

    session = AgentSession(
        # Silero VAD: pass the configured silence threshold explicitly.
        # The SDK default is 550 ms; this application is configured for 180 ms.
        vad=silero.VAD.load(
            sample_rate=16000,
            min_silence_duration=settings.voice_endpoint_silence_ms / 1000.0,
        ),
        # Sarvam realtime STT — must use STTRealtime, not the legacy STT class.
        stt=sarvam.STTRealtime(
            language=settings.sarvam_stt_language,
            stream_type=settings.sarvam_stt_stream_type,
            mode=settings.sarvam_stt_mode,
            api_key=settings.sarvam_api_key.get_secret_value(),
        ),
        # Sarvam streaming TTS — bulbul:v3 with the configured voice.
        tts=sarvam.TTS(
            model="bulbul:v3",
            target_language_code=settings.sarvam_tts_language,
            speaker=settings.sarvam_tts_speaker,
            pace=settings.sarvam_tts_pace,
            temperature=settings.sarvam_tts_temperature,
            api_key=settings.sarvam_api_key.get_secret_value(),
        ),
        # The SDK's 3-second AEC warm-up suppresses audio-triggered interruptions.
        # Set to 0: browser WebRTC has its own echo cancellation; we do not need it.
        aec_warmup_duration=0,
        turn_handling={
            # Use VAD-based turn detection driven by the Silero instance above.
            "turn_detection": "vad",
            "endpointing": {
                # Minimum silence before committing the user's turn (from config).
                "min_delay": settings.voice_endpoint_silence_ms / 1000.0,
                # Hard ceiling on silence wait; prevents indefinitely open turns.
                "max_delay": min(settings.voice_turn_timeout_seconds, 10.0),
            },
            # Bound the maximum wall-clock duration of a single user utterance.
            "user_turn_limit": {
                "max_duration": settings.voice_max_input_seconds,
            },
            "interruption": {
                "enabled": True,
                # Use VAD for interruption detection, not the ML adaptive detector.
                # The adaptive detector adds latency and is not required here.
                "mode": "vad",
                # Never resume a cancelled generation — old audio must stay cancelled.
                "resume_false_interruption": False,
                "min_duration": settings.voice_interruption_ms / 1000.0,
            },
        },
    )

    @session.on("metrics_collected")
    def _on_metrics(event) -> None:
        recorder.on_metrics(event.metrics)

    @session.on("conversation_item_added")
    def _on_item(event) -> None:
        recorder.on_conversation_item(event.item)

    async def _enforce_session_ttl() -> None:
        await asyncio.sleep(settings.voice_session_seconds)
        LOGGER.info("Session TTL reached (%ds); closing.", settings.voice_session_seconds)
        await session.aclose()

    # Task outlives entrypoint() — asyncio tasks are not cancelled when the
    # creating coroutine returns. aclose() on an already-closed session is a no-op.
    asyncio.create_task(_enforce_session_ttl(), name="session-ttl")

    await session.start(agent=IndiaVoiceAgent(settings), room=ctx.room)


def main() -> None:
    """Console entry point: validate config then start the LiveKit worker."""
    try:
        settings = Settings.from_env()
    except ConfigurationError as exc:
        logging.basicConfig()
        LOGGER.error("Voice worker configuration error: %s", exc)
        raise SystemExit(1) from None

    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=settings.voice_agent_name,
            ws_url=settings.livekit_url,
            api_key=settings.livekit_api_key.get_secret_value(),
            api_secret=settings.livekit_api_secret.get_secret_value(),
        )
    )


if __name__ == "__main__":
    main()
