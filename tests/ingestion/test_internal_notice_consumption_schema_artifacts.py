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
            "search_vector",
        ):
            self.assertIn(required_column, sql)


if __name__ == "__main__":
    unittest.main()
