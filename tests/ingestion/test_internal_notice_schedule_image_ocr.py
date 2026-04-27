from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.internal_notice_schedule_image_ocr import (
    ChatCompletionsScheduleImageOcrProvider,
    InMemoryScheduleImageOcrAttemptStore,
    PostgresScheduleImageOcrAttemptStore,
    ScheduleImageOcrAdmissionDecision,
    ScheduleImageOcrAttempt,
    ScheduleImageOcrChildDocument,
    ScheduleImageOcrEvidence,
    ScheduleImageOcrProviderRequest,
    ScheduleImageOcrProviderResult,
    admit_schedule_image_ocr_child_document,
    build_schedule_image_ocr_artifact_keys,
    build_schedule_image_ocr_attempt_store_from_env,
    build_schedule_image_ocr_child_document_registry_record,
    load_schedule_image_ocr_evidence_inventory,
    run_schedule_image_ocr_dry_run,
    summarize_schedule_image_ocr_notice_review,
    write_schedule_image_ocr_child_document_artifacts,
    write_schedule_image_ocr_source_artifacts,
)


class InternalNoticeScheduleImageOcrTest(unittest.TestCase):
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
        self.assertEqual(entries[0].attachment_ref_id, "attachment-1")

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
            source_bucket="campus-rag-source",
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

    def test_admission_builds_schedule_only_child_document_from_extractable_table(
        self,
    ) -> None:
        evidence = _evidence(image_use="mixed_schedule_and_guide_image")
        result = ScheduleImageOcrProviderResult(
            provider="fixture-ocr",
            model="fixture-table-v1",
            confidence="high",
            extracted_text=("4月28日-30日，海淀校区至丰台校区 7:30 发车。可通过企业微信扫码预约。"),
            tables=(
                (
                    ("适用日期", "运行方向", "发车时间"),
                    ("4月28日-30日", "海淀校区至丰台校区", "07:30"),
                ),
            ),
            layout_elements=(),
            raw_response={},
        )

        decision = admit_schedule_image_ocr_child_document(
            evidence=evidence,
            result=result,
            generated_at="2026-04-28T10:00:00+08:00",
        )

        self.assertEqual(decision.status, "admitted")
        self.assertIsNotNone(decision.document)
        assert decision.document is not None
        self.assertIn("07:30", decision.document.canonical_markdown)
        self.assertNotIn("扫码预约", decision.document.canonical_markdown)
        self.assertEqual(decision.document.document_units[0]["unit_type"], "table_unit")
        self.assertEqual(
            decision.document.document_id,
            "notice_attachment:muc_internal_portal:355122:attachment-1:schedule-ocr",
        )

    def test_admission_accepts_recurring_weekday_schedule_table_without_date(
        self,
    ) -> None:
        evidence = _evidence(
            notice_id="352325",
            notice_title="关于丰台校区地铁接驳车优化调整的通知",
            image_use="mixed_schedule_and_guide_image",
        )
        result = ScheduleImageOcrProviderResult(
            provider="fixture-ocr",
            model="fixture-table-v1",
            confidence="high",
            extracted_text="表1 五棵松地铁站接驳班次表",
            tables=(
                (
                    ("日期", "路线", "发车地点", "发车时间", "备注"),
                    (
                        "周五",
                        "丰台校区→五棵松地铁站",
                        "聚雅餐厅东侧停车场路口",
                        "18:00",
                        "新增班次",
                    ),
                    (
                        "周六、日及法定节假日",
                        "五棵松地铁站→丰台校区",
                        "五棵松地铁站A口北侧国家开放大学东门口",
                        "18:30",
                        "新增班次",
                    ),
                ),
            ),
            layout_elements=(),
            raw_response={},
        )

        decision = admit_schedule_image_ocr_child_document(
            evidence=evidence,
            result=result,
            generated_at="2026-04-28T10:00:00+08:00",
        )

        self.assertEqual(decision.status, "admitted")
        self.assertEqual(decision.reason, "schedule_table_admitted")
        self.assertIsNotNone(decision.document)

    def test_admission_rejects_reservation_open_time_without_schedule_table(
        self,
    ) -> None:
        evidence = _evidence(
            notice_id="354777",
            notice_title="关于近期丰台校区周末地铁接驳车运营安排的通知",
        )
        result = ScheduleImageOcrProviderResult(
            provider="fixture-ocr",
            model="fixture-table-v1",
            confidence="high",
            extracted_text="周五9:00释放周六的可预约资源",
            tables=(),
            layout_elements=(),
            raw_response={},
        )

        decision = admit_schedule_image_ocr_child_document(
            evidence=evidence,
            result=result,
            generated_at="2026-04-28T10:00:00+08:00",
        )

        self.assertEqual(decision.status, "rejected")
        self.assertEqual(decision.reason, "missing_schedule_table")

    def test_classification_uses_notice_context_route_for_time_table(self) -> None:
        evidence = _evidence(
            notice_title="关于两校区学生通勤班车增加班次的通知",
            image_use="schedule_table_image",
        )
        result = ScheduleImageOcrProviderResult(
            provider="fixture-ocr",
            model="fixture-table-v1",
            confidence="medium",
            extracted_text="表1 师生通勤班车班次表",
            tables=(
                (
                    ("适用日期", "发车时间", "备注"),
                    ("3月20日起", "19:30", "新增班次"),
                ),
            ),
            layout_elements=(),
            raw_response={},
        )

        from campus_ingestion_core.internal_notice_schedule_image_ocr import (
            classify_schedule_image_ocr_result,
        )

        self.assertEqual(
            classify_schedule_image_ocr_result(evidence=evidence, result=result),
            "extractable_schedule_table",
        )

    def test_admitted_child_document_artifacts_are_written_to_derived_bucket(self) -> None:
        evidence = _evidence()
        decision = admit_schedule_image_ocr_child_document(
            evidence=evidence,
            result=ScheduleImageOcrProviderResult(
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
                layout_elements=(),
                raw_response={},
            ),
            generated_at="2026-04-28T10:00:00+08:00",
        )
        assert decision.document is not None
        object_store = _NoWriteObjectStore({})

        report = write_schedule_image_ocr_child_document_artifacts(
            document=decision.document,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            year="2026",
        )
        record = build_schedule_image_ocr_child_document_registry_record(
            evidence=evidence,
            document=decision.document,
            artifact_report=report,
            generated_at="2026-04-28T10:00:00+08:00",
        )

        self.assertEqual(len(object_store.put_calls), 2)
        self.assertEqual(
            report.document_units_object_key,
            (
                "campus_notices/documents/internal_notice/355122/attachment-1/"
                "source-faithful/2026/document-units.jsonl"
            ),
        )
        self.assertEqual(record.document_id, decision.document.document_id)
        self.assertEqual(record.revision_track, "source-faithful")
        self.assertEqual(record.source_channel, "authenticated_notice_portal")
        self.assertEqual(record.document_units_object_key, report.document_units_object_key)

    def test_admission_rejects_low_confidence_or_missing_schedule_fields(self) -> None:
        evidence = _evidence()
        low_confidence = ScheduleImageOcrProviderResult(
            provider="fixture-ocr",
            model="fixture-table-v1",
            confidence="low",
            extracted_text="海淀校区至丰台校区 07:30",
            tables=((("运行方向", "发车时间"), ("海淀校区至丰台校区", "07:30")),),
            layout_elements=(),
            raw_response={},
        )
        missing_time = ScheduleImageOcrProviderResult(
            provider="fixture-ocr",
            model="fixture-table-v1",
            confidence="high",
            extracted_text="海淀校区至丰台校区",
            tables=((("运行方向",), ("海淀校区至丰台校区",)),),
            layout_elements=(),
            raw_response={},
        )

        self.assertEqual(
            admit_schedule_image_ocr_child_document(
                evidence=evidence,
                result=low_confidence,
                generated_at="2026-04-28T10:00:00+08:00",
            ).reason,
            "low_confidence",
        )
        self.assertEqual(
            admit_schedule_image_ocr_child_document(
                evidence=evidence,
                result=missing_time,
                generated_at="2026-04-28T10:00:00+08:00",
            ).reason,
            "missing_schedule_time",
        )

    def test_postgres_attempt_store_records_artifact_refs_not_ocr_body(self) -> None:
        store = object.__new__(PostgresScheduleImageOcrAttemptStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.internal_notice_schedule_image_ocr_attempt"
        attempt = ScheduleImageOcrAttempt(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            source_notice_id="355122",
            attachment_ref_id="attachment-1",
            image_index=1,
            source_object_key="authenticated_notice_portal/attachment-a/capture/a.jpg",
            source_sha256="57f84d542435a9de3eeb32f5bfd07bbd3d815612dbd9708a7de130cdabf9b5ea",
            provider="fixture-ocr",
            model="fixture-table-v1",
            status="stored",
            confidence="high",
            provider_response_key="authenticated_notice_portal/attachment-a/provider/p/provider-response.jsonl",
            layout_elements_key="authenticated_notice_portal/attachment-a/source-truth/layout-elements.jsonl",
            ocr_manifest_key="authenticated_notice_portal/attachment-a/source-truth/ocr-manifest.json",
            admission_batch_id="schedule-ocr-batch-001",
            run_id="run-001",
            attempt_number=2,
            created_at="2026-04-28T10:00:00Z",
        )
        cursor = _PagedCursor([[(json.dumps(asdict(attempt)),)]])

        with patch(
            "campus_ingestion_core.internal_notice_schedule_image_ocr._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            store.record(attempt)
            attempts = store.list_by_image(
                source_notice_id="355122",
                attachment_ref_id="attachment-1",
                image_index=1,
            )

        insert_query, insert_params = cursor.execute_calls[0]
        self.assertIn("insert into", insert_query)
        self.assertIn("on conflict", insert_query)
        self.assertIn("source_notice_id", insert_query)
        self.assertIn("attachment_ref_id", insert_query)
        self.assertIn("image_index", insert_query)
        self.assertIn("attempt_number", insert_query)
        self.assertEqual(insert_params[2], "355122")
        self.assertEqual(insert_params[3], "attachment-1")
        self.assertEqual(insert_params[6], "schedule-ocr-batch-001")
        self.assertNotIn("19:30", insert_params[-1])
        select_query, select_params = cursor.execute_calls[1]
        self.assertIn("where source_notice_id = %s", select_query)
        self.assertEqual(select_params, ("355122", "attachment-1", 1))
        self.assertEqual(attempts, (attempt,))

    def test_attempt_store_builder_uses_schedule_ocr_url_before_shared_fallback(self) -> None:
        with patch(
            "campus_ingestion_core.internal_notice_schedule_image_ocr."
            "PostgresScheduleImageOcrAttemptStore"
        ) as store_cls:
            build_schedule_image_ocr_attempt_store_from_env(
                {
                    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_DATABASE_URL": (
                        "postgresql://schedule-ocr/db"
                    ),
                    "CAMPUS_SHARED_POSTGRES_URL": "postgresql://shared/db",
                }
            )

        store_cls.assert_called_once_with(database_url="postgresql://schedule-ocr/db")

    def test_notice_review_separates_schedule_tables_from_visual_guide_images(self) -> None:
        table_evidence = _evidence(
            notice_id="348457",
            notice_title="关于丰台校区地铁接驳车优化调整的通知",
            image_use="mixed_schedule_and_guide_image",
        )
        visual_evidence = _evidence(
            notice_id="348457",
            notice_title="关于丰台校区地铁接驳车优化调整的通知",
            image_use="mixed_schedule_and_guide_image",
        )
        object.__setattr__(visual_evidence, "image_index", 2)
        table_document = ScheduleImageOcrChildDocument(
            document_id="notice_attachment:muc_internal_portal:348457:attachment-1:schedule-ocr",
            canonical_markdown="# table\n",
            document_units=({"unit_id": "table-1"},),
            source_notice_id="348457",
            attachment_ref_id="attachment-1",
        )

        review = summarize_schedule_image_ocr_notice_review(
            items=(
                (
                    table_evidence,
                    ScheduleImageOcrProviderResult(
                        provider="fixture-ocr",
                        model="fixture",
                        confidence="medium",
                        extracted_text="篱笆房地铁站接驳班次表",
                        tables=(
                            (
                                ("星期", "线路", "发车时间"),
                                ("周六、日及法定节假日", "丰台校区→篱笆房地铁站", "08:30"),
                            ),
                        ),
                        layout_elements=(),
                        raw_response={},
                    ),
                    ScheduleImageOcrAdmissionDecision(
                        status="admitted",
                        reason="schedule_table_admitted",
                        document=table_document,
                    ),
                ),
                (
                    visual_evidence,
                    ScheduleImageOcrProviderResult(
                        provider="fixture-ocr",
                        model="fixture",
                        confidence="low",
                        extracted_text="五棵松地铁接驳车 乘车区",
                        tables=(),
                        layout_elements=(),
                        raw_response={},
                    ),
                    ScheduleImageOcrAdmissionDecision(
                        status="rejected",
                        reason="low_confidence",
                    ),
                ),
            )
        )

        self.assertEqual(review.notice_id, "348457")
        self.assertEqual(review.admitted_schedule_image_count, 1)
        self.assertEqual(review.non_schedule_visual_count, 1)
        self.assertIn("write_schedule_child_documents", review.recommended_actions)
        self.assertIn("skip_non_schedule_visuals", review.recommended_actions)
        self.assertEqual(review.images[1].image_role, "non_schedule_visual")


def _evidence(
    *,
    notice_id: str = "355122",
    notice_title: str = "关于两校区学生通勤班车增加班次的通知",
    object_key: str = (
        "authenticated_notice_portal/attachment-fc9a63ccf50c/2026/sha256/"
        "fc9a63ccf50c6aed37042b304901584fbf880f4fe54359b061aeaaa39347f6dc/"
        "capture/table.jpg"
    ),
    sha256: str = "fc9a63ccf50c6aed37042b304901584fbf880f4fe54359b061aeaaa39347f6dc",
    image_use: str = "schedule_table_image",
) -> ScheduleImageOcrEvidence:
    return ScheduleImageOcrEvidence(
        notice_id=notice_id,
        notice_title=notice_title,
        release_time="2026-03-18 11:12",
        organization="丰台校区管理委员会",
        image_index=1,
        attachment_ref_id="attachment-1",
        filename="table.jpg",
        mime_type="image/jpeg",
        byte_size=12,
        sha256=sha256,
        object_key=object_key,
        image_use=image_use,
        reason_codes=("schedule_table_terms_near_image",),
        context_before="3月20日起，对两校区学生通勤班车增加班次。具体见下表：",
        context_after="特此通知。",
    )


class _NoWriteObjectStore:
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


class _FakeOcrProvider:
    def __init__(self, result: ScheduleImageOcrProviderResult) -> None:
        self.result = result
        self.requests: list[object] = []

    def process(self, request: object) -> ScheduleImageOcrProviderResult:
        self.requests.append(request)
        return self.result


class _FakeHttpClient:
    def __init__(self, response: dict[str, object]) -> None:
        self.response = response
        self.posts: list[dict[str, object]] = []

    def post(self, path: str, **kwargs: object) -> _FakeHttpResponse:
        self.posts.append({"path": path, **kwargs})
        return _FakeHttpResponse(self.response)


class _FakeHttpResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self.payload


class _FakeConnectionContextManager:
    def __init__(self, cursor: _PagedCursor) -> None:
        self.cursor_obj = cursor

    def __enter__(self) -> _FakeConnectionContextManager:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def cursor(self) -> _PagedCursor:
        return self.cursor_obj


class _PagedCursor:
    def __init__(self, pages: list[list[tuple[object, ...]]]) -> None:
        self.pages = pages
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def __enter__(self) -> _PagedCursor:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        self.execute_calls.append((" ".join(query.split()), params))

    def fetchall(self) -> list[tuple[object, ...]]:
        if not self.pages:
            return []
        return self.pages.pop(0)


if __name__ == "__main__":
    unittest.main()
