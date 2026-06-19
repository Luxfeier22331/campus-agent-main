from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ingestion.internal_notice_schedule_image_ocr_suite_support import (
    ChatCompletionsScheduleImageOcrProvider,
    ScheduleImageOcrProviderRequest,
    ScheduleImageOcrProviderResult,
    _evidence,
    _FakeHttpClient,
    _FakeOcrProvider,
    _NoWriteObjectStore,
    load_schedule_image_ocr_evidence_inventory,
    run_schedule_image_ocr_dry_run,
)


class InternalNoticeScheduleImageOcrTestPart01(unittest.TestCase):
    def test_dry_run_reads_selected_images_and_writes_only_local_artifacts(self) -> None:
        evidence = _evidence(
            notice_id="355122",
            notice_title="关于两校区学生通勤班车增加班次的通知",
            object_key=(
                "authenticated_notice_portal/attachment-fc9a63ccf50c/2026/"
                "sha256/57f84d542435a9de3eeb32f5bfd07bbd3d815612dbd9708a7de130cdabf9b5ea/"
                "capture/table.jpg"
            ),
            sha256="57f84d542435a9de3eeb32f5bfd07bbd3d815612dbd9708a7de130cdabf9b5ea",
        )
        object_store = _NoWriteObjectStore(
            {
                (
                    "campus-rag-source",
                    evidence.object_key,
                ): b"schedule-image",
            }
        )
        provider = _FakeOcrProvider(
            ScheduleImageOcrProviderResult(
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
                layout_elements=({"type": "table", "row_count": 2},),
                raw_response={"ok": True},
            )
        )

        with TemporaryDirectory() as temp_dir:
            report = run_schedule_image_ocr_dry_run(
                evidence_entries=(evidence,),
                object_store=object_store,
                source_bucket="campus-rag-source",
                provider=provider,
                output_dir=Path(temp_dir),
                run_id="dry-run-001",
            )
            image_dir = Path(temp_dir) / "355122" / "image-1"
            manifest = json.loads((image_dir / "manifest.json").read_text(encoding="utf-8"))
            ocr_result = json.loads((image_dir / "ocr-result.json").read_text(encoding="utf-8"))

        self.assertEqual(report.image_count, 1)
        self.assertEqual(report.processed_count, 1)
        self.assertEqual(report.failed_count, 0)
        self.assertEqual(report.item_reports[0].classification, "extractable_schedule_table")
        self.assertEqual(provider.requests[0].image_bytes, b"schedule-image")
        self.assertEqual(manifest["notice_id"], "355122")
        self.assertEqual(ocr_result["provider"], "fixture-ocr")
        self.assertEqual(object_store.put_calls, [])

    def test_load_inventory_requires_object_backed_images_and_verifies_sha256(self) -> None:
        payload = [
            {
                "notice_id": "355122",
                "notice_title": "关于两校区学生通勤班车增加班次的通知",
                "release_time": "2026-03-18 11:12",
                "image_index": 1,
                "attachment_id": 1,
                "filename": "table.jpg",
                "mime_type": "image/jpeg",
                "sha256": "6ca13d52ca70c883e0f0bb101e425a89e8624de51db2d23944d346c83973ea14",
                "object_key": "authenticated_notice_portal/attachment-a/2026/sha256/x/capture/a.jpg",
                "object_exists": True,
                "image_use": "schedule_table_image",
            },
            {
                "notice_id": "355123",
                "notice_title": "reference only",
                "image_index": 1,
                "attachment_id": 1,
                "sha256": "7ca13d52ca70c883e0f0bb101e425a89e8624de51db2d23944d346c83973ea14",
                "object_key": "",
                "object_exists": False,
            },
        ]

        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "inventory.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            entries = load_schedule_image_ocr_evidence_inventory(path)

        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].notice_id, "355122")
        self.assertEqual(entries[0].attachment_ref_id, "attachment-0001")

    def test_chat_provider_normalizes_real_table_object_payload(self) -> None:
        response = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "extracted_text": ["表1 师生通勤班车班次表"],
                                "tables": [
                                    {
                                        "columns": ["适用日期", "运行方向", "发车时间"],
                                        "rows": [
                                            [
                                                {"text": "3月20日起", "rowspan": 1},
                                                {"text": "海淀校区→丰台校区", "rowspan": 1},
                                                {"text": "19:30", "rowspan": 1},
                                            ],
                                        ],
                                    }
                                ],
                                "layout_elements": [],
                            },
                            ensure_ascii=False,
                        )
                    }
                }
            ],
            "model": "gpt-5.5",
        }
        provider = ChatCompletionsScheduleImageOcrProvider(
            api_key="test-key",
            model="gpt-5.5",
            http_client=_FakeHttpClient(response),
        )

        result = provider.process(
            ScheduleImageOcrProviderRequest(
                evidence=_evidence(),
                image_bytes=b"image",
            )
        )

        self.assertEqual(result.confidence, "medium")
        self.assertEqual(result.extracted_text, "表1 师生通勤班车班次表")
        self.assertEqual(
            result.tables,
            (
                (
                    ("适用日期", "运行方向", "发车时间"),
                    ("3月20日起", "海淀校区→丰台校区", "19:30"),
                ),
            ),
        )

    def test_chat_provider_from_env_requires_schedule_specific_credentials(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_API_KEY is required",
        ):
            ChatCompletionsScheduleImageOcrProvider.from_env(
                {
                    "LLM_API_KEY": "shared-key",
                    "LLM_MODEL": "gpt-shared",
                    "LLM_BASE_URL": "https://shared.example/v1",
                }
            )

    def test_chat_provider_from_env_requires_schedule_specific_model(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MODEL is required",
        ):
            ChatCompletionsScheduleImageOcrProvider.from_env(
                {
                    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_API_KEY": "test-key",
                    "INTERNAL_NOTICE_MULTIMODAL_MODEL": "gpt-other-lane",
                }
            )

    def test_chat_provider_normalizes_row_cell_objects_with_rowspans(self) -> None:
        response = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "confidence": "medium",
                                "extracted_text": ["表 1 师生通勤班车班次表"],
                                "tables": [
                                    {
                                        "columns": [
                                            "星期",
                                            "线路",
                                            "序号",
                                            "发车时间",
                                            "类型",
                                            "备注",
                                        ],
                                        "rows": [
                                            {
                                                "cells": [
                                                    {"text": "周一至周五", "rowspan": 3},
                                                    {"text": "海淀校区→丰台校区", "rowspan": 2},
                                                    {"text": "1"},
                                                    {"text": "6:40"},
                                                    {"text": "教师班次"},
                                                    {"text": ""},
                                                ]
                                            },
                                            {
                                                "cells": [
                                                    {"text": "2"},
                                                    {"text": "8:10"},
                                                    {"text": "学生班次"},
                                                    {"text": ""},
                                                ]
                                            },
                                            {
                                                "cells": [
                                                    {"text": "丰台校区→海淀校区"},
                                                    {"text": "1"},
                                                    {"text": "6:40"},
                                                    {"text": "教师班次"},
                                                    {"text": ""},
                                                ]
                                            },
                                        ],
                                    }
                                ],
                                "layout_elements": [],
                            },
                            ensure_ascii=False,
                        )
                    }
                }
            ],
            "model": "gpt-5.5",
        }
        provider = ChatCompletionsScheduleImageOcrProvider(
            api_key="test-key",
            model="gpt-5.5",
            http_client=_FakeHttpClient(response),
        )

        result = provider.process(
            ScheduleImageOcrProviderRequest(
                evidence=_evidence(),
                image_bytes=b"image",
            )
        )

        self.assertEqual(
            result.tables,
            (
                (
                    ("星期", "线路", "序号", "发车时间", "类型", "备注"),
                    ("周一至周五", "海淀校区→丰台校区", "1", "6:40", "教师班次", ""),
                    ("周一至周五", "海淀校区→丰台校区", "2", "8:10", "学生班次", ""),
                    ("周一至周五", "丰台校区→海淀校区", "1", "6:40", "教师班次", ""),
                ),
            ),
        )
