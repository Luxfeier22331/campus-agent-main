from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.schedule_transport_preview_gate")


class ScheduleTransportPreviewGateWorkerTest(unittest.TestCase):
    def test_builds_pass_failed_and_warning_buckets_from_projection_preview(self) -> None:
        candidate_gate = {
            "buckets": {
                "auto_stage_candidate": ["1001", "1002", "1003"],
            },
            "items": [
                {"notice_id": "1001", "title": "当前班车时刻表"},
                {"notice_id": "1002", "title": "缺 OCR 表格"},
                {"notice_id": "1003", "title": "旧 baseline"},
            ],
        }
        projection = {
            "transport_schedule_snapshots": [
                {
                    "source_ref": "notice:muc_internal_portal:1001",
                    "snapshot_id": "snapshot:1001",
                    "schedule_scope": "baseline_revision",
                    "is_current": True,
                },
                {
                    "source_ref": "notice:muc_internal_portal:1003",
                    "snapshot_id": "snapshot:1003",
                    "schedule_scope": "baseline_revision",
                    "is_current": False,
                },
            ],
            "scheduled_departures": [
                {
                    "snapshot_id": "snapshot:1001",
                    "related_notice_refs": ["notice:muc_internal_portal:1001"],
                }
            ],
            "transport_service_exceptions": [],
            "transport_operational_notices": [],
            "transport_rejected_sources": [
                {
                    "source_notice_id": "1002",
                    "source_ref": "notice:muc_internal_portal:1002",
                    "reason": "no_supported_transport_schedule_rows",
                }
            ],
        }

        report = worker.build_schedule_transport_preview_gate_report(
            candidate_gate_report=candidate_gate,
            projection_bundle=projection,
            validation_summary={"valid": True},
            rejected_sources=projection["transport_rejected_sources"],
            run_id="preview-gate-test",
            generated_at="2026-04-28T11:30:00+08:00",
        )

        self.assertEqual(report["summary"]["preview_passed_count"], 2)
        self.assertEqual(report["summary"]["preview_failed_count"], 1)
        self.assertEqual(report["buckets"]["preview_passed"], ["1001", "1003"])
        self.assertEqual(report["buckets"]["preview_failed"], ["1002"])
        item_by_notice = {item["notice_id"]: item for item in report["items"]}
        self.assertIn(
            "snapshot_only_superseded_baseline",
            item_by_notice["1003"]["warning_codes"],
        )
        self.assertIn("materialization_rejected", item_by_notice["1002"]["reason_codes"])

    def test_invalid_projection_validation_blocks_passed_selection(self) -> None:
        candidate_gate = {
            "buckets": {
                "auto_stage_candidate": ["1001"],
            },
            "items": [
                {"notice_id": "1001", "title": "当前班车时刻表"},
            ],
        }
        projection = {
            "transport_schedule_snapshots": [
                {
                    "source_ref": "notice:muc_internal_portal:1001",
                    "snapshot_id": "snapshot:1001",
                }
            ],
            "scheduled_departures": [
                {
                    "snapshot_id": "snapshot:1001",
                    "related_notice_refs": ["notice:muc_internal_portal:1001"],
                }
            ],
            "transport_service_exceptions": [],
            "transport_operational_notices": [],
        }

        report = worker.build_schedule_transport_preview_gate_report(
            candidate_gate_report=candidate_gate,
            projection_bundle=projection,
            validation_summary={"valid": False},
            rejected_sources=[],
            run_id="preview-gate-test",
            generated_at="2026-04-28T11:30:00+08:00",
        )

        self.assertEqual(report["buckets"]["preview_passed"], [])
        self.assertEqual(report["buckets"]["preview_failed"], ["1001"])
        self.assertEqual(
            report["summary"]["failed_reason_counts"],
            {"transport_preview_validation_failed": 1},
        )

    def test_main_writes_report_markdown_and_selection_files(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            candidate_path = root / "candidate.json"
            projection_path = root / "projection.json"
            validation_path = root / "validation.json"
            rejected_path = root / "rejected.json"
            output_dir = root / "out"
            candidate_path.write_text(
                json.dumps({"buckets": {"auto_stage_candidate": ["2001"]}, "items": []}),
                encoding="utf-8",
            )
            projection_path.write_text(
                json.dumps(
                    {
                        "transport_schedule_snapshots": [
                            {
                                "source_ref": "notice:muc_internal_portal:2001",
                                "snapshot_id": "snapshot:2001",
                            }
                        ],
                        "scheduled_departures": [
                            {
                                "snapshot_id": "snapshot:2001",
                                "related_notice_refs": ["notice:muc_internal_portal:2001"],
                            }
                        ],
                        "transport_service_exceptions": [],
                        "transport_operational_notices": [],
                        "transport_rejected_sources": [],
                    }
                ),
                encoding="utf-8",
            )
            validation_path.write_text('{"valid":true}', encoding="utf-8")
            rejected_path.write_text("[]", encoding="utf-8")

            with patch("sys.stdout", new_callable=io.StringIO):
                worker.main(
                    [
                        "--candidate-gate-report-path",
                        str(candidate_path),
                        "--projection-bundle-path",
                        str(projection_path),
                        "--validation-summary-path",
                        str(validation_path),
                        "--rejected-source-report-path",
                        str(rejected_path),
                        "--output-dir",
                        str(output_dir),
                        "--run-id",
                        "preview-gate-test",
                        "--generated-at",
                        "2026-04-28T11:30:00+08:00",
                    ]
                )

            report = json.loads((output_dir / "schedule-transport-preview-gate.json").read_text())
            passed = json.loads((output_dir / "preview-passed-selection.json").read_text())
            markdown = (output_dir / "README.md").read_text(encoding="utf-8")

        self.assertEqual(report["buckets"]["preview_passed"], ["2001"])
        self.assertEqual(passed, {"selected_notice_ids": ["2001"]})
        self.assertIn("|`2001`|`preview_passed`|", markdown)


if __name__ == "__main__":
    unittest.main()
