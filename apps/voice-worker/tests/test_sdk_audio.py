"""Offline integration tests using the real pinned LiveKit runtime.

LLM/TTS nodes and the audio device are deterministic in-memory doubles. These
tests do not contact LiveKit Cloud, Sarvam, or an LLM service. Resampling and
Silero inference use their real native implementations.
"""

from __future__ import annotations

import asyncio
import math
import time
from array import array

import pytest
from livekit import rtc
from livekit.agents import Agent, AgentSession, APIConnectionError, llm
from livekit.agents.voice import io
from livekit.plugins import silero


def pcm_frame(marker: int, *, sample_rate: int = 24000) -> rtc.AudioFrame:
    samples = sample_rate // 50  # Signed little-endian PCM16, mono, 20 ms.
    return rtc.AudioFrame(
        data=array("h", [marker] * samples).tobytes(),
        sample_rate=sample_rate,
        num_channels=1,
        samples_per_channel=samples,
    )


class MemoryOutput(io.AudioOutput):
    """A controllable device with an observable queued-audio buffer."""

    def __init__(self, *, block_capture: bool = False) -> None:
        super().__init__(
            label="offline-test-device",
            capabilities=io.AudioOutputCapabilities(pause=False),
            sample_rate=24000,
        )
        self.queued: list[int] = []
        self.accepted: list[int] = []
        self.clear_count = 0
        self.resume_count = 0
        self.capture_entered = asyncio.Event()
        self.frame_accepted = asyncio.Event()
        self.capture_gate = asyncio.Event()
        if not block_capture:
            self.capture_gate.set()
        self.play_immediately = False
        self.position = 0.0

    async def capture_frame(self, frame: rtc.AudioFrame) -> None:
        self.capture_entered.set()
        # Cancellation must cancel a pending device write as well as synthesis.
        await self.capture_gate.wait()
        await super().capture_frame(frame)
        marker = frame.data[0]
        self.accepted.append(marker)
        self.queued.append(marker)
        self.position += frame.duration
        self.on_playback_started(created_at=time.time())
        self.frame_accepted.set()

    def flush(self) -> None:
        super().flush()
        if self.play_immediately and self._pending_playback_count:
            self.queued.clear()
            self.on_playback_finished(playback_position=self.position, interrupted=False)
            self.position = 0.0

    def clear_buffer(self) -> None:
        self.clear_count += 1
        self.queued.clear()
        if self._pending_playback_count:
            self.on_playback_finished(playback_position=0.0, interrupted=True)
        self.position = 0.0

    def resume(self) -> None:
        self.resume_count += 1


class NoNetworkLLM(llm.LLM):
    """Registers an LLM capability; custom test nodes own all generation."""

    def chat(self, **kwargs):
        raise AssertionError("Tests must use the overridden llm_node")


class ControlledAgent(Agent):
    """Mock providers expose checkpoints and track generator finalization."""

    def __init__(self, *, stall: str = "audio", fail_llm: bool = False) -> None:
        super().__init__(instructions="Offline cancellation test.", llm=NoNetworkLLM())
        self.stall = stall
        self.fail_llm = fail_llm
        self.marker = 101
        self.finite = False
        self.llm_entered = asyncio.Event()
        self.tts_entered = asyncio.Event()
        self.llm_closed = asyncio.Event()
        self.tts_closed = asyncio.Event()
        self.provider_gate = asyncio.Event()
        self.exit_count = 0

    async def llm_node(self, chat_ctx, tools, model_settings):
        del chat_ctx, tools, model_settings
        self.llm_entered.set()
        try:
            if self.fail_llm:
                raise APIConnectionError("offline simulated LLM failure")
            if self.stall == "llm" and not self.finite:
                await self.provider_gate.wait()
            yield "A complete test sentence."
            if not self.finite:
                await self.provider_gate.wait()
                yield "Obsolete continuation must not play."
        finally:
            self.llm_closed.set()

    async def tts_node(self, text, model_settings):
        del model_settings
        try:
            async for _ in text:
                self.tts_entered.set()
                if self.stall == "tts" and not self.finite:
                    await self.provider_gate.wait()
                yield pcm_frame(self.marker)
                if not self.finite:
                    await self.provider_gate.wait()
                    yield pcm_frame(999)
        finally:
            self.tts_closed.set()

    async def on_exit(self) -> None:
        self.exit_count += 1


def offline_session(output: MemoryOutput) -> AgentSession:
    session = AgentSession(
        vad=None,
        turn_handling={
            "turn_detection": "manual",
            "interruption": {"resume_false_interruption": False},
        },
        aec_warmup_duration=0,
        user_away_timeout=None,
        tts_text_transforms=None,
    )
    session.output.audio = output
    return session


async def wait_event(event: asyncio.Event) -> None:
    await asyncio.wait_for(event.wait(), timeout=5)


