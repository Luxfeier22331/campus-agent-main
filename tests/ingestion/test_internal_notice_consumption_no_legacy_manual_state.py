from __future__ import annotations

import unittest
from pathlib import Path

import campus_ingestion_core.notice_consumption_projection as projection
from campus_ingestion_core.internal_notice_regulation_promotion_shared import (
    InternalNoticeRegulationPromotionManifestReport,
)


class InternalNoticeConsumptionNoLegacyManualStateTest(unittest.TestCase):
    def test_consumption_layer_has_no_legacy_manual_projection_migration(self) -> None:
        root = Path(__file__).resolve().parents[2]

        pyproject = (root / "apps/ingestion-worker/pyproject.toml").read_text(encoding="utf-8")

        self.assertNotIn("migrate-internal-notice-legacy-manual", pyproject)
        self.assertFalse(
            (
                root / "apps/ingestion-worker/src/campus_ingestion_worker/"
                "migrate_internal_notice_legacy_manual_projection.py"
            ).exists()
        )
        self.assertFalse(
            (
                root / "packages/ingestion-core/src/campus_ingestion_core/"
                "internal_notice_legacy_manual_migration.py"
            ).exists()
        )

    def test_notice_consumption_projection_exports_no_manual_review_status(self) -> None:
        self.assertFalse(hasattr(projection, "NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED"))
        self.assertNotIn(
            "NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED",
            projection.__all__,
        )

    def test_consumption_promotion_paths_do_not_emit_legacy_manual_action(self) -> None:
        root = Path(__file__).resolve().parents[2]
        checked_paths = (
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "internal_notice_regulation_promotion_scan.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "internal_notice_regulation_promotion_heuristics.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "internal_notice_regulation_promotion_engine.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "internal_notice_consumption_projection.py",
        )

        for path in checked_paths:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn('action="manual_review_required"', text)
            self.assertNotIn('== "manual_review_required"', text)
            self.assertNotIn('"legacy_promotion_action": "manual_review_required"', text)
        routing = (
            root / "configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json"
        ).read_text(encoding="utf-8")
        self.assertNotIn('"default_action": "manual_review_required"', routing)
        self.assertNotIn('"manual_promotion_review"', routing)

    def test_promotion_manifest_report_has_no_manual_review_count_field(self) -> None:
        fields = InternalNoticeRegulationPromotionManifestReport.__dataclass_fields__

        self.assertNotIn("manual_review_count", fields)
        self.assertIn("machine_processing_required_count", fields)

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
        checked_paths = (
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "authenticated_notice_source_projections_shared.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "authenticated_notice_source_projections_classification.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "authenticated_notice_source_projections_engine.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "authenticated_notice_source_truth_inventory_shared.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "authenticated_notice_source_truth_inventory_rebuild.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "authenticated_notice_source_truth_replay.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "authenticated_notice_closeout_service.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "authenticated_notice_closeout_verification.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "authenticated_notice_closeout_repair.py",
            root / "packages/ingestion-core/src/campus_ingestion_core/"
            "internal_notice_multimodal_processing.py",
            root / "configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json",
            root / "configs/ingestion/campus_notices/internal_notice/historical-batches/"
            "run14-attachment-routing-probe.v1.json",
            root / "docs/architecture/domains/authenticated-notice/architecture.md",
            root / "docs/reference/internal-notice-offline-preparation-strategy.md",
        )

        for path in checked_paths:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("manual_review_required", text)
            self.assertNotIn("manual_review_required_count", text)
            self.assertNotIn("AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MANUAL_REVIEW_REQUIRED", text)
            self.assertTrue(
                "multimodal_processing" in text or "MULTIMODAL_PROCESSING" in text,
                f"{path} should use multimodal processing terminology",
            )


if __name__ == "__main__":
    unittest.main()
