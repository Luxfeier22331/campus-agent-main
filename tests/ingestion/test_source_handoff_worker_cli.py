from __future__ import annotations

import unittest
from datetime import UTC, datetime

from campus_ingestion_core.source_handoff_execution import SourceHandoffProcessorResult
from campus_ingestion_core.source_handoff_state_machine import (
    IngestionExecution,
    SourceHandoff,
    SourceObjectRef,
    SourceRunRef,
)
from campus_ingestion_core.source_handoff_store import InMemorySourceHandoffStore
from campus_ingestion_worker.consume_source_handoff_executions import (
    consume_source_handoff_executions,
)
from campus_ingestion_worker.show_source_handoff_executions import (
    show_source_handoff_executions,
)


class SourceHandoffWorkerCliTest(unittest.TestCase):
    def test_worker_functions_expose_consume_and_read_only_operator_projection(self) -> None:
        now = datetime(2026, 5, 1, tzinfo=UTC)
        store = _store_with_verified_execution(now=now)

        consume_result = consume_source_handoff_executions(
            store=store,
            processors={
                "official_web_source_truth_replay": lambda **_: SourceHandoffProcessorResult(
                    result_kind="staged",
                    completed_step_names=("source_truth_import",),
                )
            },
            worker_id="worker-001",
            limit=1,
            now=now,
        )
        projection = show_source_handoff_executions(store=store, now=now)

        self.assertEqual(consume_result["processed_count"], 1)
        self.assertEqual(consume_result["results"][0]["status"], "completed")
        self.assertEqual(projection["records"][0]["execution"]["status"], "completed")
        self.assertEqual(projection["records"][0]["execution"]["result_kind"], "staged")


def _store_with_verified_execution(*, now: datetime) -> InMemorySourceHandoffStore:
    store = InMemorySourceHandoffStore()
    handoff = store.create_or_get_handoff(_handoff(now=now))
    verified = store.mark_handoff_verified(handoff.handoff_id, now=now)
    store.enqueue_execution(_execution(verified.handoff_id, now=now))
    return store


def _handoff(*, now: datetime) -> SourceHandoff:
    run_ref = SourceRunRef(
        source_channel="official_web",
        source_surface="baseline",
        site_id="muc_official",
        source_run_id="run-001",
        source_run_owner="app_api_official_web",
        source_run_status="completed",
        source_run_terminal_at=now,
        source_run_ref="official_web:crawl_run:run-001",
    )
    bundle = SourceObjectRef(
        object_role="handoff_bundle",
        bucket="campus-rag-source",
        object_key="official_web/run-001/source_truth_bundle.json",
        content_sha256="a" * 64,
        byte_size=4096,
        required=True,
    )
    return SourceHandoff(
        handoff_id="handoff-001",
        schema_version="source_handoff.v1",
        source_run_ref=run_ref,
        handoff_kind="official_web_source_truth_replay",
        source_bucket="campus-rag-source",
        required_objects=(bundle,),
        idempotency_key="official_web:event-001",
        status="created",
        created_at=now,
        updated_at=now,
    )


def _execution(handoff_id: str, *, now: datetime) -> IngestionExecution:
    return IngestionExecution(
        execution_id="execution-001",
        handoff_id=handoff_id,
        processor_profile="official_web_source_truth_replay",
        requested_result_kind="stage_only",
        status="queued",
        result_kind="none",
        attempt_count=0,
        max_attempts=3,
        created_at=now,
        updated_at=now,
    )


if __name__ == "__main__":
    unittest.main()
