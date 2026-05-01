from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_contracts import (
    AgentRequest,
    AgentResponse,
    KnowledgeScope,
    RagRequestPayload,
)
from campus_supervisor_agent_worker.agent_delegates import _build_agent_delegates
from campus_supervisor_agent_worker.retrieval_observation_bridge import (
    build_retrieval_runtime_event_sink,
    build_runtime_event_jsonl_emitter,
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

    def test_marks_release_drift_and_reranker_degraded_without_raw_fields(self) -> None:
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
                "reranker_degraded": True,
                "reranker_failure_kind": "reranker_degraded",
                "query": "raw query",
            }
        )

        self.assertTrue(sanitized["release_metadata_drift"])
        self.assertTrue(sanitized["reranker_degraded"])
        self.assertEqual(sanitized["reranker_failure_kind"], "reranker_degraded")
        self.assertFalse(sanitized["no_hit"])
        self.assertFalse(sanitized["low_confidence"])
        self.assertNotIn("query", sanitized)

    def test_runtime_event_sink_emits_sanitized_retrieval_event_and_swallows_failure(self) -> None:
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

        with self.assertLogs(
            "campus_supervisor_agent_worker.retrieval_observation_bridge",
            level="WARNING",
        ):
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

    def test_composed_observation_sink_runs_all_sinks_and_keeps_failures_warning_only(self) -> None:
        seen: list[dict[str, object]] = []
        sink = compose_retrieval_observation_sinks(
            lambda observation: seen.append(dict(observation)),
            lambda _observation: (_ for _ in ()).throw(OSError("disk full")),
        )

        self.assertIsNotNone(sink)
        assert sink is not None
        with self.assertLogs(
            "campus_supervisor_agent_worker.retrieval_observation_bridge",
            level="WARNING",
        ):
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
                "campus_supervisor_agent_worker.agent_delegates.delegate_to_rag_agent"
            ) as delegate:
                delegate.return_value = AgentResponse(
                    target="rag-agent",
                    status="completed",
                    answer_text="ok",
                    confidence="high",
                )
                delegates = _build_agent_delegates(
                    settings=settings,
                    rag_prompt_executor=None,
                    campus_services_query_service=None,
                    notice_query_service=None,
                )

                response = delegates["rag-agent"](
                    AgentRequest(
                        target="rag-agent",
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