@pytest.mark.asyncio
@pytest.mark.parametrize("checkpoint", ["llm", "tts", "capture", "audio"])
async def test_sdk_interrupt_cancels_each_pipeline_checkpoint_and_never_resumes(checkpoint):
    agent = ControlledAgent(stall=checkpoint)
    output = MemoryOutput(block_capture=checkpoint == "capture")
    session = offline_session(output)
    try:
        await session.start(agent=agent, record=False)
        old_speech = session.generate_reply(user_input="Begin the first response")
        checkpoint_event = {
            "llm": agent.llm_entered,
            "tts": agent.tts_entered,
            "capture": output.capture_entered,
            "audio": output.frame_accepted,
        }[checkpoint]
        await wait_event(checkpoint_event)
        await asyncio.wait_for(session.interrupt(force=True), timeout=5)
        await asyncio.wait_for(old_speech.wait_for_playout(), timeout=5)
        assert old_speech.interrupted
        await wait_event(agent.llm_closed)
        if checkpoint != "llm":
            await wait_event(agent.tts_closed)
        assert not output.queued
        if checkpoint == "audio":
            assert output.clear_count >= 1

        # Release every old provider/device gate after cancellation: old audio
        # must stay cancelled even when those operations could now complete.
        previous_frames = list(output.accepted)
        agent.provider_gate.set()
        output.capture_gate.set()
        await asyncio.sleep(0.05)
        assert output.accepted == previous_frames
        assert 999 not in output.accepted
        assert output.resume_count == 0

        agent.marker = 202
        agent.finite = True
        output.play_immediately = True
        new_speech = session.generate_reply(user_input="Now answer a new turn")
        await asyncio.wait_for(new_speech.wait_for_playout(), timeout=5)
        assert not new_speech.interrupted
        assert output.accepted[len(previous_frames):] == [202]
        assert not output.queued
    finally:
        await asyncio.wait_for(session.aclose(), timeout=5)
    assert agent.exit_count == 1


@pytest.mark.asyncio
async def test_sdk_shutdown_cancels_provider_generators_and_clears_queued_audio():
    agent = ControlledAgent()
    output = MemoryOutput()
    session = offline_session(output)
    await session.start(agent=agent, record=False)
    speech = session.generate_reply(user_input="Start a long response")
    await wait_event(output.frame_accepted)
    await asyncio.wait_for(session.aclose(), timeout=5)
    await wait_event(agent.llm_closed)
    await wait_event(agent.tts_closed)
    assert speech.interrupted
    assert output.clear_count >= 1
    assert not output.queued
    assert agent.exit_count == 1
    await asyncio.wait_for(session.aclose(), timeout=5)
    assert agent.exit_count == 1


@pytest.mark.asyncio
async def test_sdk_llm_failure_is_observable_and_a_later_response_can_succeed():
    agent = ControlledAgent(fail_llm=True)
    output = MemoryOutput()
    output.play_immediately = True
    session = offline_session(output)
    try:
        await session.start(agent=agent, record=False)
        failed = session.generate_reply(user_input="Trigger provider failure")
        await asyncio.wait_for(failed.wait_for_playout(), timeout=5)
        assert isinstance(failed.exception(), APIConnectionError)
        assert not output.accepted
        agent.fail_llm = False
        agent.finite = True
        recovered = session.generate_reply(user_input="Try a fresh turn")
        await asyncio.wait_for(recovered.wait_for_playout(), timeout=5)
        assert recovered.exception() is None
        assert output.accepted == [101]
    finally:
        await asyncio.wait_for(session.aclose(), timeout=5)


def test_native_resampler_converts_48khz_pcm16_mono_to_16khz_without_duration_drift():
    resampler = rtc.AudioResampler(input_rate=48000, output_rate=16000, num_channels=1)
    samples = array("h", (int(10000 * math.sin(2 * math.pi * 440 * i / 48000)) for i in range(48000)))
    frames = []
    for offset in range(0, 48000, 480):
        source = rtc.AudioFrame(
            data=samples[offset:offset + 480].tobytes(),
            sample_rate=48000, num_channels=1, samples_per_channel=480,
        )
        frames.extend(resampler.push(source))
    frames.extend(resampler.flush())
    assert frames
    assert all(frame.sample_rate == 16000 and frame.num_channels == 1 for frame in frames)
    assert abs(sum(frame.samples_per_channel for frame in frames) - 16000) <= 16
    assert all(len(frame.data) == frame.samples_per_channel for frame in frames)
    assert max(abs(value) for frame in frames for value in frame.data) > 9000


@pytest.mark.asyncio
async def test_real_silero_model_processes_silence_locally_and_closes():
    detector = silero.VAD.load(sample_rate=16000)
    stream = detector.stream()
    try:
        for _ in range(50):
            stream.push_frame(pcm_frame(0, sample_rate=16000))
        stream.end_input()

        async def consume():
            return [event async for event in stream]

        events = await asyncio.wait_for(consume(), timeout=30)
        inference = [event for event in events if event.type.name == "INFERENCE_DONE"]
        assert inference, "The real ONNX model must execute; this is not a mocked VAD test"
        assert all(event.probability < 0.5 for event in inference)
        assert not any(event.type.name == "START_OF_SPEECH" for event in events)
    finally:
        await asyncio.wait_for(stream.aclose(), timeout=5)
