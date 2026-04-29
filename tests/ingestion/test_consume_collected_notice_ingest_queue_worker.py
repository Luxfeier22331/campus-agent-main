from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_historical_enqueue import (
    build_historical_notice_enqueue_plan,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    notice_ingest_job_from_payload,
)
from campus_ingestion_core.collected_notice_reimport_preview import (
    CollectedNoticeCapturedRunRef,
    build_collected_notice_reimport_preview,
)

from tests.ingestion.authenticated_notice_import_test_support import (
    _sample_export_manifest,
    _sample_notice_bundle,
)
from tests.ingestion.test_collected_notice_queue_consumer import (
    _ReadOnlyObjectStore,
    _RecordingWriter,
)

worker = importlib.import_module("campus_ingestion_worker.consume_collected_notice_ingest_queue")


class ConsumeCollectedNoticeIngestQueueWorkerTest(unittest.TestCase):
    def test_main_seeds_dry_run_queue_from_historical_plan_without_building_pg_store(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "phase-04-8"
            fixture = _historical_plan_fixture()
            plan_path = tmp_path / "historical-enqueue-plan.dry-run.json"
            plan_path.write_text(json.dumps(fixture.plan, ensure_ascii=False), encoding="utf-8")

            with (
                patch(
                    "campus_ingestion_worker.consume_collected_notice_ingest_queue.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.consume_collected_notice_ingest_queue."
                    "build_notice_ingest_queue_store_from_env"
                ) as build_store,
                patch(
                    "campus_ingestion_worker.consume_collected_notice_ingest_queue."
                    "build_object_store_from_env",
                    return_value=fixture.object_store,
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--historical-enqueue-plan-path",
                        str(plan_path),
                        "--output-dir",
                        str(output_dir),
                        "--limit",
                        "1",
                    ]
                )

            build_store.assert_not_called()
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertEqual(payload["counts"]["leased_count"], 1)
            expected_files = {
                "queue-consume.dry-run.json",
                "queue-consume.trace.json",
                "queue-consume-failed-report.json",
                "searchable-coverage-after-queue-consume.json",
            }
            self.assertEqual({path.name for path in output_dir.glob("*.json")}, expected_files)

    def test_execute_uses_configured_queue_store_and_writer(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "phase-04-8"
            fixture = _historical_plan_fixture()
            store = InMemoryNoticeIngestQueueStore()
            for job_payload in fixture.plan["jobs"]:
                store.enqueue(notice_ingest_job_from_payload(job_payload))
            writer = _RecordingWriter()

            with (
                patch(
                    "campus_ingestion_worker.consume_collected_notice_ingest_queue.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.consume_collected_notice_ingest_queue."
                    "build_notice_ingest_queue_store_from_env",
                    return_value=store,
                ) as build_store,
                patch(
                    "campus_ingestion_worker.consume_collected_notice_ingest_queue."
                    "build_object_store_from_env",
                    return_value=fixture.object_store,
                ),
                patch(
                    "campus_ingestion_worker.consume_collected_notice_ingest_queue."
                    "build_queue_consume_writer_from_env",
                    return_value=writer,
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--execute",
                        "--output-dir",
                        str(output_dir),
                        "--limit",
                        "1",
                    ]
                )

            build_store.assert_called_once()
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "execute")
            self.assertTrue(payload["write_enabled"])
            self.assertEqual(payload["counts"]["completed_count"], 1)
            self.assertEqual(
                writer.searchable_unit_refs, ["searchable:notice:muc_internal_portal:355119"]
            )


class _HistoricalPlanFixture:
    def __init__(self, *, plan: dict[str, object], object_store: _ReadOnlyObjectStore) -> None:
        self.plan = plan
        self.object_store = object_store


def _historical_plan_fixture() -> _HistoricalPlanFixture:
    object_store = _ReadOnlyObjectStore()
    bucket = "campus-rag-source"
    bundle_key = "authenticated_notice_portal/runs/run-001/notices-bundle.json"
    manifest_key = "authenticated_notice_portal/runs/run-001/export-manifest.json"
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
        object_store=object_store,
    )
    return _HistoricalPlanFixture(
        plan=build_historical_notice_enqueue_plan(
            preview.reimport_plan,
            replay_batch_id="phase-04-8-worker-test",
        ),
        object_store=object_store,
    )


if __name__ == "__main__":
    unittest.main()
