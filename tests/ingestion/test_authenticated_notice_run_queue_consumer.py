from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer import (
    AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_SCHEMA_VERSION,
    consume_authenticated_notice_ingest_queue,
)
from campus_ingestion_core.collected_notice_ingest_queue import (
    build_authenticated_notice_run_ingest_job,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)


class AuthenticatedNoticeRunQueueConsumerTest(unittest.TestCase):
    def test_execute_imports_verified_run_and_marks_queue_succeeded(self) -> None:
        bundle_bytes = _json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = _json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        importer = _RecordingImporter({"notice_count": 1, "source_truth_only": True})

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=_ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=_resolver_for(job),
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

    def test_missing_source_object_maps_to_retryable_failure_with_retry_after(self) -> None:
        bundle_bytes = _json_bytes([{"notice_id": "355867"}])
        manifest_bytes = _json_bytes({"run_id": "run-001"})
        store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=_ObjectStore(
                {
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=_resolver_for(job),
            importer=_RecordingImporter({}),
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
        payload = _json_bytes([{"notice_id": "355867"}])
        manifest = _json_bytes({"run_id": "run-002"})
        store = InMemoryNoticeIngestQueueStore()
        job_1 = _job(
            run_id="run-001",
            bundle_sha=_sha(payload),
            bundle_size=len(payload),
            manifest_sha=_sha(manifest),
            manifest_size=len(manifest),
        )
        job_2 = _job(
            run_id="run-002",
            bundle_sha=_sha(payload),
            bundle_size=len(payload),
            manifest_sha=_sha(manifest),
            manifest_size=len(manifest),
        )
        store.enqueue(job_1)
        store.enqueue(job_2)

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=_ObjectStore(
                {
                    ("campus-rag-source", job_2.bundle_object_key): payload,
                    ("campus-rag-source", job_2.manifest_object_key): manifest,
                }
            ),
            run_ref_resolver=_resolver_for(job_2),
            importer=_RecordingImporter({"notice_count": 1}),
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
        bundle_bytes = _json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = _json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=_ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=_resolver_for(job),
            importer=_RecordingImporter({"notice_count": 1}),
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
        bundle_bytes = _json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = _json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        with TemporaryDirectory() as tmpdir:
            operations_root = Path(tmpdir) / "operations"
            evidence_dir = operations_root / "run-001" / job.job_id / "attempt-001"
            _write_passed_media_gate_evidence(evidence_dir)
            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=_ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=_resolver_for(job),
                importer=_RecordingImporter({"notice_count": 1}),
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
        bundle_bytes = _json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = _json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        with TemporaryDirectory() as tmpdir:
            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=_ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=_resolver_for(job),
                importer=_RecordingImporter({"notice_count": 1}),
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
        bundle_bytes = _json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = _json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        importer = _RecordingImporter(
            {
                "notice_count": 1,
                "consumption_projection_entry_count": 1,
                "internal_notice_read_model_entry_count": 1,
            }
        )

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=_ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=_resolver_for(job),
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
        bundle_bytes = _json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = _json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        with TemporaryDirectory() as tmpdir:
            consumer_manifest_path = Path(tmpdir) / "consumer-admission.json"
            consumer_manifest_path.write_text("{}", encoding="utf-8")

            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=_ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=_resolver_for(job),
                importer=_RecordingImporter(
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

    def test_missing_downstream_materialization_result_maps_to_manual_review(self) -> None:
        bundle_bytes = _json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = _json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)
        with TemporaryDirectory() as tmpdir:
            consumer_manifest_path = Path(tmpdir) / "consumer-admission.json"
            consumer_manifest_path.write_text("{}", encoding="utf-8")

            result = consume_authenticated_notice_ingest_queue(
                queue_store=store,
                object_store=_ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=_resolver_for(job),
                importer=_RecordingImporter({"notice_count": 1}),
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

    def test_cleanup_dry_run_posture_is_recorded_when_report_path_is_supplied(self) -> None:
        bundle_bytes = _json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = _json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
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
                object_store=_ObjectStore(
                    {
                        ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                        ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                    }
                ),
                run_ref_resolver=_resolver_for(job),
                importer=_RecordingImporter({"notice_count": 1}),
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
        bundle_bytes = _json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = _json_bytes({"run_id": "run-001", "filters": {}})
        store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        store.enqueue(job)

        result = consume_authenticated_notice_ingest_queue(
            queue_store=store,
            object_store=_ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=_resolver_for(job),
            importer=_RecordingImporter({"notice_count": 1}),
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


class _ObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self._objects = objects

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self._objects[(bucket, key)]
        except KeyError as exc:
            raise KeyError(f"{bucket}/{key}") from exc


class _RecordingImporter:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result
        self.requests = []

    def __call__(self, *, request, env, object_store):
        del env, object_store
        self.requests.append(request)
        return dict(self.result)


def _resolver_for(job):
    def _resolve(*, env, run_id, expected_source_surface, table_name):
        del env, table_name
        if run_id != job.run_id:
            raise ValueError(f"unexpected run_id: {run_id}")
        return AuthenticatedNoticeCollectorRunObjectRefs(
            run_id=job.run_id,
            source_surface=expected_source_surface,
            source_bucket=job.source_bucket,
            bundle_object_key=job.bundle_object_key,
            manifest_object_key=job.manifest_object_key,
            bundle_content_sha256=job.bundle_content_sha256,
            bundle_byte_size=job.bundle_byte_size,
            manifest_content_sha256=job.manifest_content_sha256,
            manifest_byte_size=job.manifest_byte_size,
        )

    return _resolve


def _job(
    *,
    run_id: str,
    bundle_sha: str,
    bundle_size: int,
    manifest_sha: str,
    manifest_size: int,
):
    return build_authenticated_notice_run_ingest_job(
        source_surface="notice",
        site_id="muc_internal_portal",
        run_id=run_id,
        source_bucket="campus-rag-source",
        bundle_object_key=f"authenticated_notice_portal/runs/{run_id}/bundle.json",
        bundle_content_sha256=bundle_sha,
        bundle_byte_size=bundle_size,
        manifest_object_key=f"authenticated_notice_portal/runs/{run_id}/manifest.json",
        manifest_content_sha256=manifest_sha,
        manifest_byte_size=manifest_size,
        enqueue_source="manual_replay",
        replay_batch_id="manual-run-20260501",
    )


def _json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")


def _sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _write_passed_media_gate_evidence(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    artifact_payloads = {
        "media-extraction-candidate-inventory.json": {"candidates": []},
        "media-extraction-attempt-ledger.json": {"attempts": []},
        "media-extraction-candidate-inventory.closeout.json": {"candidates": []},
        "target-admission-manifest.json": {"admissions": []},
        "cleanup.dry-run.json": {"items": []},
        "media-source-object-verification-report.json": {"objects": []},
    }
    for filename, payload in artifact_payloads.items():
        (root / filename).write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    audit = {
        "verdict": "passed",
        "strict_gate": True,
        "finding_count": 0,
        "input_hashes": {
            "candidate_inventory_sha256": _sha(
                (root / "media-extraction-candidate-inventory.json").read_bytes()
            ),
            "attempt_ledger_sha256": _sha(
                (root / "media-extraction-attempt-ledger.json").read_bytes()
            ),
            "closeout_candidate_inventory_sha256": _sha(
                (root / "media-extraction-candidate-inventory.closeout.json").read_bytes()
            ),
            "target_admission_manifest_1_sha256": _sha(
                (root / "target-admission-manifest.json").read_bytes()
            ),
            "cleanup_report_sha256": _sha((root / "cleanup.dry-run.json").read_bytes()),
            "object_verification_report_sha256": _sha(
                (root / "media-source-object-verification-report.json").read_bytes()
            ),
        },
    }
    (root / "media-closeout-state-machine-audit.json").write_text(
        json.dumps(audit, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    unittest.main()
