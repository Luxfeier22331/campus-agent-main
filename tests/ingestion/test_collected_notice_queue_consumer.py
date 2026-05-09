from __future__ import annotations

import json
import unittest
from collections.abc import Mapping

from campus_ingestion_core.collected_notice_historical_enqueue import (
    build_historical_notice_enqueue_plan,
)
from campus_ingestion_core.collected_notice_ingest_queue import (
    NoticeIngestObjectRef,
    build_notice_ingest_job,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    notice_ingest_job_from_payload,
)
from campus_ingestion_core.collected_notice_queue_consumer import (
    CollectedNoticeQueueConsumeWriter,
    consume_collected_notice_ingest_queue,
)
from campus_ingestion_core.collected_notice_reimport_preview import (
    CollectedNoticeCapturedRunRef,
    build_collected_notice_reimport_preview,
)

from tests.ingestion.authenticated_notice_import_test_support import (
    _sample_export_manifest,
    _sample_notice_bundle,
)


class CollectedNoticeQueueConsumerTest(unittest.TestCase):
    def test_dry_run_leases_job_without_completing_or_writing(self) -> None:
        fixture = _queue_fixture()

        result = consume_collected_notice_ingest_queue(
            queue_store=fixture.queue_store,
            object_store=fixture.object_store,
            mode="dry_run",
            worker_id="phase-4-8-test-worker",
            lease_seconds=60,
            limit=1,
            writer=_FailingWriter(),
        )

        self.assertEqual(result.queue_consume["mode"], "dry_run")
        self.assertFalse(result.queue_consume["write_enabled"])
        self.assertEqual(result.queue_consume["counts"]["leased_count"], 1)
        self.assertEqual(result.queue_consume["counts"]["completed_count"], 0)
        self.assertEqual(result.queue_consume["counts"]["failed_count"], 0)
        self.assertEqual(fixture.queue_store.get(fixture.job_id).status, "leased")
        self.assertEqual(result.searchable_coverage["verdict"], "passed")
        trace_row = result.trace["trace_rows"][0]
        self.assertEqual(trace_row["job_id"], fixture.job_id)
        self.assertEqual(
            trace_row["searchable_unit_refs"],
            ["searchable:notice:muc_internal_portal:355119"],
        )
        self.assertEqual(fixture.object_store.puts, [])

    def test_execute_writes_projection_and_completes_job(self) -> None:
        fixture = _queue_fixture()
        writer = _RecordingWriter()

        result = consume_collected_notice_ingest_queue(
            queue_store=fixture.queue_store,
            object_store=fixture.object_store,
            mode="execute",
            worker_id="phase-4-8-test-worker",
            lease_seconds=60,
            limit=1,
            writer=writer,
        )

        self.assertEqual(result.queue_consume["mode"], "execute")
        self.assertTrue(result.queue_consume["write_enabled"])
        self.assertEqual(result.queue_consume["counts"]["completed_count"], 1)
        self.assertEqual(fixture.queue_store.get(fixture.job_id).status, "succeeded")
        self.assertEqual(writer.write_count, 1)
        self.assertEqual(
            writer.searchable_unit_refs,
            ["searchable:notice:muc_internal_portal:355119"],
        )
        self.assertEqual(writer.received_admission_candidate_count, 0)

    def test_missing_required_input_ref_is_terminal_failure_in_execute(self) -> None:
        object_store = _ReadOnlyObjectStore()
        queue_store = InMemoryNoticeIngestQueueStore()
        job = build_notice_ingest_job(
            source_channel="authenticated_notice_portal",
            source_surface="notice",
            source_identity="muc_internal_portal:355119",
            capture_id="capture:muc_internal_portal:notice:355119:sha256-a",
            capture_manifest_object_ref=_object_ref(
                "source-truth/notice-manifest.json",
                key="authenticated_notice_portal/355119/source-truth/notice-manifest.json",
            ),
            source_object_refs=(
                _object_ref(
                    "collector_manifest",
                    key="authenticated_notice_portal/runs/run-001/export-manifest.json",
                ),
            ),
            content_hash="sha256-a",
            run_id="run-001",
            enqueue_source="historical_backfill",
            replay_batch_id="phase-04-8-test",
        )
        queue_store.enqueue(job)

        result = consume_collected_notice_ingest_queue(
            queue_store=queue_store,
            object_store=object_store,
            mode="execute",
            worker_id="phase-4-8-test-worker",
            lease_seconds=60,
            limit=1,
            writer=_RecordingWriter(),
        )

        record = queue_store.get(job.job_id)
        self.assertEqual(record.status, "failed_terminal")
        self.assertEqual(record.last_error_code, "missing_required_input_object_ref")
        self.assertEqual(result.failed_report["failed_items"][0]["failure_class"], "terminal")

    def test_missing_object_store_input_is_retryable_failure_in_execute(self) -> None:
        fixture = _queue_fixture(include_objects=False)

        result = consume_collected_notice_ingest_queue(
            queue_store=fixture.queue_store,
            object_store=fixture.object_store,
            mode="execute",
            worker_id="phase-4-8-test-worker",
            lease_seconds=60,
            limit=1,
            writer=_RecordingWriter(),
        )

        record = fixture.queue_store.get(fixture.job_id)
        self.assertEqual(record.status, "failed_retryable")
        self.assertEqual(record.attempt_count, 1)
        self.assertIsNotNone(record.next_retry_after)
        self.assertEqual(record.last_error_code, "source_object_unavailable")
        self.assertEqual(result.failed_report["failed_items"][0]["failure_class"], "retryable")

    def test_replay_batch_filter_only_leases_matching_jobs(self) -> None:
        matching = _queue_fixture(replay_batch_id="batch-a")
        other_job = _queue_fixture(replay_batch_id="batch-b").job_payload
        matching.queue_store.enqueue(notice_ingest_job_from_payload(other_job))

        result = consume_collected_notice_ingest_queue(
            queue_store=matching.queue_store,
            object_store=matching.object_store,
            mode="dry_run",
            worker_id="phase-4-8-test-worker",
            lease_seconds=60,
            limit=10,
            replay_batch_id="batch-a",
            writer=_FailingWriter(),
        )

        self.assertEqual(result.queue_consume["counts"]["leased_count"], 1)
        self.assertEqual(
            {row["replay_batch_id"] for row in result.trace["trace_rows"]},
            {"batch-a"},
        )


