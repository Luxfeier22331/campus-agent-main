from __future__ import annotations

import unittest
from pathlib import Path


class InternalNoticeConsumptionNoLegacyManualStateTest(unittest.TestCase):
    def test_consumption_layer_has_no_legacy_manual_projection_migration(self) -> None:
        root = Path(__file__).resolve().parents[2]
        retired_core = root / "packages" / "ingestion-core"

        self.assertFalse((root / "apps/ingestion-worker").exists())
        self.assertFalse(retired_core.exists())
        self.assertFalse(
            (
                root / "apps/ingestion-worker/src/campus_ingestion_worker/"
                "migrate_internal_notice_legacy_manual_projection.py"
            ).exists()
        )

    def test_python_notice_consumption_projection_facade_is_retired(self) -> None:
        root = Path(__file__).resolve().parents[2]
        self.assertFalse((root / "packages" / "ingestion-core").exists())

    def test_consumption_promotion_scaffold_does_not_emit_legacy_manual_action(self) -> None:
        root = Path(__file__).resolve().parents[2]
        checked_paths = (
            root / "packages/ingest-core/src/notice-consumption-projection.ts",
            root / "packages/ingest-core/src/internal-notice-consumption-projection-build.ts",
            root / "configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json",
            root / "configs/ingestion/regulations/institutional_rules/source-projections.v1.json",
        )

        for path in checked_paths:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn('action="manual_review_required"', text)
            self.assertNotIn('== "manual_review_required"', text)
            self.assertNotIn('"legacy_promotion_action": "manual_review_required"', text)
            self.assertNotIn('"default_action": "manual_review_required"', text)
            self.assertNotIn('"manual_promotion_review"', text)

    def test_consumption_layer_schema_has_no_manual_review_attempt_status(self) -> None:
        root = Path(__file__).resolve().parents[2]
        schema = (
            root / "configs/ingestion/campus_notices/internal_notice/consumption-layer-schema.sql"
        ).read_text(encoding="utf-8")

        self.assertNotIn("'manual_review'", schema)
        self.assertIn("'machine_review_required'", schema)

    def test_authenticated_notice_source_truth_uses_multimodal_processing_classification(
        self,
    ) -> None:
        root = Path(__file__).resolve().parents[2]
        self.assertFalse((root / "packages" / "ingestion-core").exists())

        no_legacy_manual_paths = (
            root / "packages/ingest-core/src/authenticated-notice-source-truth-inventory.ts",
            root / "packages/ingest-core/src/internal-notice-consumption-projection-build.ts",
            root / "configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json",
            root / "configs/ingestion/campus_notices/internal_notice/historical-batches/"
            "run14-attachment-routing-probe.v1.json",
            root / "docs/architecture/domains/authenticated-notice/architecture.md",
        )

        for path in no_legacy_manual_paths:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("manual_review_required", text)
            self.assertNotIn("manual_review_required_count", text)
            self.assertNotIn("AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MANUAL_REVIEW_REQUIRED", text)

        for path in no_legacy_manual_paths:
            text = path.read_text(encoding="utf-8")
            self.assertTrue(
                "multimodal_processing" in text or "MULTIMODAL_PROCESSING" in text,
                f"{path} should use multimodal processing terminology",
            )


if __name__ == "__main__":
    unittest.main()
