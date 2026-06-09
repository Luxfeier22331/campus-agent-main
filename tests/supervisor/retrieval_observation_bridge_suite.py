from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_contracts import (
    CapabilityRequest,
    CapabilityResponse,
    KnowledgeScope,
    RagRequestPayload,
)
from campus_supervisor_agent_worker.capability_delegates import _build_capability_delegates
from campus_supervisor_agent_worker.retrieval_observation_bridge import (
    build_jsonl_retrieval_observation_sink,
    build_retrieval_runtime_event_sink,
    build_runtime_event_emitter_status,
    build_runtime_event_jsonl_emitter,
    build_runtime_event_otlp_emitter,
    compose_retrieval_observation_sinks,
    sanitize_retrieval_observation,
)
from campus_supervisor_agent_worker.settings import ApiSettings


class RetrievalObservationBridgeTest(unittest.TestCase):
    def test_sanitizes_retrieval_observation_with_allowed_fields_and_derived_flags(self) -> None:
        sanitized = sanitize_retrieval_observation(
            {
                "schema_version": "retrieval-runtime-observation-v1",
                "request_id": "req-1",
                "plan_id": "plan-1",
                "step_id": "step-1",
                "query_mode": "historical",
                "retrieval_mode": "historical",
                "terminal_state": "completed",
                "failure_kind": "",
                "candidate_count": 3,
                "reference_count": 0,
                "latency_ms": 12,
                "query_sha256": "abc123",
                "scope": {"corpus": "regulations", "collection": "student_rules"},
                "target_document_ids": ("doc-1", "doc-2"),
                "target_version_ids": ("v1",),
                "top_source_ids": ("source-1", "source-2"),
                "source_timestamps": ("2026-01-01", "2026-01-02"),
                "top_score": None,
                "score_gap": None,
                "canonical_index_truth": True,
                "as_of": "2026-05-01T00:00:00Z",
                "query": "校园卡丢了怎么办",
                "snippet": "raw retrieved snippet",
                "document_body": "raw canonical body",
                "authorization": "Bearer secret",
            }
        )

        self.assertEqual(sanitized["request_id"], "req-1")
        self.assertEqual(sanitized["query_mode"], "historical")
        self.assertEqual(sanitized["query_sha256"], "abc123")
        self.assertEqual(sanitized["scope.corpus"], "regulations")
        self.assertEqual(sanitized["scope.collection"], "student_rules")
        self.assertEqual(sanitized["target_document_ids_count"], 2)
        self.assertEqual(sanitized["target_version_ids_count"], 1)
        self.assertEqual(sanitized["top_source_ids_count"], 2)
        self.assertEqual(sanitized["source_timestamps_count"], 2)
        self.assertTrue(sanitized["no_hit"])
        self.assertTrue(sanitized["low_confidence"])
        self.assertFalse(sanitized["release_metadata_drift"])
        self.assertNotIn("scope", sanitized)
        self.assertNotIn("query", sanitized)
        self.assertNotIn("snippet", sanitized)
        self.assertNotIn("document_body", sanitized)
        self.assertNotIn("authorization", sanitized)
        self.assertNotIn("target_document_ids", sanitized)
        self.assertNotIn("top_source_ids", sanitized)

    def test_marks_release_drift_and_reranker_failure_without_raw_fields(self) -> None:
        sanitized = sanitize_retrieval_observation(
            {
                "request_id": "req-drift",
                "plan_id": "plan-drift",
                "step_id": "step-drift",
                "query_mode": "freshness_sensitive",
                "retrieval_mode": "freshness_sensitive",
                "terminal_state": "failed_closed",
                "failure_kind": "release_metadata_drift",
                "candidate_count": 2,
                "reference_count": 1,
                "latency_ms": 9,
                "query_sha256": "hash-drift",
                "scope": {"corpus": "regulations", "collection": "student_rules"},
                "reranker_failure_kind": "reranker_failed",
                "query": "raw query",
            }
        )

        self.assertTrue(sanitized["release_metadata_drift"])
        self.assertEqual(sanitized["reranker_failure_kind"], "reranker_failed")
        self.assertNotIn("reranker_degraded", sanitized)
        self.assertFalse(sanitized["no_hit"])
        self.assertFalse(sanitized["low_confidence"])
        self.assertNotIn("query", sanitized)

    def test_runtime_event_sink_emits_sanitized_retrieval_event_and_fails_closed(self) -> None:
        events: list[tuple[str, dict[str, object]]] = []
        sink = build_retrieval_runtime_event_sink(
            lambda event_name, attributes: events.append((event_name, attributes))
        )

        sink(
            {
                "request_id": "req-event",
                "plan_id": "plan-event",
                "step_id": "step-event",
                "query_mode": "historical",
                "retrieval_mode": "historical",
                "terminal_state": "completed",
                "candidate_count": 1,
                "reference_count": 1,
                "latency_ms": 4,
                "query_sha256": "hash-event",
                "scope": {"corpus": "regulations", "collection": "student_rules"},
                "query": "raw query",
            }
        )
        failing_sink = build_retrieval_runtime_event_sink(
            lambda _event_name, _attributes: (_ for _ in ()).throw(OSError("sink down"))
        )

        with self.assertRaisesRegex(OSError, "sink down"):
            failing_sink({"request_id": "req-failure", "reference_count": 0})

        self.assertEqual(events[0][0], "retrieval.runtime_observation")
        self.assertEqual(events[0][1]["request_id"], "req-event")
        self.assertNotIn("query", events[0][1])

    def test_runtime_event_jsonl_emitter_writes_event_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "runtime-events.jsonl"
            emitter = build_runtime_event_jsonl_emitter(output_path)

            emitter("retrieval.runtime_observation", {"request_id": "req-jsonl"})

            rows = [
                json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual(
            rows,
            [
                {
                    "event_name": "retrieval.runtime_observation",
                    "attributes": {"request_id": "req-jsonl"},
                }
            ],
        )

    def test_worker_owned_retrieval_observation_jsonl_sink_writes_debug_observation(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "retrieval-observations.jsonl"
            sink = build_jsonl_retrieval_observation_sink(output_path)

            sink(
                {
                    "request_id": "req-debug",
                    "query_sha256": "hash-debug",
                    "query": "debug query only when explicitly enabled upstream",
                }
            )

            rows = [
                json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual(rows[0]["request_id"], "req-debug")
        self.assertEqual(rows[0]["query_sha256"], "hash-debug")
        self.assertEqual(rows[0]["query"], "debug query only when explicitly enabled upstream")

    def test_runtime_event_emitter_status_reports_otlp_configuration(self) -> None:
        status = build_runtime_event_emitter_status(
            otel_enabled=True,
            traces_endpoint="http://otel-collector:4318/v1/traces",
            metrics_endpoint="http://otel-collector:4318/v1/metrics",
            logs_endpoint="http://otel-collector:4318/v1/logs",
        )

        self.assertTrue(status["enabled"])
        self.assertTrue(status["configured"])
        self.assertEqual(status["transport"], "otlp_http")
        self.assertTrue(status["traces_configured"])
        self.assertTrue(status["metrics_configured"])
        self.assertTrue(status["logs_configured"])

    def test_runtime_event_otlp_emitter_requires_endpoint_when_enabled(self) -> None:
        with self.assertRaisesRegex(ValueError, "traces endpoint"):
            build_runtime_event_otlp_emitter(
                enabled=True,
                service_name="campus-supervisor-agent-worker",
                allowed_attributes_version="attrs-v1",
                traces_endpoint="",
                metrics_endpoint="",
                logs_endpoint="",
                export_timeout_seconds=1.0,
                export_interval_seconds=5.0,
                headers="",
            )

    def test_composed_observation_sink_fails_closed_when_any_sink_fails(self) -> None:
        seen: list[dict[str, object]] = []
        sink = compose_retrieval_observation_sinks(
            lambda observation: seen.append(dict(observation)),
            lambda _observation: (_ for _ in ()).throw(OSError("disk full")),
        )

        self.assertIsNotNone(sink)
        assert sink is not None
        with self.assertRaisesRegex(OSError, "disk full"):
            sink({"request_id": "req-compose"})

        self.assertEqual(seen, [{"request_id": "req-compose"}])

    def test_settings_from_env_reads_runtime_event_jsonl_path(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPERVISOR_RETRIEVAL_OBSERVATION_JSONL_PATH": "/tmp/raw-observations.jsonl",
                "SUPERVISOR_RETRIEVAL_RUNTIME_EVENT_JSONL_PATH": "/tmp/runtime-events.jsonl",
            },
            clear=True,
        ):
            settings = ApiSettings.from_env()

        self.assertEqual(settings.retrieval_observation_jsonl_path, "/tmp/raw-observations.jsonl")
        self.assertEqual(
            settings.retrieval_runtime_event_jsonl_path,
            "/tmp/runtime-events.jsonl",
        )

    def test_rag_delegate_wires_jsonl_and_runtime_event_observation_sinks(self) -> None:
        with TemporaryDirectory() as temp_dir:
            observation_path = Path(temp_dir) / "retrieval-observations.jsonl"
            runtime_event_path = Path(temp_dir) / "runtime-events.jsonl"
            settings = ApiSettings(
                retrieval_observation_jsonl_path=str(observation_path),
                retrieval_runtime_event_jsonl_path=str(runtime_event_path),
            )
            with patch(
                "campus_supervisor_agent_worker.capability_delegates.delegate_to_knowledge_capability"
            ) as delegate:
                delegate.return_value = CapabilityResponse(
                    capability="knowledge",
                    status="completed",
                    answer_text="ok",
                    confidence="high",
                )
                delegates = _build_capability_delegates(
                    settings=settings,
                    rag_prompt_executor=None,
                    campus_services_query_service=None,
                    notice_query_service=None,
                    rag_openai_runtime=object(),
                )

                response = delegates["knowledge"](
                    CapabilityRequest(
                        capability="knowledge",
                        user_goal="校园卡丢了怎么办",
                        request_id="req-rag-runtime-event",
                        payload=RagRequestPayload(
                            scope=KnowledgeScope(
                                corpus="regulations",
                                collection="student_rules",
                            )
                        ),
                    )
                )
                observation_sink = delegate.call_args.kwargs["retrieval_observation_sink"]
                observation_sink(
                    {
                        "schema_version": "retrieval-runtime-observation-v1",
                        "request_id": "req-rag-runtime-event",
                        "plan_id": "plan-rag",
                        "step_id": "step-rag",
                        "query_mode": "historical",
                        "retrieval_mode": "historical",
                        "terminal_state": "completed",
                        "candidate_count": 1,
                        "reference_count": 1,
                        "latency_ms": 5,
                        "query_sha256": "hash-rag",
                        "scope": {
                            "corpus": "regulations",
                            "collection": "student_rules",
                        },
                        "query": "校园卡丢了怎么办",
                    }
                )
            observation_rows = [
                json.loads(line)
                for line in observation_path.read_text(encoding="utf-8").splitlines()
            ]
            runtime_event_rows = [
                json.loads(line)
                for line in runtime_event_path.read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual(response.status, "completed")
        self.assertEqual(observation_rows[0]["request_id"], "req-rag-runtime-event")
        self.assertIn("query", observation_rows[0])
        self.assertEqual(
            runtime_event_rows[0]["event_name"],
            "retrieval.runtime_observation",
        )
        self.assertEqual(
            runtime_event_rows[0]["attributes"]["request_id"],
            "req-rag-runtime-event",
        )
        self.assertNotIn("query", runtime_event_rows[0]["attributes"])


if __name__ == "__main__":
    unittest.main()
