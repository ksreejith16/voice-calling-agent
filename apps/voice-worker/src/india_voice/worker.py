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

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import openai as oai_plugin
from livekit.plugins import sarvam, silero

from india_voice.config import ConfigurationError, Settings
from india_voice.telemetry import Recorder

LOGGER = logging.getLogger("india_voice.worker")


class IndiaVoiceAgent(Agent):
    """Conversational agent using the configured OpenAI-compatible LLM."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(
            instructions=settings.instructions(),
            llm=oai_plugin.LLM(
                model=settings.llm_model,
                api_key=settings.llm_api_key.get_secret_value(),
                base_url=settings.llm_base_url,
            ),
        )


def _make_entrypoint(settings: Settings):
    """Return a per-job entrypoint bound to validated settings.

    Using a factory keeps settings validated once in main() and avoids
    re-reading environment variables on every dispatch.
    """

    async def entrypoint(ctx: JobContext) -> None:
        metrics_dir = Path(settings.voice_metrics_directory)
        recorder = Recorder(metrics_dir / f"session-{uuid.uuid4().hex}.jsonl")

        # Register cleanup to run when the LiveKit job ends.
        async def _on_shutdown() -> None:
            recorder.close()

        ctx.add_shutdown_callback(_on_shutdown)

        await ctx.connect()

        session = AgentSession(
            # Silero VAD runs locally via ONNX at 16 kHz; the SDK resamples
            # browser WebRTC audio (48 kHz) to the required 16 kHz input rate.
            vad=silero.VAD.load(sample_rate=16000),
            # Sarvam realtime STT — must use STTRealtime, not the legacy STT.
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
            turn_handling={
                # min_delay is the silence window before committing an utterance.
                "endpointing": {
                    "min_delay": settings.voice_endpoint_silence_ms / 1000.0,
                },
                # Disable false-interruption resumption: once the old generation
                # is cancelled, its audio must never resume (guards.py epoch check).
                "interruption": {
                    "enabled": True,
                    "resume_false_interruption": False,
                    "min_duration": settings.voice_interruption_ms / 1000.0,
                },
            },
        )

        # Wire internal timing events to the JSONL recorder.
        @session.on("metrics_collected")
        def _on_metrics(event) -> None:
            recorder.on_metrics(event.metrics)

        @session.on("conversation_item_added")
        def _on_item(event) -> None:
            recorder.on_conversation_item(event.item)

        async def _enforce_session_ttl() -> None:
            """Close the session after the configured maximum duration."""
            await asyncio.sleep(settings.voice_session_seconds)
            LOGGER.info(
                "Session TTL reached (%ds); closing.", settings.voice_session_seconds
            )
            await session.aclose()

        # The TTL task outlives entrypoint() — asyncio tasks are not cancelled
        # when the creating coroutine returns. The shutdown callback above
        # handles recorder cleanup; aclose() on a finished session is a no-op.
        asyncio.create_task(_enforce_session_ttl(), name="session-ttl")

        await session.start(agent=IndiaVoiceAgent(settings), room=ctx.room)

    return entrypoint


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
            entrypoint_fnc=_make_entrypoint(settings),
            agent_name=settings.voice_agent_name,
            ws_url=settings.livekit_url,
            api_key=settings.livekit_api_key.get_secret_value(),
            api_secret=settings.livekit_api_secret.get_secret_value(),
        )
    )


if __name__ == "__main__":
    main()
