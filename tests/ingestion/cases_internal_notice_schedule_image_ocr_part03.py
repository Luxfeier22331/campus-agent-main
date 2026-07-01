from __future__ import annotations

import json
import unittest

from tests.ingestion.internal_notice_schedule_image_ocr_suite_support import (
    ScheduleImageOcrProviderResult,
    _evidence,
    _NoWriteObjectStore,
    admit_schedule_image_ocr_child_document,
    build_schedule_image_ocr_child_document_registry_record,
    write_schedule_image_ocr_child_document_artifacts,
)


class InternalNoticeScheduleImageOcrTestPart03(unittest.TestCase):
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
            "notice_attachment:example_internal_portal:355122:attachment-0001:schedule-ocr",
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

    def test_admitted_schedule_child_preserves_table_caption_effective_date_context(
        self,
    ) -> None:
        evidence = _evidence(
            notice_id="353901",
            notice_title="关于两校区通勤班车新增班次的通知",
            image_use="schedule_table_image",
        )
        result = ScheduleImageOcrProviderResult(
            provider="fixture-ocr",
            model="fixture-table-v1",
            confidence="high",
            extracted_text="表1 师生通勤班车班次表（新班次 12月13日起执行）",
            tables=(
                (
                    ("星期", "线路", "序号", "发车时间", "类型", "备注"),
                    ("周一至周五", "丰台校区→海淀校区", "5", "13:15", "教师班次", "新增班次"),
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
        assert decision.document is not None
        self.assertIn("新班次 12月13日起执行", decision.document.canonical_markdown)
        self.assertIn(
            "新班次 12月13日起执行",
            json.dumps(decision.document.document_units, ensure_ascii=False),
        )

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
            derived_bucket="campus-agent-derived",
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
                "campus_notices/documents/internal_notice/355122/attachment-0001/"
                "source-faithful/2026/document-units.jsonl"
            ),
        )
        self.assertEqual(record.document_id, decision.document.document_id)
        self.assertEqual(record.revision_track, "source-faithful")
        self.assertEqual(record.source_channel, "authenticated_notice_portal")
        self.assertEqual(record.document_units_object_key, report.document_units_object_key)
