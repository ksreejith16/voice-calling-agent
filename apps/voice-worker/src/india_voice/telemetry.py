"""Private-content-free diagnostic events and honest latency reports.

SDK durations are seconds at server/provider boundaries. They are NOT the caller's
audible response time. In particular EOU already includes transcription delay, and
streaming STT request duration is zero. Never sum these overlapping measurements.

Use one Recorder per session and a separate output file per worker process. The
lock protects complete JSONL writes/flushes by threads sharing that Recorder.
No LiveKit or provider package is needed to read a report.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import re
import threading
import time
import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any, TextIO

LOGGER = logging.getLogger(__name__)
CALLER_MEASUREMENT = "caller_end_of_speech_to_first_meaningful_audible_response"
MAX_LINE_CHARACTERS = 16_384
DEFAULT_MAX_SAMPLES = 100_000

_TOKEN = re.compile(r"[A-Za-z0-9_.:/-]{1,128}\Z")
_EVENT = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")
_PROFILE = re.compile(r"[\w .,:()/+%\-]{1,256}\Z", re.UNICODE)
_STRINGS = {
    "speech_id", "request_id", "segment_id", "item_id", "metric_type",
    "old_state", "new_state", "state", "source", "role", "language",
    "model_name", "model_provider", "measurement", "scope",
}
_BOOLEANS = {
    "cancelled", "interrupted", "failed", "streamed", "is_final", "resumed",
    "user_initiated", "tool_dependent", "connection_reused",
}
_NUMBERS = {
    "duration", "ttft", "ttfb", "audio_duration", "acquire_time",
    "end_of_utterance_delay", "transcription_delay", "on_user_turn_completed_delay",
    "idle_time", "inference_duration_total", "inference_count", "completion_tokens",
    "prompt_tokens", "prompt_cached_tokens", "cache_creation_tokens", "total_tokens",
    "input_tokens", "output_tokens", "tokens_per_second", "characters_count",
    "total_duration", "prediction_duration", "detection_delay", "num_interruptions",
    "num_backchannels", "num_requests", "provider_timestamp_s", "created_at",
    "latency_ms", "playback_position", "speech_duration", "duration_ms",
    "end_of_turn_delay", "llm_node_ttft", "tts_node_ttfb", "playback_latency",
    "e2e_latency", "started_speaking_at", "stopped_speaking_at",
}
_SDK_TYPES = {
    "eou_metrics", "llm_metrics", "tts_metrics", "stt_metrics", "vad_metrics",
    "interruption_metrics", "eot_inference_metrics",
}
_SDK_INCLUDE = _STRINGS | _BOOLEANS | _NUMBERS | {"type", "timestamp", "metadata", "error"}

# Name -> SDK field. All values are reported separately; no aggregate is derived.
_LATENCIES = {
    "eou_metrics": {
        "endpointing_delay": "end_of_utterance_delay",
        "transcription_delay": "transcription_delay",
        "on_user_turn_completed_delay": "on_user_turn_completed_delay",
    },
    "llm_metrics": {"llm_ttft": "ttft", "llm_generation_duration": "duration"},
    "tts_metrics": {"tts_ttfb": "ttfb", "tts_generation_duration": "duration"},
    "stt_metrics": {"stt_nonstreaming_request_duration": "duration"},
    "interruption_metrics": {"interruption_detection_delay": "detection_delay"},
    "eot_inference_metrics": {"eot_detection_delay": "detection_delay"},
}
_MESSAGE_LATENCIES = {
    "user": {
        "turn_endpointing_delay": "end_of_turn_delay",
        "turn_transcription_delay": "transcription_delay",
        "turn_on_user_turn_completed_delay": "on_user_turn_completed_delay",
    },
    "assistant": {
        "turn_llm_ttft": "llm_node_ttft",
        "turn_tts_ttfb": "tts_node_ttfb",
        "turn_playback_latency": "playback_latency",
        "turn_e2e_latency": "e2e_latency",
    },
}
_MESSAGE_INCLUDE = {"type", "id", "role", "interrupted", "metrics"}


def _number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _profile(value: Any) -> dict[str, str] | None:
    if not isinstance(value, Mapping):
        return None
    result: dict[str, str] = {}
    for field in ("language", "network", "load"):
        item = value.get(field)
        if not isinstance(item, str) or not item.strip() or not _PROFILE.fullmatch(item):
            return None
        result[field] = item.strip()
    return result


def _safe_fields(fields: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in fields.items():
        if key in _STRINGS and isinstance(value, str) and _TOKEN.fullmatch(value):
            result[key] = value
        elif key in _BOOLEANS and type(value) is bool:
            result[key] = value
        elif key in _NUMBERS and _number(value):
            result[key] = value
        elif key == "profile" and (profile := _profile(value)) is not None:
            result[key] = profile
    return result


class Recorder:
    """Write allowlisted fields only; never serialize entire event/chat objects.

    record() returns the sanitized row for adapters/tests. With no output_path,
    rows are sent to the application logger. File output is appended and flushed
    after every complete line; no event history is retained in memory.
    """

    def __init__(self, output_path: str | Path | None = None) -> None:
        self.session_id = uuid.uuid4().hex
        self._lock = threading.Lock()
        self._closed = False
        self._file: TextIO | None = None
        if output_path is not None:
            path = Path(output_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            self._file = path.open("a", encoding="utf-8", newline="\n")

    def record(self, event: str, fields: Mapping[str, Any] | None = None, **values: Any) -> dict[str, Any]:
        """Record allowlisted fields from a mapping and/or keyword arguments."""
        if not isinstance(event, str) or not _EVENT.fullmatch(event):
            raise ValueError("event must be a short lowercase event name")
        if fields is not None and not isinstance(fields, Mapping):
            raise TypeError("fields must be a mapping")
        with self._lock:
            if self._closed:
                raise RuntimeError("telemetry recorder is closed")
            row = {
                **_safe_fields({**(fields or {}), **values}),
                "schema_version": 1,
                "event": event,
                "session_id": self.session_id,
                "monotonic_ns": time.monotonic_ns(),
                "measurement_scope": "caller_external" if event == "caller_audible_sample" else "server_internal",
            }
            line = json.dumps(row, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            if len(line) > MAX_LINE_CHARACTERS:
                raise ValueError("telemetry row exceeds the maximum line length")
            if self._file is None:
                LOGGER.info("voice_event %s", line)
            else:
                self._file.write(line + "\n")
                self._file.flush()
            return row

    def on_metrics(self, metrics: Any) -> dict[str, Any] | None:
        """Accept a LiveKit metrics model (or mapping) using a field allowlist.

        Provider metadata is reduced to model/provider names. Error contents and
        negative sentinel times are discarded. Speech IDs are kept only when the
        SDK supplied one; no correlation is inferred from callback arrival order.
        """
        if isinstance(metrics, Mapping):
            data = {key: value for key, value in metrics.items() if key in _SDK_INCLUDE}
        elif callable(getattr(metrics, "model_dump", None)):
            data = metrics.model_dump(include=_SDK_INCLUDE, exclude_none=True)
        else:
            return None
        metric_type = data.get("type")
        if metric_type not in _SDK_TYPES:
            return None
        fields = {key: value for key, value in data.items() if key not in {"type", "metadata", "error", "timestamp"}}
        fields["metric_type"] = metric_type
        if _number(data.get("timestamp")):
            fields["provider_timestamp_s"] = data["timestamp"]
        if data.get("error") is not None:
            fields["failed"] = True
        metadata = data.get("metadata")
        if isinstance(metadata, Mapping):
            for key in ("model_name", "model_provider"):
                fields[key] = metadata.get(key)
        return self.record("metrics", **fields)

    def on_conversation_item(self, item: Any, *, speech_id: str | None = None) -> dict[str, Any] | None:
        """Collect current SDK ChatMessage.metrics without reading chat content.

        Call with ev.item from conversation_item_added. Plugin measurements and
        per-message measurements stay separate: their timing boundaries differ.
        item.id is NOT assumed to equal a SpeechHandle.id. Supply speech_id only
        when the application knows that association; callback order is not one.
        All durations are seconds; even e2e_latency is a server-side estimate.
        """
        if isinstance(item, Mapping):
            data = {key: value for key, value in item.items() if key in _MESSAGE_INCLUDE}
        elif callable(getattr(item, "model_dump", None)):
            data = item.model_dump(include=_MESSAGE_INCLUDE, exclude_none=True)
        else:
            return None
        if data.get("type") != "message" or data.get("role") not in _MESSAGE_LATENCIES:
            return None
        item_id = data.get("id")
        if not isinstance(item_id, str) or not _TOKEN.fullmatch(item_id):
            return None
        metrics = data.get("metrics")
        if not isinstance(metrics, Mapping):
            metrics = {}
        allowed = set(_MESSAGE_LATENCIES[data["role"]].values()) | {
            "started_speaking_at", "stopped_speaking_at",
        }
        return self.record(
            "conversation_item_metrics",
            {key: value for key, value in metrics.items() if key in allowed},
            item_id=item_id,
            speech_id=speech_id,
            role=data["role"],
            interrupted=data.get("interrupted"),
        )

    def close(self) -> None:
        with self._lock:
            if not self._closed and self._file is not None:
                self._file.close()
            self._closed = True

    def __enter__(self) -> Recorder:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


def nearest_rank(values: Iterable[float], percentile: float) -> float | None:
    """Exact nearest-rank quantile: sorted[ceil(p*N)-1], p in (0, 1]."""
    if not 0 < percentile <= 1:
        raise ValueError("percentile must be in (0, 1]")
    ordered = sorted(values)
    if any(not _number(value) for value in ordered):
        raise ValueError("samples must be finite nonnegative numbers")
    if not ordered:
        return None
    return ordered[math.ceil(percentile * len(ordered)) - 1]


def _summary(values: list[float]) -> dict[str, Any]:
    return {"count": len(values), "p50_ms": nearest_rank(values, 0.5), "p95_ms": nearest_rank(values, 0.95)}


TurnKey = tuple[str, str, str]


def _turn_keys(row: Mapping[str, Any]) -> list[TurnKey]:
    session_id = row.get("session_id")
    if not isinstance(session_id, str) or not _TOKEN.fullmatch(session_id):
        return []
    return [
        (session_id, field, value)
        for field in ("speech_id", "item_id")
        if isinstance(value := row.get(field), str) and _TOKEN.fullmatch(value)
    ]


def summarize_rows(rows: Iterable[Mapping[str, Any]], *, max_samples: int = DEFAULT_MAX_SAMPLES) -> dict[str, Any]:
    """Consume rows once, with an explicit cap rather than silently biased truncation.

    Keep scalar samples until late cancellation events can exclude earlier metrics
    with the same session/speech or session/item ID. Rows explicitly containing
    both IDs establish an association. Percentiles describe event samples, not
    sums or averages of turns. Uncorrelated metrics remain uncorrelated.
    """
    if type(max_samples) is not int or max_samples <= 0:
        raise ValueError("max_samples must be a positive integer")
    samples: list[tuple[str, float, TurnKey | None, bool, tuple[str, str, str, bool] | None]] = []
    excluded_turns: set[TurnKey] = set()
    associations: dict[TurnKey, TurnKey] = {}

    def root(key: TurnKey) -> TurnKey:
        while key != associations[key]:
            associations[key] = associations[associations[key]]
            key = associations[key]
        return key

    events_read = invalid_caller_samples = invalid_rows = 0
    for row in rows:
        events_read += 1
        if not isinstance(row, Mapping) or row.get("schema_version") != 1:
            invalid_rows += 1
            continue
        keys = _turn_keys(row)
        for key in keys:
            associations.setdefault(key, key)
        if len(keys) == 2:
            associations[root(keys[1])] = root(keys[0])
        turn = keys[0] if keys else None
        cancelled = row.get("cancelled") is True or row.get("interrupted") is True
        excluded = cancelled or row.get("failed") is True
        if excluded and turn is not None:
            excluded_turns.add(turn)
        if len(associations) > max_samples * 2:
            raise ValueError("telemetry report exceeds max_samples; split the input by session/profile")
        if row.get("event") == "caller_audible_sample":
            profile = _profile(row.get("profile"))
            if (row.get("measurement") != CALLER_MEASUREMENT or profile is None
                or not _number(row.get("latency_ms")) or row["latency_ms"] <= 0
                or type(row.get("tool_dependent")) is not bool
                or type(row.get("cancelled")) is not bool):
                invalid_caller_samples += 1
                continue
            key = (profile["language"], profile["network"], profile["load"], row["tool_dependent"])
            samples.append(("caller_audible", float(row["latency_ms"]), turn, excluded, key))
        elif row.get("event") == "metrics":
            metric_type = row.get("metric_type")
            for name, field in _LATENCIES.get(metric_type, {}).items():
                if metric_type == "stt_metrics" and row.get("streamed") is not False:
                    continue  # zero streaming duration is not STT-final latency
                if metric_type == "eou_metrics" and turn is None:
                    continue  # SDK emits zero without detected speech; no valid utterance anchor
                value = row.get(field)
                if _number(value) and value > 0:
                    samples.append((name, float(value) * 1000, turn, excluded, None))
        elif row.get("event") == "conversation_item_metrics":
            for name, field in _MESSAGE_LATENCIES.get(row.get("role"), {}).items():
                value = row.get(field)
                if _number(value) and value > 0:
                    samples.append((name, float(value) * 1000, turn, excluded, None))
        if len(samples) > max_samples:
            raise ValueError("telemetry report exceeds max_samples; split the input by session/profile")

    internal: dict[str, list[float]] = defaultdict(list)
    caller: dict[tuple[str, str, str, bool], list[float]] = defaultdict(list)
    excluded_samples = 0
    excluded_roots = {root(turn) for turn in excluded_turns}
    for name, value, turn, excluded, profile in samples:
        if excluded or turn is not None and root(turn) in excluded_roots:
            excluded_samples += 1
        elif profile is not None:
            caller[profile].append(value)
        else:
            internal[name].append(value)
    caller_groups = [
        {"profile": dict(zip(("language", "network", "load"), key[:3])),
         "tool_dependent": key[3], **_summary(values)}
        for key, values in sorted(caller.items())
    ]
    return {
        "schema_version": 1,
        "percentile_method": "nearest_rank",
        "events_read": events_read,
        "invalid_rows": invalid_rows,
        "invalid_caller_samples": invalid_caller_samples,
        "cancelled_or_failed_samples_excluded": excluded_samples,
        "internal": {name: {"scope": "server_internal", **_summary(values)} for name, values in sorted(internal.items())},
        "caller_audible": {
            "status": "measured_externally" if caller_groups else "unmeasured",
            "measurement": CALLER_MEASUREMENT,
            "target_p95_ms_strictly_less_than": 500,
            "groups": caller_groups,
        },
        "limitations": [
            "Server/provider stage durations and event arrival times do not measure caller audible latency.",
            "Endpointing includes transcription delay; overlapping timings are never added.",
            "Zero and negative duration sentinels are excluded; an absent stage is unmeasured.",
            "Plugin and per-message metrics have different boundaries and are reported separately.",
            "Percentiles are per-event samples; message and speech IDs correlate only when explicitly associated.",
            "Per-message playback_latency and e2e_latency do not include verified caller audio-device playback.",
            "External sample labels are supplied by the measurement operator; this report does not verify their provenance.",
        ],
    }


def read_report(path: str | Path, *, max_samples: int = DEFAULT_MAX_SAMPLES) -> dict[str, Any]:
    def rows() -> Iterable[Mapping[str, Any]]:
        with Path(path).open("r", encoding="utf-8") as source:
            line_number = 0
            while line := source.readline(MAX_LINE_CHARACTERS + 2):
                line_number += 1
                if len(line) > MAX_LINE_CHARACTERS + 1:
                    raise ValueError(f"telemetry line {line_number} exceeds the line length limit")
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except (ValueError, TypeError) as error:
                    raise ValueError(f"invalid JSON at telemetry line {line_number}") from error
                if not isinstance(row, Mapping):
                    raise ValueError(f"telemetry line {line_number} must be a JSON object")
                yield row
    return summarize_rows(rows(), max_samples=max_samples)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report separate internal-stage and externally measured caller latency percentiles.")
    parser.add_argument("path", type=Path, help="Session JSONL file")
    parser.add_argument("--max-samples", type=int, default=DEFAULT_MAX_SAMPLES)
    args = parser.parse_args(argv)
    try:
        result = read_report(args.path, max_samples=args.max_samples)
    except (OSError, ValueError) as error:
        parser.exit(2, f"Cannot report telemetry: {error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
