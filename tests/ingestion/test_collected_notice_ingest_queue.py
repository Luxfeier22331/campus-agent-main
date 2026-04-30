from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_core.collected_notice_ingest_queue import (
    AUTHENTICATED_NOTICE_INGEST_JOB_KIND,
    AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION,
    NOTICE_INGEST_JOB_KIND,
    NOTICE_INGEST_QUEUE_STATUSES,
    NoticeIngestObjectRef,
    build_authenticated_notice_run_ingest_job,
    build_file_release_source_identity,
    build_internal_notice_source_identity,
    build_notice_ingest_job,
    validate_notice_ingest_job_payload,
)

_FIXTURE_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "phases/phase-04-5-notice-ingest-queue-contract/fixtures"
)


def _manifest_ref() -> NoticeIngestObjectRef:
    return NoticeIngestObjectRef(
        bucket="campus-rag-source",
        key=("authenticated_notice_portal/355512/2026/source-truth/notice-manifest.json"),
        role="source-truth/notice-manifest.json",
    )


def _bundle_ref() -> NoticeIngestObjectRef:
    return NoticeIngestObjectRef(
        bucket="campus-rag-source",
        key="authenticated_notice_portal/runs/run-001/bundle.json",
        role="collector-run/bundle.json",
    )


def _run_manifest_ref() -> NoticeIngestObjectRef:
    return NoticeIngestObjectRef(
        bucket="campus-rag-source",
        key="authenticated_notice_portal/runs/run-001/manifest.json",
        role="collector-run/manifest.json",
        content_sha256=("b" * 64),
        byte_size=2048,
    )


def _run_bundle_ref() -> NoticeIngestObjectRef:
    return NoticeIngestObjectRef(
        bucket="campus-rag-source",
        key="authenticated_notice_portal/runs/run-001/bundle.json",
        role="collector-run/bundle.json",
        content_sha256=("a" * 64),
        byte_size=4096,
    )


