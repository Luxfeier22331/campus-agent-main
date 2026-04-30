from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.authenticated_notice_run_enqueue import (
    AUTHENTICATED_NOTICE_RUN_ENQUEUE_EXECUTE_SCHEMA_VERSION,
    AUTHENTICATED_NOTICE_RUN_ENQUEUE_PLAN_SCHEMA_VERSION,
    build_authenticated_notice_run_enqueue_plan,
    execute_authenticated_notice_run_enqueue_plan,
)
from campus_ingestion_core.collected_notice_ingest_queue import (
    AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION,
    validate_notice_ingest_job_payload,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)


class AuthenticatedNoticeRunEnqueueTest(unittest.TestCase):
    def test_plan_projects_verified_run_refs_to_run_level_queue_job(self) -> None:
        plan = build_authenticated_notice_run_enqueue_plan(
            run_refs=_run_refs(),
            site_id="muc_internal_portal",
            enqueue_source="manual_replay",
            replay_batch_id="manual-run-20260501",
            priority=25,
            generated_by="test",
            provenance={"repair_mode": "existing_verified_ledger"},
        )

        self.assertEqual(
            plan["schema_version"], AUTHENTICATED_NOTICE_RUN_ENQUEUE_PLAN_SCHEMA_VERSION
        )
        self.assertEqual(plan["mode"], "dry_run")
        self.assertFalse(plan["write_enabled"])
        self.assertEqual(plan["planned_writes"]["queue_jobs"], 1)
        self.assertEqual(plan["counts"]["planned_job_count"], 1)
        job = plan["jobs"][0]
        self.assertEqual(job["schema_version"], AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION)
        self.assertEqual(job["source_identity"], "muc_internal_portal:run-001")
        self.assertEqual(job["run_id"], "run-001")
        self.assertEqual(job["site_id"], "muc_internal_portal")
        self.assertEqual(job["source_bucket"], "campus-rag-source")
        self.assertEqual(job["bundle_content_sha256"], "a" * 64)
        self.assertEqual(job["manifest_content_sha256"], "b" * 64)
        self.assertEqual(job["provenance"], {"repair_mode": "existing_verified_ledger"})
        self.assertNotIn("bundle_path", job)
        self.assertNotIn("manifest_path", job)
        validate_notice_ingest_job_payload(job)

    def test_execute_enqueues_idempotently(self) -> None:
        plan = build_authenticated_notice_run_enqueue_plan(
            run_refs=_run_refs(),
            site_id="muc_internal_portal",
            enqueue_source="manual_replay",
            replay_batch_id="manual-run-20260501",
            generated_by="test",
        )
        store = InMemoryNoticeIngestQueueStore()

        first = execute_authenticated_notice_run_enqueue_plan(plan, queue_store=store)
        second = execute_authenticated_notice_run_enqueue_plan(plan, queue_store=store)

        self.assertEqual(
            first["schema_version"], AUTHENTICATED_NOTICE_RUN_ENQUEUE_EXECUTE_SCHEMA_VERSION
        )
        self.assertEqual(first["counts"]["inserted_count"], 1)
        self.assertEqual(first["counts"]["existing_count"], 0)
        self.assertEqual(second["counts"]["inserted_count"], 0)
        self.assertEqual(second["counts"]["existing_count"], 1)
        self.assertEqual(store.list_status_counts()["queued"], 1)


def _run_refs() -> AuthenticatedNoticeCollectorRunObjectRefs:
    return AuthenticatedNoticeCollectorRunObjectRefs(
        run_id="run-001",
        source_surface="notice",
        source_bucket="campus-rag-source",
        bundle_object_key="authenticated_notice_portal/runs/run-001/bundle.json",
        manifest_object_key="authenticated_notice_portal/runs/run-001/manifest.json",
        bundle_content_sha256="a" * 64,
        bundle_byte_size=4096,
        manifest_content_sha256="b" * 64,
        manifest_byte_size=2048,
    )


if __name__ == "__main__":
    unittest.main()
