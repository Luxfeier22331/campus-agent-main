from __future__ import annotations

import unittest
from collections.abc import Mapping
from typing import Any

from campus_ingestion_worker.ingestion_task_executor import (
    HttpIngestionControlClient,
    IngestionTaskExecutor,
    InMemoryIngestionControlClient,
    PythonAdapterRegistry,
    build_executor_from_env,
)

TASK: dict[str, Any] = {
    "schema_version": "ingestion_task_envelope.v1",
    "task_id": "task_curriculum_chunk_001",
    "run_id": "run_curriculum_20260611",
    "source_family": "curriculum",
    "source_channel": "curriculum_plan",
    "corpus": "curriculum",
    "collection": "curriculum_plan",
    "task_kind": "chunk_prepare",
    "input_ref": {
        "kind": "object_store",
        "uri": "s3://campus-rag-derived/curriculum/curriculum_plan/document-units.jsonl",
    },
    "output_contract": "ingestion_chunk_set.v1",
    "idempotency_key": "curriculum/curriculum_plan/chunk_prepare/document-units-v1",
    "lease_policy": {
        "lease_seconds": 300,
        "heartbeat_seconds": 30,
    },
    "retry_policy": {
        "max_attempts": 1,
    },
    "created_by": "operator",
    "created_at": "2026-06-11T00:00:00Z",
}


class IngestionTaskExecutorSuite(unittest.TestCase):
    def test_claims_task_dispatches_adapter_and_completes_closeout(self) -> None:
        client = InMemoryIngestionControlClient(tasks=[dict(TASK)])
        registry = PythonAdapterRegistry()
        registry.register(
            "curriculum.chunk_prepare.v1",
            lambda task: {
                "artifact_refs": [
                    {
                        "kind": "object_store",
                        "uri": f"{task['input_ref']['uri']}.chunks.jsonl",
                    }
                ]
            },
        )

        result = IngestionTaskExecutor(
            control_client=client,
            adapter_registry=registry,
            worker_id="worker-a",
        ).run_once()

        self.assertEqual(result["status"], "completed")
        self.assertEqual(client.completed[0]["task_id"], TASK["task_id"])
        self.assertEqual(client.completed[0]["artifact_refs"][0]["kind"], "object_store")

    def test_fail_closes_when_adapter_is_missing(self) -> None:
        client = InMemoryIngestionControlClient(tasks=[dict(TASK)])

        result = IngestionTaskExecutor(
            control_client=client,
            adapter_registry=PythonAdapterRegistry(),
            worker_id="worker-a",
        ).run_once()

        self.assertEqual(result["status"], "failed")
        self.assertEqual(client.failed[0]["error_code"], "adapter_not_registered")

    def test_fail_closes_invalid_task_payload_before_adapter_dispatch(self) -> None:
        invalid_task: Mapping[str, Any] = {
            key: value for key, value in TASK.items() if key != "idempotency_key"
        }
        client = InMemoryIngestionControlClient(tasks=[dict(invalid_task)])
        registry = PythonAdapterRegistry()
        registry.register("curriculum.chunk_prepare.v1", lambda task: {"artifact_refs": []})

        result = IngestionTaskExecutor(
            control_client=client,
            adapter_registry=registry,
            worker_id="worker-a",
        ).run_once()

        self.assertEqual(result["status"], "failed")
        self.assertEqual(client.failed[0]["error_code"], "invalid_task_payload")

    def test_http_control_client_uses_internal_ingestion_wire_contract(self) -> None:
        transport = RecordingTransport(
            responses=[
                (200, TASK),
                (200, {"task_id": TASK["task_id"], "terminal_status": "running"}),
                (200, {"task_id": TASK["task_id"], "terminal_status": "completed"}),
            ]
        )
        client = HttpIngestionControlClient(
            base_url="http://ingestion-control",
            transport=transport,
        )

        claimed = client.claim_next_task(worker_id="worker-a")
        heartbeat = client.heartbeat_task(task_id=TASK["task_id"], worker_id="worker-a")
        completed = client.complete_task(
            task_id=TASK["task_id"],
            worker_id="worker-a",
            artifact_refs=[{"kind": "object_store", "uri": "s3://bucket/chunks.jsonl"}],
        )

        self.assertEqual(claimed, TASK)
        self.assertEqual(heartbeat["terminal_status"], "running")
        self.assertEqual(completed["terminal_status"], "completed")
        self.assertEqual(
            transport.requests[0],
            {
                "method": "POST",
                "url": "http://ingestion-control/internal/ingestion/tasks/claim",
                "json": {"worker_id": "worker-a"},
            },
        )
        self.assertEqual(
            transport.requests[1]["url"],
            f"http://ingestion-control/internal/ingestion/tasks/{TASK['task_id']}/heartbeat",
        )
        self.assertEqual(
            transport.requests[2]["url"],
            f"http://ingestion-control/internal/ingestion/tasks/{TASK['task_id']}/complete",
        )

    def test_executor_env_builder_requires_ingestion_control_base_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "INGESTION_CONTROL_BASE_URL is required"):
            build_executor_from_env(env={})


if __name__ == "__main__":
    unittest.main()


class RecordingTransport:
    def __init__(self, *, responses: list[tuple[int, Mapping[str, Any]]]) -> None:
        self._responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    def request(
        self, method: str, url: str, json: Mapping[str, Any]
    ) -> tuple[int, Mapping[str, Any]]:
        self.requests.append({"method": method, "url": url, "json": dict(json)})
        if not self._responses:
            raise AssertionError("unexpected HTTP request")
        return self._responses.pop(0)
