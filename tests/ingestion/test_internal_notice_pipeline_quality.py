from __future__ import annotations

import unittest
from dataclasses import replace

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_pipeline_quality import (
    check_internal_notice_pipeline_quality,
)
from campus_ingestion_core.internal_notice_read_model import (
    InMemoryInternalNoticeReadModelStore,
    InternalNoticeReadModelEntry,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    InMemoryNoticeConsumptionProjectionStore,
)

from tests.ingestion.internal_notice_consumption_projection_test_support import (
    _inventory_entry,
    _projection_entry,
)


class InternalNoticePipelineQualityTest(unittest.TestCase):
    def test_pipeline_quality_reports_lineage_and_cross_layer_findings(self) -> None:
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(notice_id="355001", notice_title="可检索通知"),
                _inventory_entry(notice_id="355002", notice_title="错误制度通知"),
            )
        )
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                replace(
                    _projection_entry("355001"),
                    unit_id="notice_unit:355001:notice_window",
                    role_metadata={
                        "consumer_admission_batch_id": "batch-001",
                        "consumer_admission_command": "projection_rebuild",
                    },
                ),
                replace(
                    _projection_entry("355002"),
                    unit_id="notice_unit:355002:bad_regulation",
                    target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                    role_metadata={
                        "document_nature": "wrapper_notice",
                        "quality_gates_passed": (),
                        "consumer_admission_batch_id": "",
                    },
                ),
                replace(
                    _projection_entry("355003"),
                    unit_id="notice_unit:355003:legacy",
                    consumption_status="manual_review_required",
                    role_metadata={"routing_state": "review_later"},
                ),
            )
        )
        read_model_store = InMemoryInternalNoticeReadModelStore(
            (
                _read_model_entry(
                    notice_id="355001",
                    unit_id="notice_unit:355001:notice_window",
                    title="",
                    source_url="",
                ),
                _read_model_entry(
                    notice_id="355001",
                    unit_id="notice_unit:355001:extra",
                    title="额外行",
                    source_url="https://portal.example.edu/notices/355001/extra",
                ),
            )
        )

        report = check_internal_notice_pipeline_quality(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            notice_ids=("355001", "355002", "355003"),
            source_truth_inventory_store=inventory_store,
            projection_store=projection_store,
            read_model_store=read_model_store,
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.source_truth_notice_count, 2)
        self.assertEqual(report.projection_entry_count, 3)
        self.assertEqual(report.read_model_entry_count, 2)
        self.assertIn(
            (
                "source_truth",
                "notice:355001",
                "consumption_projection",
                "notice_unit:355001:notice_window",
            ),
            {
                (edge.from_stage, edge.from_asset_id, edge.to_stage, edge.to_asset_id)
                for edge in report.asset_edges
            },
        )
        self.assertIn(
            (
                "consumption_projection",
                "notice_unit:355001:notice_window",
                "internal_notice_read_model",
                "notice_unit:355001:notice_window",
            ),
            {
                (edge.from_stage, edge.from_asset_id, edge.to_stage, edge.to_asset_id)
                for edge in report.asset_edges
            },
        )
        reason_codes = {finding.reason_code for finding in report.findings}
        self.assertIn("missing_source_truth_inventory", reason_codes)
        self.assertIn("projection_missing_admission_provenance", reason_codes)
        self.assertIn("read_model_missing_title", reason_codes)
        self.assertIn("read_model_missing_source_url", reason_codes)
        self.assertIn("read_model_extra_without_projection", reason_codes)
        self.assertIn("regulation_ready_without_quality_gate", reason_codes)
        self.assertIn("legacy_review_state_detected", reason_codes)

    def test_pipeline_quality_passes_for_queryable_notice_card_and_ready_regulation(
        self,
    ) -> None:
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(notice_id="355001", notice_title="可检索通知"),
                _inventory_entry(notice_id="355002", notice_title="制度正文"),
            )
        )
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                replace(
                    _projection_entry("355001"),
                    unit_id="notice_unit:355001:notice_window",
                    role_metadata={
                        "consumer_admission_batch_id": "batch-001",
                        "consumer_admission_command": "projection_rebuild",
                    },
                ),
                replace(
                    _projection_entry("355002"),
                    unit_id="notice_unit:355002:regulation",
                    target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                    role_metadata={
                        "document_nature": "institutional_regulation",
                        "quality_gates_passed": ("canonical_text_available",),
                        "consumer_admission_batch_id": "batch-001",
                        "consumer_admission_command": "projection_rebuild",
                    },
                ),
            )
        )
        read_model_store = InMemoryInternalNoticeReadModelStore(
            (
                _read_model_entry(
                    notice_id="355001",
                    unit_id="notice_unit:355001:notice_window",
                    title="可检索通知",
                    source_url="https://portal.example.edu/notices/355001",
                ),
            )
        )

        report = check_internal_notice_pipeline_quality(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            notice_ids=("355001", "355002"),
            source_truth_inventory_store=inventory_store,
            projection_store=projection_store,
            read_model_store=read_model_store,
        )

        self.assertTrue(report.ok)
        self.assertEqual(report.findings, ())
        self.assertEqual(report.queryable_read_model_card_count, 1)
        self.assertEqual(report.ready_regulation_target_count, 1)


def _read_model_entry(
    *,
    notice_id: str,
    unit_id: str,
    title: str,
    source_url: str,
) -> InternalNoticeReadModelEntry:
    return InternalNoticeReadModelEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=unit_id,
        primary_role="notice_window",
        target_surface="notice_level_query",
        consumption_status="retained_for_notice_query",
        queryable=True,
        title=title,
        source_url=source_url,
        search_text=title,
    )


if __name__ == "__main__":
    unittest.main()
