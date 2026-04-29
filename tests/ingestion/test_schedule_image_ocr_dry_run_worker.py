from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.internal_notice_schedule_image_ocr import (
    ScheduleImageOcrProviderResult,
)

worker = importlib.import_module("campus_ingestion_worker.schedule_image_ocr_dry_run")


class ScheduleImageOcrDryRunWorkerTest(unittest.TestCase):
    def test_main_runs_bounded_dry_run_without_object_store_writes(self) -> None:
        image_bytes = b"schedule-image"
        inventory = [
            {
                "notice_id": "355122",
                "notice_title": "关于两校区学生通勤班车增加班次的通知",
                "release_time": "2026-03-18 11:12",
                "organization": "丰台校区管理委员会",
                "image_index": 1,
                "attachment_id": 1,
                "filename": "table.jpg",
                "mime_type": "image/jpeg",
                "byte_size": len(image_bytes),
                "sha256": "57f84d542435a9de3eeb32f5bfd07bbd3d815612dbd9708a7de130cdabf9b5ea",
                "object_key": "authenticated_notice_portal/attachment-a/2026/sha256/x/capture/a.jpg",
                "object_exists": True,
                "image_use": "schedule_table_image",
                "reason_codes": ["schedule_table_terms_near_image"],
            },
            {
                "notice_id": "355122",
                "notice_title": "关于两校区学生通勤班车增加班次的通知",
                "release_time": "2026-03-18 11:12",
                "organization": "丰台校区管理委员会",
                "image_index": 2,
                "attachment_id": 2,
                "filename": "boarding-point.jpg",
                "mime_type": "image/jpeg",
                "byte_size": len(image_bytes),
                "sha256": "57f84d542435a9de3eeb32f5bfd07bbd3d815612dbd9708a7de130cdabf9b5ea",
                "object_key": "authenticated_notice_portal/attachment-a/2026/sha256/x/capture/b.jpg",
                "object_exists": True,
                "image_use": "mixed_schedule_and_guide_image",
                "context_before": "乘车地点见图1。",
                "context_after": "图1. 学生活动中心西侧停车场路口实景图。",
                "reason_codes": ["transport_image_candidate"],
            },
        ]
        object_store = _FakeObjectStore(
            {
                (
                    "campus-rag-source",
                    "authenticated_notice_portal/attachment-a/2026/sha256/x/capture/a.jpg",
                ): image_bytes
            }
        )
        provider = _FakeProvider()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "inventory.json"
            output_dir = root / "dry-run"
            inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
            stdout = io.StringIO()

            with (
                patch("campus_ingestion_worker.schedule_image_ocr_dry_run.load_worker_env"),
                patch(
                    "campus_ingestion_worker.schedule_image_ocr_dry_run.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(bucket_source="campus-rag-source"),
                ),
                patch(
                    "campus_ingestion_worker.schedule_image_ocr_dry_run.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.schedule_image_ocr_dry_run."
                    "build_schedule_image_ocr_provider_from_env",
                    return_value=provider,
                ),
                patch("sys.stdout", stdout),
            ):
                worker.main(
                    [
                        "--evidence-inventory",
                        str(inventory_path),
                        "--output-dir",
                        str(output_dir),
                        "--run-id",
                        "schedule-ocr-dry-run-test",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["image_count"], 1)
            self.assertEqual(payload["processed_count"], 1)
            self.assertEqual(payload["failed_count"], 0)
            self.assertEqual(payload["router"]["image_count"], 2)
            self.assertEqual(payload["router"]["image_ocr_count"], 1)
            self.assertEqual(payload["router"]["skipped_visual_count"], 1)
            self.assertEqual(provider.request_count, 1)
            self.assertEqual(object_store.put_calls, [])
            image_inventory = json.loads(
                (output_dir / "_image-ocr-inventory.json").read_text(encoding="utf-8")
            )
            skipped_inventory = json.loads(
                (output_dir / "_skipped-visual-inventory.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(image_inventory), 1)
            self.assertEqual(image_inventory[0]["image_index"], 1)
            self.assertEqual(len(skipped_inventory), 1)
            self.assertEqual(skipped_inventory[0]["image_index"], 2)


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = dict(objects)
        self.put_calls: list[dict[str, object]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.put_calls.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )


class _FakeProvider:
    def __init__(self) -> None:
        self.request_count = 0

    def process(self, request: object) -> ScheduleImageOcrProviderResult:
        self.request_count += 1
        return ScheduleImageOcrProviderResult(
            provider="fixture-ocr",
            model="fixture-table-v1",
            confidence="high",
            extracted_text="3月20日起，海淀校区至丰台校区 19:30 发车",
            tables=(
                (
                    ("适用日期", "运行方向", "发车时间"),
                    ("3月20日起", "海淀校区至丰台校区", "19:30"),
                ),
            ),
            layout_elements=({"type": "table"},),
            raw_response={"ok": True},
        )


if __name__ == "__main__":
    unittest.main()
