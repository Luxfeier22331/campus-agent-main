from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from unittest.mock import patch

from tests.ingestion.internal_notice_schedule_image_ocr_suite_support import (
    PostgresScheduleImageOcrAttemptStore,
    ScheduleImageOcrAdmissionDecision,
    ScheduleImageOcrAttempt,
    ScheduleImageOcrChildDocument,
    ScheduleImageOcrProviderResult,
    _evidence,
    _FakeConnectionContextManager,
    _PagedCursor,
    admit_schedule_image_ocr_child_document,
    build_schedule_image_ocr_attempt_store_from_env,
    summarize_schedule_image_ocr_notice_review,
)


class InternalNoticeScheduleImageOcrTestPart04(unittest.TestCase):
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
            "campus_ingestion_core.internal_notice_schedule_image_ocr_db._postgres_connection",
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

    def test_attempt_store_builder_uses_schedule_ocr_url_before_shared_postgres(self) -> None:
        with patch(
            "campus_ingestion_core.internal_notice_schedule_image_ocr_db."
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

    def test_attempt_store_builder_rejects_admission_url_without_ocr_or_shared_url(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_DATABASE_URL or CAMPUS_SHARED_POSTGRES_URL",
        ):
            build_schedule_image_ocr_attempt_store_from_env(
                {
                    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL": "postgresql://admission/db",
                }
            )

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
