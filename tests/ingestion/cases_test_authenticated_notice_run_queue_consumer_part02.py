# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_authenticated_notice_run_queue_consumer_support import *


class AuthenticatedNoticeRunQueueConsumerTestPart02(unittest.TestCase):
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

    def test_execute_reports_operator_run_processing_projection(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="muc_internal_portal:notice:20260428T181953007Z",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        reporter = support._RecordingRunProcessingProjectionReporter()
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
                        "selected_notice_ids": ["355867"],
                    }
                ),
                run_processing_projection_reporter=reporter,
                run_processing_projection_producer_version="test.run@1",
                mode="execute",
                worker_id="worker-a",
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
                source_truth_only=True,
                consumer_admission_manifest_path=consumer_manifest_path,
            )

        self.assertEqual(len(reporter.calls), 1)
        snapshot = reporter.calls[0][0]
        self.assertEqual(snapshot["collectorRunToken"], "20260428T181953007Z")
        self.assertEqual(snapshot["queueJobCount"], 1)
        self.assertEqual(snapshot["queueStatusCounts"]["succeeded"], 1)
        self.assertEqual(snapshot["producerVersion"], "test.run@1")

    def test_source_truth_only_selected_run_reports_operator_processing_projection(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355959", "title": "岗位聘用通知"}])
        manifest_bytes = support._json_bytes(
            {"run_id": "run-001", "filters": {"selected_notice_ids": ["355959"]}}
        )
        store = InMemoryNoticeIngestQueueStore()
        job = support._job(
            run_id="muc_internal_portal:notice:20260428T180931937Z:canary:355959",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        reporter = support._RecordingProcessingProjectionReporter()

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
                    "selected_notice_ids": ["355959"],
                    "source_truth_only": True,
                }
            ),
            processing_projection_reporter=reporter,
            processing_projection_producer_version="test@source-truth-only",
            mode="execute",
            worker_id="worker-a",
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            source_truth_only=True,
        )

        self.assertEqual(len(reporter.calls), 1)
        snapshot = reporter.calls[0][0]
        self.assertEqual(snapshot["noticeId"], "355959")
        self.assertEqual(snapshot["lifecycleStatus"], "imported")
        self.assertEqual(snapshot["materializationStatus"], "skipped_source_truth_only")
        self.assertEqual(snapshot["producerVersion"], "test@source-truth-only")

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
