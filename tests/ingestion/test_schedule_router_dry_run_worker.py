from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.schedule_router_dry_run")


class ScheduleRouterDryRunWorkerTest(unittest.TestCase):
    def test_main_writes_local_router_report_and_filtered_inventories(self) -> None:
        inventory = [
            {
                "notice_id": "348457",
                "notice_title": "关于丰台校区地铁接驳车优化调整的通知",
                "release_time": "2025-03-07 08:30",
                "organization": "丰台校区管委会办公室",
                "image_index": 1,
                "attachment_ref_id": "attachment-1",
                "image_use": "mixed_schedule_and_guide_image",
                "context_before": "恢复篱笆房地铁站接驳线路。具体班次信息如下：",
                "context_after": "为方便乘车，上下车点调整至停车场路口（见图1）。",
                "object_key": "source/a.jpg",
                "object_exists": True,
                "sha256": "x",
            },
            {
                "notice_id": "348457",
                "notice_title": "关于丰台校区地铁接驳车优化调整的通知",
                "release_time": "2025-03-07 08:30",
                "organization": "丰台校区管委会办公室",
                "image_index": 2,
                "attachment_ref_id": "attachment-2",
                "image_use": "mixed_schedule_and_guide_image",
                "context_before": "上下车点调整至停车场路口（见图1）。",
                "context_after": "图1. 线路校内上下车点实景图。",
                "object_key": "source/b.jpg",
                "object_exists": True,
                "sha256": "y",
            },
            {
                "notice_id": "355881",
                "notice_title": "关于开通丰台校区社会实践专车的通知",
                "release_time": "2026-04-25 16:26",
                "organization": "丰台校区管理委员会办公室",
                "image_index": 1,
                "attachment_ref_id": "attachment-1",
                "image_use": "mixed_schedule_and_guide_image",
                "context_before": "出发：第一班07：30，第二班09：00。接站：第一班18：00。",
                "context_after": "乘车地点和预约方式。",
                "object_key": "source/c.jpg",
                "object_exists": True,
                "sha256": "z",
            },
        ]

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "inventory.json"
            output_dir = root / "router"
            inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
            stdout = io.StringIO()

            with patch("sys.stdout", stdout):
                worker.main(
                    [
                        "--evidence-inventory",
                        str(inventory_path),
                        "--output-dir",
                        str(output_dir),
                        "--run-id",
                        "router-test",
                    ]
                )

            stdout_payload = json.loads(stdout.getvalue())
            report = json.loads((output_dir / "_router-dry-run.json").read_text(encoding="utf-8"))
            image_ocr_inventory = json.loads(
                (output_dir / "_image-ocr-inventory.json").read_text(encoding="utf-8")
            )
            body_inventory = json.loads(
                (output_dir / "_body-schedule-inventory.json").read_text(encoding="utf-8")
            )
            skipped_visual_inventory = json.loads(
                (output_dir / "_skipped-visual-inventory.json").read_text(encoding="utf-8")
            )

        self.assertEqual(stdout_payload["image_ocr_count"], 1)
        self.assertEqual(report["counts"]["image_schedule_table"], 1)
        self.assertEqual(report["counts"]["visual_or_guide"], 1)
        self.assertEqual(report["counts"]["body_schedule"], 1)
        self.assertEqual(len(image_ocr_inventory), 1)
        self.assertEqual(image_ocr_inventory[0]["image_index"], 1)
        self.assertEqual(len(body_inventory), 1)
        self.assertEqual(body_inventory[0]["notice_id"], "355881")
        self.assertEqual(len(skipped_visual_inventory), 1)
        self.assertEqual(skipped_visual_inventory[0]["image_index"], 2)


if __name__ == "__main__":
    unittest.main()
