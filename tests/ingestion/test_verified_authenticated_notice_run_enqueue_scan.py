from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)
from campus_ingestion_core.verified_authenticated_notice_run_enqueue_scan import (
    VERIFIED_AUTHENTICATED_NOTICE_RUN_ENQUEUE_SCAN_PLAN_SCHEMA_VERSION,
    VerifiedAuthenticatedNoticeRunEnqueueCandidate,
    build_verified_authenticated_notice_run_enqueue_scan_plan,
    execute_verified_authenticated_notice_run_enqueue_scan_plan,
)


class VerifiedAuthenticatedNoticeRunEnqueueScanTest(unittest.TestCase):
    def test_scan_skips_existing_queue_jobs_and_plans_missing_verified_runs(self) -> None:
        store = InMemoryNoticeIngestQueueStore()
        first_plan = build_verified_authenticated_notice_run_enqueue_scan_plan(
            candidates=[_candidate("run-001")],
            queue_store=store,
            replay_batch_id="scheduled:20260501",
            generated_at="2026-05-01T01:00:00Z",
        )
        execute_verified_authenticated_notice_run_enqueue_scan_plan(
            first_plan,
            queue_store=store,
        )

        plan = build_verified_authenticated_notice_run_enqueue_scan_plan(
            candidates=[_candidate("run-001"), _candidate("run-002")],
            queue_store=store,
            replay_batch_id="scheduled:20260501",
            generated_at="2026-05-01T01:01:00Z",
        )

        self.assertEqual(
            plan["schema_version"],
            VERIFIED_AUTHENTICATED_NOTICE_RUN_ENQUEUE_SCAN_PLAN_SCHEMA_VERSION,
        )
        self.assertEqual(plan["mode"], "dry_run")
        self.assertEqual(plan["counts"]["scanned_run_count"], 2)
        self.assertEqual(plan["counts"]["already_queued_count"], 1)
        self.assertEqual(plan["counts"]["planned_job_count"], 1)
        self.assertEqual(plan["jobs"][0]["run_id"], "run-002")
        self.assertEqual(plan["jobs"][0]["enqueue_source"], "live_discovery")

    def test_execute_enqueues_planned_verified_runs_idempotently(self) -> None:
        store = InMemoryNoticeIngestQueueStore()
        plan = build_verified_authenticated_notice_run_enqueue_scan_plan(
            candidates=[_candidate("run-001")],
            queue_store=store,
            replay_batch_id="scheduled:20260501",
            generated_at="2026-05-01T01:00:00Z",
        )

        first = execute_verified_authenticated_notice_run_enqueue_scan_plan(
            plan,
            queue_store=store,
        )
        second = execute_verified_authenticated_notice_run_enqueue_scan_plan(
            plan,
            queue_store=store,
        )

        self.assertEqual(first["counts"]["inserted_count"], 1)
        self.assertEqual(first["counts"]["existing_count"], 0)
        self.assertEqual(second["counts"]["inserted_count"], 0)
        self.assertEqual(second["counts"]["existing_count"], 1)
        self.assertEqual(store.list_status_counts()["queued"], 1)


def _candidate(run_id: str) -> VerifiedAuthenticatedNoticeRunEnqueueCandidate:
    return VerifiedAuthenticatedNoticeRunEnqueueCandidate(
        site_id="muc_internal_portal",
        run_refs=AuthenticatedNoticeCollectorRunObjectRefs(
            run_id=run_id,
            source_surface="notice",
            source_bucket="campus-rag-source",
            bundle_object_key=f"runs/{run_id}/bundle.json",
            manifest_object_key=f"runs/{run_id}/manifest.json",
            bundle_content_sha256="a" * 64,
            bundle_byte_size=4096,
            manifest_content_sha256="b" * 64,
            manifest_byte_size=2048,
        ),
    )


if __name__ == "__main__":
    unittest.main()