class _ReadOnlyObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.gets: list[tuple[str, str]] = []
        self.puts: list[tuple[str, str]] = []

    def add_json(self, *, bucket: str, key: str, payload: object) -> None:
        self.objects[(bucket, key)] = (
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        ).encode("utf-8")

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.gets.append((bucket, key))
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.puts.append((bucket, key))
        raise AssertionError("queue consume preview must not write object-store bytes")


class _RecordingWriter(CollectedNoticeQueueConsumeWriter):
    def __init__(self) -> None:
        self.write_count = 0
        self.searchable_unit_refs: list[str] = []
        self.received_admission_candidate_count = 0

    def write_consumed_job(
        self,
        *,
        job_id: str,
        source_truth_candidates: tuple[Mapping[str, object], ...],
        searchable_units: tuple[Mapping[str, object], ...],
    ) -> Mapping[str, object]:
        self.write_count += 1
        self.searchable_unit_refs.extend(str(unit["unit_id"]) for unit in searchable_units)
        self.received_admission_candidate_count += 0
        return {
            "source_truth_write_count": len(source_truth_candidates),
            "searchable_write_count": len(searchable_units),
        }


class _FailingWriter(_RecordingWriter):
    def write_consumed_job(
        self,
        *,
        job_id: str,
        source_truth_candidates: tuple[Mapping[str, object], ...],
        searchable_units: tuple[Mapping[str, object], ...],
    ) -> Mapping[str, object]:
        raise AssertionError("dry-run must not call the queue consume writer")


class _QueueFixture:
    def __init__(
        self,
        *,
        queue_store: InMemoryNoticeIngestQueueStore,
        object_store: _ReadOnlyObjectStore,
        job_payload: dict[str, object],
    ) -> None:
        self.queue_store = queue_store
        self.object_store = object_store
        self.job_payload = job_payload
        self.job_id = str(job_payload["job_id"])


def _queue_fixture(
    *,
    include_objects: bool = True,
    replay_batch_id: str = "phase-04-8-test",
) -> _QueueFixture:
    object_store = _ReadOnlyObjectStore()
    bucket = "campus-rag-source"
    bundle_key = "authenticated_notice_portal/runs/run-001/notices-bundle.json"
    manifest_key = "authenticated_notice_portal/runs/run-001/export-manifest.json"
    if include_objects:
        object_store.add_json(bucket=bucket, key=bundle_key, payload=_sample_notice_bundle())
        object_store.add_json(bucket=bucket, key=manifest_key, payload=_sample_export_manifest())
    preview = build_collected_notice_reimport_preview(
        run_refs=(
            CollectedNoticeCapturedRunRef(
                run_id="run-001",
                source_surface="notice",
                source_bucket=bucket,
                bundle_object_key=bundle_key,
                manifest_object_key=manifest_key,
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
            ),
        ),
        env={},
        object_store=object_store if include_objects else _preview_only_object_store(),
    )
    enqueue_plan = build_historical_notice_enqueue_plan(
        preview.reimport_plan,
        replay_batch_id=replay_batch_id,
    )
    job_payload = dict(enqueue_plan["jobs"][0])
    queue_store = InMemoryNoticeIngestQueueStore()
    queue_store.enqueue(notice_ingest_job_from_payload(job_payload))
    return _QueueFixture(
        queue_store=queue_store,
        object_store=object_store,
        job_payload=job_payload,
    )


def _preview_only_object_store() -> _ReadOnlyObjectStore:
    object_store = _ReadOnlyObjectStore()
    bucket = "campus-rag-source"
    object_store.add_json(
        bucket=bucket,
        key="authenticated_notice_portal/runs/run-001/notices-bundle.json",
        payload=_sample_notice_bundle(),
    )
    object_store.add_json(
        bucket=bucket,
        key="authenticated_notice_portal/runs/run-001/export-manifest.json",
        payload=_sample_export_manifest(),
    )
    return object_store


def _object_ref(role: str, *, key: str) -> NoticeIngestObjectRef:
    return NoticeIngestObjectRef(
        bucket="campus-rag-source",
        key=key,
        role=role,
    )


if __name__ == "__main__":
    unittest.main()
