from __future__ import annotations

import unittest

from campus_ingestion_core.internal_notice_legacy_manual_migration import (
    migrate_legacy_manual_review_projection_entries,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)


class InternalNoticeLegacyManualMigrationTest(unittest.TestCase):
    def test_dry_run_reports_changes_without_writing_projection(self) -> None:
        store = InMemoryNoticeConsumptionProjectionStore(
            (
                _legacy_manual_entry("351907", reasons=("promotion_class_ambiguous",)),
                _legacy_manual_entry("351908", reasons=("input_lane_not_admitted",)),
            )
        )

        report = migrate_legacy_manual_review_projection_entries(
            projection_store=store,
            notice_ids=("351907", "351908"),
            apply=False,
        )

        self.assertFalse(report.applied)
        self.assertEqual(report.legacy_manual_review_count, 2)
        self.assertEqual(report.pending_multimodal_count, 1)
        self.assertEqual(report.no_adoption_count, 1)
        stored = store.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(
            {entry.consumption_status for entry in stored},
            {NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED},
        )

    def test_apply_rewrites_legacy_manual_statuses_for_selected_notices(self) -> None:
        store = InMemoryNoticeConsumptionProjectionStore(
            (
                _legacy_manual_entry("351907", reasons=("promotion_class_ambiguous",)),
                _legacy_manual_entry("351908", reasons=("input_lane_not_admitted",)),
                _legacy_manual_entry("999999", reasons=("promotion_class_ambiguous",)),
            )
        )

        report = migrate_legacy_manual_review_projection_entries(
            projection_store=store,
            notice_ids=("351907", "351908"),
            apply=True,
        )

        self.assertTrue(report.applied)
        stored_by_notice = {
            entry.source_notice_id: entry
            for entry in store.list_by_scope("campus_notices", "internal_notice")
        }
        self.assertEqual(
            stored_by_notice["351907"].consumption_status,
            NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        )
        self.assertEqual(
            stored_by_notice["351907"].target_surface,
            NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
        )
        self.assertEqual(
            stored_by_notice["351907"].completeness_status,
            NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
        )
        self.assertEqual(
            stored_by_notice["351908"].consumption_status,
            NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        )
        self.assertEqual(
            stored_by_notice["351908"].target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED
        )
        self.assertEqual(
            stored_by_notice["999999"].consumption_status,
            NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED,
        )

    def test_migration_requires_selected_notice_ids(self) -> None:
        with self.assertRaisesRegex(ValueError, "selected notice_ids are required"):
            migrate_legacy_manual_review_projection_entries(
                projection_store=InMemoryNoticeConsumptionProjectionStore(),
            )


def _legacy_manual_entry(
    notice_id: str,
    *,
    reasons: tuple[str, ...],
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:{notice_id}:legacy_manual",
        primary_role="annual_cycle_rule",
        semantic_owner="notice_body",
        default_agent="notice-agent",
        target_surface="regulations/scoped_rules",
        temporal_policy="explicit_year_only",
        completeness_status="manual_review_required",
        answerability="manual_review_required",
        consumption_status=NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        role_metadata={"reasons": reasons},
    )


if __name__ == "__main__":
    unittest.main()
