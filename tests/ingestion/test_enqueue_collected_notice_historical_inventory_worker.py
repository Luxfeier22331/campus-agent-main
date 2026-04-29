from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)

worker = importlib.import_module(
    "campus_ingestion_worker.enqueue_collected_notice_historical_inventory"
)


class EnqueueCollectedNoticeHistoricalInventoryWorkerTest(unittest.TestCase):
    def test_main_writes_dry_run_evidence_without_building_queue_store(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "phase-04-7"
            reimport_plan_path = tmp_path / "reimport-plan.dry-run.json"
            reimport_plan_path.write_text(
                json.dumps(_reimport_plan(), ensure_ascii=False),
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_worker.enqueue_collected_notice_historical_inventory."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.enqueue_collected_notice_historical_inventory."
                    "build_notice_ingest_queue_store_from_env"
                ) as build_store,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--reimport-plan-path",
                        str(reimport_plan_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            build_store.assert_not_called()
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertEqual(payload["counts"]["planned_job_count"], 1)
            expected_files = {
                "historical-enqueue-plan.dry-run.json",
                "historical-enqueue-rejected-deferred-report.json",
                "enqueue-coverage-report.json",
            }
            self.assertEqual({path.name for path in output_dir.glob("*.json")}, expected_files)

    def test_execute_writes_queue_jobs_and_execute_evidence(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "phase-04-7"
            reimport_plan_path = tmp_path / "reimport-plan.dry-run.json"
            reimport_plan_path.write_text(
                json.dumps(_reimport_plan(), ensure_ascii=False),
                encoding="utf-8",
            )
            store = InMemoryNoticeIngestQueueStore()

            with (
                patch(
                    "campus_ingestion_worker.enqueue_collected_notice_historical_inventory."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.enqueue_collected_notice_historical_inventory."
                    "build_notice_ingest_queue_store_from_env",
                    return_value=store,
                ) as build_store,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--reimport-plan-path",
                        str(reimport_plan_path),
                        "--output-dir",
                        str(output_dir),
                        "--execute",
                    ]
                )

            build_store.assert_called_once()
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "execute")
            self.assertTrue(payload["write_enabled"])
            self.assertEqual(payload["counts"]["queue_write_count"], 1)
            self.assertTrue((output_dir / "historical-enqueue.execute.json").exists())
            self.assertEqual(store.list_status_counts()["queued"], 1)


def _reimport_plan() -> dict[str, object]:
    return {
        "schema_version": "collected_notice_reimport_dry_run.v1",
        "report_id": "worker-test",
        "write_manifest_candidate": {
            "source_truth_candidates": [
                {
                    "source_surface": "notice",
                    "source_channel": "authenticated_notice_portal",
                    "site_id": "muc_internal_portal",
                    "source_identifier": "355512",
                    "run_id": "run-001",
                    "document": {"content_hash": "sha256-a"},
                    "source_object_refs": [
                        {
                            "bucket": "campus-rag-source",
                            "key": "authenticated_notice_portal/runs/run-001/bundle.json",
                            "role": "collector_bundle",
                        },
                        {
                            "bucket": "campus-rag-source",
                            "key": (
                                "authenticated_notice_portal/355512/"
                                "source-truth/notice-manifest.json"
                            ),
                            "role": "source-truth/notice-manifest.json",
                        },
                    ],
                }
            ]
        },
    }


if __name__ == "__main__":
    unittest.main()
