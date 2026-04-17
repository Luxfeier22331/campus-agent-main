from __future__ import annotations

import importlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import time
import unittest
from unittest.mock import Mock, patch

worker = importlib.import_module(
    "campus_ingestion_worker.closeout_authenticated_notice_historical_backfill"
)


class CloseoutAuthenticatedNoticeHistoricalBackfillWorkerCliTest(unittest.TestCase):
    def test_resolve_checkpoint_sizes_adds_full_and_dedupes(self) -> None:
        self.assertEqual(
            worker.resolve_checkpoint_sizes(total_count=6694, requested_sizes=(240, 240, 1000, 9000)),
            (240, 1000, 6694),
        )

    def test_main_writes_closeout_artifacts_with_checkpoint_and_rerun(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            output_dir = root / "closeout"
            bundle_path.write_text(
                json.dumps(
                    [
                        {"notice_id": 355119, "notice": {"notice_id": 355119}},
                        {"notice_id": 355120, "notice": {"notice_id": 355120}},
                        {"notice_id": 355121, "notice": {"notice_id": 355121}},
                    ]
                ),
                encoding="utf-8",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": "v3",
                        "export_scope": "run-14",
                        "counts": {"notices": 3},
                        "run": {"id": 14, "mode": "backfill", "status": "success"},
                    }
                ),
                encoding="utf-8",
            )
            document_registry = Mock()
            document_registry.list_by_scope.return_value = (
                Mock(
                    document_id="notice:muc_internal_portal:355119",
                    ingestion_timestamp="2026-04-04T08:00:00+00:00",
                    visibility_level="restricted",
                    processed_object_keys=(
                        "authenticated_notice_portal/foo/source-truth/notice-manifest.json",
                        "campus_notices/documents/internal_notice/a/source-faithful/2026/document-units.jsonl",
                    ),
                    document_units_object_key="campus_notices/documents/internal_notice/a/source-faithful/2026/document-units.jsonl",
                ),
                Mock(
                    document_id="notice:muc_internal_portal:355120",
                    ingestion_timestamp="2026-04-04T08:00:01+00:00",
                    visibility_level="restricted",
                    processed_object_keys=(
                        "authenticated_notice_portal/bar/source-truth/notice-manifest.json",
                        "campus_notices/documents/internal_notice/b/source-faithful/2026/document-units.jsonl",
                    ),
                    document_units_object_key="campus_notices/documents/internal_notice/b/source-faithful/2026/document-units.jsonl",
                ),
                Mock(
                    document_id="notice:muc_internal_portal:355121",
                    ingestion_timestamp="2026-04-04T08:00:02+00:00",
                    visibility_level="restricted",
                    processed_object_keys=(
                        "authenticated_notice_portal/baz/source-truth/notice-manifest.json",
                        "campus_notices/documents/internal_notice/c/source-faithful/2026/document-units.jsonl",
                    ),
                    document_units_object_key="campus_notices/documents/internal_notice/c/source-faithful/2026/document-units.jsonl",
                ),
            )
            raw_asset_registry = Mock()
            raw_asset_registry.list_by_scope.return_value = (
                Mock(raw_asset_id="asset:authenticated-notice:muc_internal_portal:355119"),
                Mock(raw_asset_id="asset:authenticated-notice:muc_internal_portal:355120"),
                Mock(raw_asset_id="asset:authenticated-notice:muc_internal_portal:355121"),
                Mock(raw_asset_id="asset:authenticated-notice:muc_internal_portal:355999"),
            )

            import_results = [
                {
                    "notice_count": 2,
                    "created_document_ids": [
                        "notice:muc_internal_portal:355119",
                        "notice:muc_internal_portal:355120",
                    ],
                    "updated_document_ids": [],
                    "skipped_document_ids": [],
                    "raw_uploaded_count": 2,
                    "raw_reused_count": 0,
                    "errors": [],
                },
                {
                    "notice_count": 3,
                    "created_document_ids": ["notice:muc_internal_portal:355121"],
                    "updated_document_ids": [],
                    "skipped_document_ids": [
                        "notice:muc_internal_portal:355119",
                        "notice:muc_internal_portal:355120",
                    ],
                    "raw_uploaded_count": 1,
                    "raw_reused_count": 2,
                    "errors": [],
                },
                {
                    "notice_count": 3,
                    "created_document_ids": [],
                    "updated_document_ids": [],
                    "skipped_document_ids": [
                        "notice:muc_internal_portal:355119",
                        "notice:muc_internal_portal:355120",
                        "notice:muc_internal_portal:355121",
                    ],
                    "raw_uploaded_count": 0,
                    "raw_reused_count": 3,
                    "errors": [],
                },
            ]

            with (
                patch(
                    "campus_ingestion_worker.closeout_authenticated_notice_historical_backfill.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.closeout_authenticated_notice_historical_backfill.import_authenticated_notice_export",
                    side_effect=import_results,
                ) as run_import,
                patch(
                    "campus_ingestion_worker.closeout_authenticated_notice_historical_backfill.build_document_registry_from_env",
                    return_value=document_registry,
                ),
                patch(
                    "campus_ingestion_worker.closeout_authenticated_notice_historical_backfill.build_raw_asset_registry_from_env",
                    return_value=raw_asset_registry,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
                patch("sys.stderr", new_callable=io.StringIO) as stderr,
            ):
                worker.main(
                    [
                        "--bundle-path",
                        str(bundle_path),
                        "--manifest-path",
                        str(manifest_path),
                        "--site-id",
                        "muc_internal_portal",
                        "--source-home-url",
                        "https://my.muc.edu.cn",
                        "--output-dir",
                        str(output_dir),
                        "--checkpoint-size",
                        "2",
                        "--final-rerun",
                    ]
                )

            self.assertEqual(run_import.call_count, 3)
            frozen_input = json.loads((output_dir / "frozen-input.json").read_text(encoding="utf-8"))
            checkpoint_summary = json.loads(
                (output_dir / "checkpoint-0002" / "summary.json").read_text(encoding="utf-8")
            )
            full_summary = json.loads(
                (output_dir / "checkpoint-0003" / "summary.json").read_text(encoding="utf-8")
            )
            rerun_summary = json.loads(
                (output_dir / "final-rerun" / "summary.json").read_text(encoding="utf-8")
            )
            closeout_summary = json.loads(
                (output_dir / "closeout-summary.json").read_text(encoding="utf-8")
            )

            self.assertEqual(frozen_input["bundle_notice_count"], 3)
            self.assertEqual(frozen_input["checkpoint_sizes"], [2, 3])
            self.assertTrue(checkpoint_summary["ok"])
            self.assertTrue(full_summary["ok"])
            self.assertTrue(rerun_summary["ok"])
            self.assertTrue(closeout_summary["ok"])
            self.assertEqual(closeout_summary["reconciliation"]["missing_document_id_count"], 0)
            self.assertEqual(closeout_summary["reconciliation"]["missing_raw_asset_id_count"], 0)
            self.assertEqual(closeout_summary["reconciliation"]["unexpected_raw_asset_id_count"], 1)
            self.assertFalse(closeout_summary["reconciliation"]["raw_asset_scope_exact_match_required"])
            payload = json.loads(stdout.getvalue())
            self.assertTrue(payload["ok"])
            runtime_logs = stderr.getvalue()
            self.assertIn('"event": "closeout_started"', runtime_logs)
            self.assertIn('"event": "checkpoint_started"', runtime_logs)
            self.assertIn('"event": "checkpoint_finished"', runtime_logs)
            self.assertIn('"event": "final_rerun_started"', runtime_logs)
            self.assertIn('"event": "final_rerun_finished"', runtime_logs)
            self.assertIn('"event": "closeout_finished"', runtime_logs)

    def test_run_with_heartbeat_emits_progress_until_operation_finishes(self) -> None:
        events: list[dict[str, object]] = []

        def logger(*, event: str, **fields: object) -> None:
            events.append({"event": event, **fields})

        def operation() -> str:
            time.sleep(0.05)
            return "done"

        result = worker.run_with_heartbeat(
            operation=operation,
            logger=logger,
            heartbeat_event="checkpoint_heartbeat",
            heartbeat_interval_seconds=0.01,
            heartbeat_fields={"checkpoint_size": 1000},
        )

        self.assertEqual(result, "done")
        heartbeat_events = [item for item in events if item["event"] == "checkpoint_heartbeat"]
        self.assertGreaterEqual(len(heartbeat_events), 1)
        self.assertTrue(
            all(float(item["elapsed_seconds"]) > 0 for item in heartbeat_events),
        )


if __name__ == "__main__":
    unittest.main()
