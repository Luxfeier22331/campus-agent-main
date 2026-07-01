from __future__ import annotations

import json
import unittest
from dataclasses import asdict

from tests.ingestion.internal_notice_schedule_image_ocr_suite_support import (
    ChatCompletionsScheduleImageOcrProvider,
    InMemoryScheduleImageOcrAttemptStore,
    ScheduleImageOcrProviderRequest,
    ScheduleImageOcrProviderResult,
    _evidence,
    _FakeHttpClient,
    _NoWriteObjectStore,
    build_schedule_image_ocr_artifact_keys,
    write_schedule_image_ocr_source_artifacts,
)


class InternalNoticeScheduleImageOcrTestPart02(unittest.TestCase):
    def test_chat_provider_normalizes_headers_and_dict_rows_payload(self) -> None:
        response = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "confidence": "medium",
                                "extracted_text": ["通勤班车临时增加班次表"],
                                "tables": [
                                    {
                                        "headers": [
                                            "日期",
                                            "路线",
                                            "发车时间",
                                            "可乘车人数",
                                            "发车地点",
                                        ],
                                        "rows": [
                                            {
                                                "日期": "7月4日（本周五）",
                                                "路线": "海淀校区→丰台校区",
                                                "发车时间": "20:30",
                                                "可乘车人数": "49人",
                                                "发车地点": "海淀校区东门内",
                                            },
                                            {
                                                "日期": "",
                                                "路线": "",
                                                "发车时间": "21:30",
                                                "可乘车人数": "49人",
                                                "发车地点": "",
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
                    ("日期", "路线", "发车时间", "可乘车人数", "发车地点"),
                    ("7月4日（本周五）", "海淀校区→丰台校区", "20:30", "49人", "海淀校区东门内"),
                    ("7月4日（本周五）", "海淀校区→丰台校区", "21:30", "49人", "海淀校区东门内"),
                ),
            ),
        )

    def test_chat_provider_normalizes_positioned_cells_payload(self) -> None:
        response = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "confidence": "medium",
                                "extracted_text": ["教师通勤班车班次表"],
                                "tables": [
                                    {
                                        "headers": ["日期", "路线", "发车时间", "发车地点"],
                                        "cells": [
                                            {"row": 1, "column": "日期", "text": "2月20日-2月23日"},
                                            {
                                                "row": 1,
                                                "column": "路线",
                                                "text": "海淀校区→丰台校区",
                                            },
                                            {"row": 1, "column": "发车时间", "text": "07:30"},
                                            {
                                                "row": 1,
                                                "column": "发车地点",
                                                "text": "海淀校区东门",
                                            },
                                            {"row": 2, "column": "发车时间", "text": "17:00"},
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
                    ("日期", "路线", "发车时间", "发车地点"),
                    ("2月20日-2月23日", "海淀校区→丰台校区", "07:30", "海淀校区东门"),
                    ("2月20日-2月23日", "海淀校区→丰台校区", "17:00", "海淀校区东门"),
                ),
            ),
        )

    def test_chat_provider_normalizes_nested_row_groups_payload(self) -> None:
        response = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "confidence": "medium",
                                "extracted_text": ["表1 师生通勤班车班次表"],
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
                                        "row_groups": [
                                            {
                                                "星期": "周一至周五",
                                                "线路_groups": [
                                                    {
                                                        "线路": "海淀校区→丰台校区",
                                                        "rows": [
                                                            {
                                                                "序号": "1",
                                                                "发车时间": "6:40",
                                                                "类型": "教师班次",
                                                                "备注": "",
                                                            }
                                                        ],
                                                    }
                                                ],
                                            }
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
                ),
            ),
        )

    def test_source_artifact_keys_stay_under_capture_asset_provider_and_source_truth(
        self,
    ) -> None:
        evidence = _evidence(
            object_key=(
                "authenticated_notice_portal/attachment-fc9a63ccf50c/2026/sha256/"
                "fc9a63ccf50c6aed37042b304901584fbf880f4fe54359b061aeaaa39347f6dc/"
                "capture/table.jpg"
            )
        )

        keys = build_schedule_image_ocr_artifact_keys(
            evidence=evidence,
            provider="fixture-ocr",
            model="fixture table/v1",
        )

        self.assertEqual(
            keys.provider_response_key,
            (
                "authenticated_notice_portal/attachment-fc9a63ccf50c/2026/sha256/"
                "fc9a63ccf50c6aed37042b304901584fbf880f4fe54359b061aeaaa39347f6dc/"
                "provider/fixture-ocr__fixture-table-v1/provider-response.jsonl"
            ),
        )
        self.assertTrue(keys.layout_elements_key.endswith("/source-truth/layout-elements.jsonl"))
        self.assertTrue(keys.ocr_manifest_key.endswith("/source-truth/ocr-manifest.json"))

    def test_source_artifact_keys_reject_missing_provider_or_model(self) -> None:
        evidence = _evidence()

        with self.assertRaisesRegex(ValueError, "schedule image OCR provider is required"):
            build_schedule_image_ocr_artifact_keys(
                evidence=evidence,
                provider="",
                model="fixture-table-v1",
            )

        with self.assertRaisesRegex(ValueError, "schedule image OCR model is required"):
            build_schedule_image_ocr_artifact_keys(
                evidence=evidence,
                provider="fixture-ocr",
                model="",
            )

    def test_write_source_artifacts_records_attempt_without_using_pg_for_ocr_body(
        self,
    ) -> None:
        evidence = _evidence()
        object_store = _NoWriteObjectStore({})
        attempt_store = InMemoryScheduleImageOcrAttemptStore()
        result = ScheduleImageOcrProviderResult(
            provider="fixture-ocr",
            model="fixture-table-v1",
            confidence="high",
            extracted_text="海淀校区至丰台校区 19:30",
            tables=((("运行方向", "发车时间"), ("海淀校区至丰台校区", "19:30")),),
            layout_elements=({"type": "table"},),
            raw_response={"text": "海淀校区至丰台校区 19:30"},
        )

        report = write_schedule_image_ocr_source_artifacts(
            evidence=evidence,
            result=result,
            object_store=object_store,
            source_bucket="campus-agent-source",
            attempt_store=attempt_store,
            admission_batch_id="schedule-ocr-batch-001",
            run_id="run-001",
        )

        self.assertEqual(report.status, "stored")
        self.assertEqual(len(object_store.put_calls), 3)
        self.assertEqual(len(attempt_store.attempts), 1)
        self.assertEqual(attempt_store.attempts[0].source_notice_id, "355122")
        self.assertEqual(
            attempt_store.attempts[0].provider_response_key, report.keys.provider_response_key
        )
        self.assertNotIn("19:30", json.dumps(asdict(attempt_store.attempts[0]), ensure_ascii=False))
