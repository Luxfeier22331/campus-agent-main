from __future__ import annotations

import unittest
from pathlib import Path


class InternalNoticeConsumptionSchemaArtifactsTest(unittest.TestCase):
    def test_repo_tracks_internal_notice_consumption_schema_sql(self) -> None:
        root = Path(__file__).resolve().parents[2]
        schema_path = (
            root / "configs/ingestion/campus_notices/internal_notice/consumption-layer-schema.sql"
        )

        self.assertTrue(schema_path.exists())
        sql = schema_path.read_text(encoding="utf-8").lower()

        for table_name in (
            "ingestion_projection.notice_consumption_projection",
            "ingestion_projection.internal_notice_read_model",
            "ingestion_projection.internal_notice_consumption_admission",
            "ingestion_projection.internal_notice_consumption_admission_event",
            "ingestion_projection.internal_notice_multimodal_attempt",
            "ingestion_projection.internal_notice_schedule_image_ocr_attempt",
            "ingestion_projection.collected_notice_released_file_text_extraction_attempt",
            "ingestion_projection.collected_notice_pdf_ocr_text_extraction_attempt",
            "ingestion_projection.collected_notice_office_text_extraction_attempt",
            "ingestion_projection.collected_notice_image_ocr_text_extraction_attempt",
        ):
            self.assertIn(table_name, sql)

        for required_column in (
            "consumer_admission_batch_id",
            "selection_source",
            "selection_sha256",
            "event_id",
            "attempt_number",
            "provider_response_key",
            "layout_elements_key",
            "ocr_manifest_key",
            "media_ref_id",
            "plain_text_key",
            "searchable_merge_input_key",
            "search_vector",
        ):
            self.assertIn(required_column, sql)

        for constraint_name in (
            "collected_notice_released_file_text_extraction_attempt_status_check",
            "collected_notice_pdf_ocr_text_extraction_attempt_status_check",
            "collected_notice_office_text_extraction_attempt_status_check",
            "collected_notice_image_ocr_text_extraction_attempt_status_check",
        ):
            self.assertIn(constraint_name, sql)

        for status in (
            "'pending'",
            "'completed'",
            "'skipped'",
            "'manual_review'",
            "'failed_retryable'",
            "'failed_terminal'",
        ):
            self.assertIn(status, sql)


if __name__ == "__main__":
    unittest.main()
