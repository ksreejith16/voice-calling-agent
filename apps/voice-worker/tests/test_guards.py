import asyncio

import pytest

from india_voice.guards import GenerationGate, StreamLimitError, guarded_stream


def wrap(stream, gate, **kwargs):
    return guarded_stream(stream, gate=gate, epoch=gate.epoch, idle_timeout=0.1,
                          total_timeout=1, maximum=10, cost=len, **kwargs)


async def test_interruption_result_race_never_forwards_stale_chunk():
    gate = GenerationGate()
    closed = asyncio.Event()

    async def provider():
        try:
            yield "first"
            gate.invalidate()  # caller speech arrives just as the next provider chunk does
            yield "stale"
        finally:
            closed.set()

    assert [chunk async for chunk in wrap(provider(), gate)] == ["first"]
    assert closed.is_set()


async def test_cancelled_generation_closes_stream_and_propagates_cancellation():
    gate = GenerationGate()
    entered, closed = asyncio.Event(), asyncio.Event()

    async def provider():
        try:
            entered.set()
            await asyncio.Event().wait()
            yield "obsolete"
        finally:
            closed.set()

    async def consume():
        return [item async for item in wrap(provider(), gate)]

    task = asyncio.create_task(consume())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()


async def test_timeout_closes_provider_without_retry():
    closed = asyncio.Event()

    async def provider():
        try:
            await asyncio.Event().wait()
            yield "late"
        finally:
            closed.set()

    with pytest.raises(TimeoutError):
        _ = [item async for item in wrap(provider(), GenerationGate())]
    assert closed.is_set()


async def test_budget_and_provider_errors_close_generator():
    closed = []

    async def provider():
        try:
            yield "12345678"
            yield "overflow"
        finally:
            closed.append(True)

    with pytest.raises(StreamLimitError):
        _ = [item async for item in wrap(provider(), GenerationGate())]
    assert closed == [True]


async def test_no_prefetch_and_first_chunk_callback_once():
    pulled, first = [], []

    async def provider():
        for value in ["a", "b", "c"]:
            pulled.append(value)
            yield value

    stream = wrap(provider(), GenerationGate(), on_first=lambda: first.append(True))
    assert await anext(stream) == "a"
    await asyncio.sleep(0)
    assert pulled == ["a"]  # downstream demand supplies backpressure
    assert [value async for value in stream] == ["b", "c"]
    assert first == [True]


async def test_closed_session_never_resumes_old_or_new_generation():
    gate = GenerationGate()
    gate.close()

    async def provider():
        yield "never"

    assert [value async for value in wrap(provider(), gate)] == []
