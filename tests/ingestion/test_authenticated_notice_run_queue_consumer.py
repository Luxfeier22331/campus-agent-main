from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_notice_run_queue_consumer import (
    AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_SCHEMA_VERSION,
    consume_authenticated_notice_ingest_queue,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)

from tests.ingestion import authenticated_notice_run_queue_consumer_support as support


class AuthenticatedNoticeRunQueueConsumerTest(unittest.TestCase):
    def test_execute_imports_verified_run_and_marks_queue_succeeded(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        importer = support._RecordingImporter({"notice_count": 1, "source_truth_only": True})

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=support._ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=support._resolver_for(job),
            importer=importer,
            mode="execute",
            worker_id="worker-a",
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            source_truth_only=True,
        )

        self.assertEqual(
            result.queue_consume["schema_version"],
            AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_SCHEMA_VERSION,
        )
        self.assertEqual(result.queue_consume["counts"]["completed_count"], 1)
        self.assertEqual(result.queue_consume["counts"]["failed_count"], 0)
        self.assertEqual(store.get(job.job_id).status, "succeeded")  # type: ignore[union-attr]
        self.assertEqual(len(importer.requests), 1)
        request = importer.requests[0]
        self.assertEqual(request.source_bucket, "campus-rag-source")
        self.assertEqual(request.bundle_object_key, job.bundle_object_key)
        self.assertEqual(request.manifest_object_key, job.manifest_object_key)
        self.assertIsNone(request.bundle_path)
        self.assertIsNone(request.export_manifest_path)
        self.assertFalse(request.allow_local_fixture_import)
        row = result.trace["trace_rows"][0]
        self.assertEqual(row["child_task_summary"]["by_state"]["completed"], 3)
        self.assertEqual(row["child_task_summary"]["highest_severity"], "none")
        self.assertEqual(row["child_tasks"][0]["task_kind"], "source_unit_import")
        self.assertGreaterEqual(len(row["progress_events"]), 3)

    def test_execute_heartbeats_long_running_import_before_completion(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = support._HeartbeatRecordingQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        importer = support._WaitForHeartbeatImporter(
            store.heartbeat_seen,
            {"notice_count": 1, "source_truth_only": True},
        )

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=support._ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=support._resolver_for(job),
            importer=importer,
            mode="execute",
            worker_id="worker-a",
            lease_seconds=3,
            heartbeat_interval_seconds=0.01,
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            source_truth_only=True,
        )

        self.assertEqual(store.get(job.job_id).status, "succeeded")  # type: ignore[union-attr]
        self.assertGreaterEqual(store.heartbeat_count, 1)
        self.assertTrue(importer.observed_heartbeat)
        row = result.trace["trace_rows"][0]
        self.assertTrue(row["lease_heartbeat"]["enabled"])
        self.assertEqual(row["lease_heartbeat"]["heartbeat_failed"], False)
        self.assertGreaterEqual(row["lease_heartbeat"]["heartbeat_count"], 1)

    def test_execute_maps_heartbeat_failure_to_retryable_failure(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = support._FailingHeartbeatQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        importer = support._WaitForHeartbeatAttemptImporter(
            store.heartbeat_attempted,
            {"notice_count": 1, "source_truth_only": True},
        )

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=support._ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=support._resolver_for(job),
            importer=importer,
            mode="execute",
            worker_id="worker-a",
            lease_seconds=3,
            heartbeat_interval_seconds=0.01,
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            source_truth_only=True,
        )

        record = store.get(job.job_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, "failed_retryable")
        self.assertEqual(record.last_error_code, "lease_heartbeat_failed")
        self.assertEqual(result.queue_consume["counts"]["completed_count"], 0)
        self.assertEqual(result.queue_consume["counts"]["retryable_count"], 1)
        row = result.trace["trace_rows"][0]
        self.assertTrue(row["lease_heartbeat"]["heartbeat_failed"])
        self.assertIn("boom", row["lease_heartbeat"]["last_error_message"])

    def test_missing_source_object_maps_to_retryable_failure_with_retry_after(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001"})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=support._ObjectStore(
                {
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=support._resolver_for(job),
            importer=support._RecordingImporter({}),
            mode="execute",
            worker_id="worker-a",
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            retry_after_seconds=90,
        )

        record = store.get(job.job_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, "failed_retryable")
        self.assertEqual(record.last_error_code, "source_object_unavailable")
        self.assertIsNotNone(record.next_retry_after)
        self.assertEqual(result.failed_report["retryable_count"], 1)
        self.assertEqual(result.queue_consume["counts"]["completed_count"], 0)

    def test_run_id_filter_does_not_claim_other_runs(self) -> None:
        payload = support._json_bytes([{"notice_id": "355867"}])
        manifest = support._json_bytes({"run_id": "run-002"})
        store = InMemoryNoticeIngestQueueStore()
        job_1 = support._job(
            run_id="run-001",
            bundle_sha=support._sha(payload),
            bundle_size=len(payload),
            manifest_sha=support._sha(manifest),
            manifest_size=len(manifest),
        )
        job_2 = support._job(
            run_id="run-002",
            bundle_sha=support._sha(payload),
            bundle_size=len(payload),
            manifest_sha=support._sha(manifest),
            manifest_size=len(manifest),
        )
        store.enqueue(job_1)
        store.enqueue(job_2)

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=support._ObjectStore(
                {
                    ("campus-rag-source", job_2.bundle_object_key): payload,
                    ("campus-rag-source", job_2.manifest_object_key): manifest,
                }
            ),
            run_ref_resolver=support._resolver_for(job_2),
            importer=support._RecordingImporter({"notice_count": 1}),
            mode="execute",
            worker_id="worker-a",
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            run_id="run-002",
        )

        self.assertEqual(result.queue_consume["counts"]["leased_count"], 1)
        self.assertEqual(store.get(job_1.job_id).status, "queued")  # type: ignore[union-attr]
        self.assertEqual(store.get(job_2.job_id).status, "succeeded")  # type: ignore[union-attr]

    def test_dry_run_releases_claimed_job_without_terminal_state_mutation(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=support._ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=support._resolver_for(job),
            importer=support._RecordingImporter({"notice_count": 1}),
            mode="dry_run",
            worker_id="worker-a",
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
        )

        record = store.get(job.job_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, "queued")
        self.assertIsNone(record.leased_by)
        self.assertEqual(result.queue_consume["counts"]["completed_count"], 0)

    def test_required_media_gate_uses_consumer_owned_operations_dir(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        with TemporaryDirectory() as tmpdir:
            operations_root = Path(tmpdir) / "operations"
            evidence_dir = operations_root / "run-001" / job.job_id / "attempt-001"
            support._write_passed_media_gate_evidence(evidence_dir)
            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=support._ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=support._resolver_for(job),
                importer=support._RecordingImporter({"notice_count": 1}),
                mode="execute",
                worker_id="worker-a",
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
                require_media_gate=True,
                operations_dir=operations_root,
            )
            self.assertTrue(
                (evidence_dir / "authenticated-notice-media-gate-evidence.json").exists()
            )
            self.assertTrue(
                (evidence_dir / "authenticated-notice-media-gate-evidence-verdict.json").exists()
            )

        record = store.get(job.job_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, "succeeded")
        self.assertEqual(result.failed_report["manual_review_count"], 0)
        row = result.trace["trace_rows"][0]
        self.assertEqual(row["operations_dir"], str(evidence_dir))
        self.assertEqual(row["media_gate"]["verdict"], "passed")

    def test_required_media_gate_missing_consumer_owned_evidence_maps_to_manual_review(
        self,
    ) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        with TemporaryDirectory() as tmpdir:
            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=support._ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=support._resolver_for(job),
                importer=support._RecordingImporter({"notice_count": 1}),
                mode="execute",
                worker_id="worker-a",
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
                require_media_gate=True,
                operations_dir=Path(tmpdir) / "operations",
            )

        record = store.get(job.job_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, "manual_review")
        self.assertEqual(record.last_error_code, "media_gate_requires_manual_review")
        self.assertEqual(result.failed_report["manual_review_count"], 1)

    def test_downstream_materialization_requires_consumer_admission_manifest(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        importer = support._RecordingImporter(
            {
                "notice_count": 1,
                "consumption_projection_entry_count": 1,
                "internal_notice_read_model_entry_count": 1,
            }
        )

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=support._ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=support._resolver_for(job),
            importer=importer,
            mode="execute",
            worker_id="worker-a",
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            source_truth_only=False,
        )

        record = store.get(job.job_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, "manual_review")
        self.assertEqual(record.last_error_code, "consumer_admission_manifest_required")
        self.assertEqual(result.failed_report["manual_review_count"], 1)
        self.assertEqual(len(importer.requests), 0)

    def test_downstream_materialization_trace_is_required_when_requested(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        with TemporaryDirectory() as tmpdir:
            consumer_manifest_path = Path(tmpdir) / "consumer-admission.json"
            consumer_manifest_path.write_text("{}", encoding="utf-8")

            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=support._ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=support._resolver_for(job),
                importer=support._RecordingImporter(
                    {
                        "notice_count": 1,
                        "consumption_projection_entry_count": 1,
                        "internal_notice_read_model_entry_count": 1,
                        "consumer_admission_projection_gate": {"allowed": True},
                        "consumer_admission_read_model_gate": {"allowed": True},
                    }
                ),
                mode="execute",
                worker_id="worker-a",
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
                source_truth_only=False,
                consumer_admission_manifest_path=consumer_manifest_path,
            )

        row = result.trace["trace_rows"][0]
        self.assertEqual(row["downstream_materialization"]["status"], "completed")
        self.assertEqual(
            row["downstream_materialization"]["consumption_projection_entry_count"],
            1,
        )
        self.assertEqual(
            row["downstream_materialization"]["internal_notice_read_model_entry_count"],
            1,
        )
        self.assertEqual(store.get(job.job_id).status, "succeeded")  # type: ignore[union-attr]
        self.assertEqual(
            row["child_task_summary"]["by_kind"]["downstream_materialization"],
            1,
        )
        self.assertEqual(row["child_task_summary"]["highest_severity"], "none")

    def test_ready_typed_candidate_requires_typed_materializer_when_downstream_requested(
        self,
    ) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        with TemporaryDirectory() as tmpdir:
            consumer_manifest_path = Path(tmpdir) / "consumer-admission.json"
            consumer_manifest_path.write_text("{}", encoding="utf-8")

            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=support._ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=support._resolver_for(job),
                importer=support._RecordingImporter(
                    {
                        "notice_count": 1,
                        "consumption_projection_entry_count": 2,
                        "internal_notice_read_model_entry_count": 1,
                        "typed_materialization_candidate_count": 1,
                    }
                ),
                mode="execute",
                worker_id="worker-a",
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
                source_truth_only=False,
                consumer_admission_manifest_path=consumer_manifest_path,
            )

        record = store.get(job.job_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, "manual_review")
        self.assertEqual(record.last_error_code, "downstream_materialization_missing")
        row = result.trace["trace_rows"][0]
        self.assertEqual(row["downstream_materialization"]["status"], "missing")
        self.assertEqual(
            row["downstream_materialization"]["typed_materialization_candidate_count"], 1
        )
        self.assertEqual(row["child_task_summary"]["highest_severity"], "medium")

    def test_typed_materializer_result_completes_downstream_materialization(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        materializer = support._RecordingTypedMaterializer(
            {
                "schema_version": "authenticated_notice_typed_downstream_materialization.v1",
                "status": "completed",
                "candidate_count": 1,
                "completed_count": 1,
                "materialized_releases": [
                    {
                        "collection": "transport_schedule",
                        "release_id": "release-001",
                        "current": True,
                    }
                ],
            }
        )
        with TemporaryDirectory() as tmpdir:
            operations_root = Path(tmpdir) / "operations"
            consumer_manifest_path = Path(tmpdir) / "consumer-admission.json"
            consumer_manifest_path.write_text("{}", encoding="utf-8")

            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=support._ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=support._resolver_for(job),
                importer=support._RecordingImporter(
                    {
                        "notice_count": 1,
                        "consumption_projection_entry_count": 2,
                        "internal_notice_read_model_entry_count": 1,
                        "typed_materialization_candidate_count": 1,
                    }
                ),
                typed_downstream_materializer=materializer,
                mode="execute",
                worker_id="worker-a",
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
                source_truth_only=False,
                operations_dir=operations_root,
                consumer_admission_manifest_path=consumer_manifest_path,
            )

        self.assertEqual(store.get(job.job_id).status, "succeeded")  # type: ignore[union-attr]
        self.assertEqual(len(materializer.calls), 1)
        call = materializer.calls[0]
        self.assertEqual(call["run_id"], "run-001")
        self.assertEqual(call["job_id"], job.job_id)
        self.assertEqual(call["consumer_admission_manifest_path"], consumer_manifest_path)
        self.assertEqual(call["source_corpus"], "campus_notices")
        self.assertEqual(call["source_collection"], "internal_notice")
        self.assertEqual(
            call["operations_dir"], operations_root / "run-001" / job.job_id / "attempt-001"
        )
        downstream = result.trace["trace_rows"][0]["downstream_materialization"]
        self.assertEqual(downstream["status"], "completed")
        self.assertEqual(downstream["typed_materialization"]["completed_count"], 1)
        self.assertEqual(
            downstream["typed_materialization"]["materialized_releases"][0]["collection"],
            "transport_schedule",
        )

    def test_execute_reports_operator_processing_projection(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        reporter = support._RecordingProcessingProjectionReporter()
        materializer = support._RecordingTypedMaterializer(
            {
                "schema_version": "authenticated_notice_typed_downstream_materialization.v1",
                "status": "completed",
                "candidate_count": 1,
                "completed_count": 1,
                "materialized_releases": [
                    {
                        "candidate_kind": "transport_schedule",
                        "collection": "transport_schedule",
                        "current": True,
                        "notice_ids": ["355867"],
                        "release_id": "release-001",
                        "notice_read_model_counts": {
                            "355867": {
                                "rejectedSources": 0,
                                "scheduledDepartures": 49,
                            }
                        },
                    }
                ],
            }
        )
        with TemporaryDirectory() as tmpdir:
            consumer_manifest_path = Path(tmpdir) / "consumer-admission.json"
            consumer_manifest_path.write_text("{}", encoding="utf-8")

            consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=support._ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=support._resolver_for(job),
                importer=support._RecordingImporter(
                    {
                        "notice_count": 1,
                        "selected_notices": [
                            {
                                "notice_id": "355867",
                                "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                            }
                        ],
                        "selected_notice_ids": ["355867"],
                    }
                ),
                typed_downstream_materializer=materializer,
                processing_projection_reporter=reporter,
                processing_projection_producer_version="test@1",
                mode="execute",
                worker_id="worker-a",
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
                source_truth_only=False,
                consumer_admission_manifest_path=consumer_manifest_path,
            )

        self.assertEqual(len(reporter.calls), 1)
        snapshot = reporter.calls[0][0]
        self.assertEqual(snapshot["noticeId"], "355867")
        self.assertEqual(snapshot["lifecycleStatus"], "tool_ready")
        self.assertEqual(snapshot["candidateKind"], "transport_schedule")
        self.assertEqual(snapshot["readModelCounts"]["scheduledDepartures"], 49)
        self.assertTrue(snapshot["toolReady"])

    def test_downstream_request_invokes_typed_materializer_for_selected_notice_replay(
        self,
    ) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        materializer = support._RecordingTypedMaterializer(
            {
                "schema_version": "authenticated_notice_typed_downstream_materialization.v1",
                "status": "completed",
                "candidate_count": 1,
                "completed_count": 1,
                "materialized_releases": [
                    {
                        "collection": "transport_schedule",
                        "release_id": "release-001",
                        "current": True,
                    }
                ],
            }
        )
        with TemporaryDirectory() as tmpdir:
            consumer_manifest_path = Path(tmpdir) / "consumer-admission.json"
            consumer_manifest_path.write_text("{}", encoding="utf-8")

            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=support._ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=support._resolver_for(job),
                importer=support._RecordingImporter(
                    {
                        "notice_count": 1,
                        "selected_notice_ids": ["355867"],
                    }
                ),
                typed_downstream_materializer=materializer,
                mode="execute",
                worker_id="worker-a",
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
                source_truth_only=False,
                consumer_admission_manifest_path=consumer_manifest_path,
            )

        self.assertEqual(store.get(job.job_id).status, "succeeded")  # type: ignore[union-attr]
        self.assertEqual(len(materializer.calls), 1)
        downstream = result.trace["trace_rows"][0]["downstream_materialization"]
        self.assertEqual(downstream["status"], "completed")
        self.assertEqual(downstream["typed_materialization_candidate_count"], 0)
        self.assertEqual(downstream["typed_materialization"]["candidate_count"], 1)

    def test_missing_downstream_materialization_result_maps_to_manual_review(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        with TemporaryDirectory() as tmpdir:
            consumer_manifest_path = Path(tmpdir) / "consumer-admission.json"
            consumer_manifest_path.write_text("{}", encoding="utf-8")

            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=support._ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=support._resolver_for(job),
                importer=support._RecordingImporter({"notice_count": 1}),
                mode="execute",
                worker_id="worker-a",
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
                source_truth_only=False,
                consumer_admission_manifest_path=consumer_manifest_path,
            )

        record = store.get(job.job_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, "manual_review")
        self.assertEqual(record.last_error_code, "downstream_materialization_missing")
        self.assertEqual(result.failed_report["manual_review_count"], 1)
        row = result.trace["trace_rows"][0]
        self.assertEqual(row["child_task_summary"]["highest_severity"], "medium")
        downstream_tasks = [
            task for task in row["child_tasks"] if task["task_kind"] == "downstream_materialization"
        ]
        self.assertEqual(
            downstream_tasks[0]["reason_code"],
            "downstream_materialization_missing",
        )

    def test_cleanup_dry_run_posture_is_recorded_when_report_path_is_supplied(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        with TemporaryDirectory() as tmpdir:
            cleanup_path = Path(tmpdir) / "cleanup.dry-run.json"
            cleanup_path.write_text(
                json.dumps(
                    {
                        "mode": "dry_run",
                        "write_enabled": False,
                        "candidate_count": 2,
                        "eligible_delete_count": 0,
                    }
                ),
                encoding="utf-8",
            )

            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=support._ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=support._resolver_for(job),
                importer=support._RecordingImporter({"notice_count": 1}),
                mode="execute",
                worker_id="worker-a",
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
                cleanup_report_path=cleanup_path,
            )

        cleanup = result.trace["trace_rows"][0]["cleanup"]
        self.assertEqual(cleanup["mode"], "dry_run")
        self.assertFalse(cleanup["destructive_cleanup_enabled"])
        self.assertEqual(cleanup["eligible_delete_count"], 0)
        self.assertEqual(store.get(job.job_id).status, "succeeded")  # type: ignore[union-attr]

    def test_destructive_cleanup_requires_passed_media_gate(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=support._ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=support._resolver_for(job),
            importer=support._RecordingImporter({"notice_count": 1}),
            mode="execute",
            worker_id="worker-a",
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            destructive_cleanup_enabled=True,
        )

        record = store.get(job.job_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, "manual_review")
        self.assertEqual(record.last_error_code, "cleanup_requires_media_gate")
        self.assertEqual(result.failed_report["manual_review_count"], 1)


if __name__ == "__main__":
    unittest.main()
