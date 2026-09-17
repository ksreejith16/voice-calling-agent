"""Small generation guards independent of provider SDK internals."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import TypeVar

T = TypeVar("T")


class StreamLimitError(RuntimeError):
    """Terminate a turn instead of letting an upstream provider grow without limit."""


@dataclass
class GenerationGate:
    epoch: int = 0
    closed: bool = False

    def invalidate(self) -> None:
        self.epoch += 1

    def valid(self, epoch: int) -> bool:
        return not self.closed and self.epoch == epoch

    def close(self) -> None:
        self.closed = True
        self.invalidate()


async def guarded_stream(
    stream: AsyncIterator[T], *, gate: GenerationGate, epoch: int,
    idle_timeout: float, total_timeout: float, maximum: float,
    cost: Callable[[T], float], on_first: Callable[[], None] | None = None,
) -> AsyncIterator[T]:
    """Pull-based forwarding, with no additional queue, bounded work and cleanup.

    Check epoch after awaited reads, too: cancellation can race a provider result.
    CancelledError always propagates. A failed/obsolete turn is never retried here.
    """
    used = 0.0
    first = True
    try:
        async with asyncio.timeout(total_timeout):
            while gate.valid(epoch):
                try:
                    async with asyncio.timeout(idle_timeout):
                        item = await anext(stream)
                except StopAsyncIteration:
                    return
                if not gate.valid(epoch):
                    return
                used += cost(item)
                if used > maximum:
                    raise StreamLimitError("Configured generation budget exceeded")
                if first:
                    first = False
                    if on_first:
                        on_first()
                yield item
    finally:
        close = getattr(stream, "aclose", None)
        if close is not None:
            with suppress(Exception):
                async with asyncio.timeout(2):
                    await close()
