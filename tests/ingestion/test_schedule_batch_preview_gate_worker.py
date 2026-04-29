from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.schedule_batch_preview_gate")


class ScheduleBatchPreviewGateWorkerTest(unittest.TestCase):
    def test_builds_buckets_from_selection_ledger_and_ocr_evidence(self) -> None:
        selection = """
- `1001` | `2026-04-01 09:00` |
  `schedule_or_overlay_candidate`
  - 标题：关于两校区通勤班车运营时间的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `1002` | `2026-04-02 09:00` |
  `schedule_or_overlay_candidate`
  - 标题：关于地铁接驳车预约方式的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `1003` | `2026-04-03 09:00` |
  `schedule_review_candidate`
  - 标题：关于两校区通勤班车新增班次的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `1004` | `2026-04-04 09:00` |
  `operational_notice_candidate`
  - 标题：关于更改通勤班车丰台校区乘车点的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
- `1005` | `2026-04-05 09:00` |
  `schedule_or_overlay_candidate`
  - 标题：关于临时增加学生班车班次的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
"""
        ledger = """
| Notice id | Year | Initial class | Consumption state |
| --- | ---: | --- | --- |
| `1001` | 2026 | schedule_or_overlay_candidate | pending independent evaluation |
| `1002` | 2026 | schedule_or_overlay_candidate | pending independent evaluation |
| `1003` | 2026 | schedule_review_candidate | pending independent evaluation |
| `1004` | 2026 | operational_notice_candidate | pending independent evaluation |
| `1005` | 2026 | schedule_or_overlay_candidate | staged selected release |
"""
        ocr_summary = {
            "items": [
                {
                    "notice_id": "1001",
                    "attachment_ref_id": "attachment-0001",
                    "classification": "extractable_schedule_table",
                    "confidence": "medium",
                    "table_count": 1,
                    "status": "processed",
                },
                {
                    "notice_id": "1002",
                    "attachment_ref_id": "attachment-0001",
                    "classification": "low_confidence",
                    "confidence": "low",
                    "table_count": 0,
                    "status": "processed",
                },
            ],
        }
        router_report = {
            "routes": [
                {
                    "notice_id": "1001",
                    "image_action": "image_schedule_table",
                    "notice_scope": "image_schedule",
                    "confidence": "high",
                    "reason_codes": ["near_schedule_table_anchor"],
                },
                {
                    "notice_id": "1002",
                    "image_action": "visual_or_guide",
                    "notice_scope": "mixed_schedule_and_visual",
                    "confidence": "high",
                    "reason_codes": ["near_visual_anchor"],
                },
            ],
        }

        report = worker.build_schedule_batch_preview_gate_report(
            selection_markdown=selection,
            ledger_markdown=ledger,
            ocr_summary_payload=ocr_summary,
            router_report_payload=router_report,
            run_id="schedule-batch-test",
            generated_at="2026-04-28T09:00:00+08:00",
        )

        buckets = report["buckets"]
        self.assertEqual(buckets["auto_stage_candidate"], ["1001"])
        self.assertEqual(buckets["guide_adjacent_split"], ["1002"])
        self.assertEqual(buckets["manual_review"], ["1003"])
        self.assertEqual(buckets["operational_only"], ["1004"])
        self.assertEqual(buckets["already_staged"], ["1005"])
        item_by_notice = {item["notice_id"]: item for item in report["items"]}
        self.assertIn("guide_adjacent_fields_present", item_by_notice["1002"]["reason_codes"])
        self.assertIn("low_confidence_ocr", item_by_notice["1002"]["reason_codes"])

    def test_routes_pdf_attachment_without_body_evidence_to_manual_review(self) -> None:
        selection = """
- `245272` | `2024-08-30 08:48` |
  `schedule_or_overlay_candidate`
  - 标题：关于2024年秋季学期两校区学生通勤班车运营的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 0`
"""
        ledger = """
| Notice id | Year | Initial class | Consumption state |
| --- | ---: | --- | --- |
| `245272` | 2024 | schedule_or_overlay_candidate | pending independent evaluation |
"""

        report = worker.build_schedule_batch_preview_gate_report(
            selection_markdown=selection,
            ledger_markdown=ledger,
            ocr_summary_payload={"items": []},
            router_report_payload={"routes": []},
            run_id="schedule-batch-test",
            generated_at="2026-04-28T12:50:00+08:00",
        )

        self.assertEqual(report["buckets"]["manual_review"], ["245272"])
        self.assertIn(
            "non_image_attachment_requires_pdf_processing",
            report["items"][0]["reason_codes"],
        )

    def test_guide_adjacent_split_keeps_priority_over_pdf_review(self) -> None:
        selection = """
- `3001` | `2026-04-01 09:00` |
  `schedule_or_overlay_candidate`
  - 标题：关于通勤班车预约方式的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 0`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
"""
        ledger = """
| Notice id | Year | Initial class | Consumption state |
| --- | ---: | --- | --- |
| `3001` | 2026 | schedule_or_overlay_candidate | pending independent evaluation |
"""

        report = worker.build_schedule_batch_preview_gate_report(
            selection_markdown=selection,
            ledger_markdown=ledger,
            ocr_summary_payload={"items": []},
            router_report_payload={"routes": []},
            run_id="schedule-batch-test",
            generated_at="2026-04-28T12:50:00+08:00",
        )

        self.assertEqual(report["buckets"]["guide_adjacent_split"], ["3001"])
        self.assertNotIn(
            "non_image_attachment_requires_pdf_processing",
            report["items"][0]["reason_codes"],
        )

    def test_routes_open_ended_suspension_without_evidence_to_operational_only(self) -> None:
        selection = """
- `354271` | `2025-12-30 17:46` |
  `schedule_or_overlay_candidate`
  - 标题：关于本学期暂停周五18:00由丰台校区发往五棵松地铁站接驳车的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
"""
        ledger = """
| Notice id | Year | Initial class | Consumption state |
| --- | ---: | --- | --- |
| `354271` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
"""

        report = worker.build_schedule_batch_preview_gate_report(
            selection_markdown=selection,
            ledger_markdown=ledger,
            ocr_summary_payload={"items": []},
            router_report_payload={"routes": []},
            run_id="schedule-batch-test",
            generated_at="2026-04-28T12:50:00+08:00",
        )

        self.assertEqual(report["buckets"]["operational_only"], ["354271"])
        self.assertIn(
            "open_ended_suspension_notice",
            report["items"][0]["reason_codes"],
        )

    def test_main_writes_report_markdown_and_bucket_selection_files(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            selection_path = root / "selection.md"
            ledger_path = root / "ledger.md"
            ocr_path = root / "ocr.json"
            router_path = root / "router.json"
            output_dir = root / "out"
            selection_path.write_text(
                """
- `2001` | `2026-04-01 09:00` |
  `schedule_or_overlay_candidate`
  - 标题：关于两校区通勤班车运营时间的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
""",
                encoding="utf-8",
            )
            ledger_path.write_text(
                """
| Notice id | Year | Initial class | Consumption state |
| --- | ---: | --- | --- |
| `2001` | 2026 | schedule_or_overlay_candidate | pending independent evaluation |
""",
                encoding="utf-8",
            )
            ocr_path.write_text('{"items":[]}', encoding="utf-8")
            router_path.write_text('{"routes":[]}', encoding="utf-8")

            with patch("sys.stdout", new_callable=io.StringIO):
                worker.main(
                    [
                        "--selection-path",
                        str(selection_path),
                        "--ledger-path",
                        str(ledger_path),
                        "--ocr-summary-path",
                        str(ocr_path),
                        "--router-report-path",
                        str(router_path),
                        "--output-dir",
                        str(output_dir),
                        "--run-id",
                        "schedule-batch-test",
                        "--generated-at",
                        "2026-04-28T09:00:00+08:00",
                    ]
                )

            report = json.loads((output_dir / "schedule-batch-preview-gate.json").read_text())
            selection_payload = json.loads(
                (output_dir / "auto-stage-candidate-selection.json").read_text()
            )
            markdown = (output_dir / "README.md").read_text()

        self.assertEqual(report["buckets"]["auto_stage_candidate"], ["2001"])
        self.assertEqual(selection_payload, {"selected_notice_ids": ["2001"]})
        self.assertIn("| `2001` | `auto_stage_candidate` |", markdown)


if __name__ == "__main__":
    unittest.main()