class CollectedNoticeIngestQueueContractTests(unittest.TestCase):
    def test_authenticated_notice_run_job_is_run_level_and_object_native(self) -> None:
        job = build_authenticated_notice_run_ingest_job(
            source_surface="notice",
            site_id="muc_internal_portal",
            run_id="run-001",
            source_bucket="campus-rag-source",
            bundle_object_key="authenticated_notice_portal/runs/run-001/bundle.json",
            bundle_content_sha256=("a" * 64),
            bundle_byte_size=4096,
            manifest_object_key="authenticated_notice_portal/runs/run-001/manifest.json",
            manifest_content_sha256=("b" * 64),
            manifest_byte_size=2048,
            enqueue_source="live_discovery",
            replay_batch_id="live-20260501",
            priority=5,
            provenance={"collector_run_ledger_status": "verified"},
        )
        same_job = build_authenticated_notice_run_ingest_job(
            source_surface="notice",
            site_id="muc_internal_portal",
            run_id="run-001",
            source_bucket="campus-rag-source",
            bundle_object_key="authenticated_notice_portal/runs/run-001/bundle.json",
            bundle_content_sha256=("a" * 64),
            bundle_byte_size=4096,
            manifest_object_key="authenticated_notice_portal/runs/run-001/manifest.json",
            manifest_content_sha256=("b" * 64),
            manifest_byte_size=2048,
            enqueue_source="manual_replay",
            replay_batch_id="manual-20260501",
            priority=100,
        )
        changed_manifest = build_authenticated_notice_run_ingest_job(
            source_surface="notice",
            site_id="muc_internal_portal",
            run_id="run-001",
            source_bucket="campus-rag-source",
            bundle_object_key="authenticated_notice_portal/runs/run-001/bundle.json",
            bundle_content_sha256=("a" * 64),
            bundle_byte_size=4096,
            manifest_object_key="authenticated_notice_portal/runs/run-001/manifest.json",
            manifest_content_sha256=("c" * 64),
            manifest_byte_size=2048,
            enqueue_source="live_discovery",
            replay_batch_id="live-20260501",
        )

        payload = job.to_payload()

        self.assertEqual(payload["schema_version"], AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION)
        self.assertEqual(payload["job_kind"], AUTHENTICATED_NOTICE_INGEST_JOB_KIND)
        self.assertEqual(payload["source_identity"], "muc_internal_portal:run-001")
        self.assertEqual(payload["site_id"], "muc_internal_portal")
        self.assertEqual(payload["source_bucket"], "campus-rag-source")
        self.assertEqual(
            payload["bundle_object_key"],
            "authenticated_notice_portal/runs/run-001/bundle.json",
        )
        self.assertEqual(payload["bundle_content_sha256"], "a" * 64)
        self.assertEqual(payload["manifest_content_sha256"], "b" * 64)
        self.assertEqual(
            payload["source_object_refs"],
            [_run_bundle_ref().to_payload(), _run_manifest_ref().to_payload()],
        )
        self.assertEqual(payload["retry_policy"], {"max_attempts": 3})
        self.assertEqual(payload["provenance"], {"collector_run_ledger_status": "verified"})
        self.assertNotIn("bundle_path", payload)
        self.assertNotIn("manifest_path", payload)
        self.assertEqual(job.idempotency_key, same_job.idempotency_key)
        self.assertEqual(job.job_id, same_job.job_id)
        self.assertNotEqual(job.idempotency_key, changed_manifest.idempotency_key)
        validate_notice_ingest_job_payload(payload)

    def test_authenticated_notice_run_job_validation_rejects_local_paths(self) -> None:
        job = build_authenticated_notice_run_ingest_job(
            source_surface="notice",
            site_id="muc_internal_portal",
            run_id="run-001",
            source_bucket="campus-rag-source",
            bundle_object_key="authenticated_notice_portal/runs/run-001/bundle.json",
            bundle_content_sha256=("a" * 64),
            bundle_byte_size=4096,
            manifest_object_key="authenticated_notice_portal/runs/run-001/manifest.json",
            manifest_content_sha256=("b" * 64),
            manifest_byte_size=2048,
            enqueue_source="manual_replay",
            replay_batch_id="manual-20260501",
        )
        for field_name in ("local_path", "bundle_path", "manifest_path", "source_file_path"):
            payload = job.to_payload()
            payload[field_name] = "/tmp/local-only.json"
            with (
                self.subTest(field_name=field_name),
                self.assertRaisesRegex(ValueError, field_name),
            ):
                validate_notice_ingest_job_payload(payload)

    def test_internal_notice_job_uses_object_refs_only_and_stable_idempotency(self) -> None:
        source_identity = build_internal_notice_source_identity(
            site_id="muc_internal_portal",
            source_notice_id="355512",
        )

        job = build_notice_ingest_job(
            source_channel="authenticated_notice_portal",
            source_surface="notice",
            source_identity=source_identity,
            capture_id="capture:muc_internal_portal:notice:355512:sha256-a",
            capture_manifest_object_ref=_manifest_ref(),
            source_object_refs=(_bundle_ref(),),
            content_hash="sha256-a",
            run_id="run-001",
            enqueue_source="historical_backfill",
            replay_batch_id="phase-4-7-backfill",
            priority=50,
        )
        same_job = build_notice_ingest_job(
            source_channel="authenticated_notice_portal",
            source_surface="notice",
            source_identity=source_identity,
            capture_id="capture:muc_internal_portal:notice:355512:sha256-a",
            capture_manifest_object_ref=_manifest_ref(),
            source_object_refs=(_bundle_ref(),),
            content_hash="sha256-a",
            run_id="run-001",
            enqueue_source="manual_replay",
            replay_batch_id="manual-20260429",
            priority=10,
        )
        changed_content_job = build_notice_ingest_job(
            source_channel="authenticated_notice_portal",
            source_surface="notice",
            source_identity=source_identity,
            capture_id="capture:muc_internal_portal:notice:355512:sha256-b",
            capture_manifest_object_ref=_manifest_ref(),
            source_object_refs=(_bundle_ref(),),
            content_hash="sha256-b",
            run_id="run-002",
            enqueue_source="live_discovery",
            replay_batch_id="live-20260429",
            priority=10,
        )

        payload = job.to_payload()
        self.assertEqual(payload["job_kind"], NOTICE_INGEST_JOB_KIND)
        self.assertEqual(payload["source_identity"], "muc_internal_portal:355512")
        self.assertEqual(payload["capture_manifest_object_ref"]["bucket"], "campus-rag-source")
        self.assertEqual(payload["source_object_refs"][0]["role"], "collector-run/bundle.json")
        self.assertEqual(payload["priority"], 50)
        self.assertEqual(job.idempotency_key, same_job.idempotency_key)
        self.assertEqual(job.job_id, same_job.job_id)
        self.assertNotEqual(job.idempotency_key, changed_content_job.idempotency_key)
        self.assertNotIn("body_text", payload)
        self.assertNotIn("raw_html", payload)
        self.assertNotIn("attachment_bytes", payload)
        validate_notice_ingest_job_payload(payload)

    def test_file_release_identity_is_content_version_aware(self) -> None:
        source_identity = build_file_release_source_identity(file_release_id="8127")
        first = build_notice_ingest_job(
            source_channel="authenticated_notice_portal",
            source_surface="file_release",
            source_identity=source_identity,
            capture_id="capture:file-release:8127:sha256-a",
            capture_manifest_object_ref=_manifest_ref(),
            source_object_refs=(_bundle_ref(),),
            content_hash="sha256-a",
            run_id="run-file-001",
            enqueue_source="historical_backfill",
            replay_batch_id="phase-4-7-backfill",
        )
        second = build_notice_ingest_job(
            source_channel="authenticated_notice_portal",
            source_surface="file_release",
            source_identity=source_identity,
            capture_id="capture:file-release:8127:sha256-b",
            capture_manifest_object_ref=_manifest_ref(),
            source_object_refs=(_bundle_ref(),),
            content_hash="sha256-b",
            run_id="run-file-002",
            enqueue_source="historical_backfill",
            replay_batch_id="phase-4-7-backfill",
        )

        self.assertEqual(first.source_identity, "file_release:8127")
        self.assertNotEqual(first.idempotency_key, second.idempotency_key)

    def test_job_validation_rejects_missing_object_refs(self) -> None:
        with self.assertRaisesRegex(ValueError, "capture_manifest_object_ref"):
            build_notice_ingest_job(
                source_channel="authenticated_notice_portal",
                source_surface="notice",
                source_identity="muc_internal_portal:355512",
                capture_id="capture:muc_internal_portal:notice:355512:sha256-a",
                capture_manifest_object_ref={},
                source_object_refs=(_bundle_ref(),),
                content_hash="sha256-a",
                run_id="run-001",
                enqueue_source="historical_backfill",
                replay_batch_id="phase-4-7-backfill",
            )

        with self.assertRaisesRegex(ValueError, "source_object_refs"):
            build_notice_ingest_job(
                source_channel="authenticated_notice_portal",
                source_surface="notice",
                source_identity="muc_internal_portal:355512",
                capture_id="capture:muc_internal_portal:notice:355512:sha256-a",
                capture_manifest_object_ref=_manifest_ref(),
                source_object_refs=(),
                content_hash="sha256-a",
                run_id="run-001",
                enqueue_source="historical_backfill",
                replay_batch_id="phase-4-7-backfill",
            )

    def test_payload_validation_rejects_large_or_semantic_payload_fields(self) -> None:
        job = build_notice_ingest_job(
            source_channel="authenticated_notice_portal",
            source_surface="notice",
            source_identity="muc_internal_portal:355512",
            capture_id="capture:muc_internal_portal:notice:355512:sha256-a",
            capture_manifest_object_ref=_manifest_ref(),
            source_object_refs=(_bundle_ref(),),
            content_hash="sha256-a",
            run_id="run-001",
            enqueue_source="historical_backfill",
            replay_batch_id="phase-4-7-backfill",
        )
        payload = job.to_payload()

        for forbidden_field in (
            "body_text",
            "raw_html",
            "html",
            "attachments",
            "attachment_bytes",
            "ocr_payload",
            "content_blocks",
        ):
            with self.subTest(forbidden_field=forbidden_field):
                invalid_payload = dict(payload)
                invalid_payload[forbidden_field] = "large-content"
                with self.assertRaisesRegex(ValueError, forbidden_field):
                    validate_notice_ingest_job_payload(invalid_payload)

    def test_payload_validation_rejects_mismatched_identity_fields(self) -> None:
        job = build_notice_ingest_job(
            source_channel="authenticated_notice_portal",
            source_surface="notice",
            source_identity="muc_internal_portal:355512",
            capture_id="capture:muc_internal_portal:notice:355512:sha256-a",
            capture_manifest_object_ref=_manifest_ref(),
            source_object_refs=(_bundle_ref(),),
            content_hash="sha256-a",
            run_id="run-001",
            enqueue_source="historical_backfill",
            replay_batch_id="phase-4-7-backfill",
        )

        invalid_key_payload = job.to_payload()
        invalid_key_payload["idempotency_key"] = "notice_ingest:not-canonical"
        with self.assertRaisesRegex(ValueError, "idempotency_key"):
            validate_notice_ingest_job_payload(invalid_key_payload)

        invalid_job_id_payload = job.to_payload()
        invalid_job_id_payload["job_id"] = "notice_ingest_job:not-canonical"
        with self.assertRaisesRegex(ValueError, "job_id"):
            validate_notice_ingest_job_payload(invalid_job_id_payload)

    def test_queue_state_machine_contract_is_explicit(self) -> None:
        self.assertEqual(
            NOTICE_INGEST_QUEUE_STATUSES,
            (
                "queued",
                "leased",
                "succeeded",
                "failed_retryable",
                "failed_terminal",
                "dead_letter",
                "manual_review",
                "blocked",
                "cancelled",
            ),
        )

    def test_phase_fixtures_validate(self) -> None:
        fixture_paths = sorted(_FIXTURE_DIR.glob("*.json"))
        self.assertEqual(
            [path.name for path in fixture_paths],
            [
                "historical-backfill.notice-ingest-job.json",
                "live-discovery.notice-ingest-job.json",
                "manual-replay.notice-ingest-job.json",
            ],
        )
        for path in fixture_paths:
            with self.subTest(path=path.name):
                payload = json.loads(path.read_text(encoding="utf-8"))
                validate_notice_ingest_job_payload(payload)


if __name__ == "__main__":
    unittest.main()
