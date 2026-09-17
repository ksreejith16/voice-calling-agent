import io
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from india_voice.telemetry import (
    CALLER_MEASUREMENT,
    Recorder,
    main,
    nearest_rank,
    read_report,
    summarize_rows,
)


def metric(kind="llm_metrics", **fields):
    return {"schema_version": 1, "event": "metrics", "session_id": "session-1",
            "speech_id": "speech-1", "metric_type": kind, **fields}


def caller(**fields):
    return {"schema_version": 1, "event": "caller_audible_sample",
            "measurement": CALLER_MEASUREMENT, "latency_ms": 400,
            "profile": {"language": "te-IN", "network": "Mumbai WiFi RTT20ms", "load": "1 concurrent call"},
            "tool_dependent": False, "cancelled": False, **fields}


class TelemetryTests(unittest.TestCase):
    def test_nearest_rank_p50_p95_are_exact_and_empty_is_unmeasured(self):
        self.assertEqual(nearest_rank(range(1, 21), 0.95), 19)
        self.assertEqual(nearest_rank(range(1, 21), 0.5), 10)
        self.assertEqual(nearest_rank([800], 0.95), 800)
        self.assertIsNone(nearest_rank([], 0.95))
        for values in ([float("nan")], [float("inf")], [-1], [True]):
            with self.assertRaises(ValueError):
                nearest_rank(values, 0.95)

    def test_internal_fields_remain_separate_and_never_become_caller_latency(self):
        result = summarize_rows([
            metric("eou_metrics", end_of_utterance_delay=0.3, transcription_delay=0.2),
            metric(ttft=0.1), metric("tts_metrics", ttfb=0.2),
            {"schema_version": 1, "event": "playback_started", "monotonic_ns": 2_000_000},
        ])
        self.assertEqual(result["internal"]["endpointing_delay"]["p95_ms"], 300)
        self.assertEqual(result["internal"]["transcription_delay"]["p95_ms"], 200)
        self.assertEqual(result["internal"]["llm_ttft"]["p95_ms"], 100)
        self.assertEqual(result["caller_audible"]["status"], "unmeasured")
        self.assertEqual(result["caller_audible"]["groups"], [])
        self.assertNotIn("total", result["internal"])

    def test_invalid_sentinels_streaming_stt_and_unanchored_eou_are_not_latency_samples(self):
        result = summarize_rows([
            metric(ttft=-1), metric(ttft=0), metric(ttft=float("nan")), metric(ttft=True),
            metric("stt_metrics", duration=0, streamed=True),
            metric("eou_metrics", speech_id=None, end_of_utterance_delay=0),
            metric("eou_metrics", end_of_utterance_delay=0, transcription_delay=-1),
            metric("stt_metrics", duration=0.4, streamed=False),
        ])
        self.assertEqual(set(result["internal"]), {"stt_nonstreaming_request_duration"})
        self.assertEqual(result["internal"]["stt_nonstreaming_request_duration"]["p95_ms"], 400)

    def test_late_cancellation_excludes_correlated_turn_without_cross_session_leak(self):
        result = summarize_rows([
            metric(ttft=0.1), metric("tts_metrics", ttfb=0.2),
            metric(ttft=0.5, session_id="different-session"),
            {"schema_version": 1, "event": "speech_finished", "session_id": "session-1",
             "speech_id": "speech-1", "interrupted": True},
            metric(ttft=0.01, speech_id=None, cancelled=True),
            caller(latency_ms=1, cancelled=True), caller(latency_ms=600),
        ])
        self.assertEqual(result["internal"]["llm_ttft"]["count"], 1)
        self.assertEqual(result["internal"]["llm_ttft"]["p95_ms"], 500)
        self.assertNotIn("tts_ttfb", result["internal"])
        self.assertEqual(result["cancelled_or_failed_samples_excluded"], 4)
        self.assertEqual(result["caller_audible"]["groups"][0]["p95_ms"], 600)

    def test_external_samples_require_measurement_profile_and_explicit_classification(self):
        rows = [caller(**override) for override in (
            {"measurement": "server_playback"}, {"profile": {}}, {"latency_ms": -1},
            {"latency_ms": "350"}, {"tool_dependent": None}, {"cancelled": None},
            {"profile": {"language": "te-IN", "network": "", "load": "1"}},
            {"latency_ms": 0},
        )]
        result = summarize_rows(rows)
        self.assertEqual(result["invalid_caller_samples"], 8)
        self.assertEqual(result["caller_audible"]["status"], "unmeasured")

    def test_external_groups_separate_language_network_load_and_tool_dependent_turns(self):
        rows = [caller(latency_ms=index) for index in range(1, 21)]
        rows.extend([
            caller(latency_ms=2000, tool_dependent=True),
            caller(latency_ms=700, profile={"language": "hi-IN", "network": "LTE", "load": "10 calls"}),
        ])
        result = summarize_rows(rows)
        groups = result["caller_audible"]["groups"]
        self.assertEqual(len(groups), 3)
        ordinary = next(group for group in groups if group["profile"]["language"] == "te-IN" and not group["tool_dependent"])
        self.assertEqual(ordinary["count"], 20)
        self.assertEqual(ordinary["p50_ms"], 10)
        self.assertEqual(ordinary["p95_ms"], 19)

    def test_recorder_drops_private_payloads_and_records_complete_flushed_monotonic_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.jsonl"
            with Recorder(path) as recorder:
                row = recorder.record("user_input_transcribed", transcript="private transcript",
                                      api_key="private-secret", is_final=True, language="te-IN",
                                      nested={"secret": "private-secret"})
                self.assertNotIn("transcript", row)
                self.assertNotIn("api_key", row)
                with ThreadPoolExecutor(max_workers=4) as pool:
                    list(pool.map(lambda number: recorder.record("agent_state_changed", state="speaking", duration=number), range(20)))
                # The file is readable before recorder.close(): every event has been flushed.
                lines = path.read_text(encoding="utf-8").splitlines()
                self.assertEqual(len(lines), 21)
                events = [json.loads(line) for line in lines]
                times = [event["monotonic_ns"] for event in events]
                self.assertEqual(times, sorted(times))
                self.assertTrue(all(event["measurement_scope"] == "server_internal" for event in events))
                self.assertNotIn("private", path.read_text(encoding="utf-8"))
            with self.assertRaises(RuntimeError):
                recorder.record("closed")

    def test_sdk_model_dump_is_allowlisted_and_negative_times_errors_and_metadata_are_filtered(self):
        class FakeMetrics:
            def model_dump(self, *, include, exclude_none):
                self_keys = set(include)
                self.asserted_keys = self_keys
                assert "transcript" not in self_keys and exclude_none
                return {"type": "llm_metrics", "ttft": -1, "duration": 0.5, "speech_id": "speech-7",
                        "timestamp": 123.5, "error": {"message": "private-secret"},
                        "metadata": {"model_name": "test-model", "model_provider": "provider", "api_key": "secret"}}

        with Recorder() as recorder:
            row = recorder.on_metrics(FakeMetrics())
            self.assertIsNotNone(row)
            self.assertNotIn("ttft", row)
            self.assertTrue(row["failed"])
            self.assertEqual(row["provider_timestamp_s"], 123.5)
            self.assertEqual(row["speech_id"], "speech-7")
            self.assertEqual(row["model_name"], "test-model")
            self.assertNotIn("private-secret", json.dumps(row))
            self.assertIsNone(recorder.on_metrics({"type": "unknown"}))

    def test_mapping_record_api_and_conversation_metrics_do_not_read_private_content(self):
        class FakeMessage:
            def model_dump(self, *, include, exclude_none):
                assert include == {"type", "id", "role", "interrupted", "metrics"}
                assert exclude_none
                return {"type": "message", "id": "item-1", "role": "assistant", "interrupted": False,
                        "metrics": {"llm_node_ttft": 0.1, "tts_node_ttfb": 0.2,
                                    "playback_latency": 0.002, "e2e_latency": 0.4,
                                    "started_speaking_at": 100, "stopped_speaking_at": 101,
                                    "transcript": "private text", "transcription_delay": 50}}

        with Recorder() as recorder:
            plain = recorder.record("test_event", {"duration": 2, "secret": "private"}, duration=1)
            self.assertEqual(plain["duration"], 1)
            self.assertNotIn("secret", plain)
            row = recorder.on_conversation_item(FakeMessage(), speech_id="speech-1")
            self.assertNotIn("private", json.dumps(row))
            self.assertNotIn("transcription_delay", row)
            self.assertEqual(row["item_id"], "item-1")
            self.assertEqual(row["speech_id"], "speech-1")
            self.assertEqual(row["measurement_scope"], "server_internal")
        result = summarize_rows([row])
        self.assertEqual(result["internal"]["turn_llm_ttft"]["p95_ms"], 100)
        self.assertEqual(result["internal"]["turn_tts_ttfb"]["p95_ms"], 200)
        self.assertEqual(result["internal"]["turn_playback_latency"]["p95_ms"], 2)
        self.assertEqual(result["internal"]["turn_e2e_latency"]["p95_ms"], 400)
        self.assertEqual(result["caller_audible"]["status"], "unmeasured")

    def test_user_conversation_metrics_and_zero_sentinels_remain_separate_from_plugin_metrics(self):
        with Recorder() as recorder:
            user = recorder.on_conversation_item({
                "type": "message", "id": "user-1", "role": "user", "interrupted": False,
                "metrics": {"end_of_turn_delay": 0.3, "transcription_delay": 0.2,
                            "on_user_turn_completed_delay": 0, "llm_node_ttft": 10},
            })
            assistant = recorder.on_conversation_item({
                "type": "message", "id": "assistant-1", "role": "assistant",
                "metrics": {"llm_node_ttft": -1, "tts_node_ttfb": 0, "e2e_latency": -1},
            })
        result = summarize_rows([user, assistant, metric(ttft=0.5)])
        self.assertEqual(set(result["internal"]), {"turn_endpointing_delay", "turn_transcription_delay", "llm_ttft"})
        self.assertEqual(result["internal"]["turn_endpointing_delay"]["p95_ms"], 300)
        self.assertEqual(result["internal"]["turn_transcription_delay"]["p95_ms"], 200)
        self.assertNotIn("llm_node_ttft", user)

    def test_non_message_items_are_ignored_even_if_they_contain_latency_fields(self):
        with Recorder() as recorder:
            for item in (None, {}, {"type": "function_call", "id": "1", "role": "assistant"},
                         {"type": "message", "id": "1", "role": "system"},
                         {"type": "message", "id": "invalid id", "role": "user"}):
                self.assertIsNone(recorder.on_conversation_item(item))

    def test_explicit_item_speech_association_propagates_late_failure_in_both_directions(self):
        for failure in ({"item_id": "item-1"}, {"speech_id": "speech-1"}):
            rows = [
                metric(ttft=0.1),
                {"schema_version": 1, "session_id": "session-1", "item_id": "item-1",
                 "event": "conversation_item_metrics", "role": "assistant", "llm_node_ttft": 0.2},
                # Association may arrive after both measurements and the failure.
                {"schema_version": 1, "session_id": "session-1", "event": "failure", "failed": True, **failure},
                {"schema_version": 1, "session_id": "session-1", "event": "association",
                 "speech_id": "speech-1", "item_id": "item-1"},
            ]
            result = summarize_rows(rows)
            self.assertEqual(result["internal"], {})
            self.assertEqual(result["cancelled_or_failed_samples_excluded"], 2)

    def test_item_cancellation_does_not_assume_unrelated_matching_speech_identifier(self):
        result = summarize_rows([
            metric(ttft=0.1, speech_id="same-id"),
            {"schema_version": 1, "session_id": "session-1", "event": "conversation_item_metrics",
             "item_id": "same-id", "role": "assistant", "llm_node_ttft": 0.2},
            {"schema_version": 1, "session_id": "session-1", "event": "conversation_item_metrics",
             "item_id": "same-id", "role": "assistant", "interrupted": True},
        ])
        self.assertEqual(set(result["internal"]), {"llm_ttft"})
        self.assertEqual(result["cancelled_or_failed_samples_excluded"], 1)

    def test_association_memory_has_an_explicit_limit_even_without_metric_samples(self):
        with self.assertRaisesRegex(ValueError, "max_samples"):
            summarize_rows([
                {"schema_version": 1, "event": "state", "session_id": "session-1", "speech_id": f"s-{index}"}
                for index in range(3)
            ], max_samples=1)

    def test_reader_rejects_partial_json_and_resource_limit_without_silent_truncation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "broken.jsonl"
            path.write_text('{"event":', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "line 1"):
                read_report(path)
        with self.assertRaisesRegex(ValueError, "max_samples"):
            summarize_rows([metric(ttft=0.1), metric(ttft=0.2)], max_samples=1)

    def test_cli_reports_unmeasured_without_external_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.jsonl"
            with Recorder(path) as recorder:
                recorder.on_metrics({"type": "llm_metrics", "ttft": 0.4, "cancelled": False})
            with patch("sys.stdout", new_callable=io.StringIO) as output:
                self.assertEqual(main([str(path)]), 0)
                report = json.loads(output.getvalue())
            self.assertEqual(report["caller_audible"]["status"], "unmeasured")
            self.assertEqual(report["internal"]["llm_ttft"]["p95_ms"], 400)


if __name__ == "__main__":
    unittest.main()
