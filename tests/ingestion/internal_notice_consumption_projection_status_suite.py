from __future__ import annotations

import unittest
from dataclasses import replace

from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS,
    NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP,
    NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
    NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    InMemoryNoticeConsumptionProjectionStore,
    check_internal_notice_processing_gaps,
    read_notice_consumption_projection_status,
    rebuild_internal_notice_consumption_projection,
)

from tests.ingestion.internal_notice_consumption_projection_test_support import (
    _build_runtime,
    _env,
    _projection_entry,
)


class InternalNoticeConsumptionProjectionStatusTest(unittest.TestCase):
    def test_read_notice_consumption_projection_status_explains_ready_hold_manual_and_no_adoption_units(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime()
        projection_store = InMemoryNoticeConsumptionProjectionStore()
        rebuild_internal_notice_consumption_projection(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
            projection_store=projection_store,
        )

        ready_status = read_notice_consumption_projection_status(
            projection_store,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            source_notice_id="351907",
        )
        pending_status = read_notice_consumption_projection_status(
            projection_store,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            source_notice_id="351908",
        )

        self.assertTrue(ready_status.has_target_ready_units)
        self.assertEqual(ready_status.ready_unit_count, 1)
        self.assertFalse(pending_status.has_target_ready_units)
        self.assertEqual(pending_status.held_unit_count, 2)
        pending_reasons = {reason for unit in pending_status.units for reason in unit.reasons}
        self.assertIn("attachment_backed_regulation_body_missing", pending_reasons)

    def test_read_notice_consumption_projection_status_counts_legacy_runtime_hold_status(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                replace(
                    _projection_entry("355000"),
                    consumption_status="held_in_notice_runtime",
                ),
            )
        )

        status = read_notice_consumption_projection_status(
            projection_store,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            source_notice_id="355000",
        )

        self.assertEqual(status.held_unit_count, 1)

    def test_read_notice_consumption_projection_status_counts_pending_multimodal_units(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                replace(
                    _projection_entry("355000"),
                    target_surface=NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
                ),
            )
        )

        status = read_notice_consumption_projection_status(
            projection_store,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            source_notice_id="355000",
        )

        self.assertEqual(status.pending_multimodal_unit_count, 1)
        self.assertFalse(hasattr(status, "manual_review_unit_count"))

    def test_check_internal_notice_processing_gaps_groups_machine_processing_states(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                replace(
                    _projection_entry("355000"),
                    unit_id="notice_unit:355000:pending_multimodal",
                    target_surface=NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
                    role_metadata={"processing_gap_reason": "multimodal_processing_required"},
                ),
                replace(
                    _projection_entry("355001"),
                    unit_id="notice_unit:355001:unsupported",
                    target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
                    role_metadata={"no_adoption_reason": "unsupported_legacy_reason"},
                ),
                replace(
                    _projection_entry("355002"),
                    unit_id="notice_unit:355002:ready",
                    target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                ),
                replace(
                    _projection_entry("355003"),
                    unit_id="notice_unit:355003:authority_pending",
                    semantic_owner=NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    role_metadata={
                        "owner_source_missing_reason": "authoritative_attachment_missing"
                    },
                ),
            )
        )

        report = check_internal_notice_processing_gaps(
            projection_store=projection_store,
            source_corpus="campus_notices",
            source_collection="internal_notice",
        )

        self.assertEqual(report.projection_entry_count, 4)
        self.assertEqual(report.pending_multimodal_processing_count, 1)
        self.assertEqual(report.source_multimodal_required_count, 0)
        self.assertEqual(report.multimodal_skipped_low_value_count, 0)
        self.assertEqual(report.multimodal_action_required_count, 1)
        self.assertEqual(report.authority_pending_count, 1)
        self.assertEqual(report.unsupported_count, 1)
        self.assertEqual(report.no_adoption_count, 1)
        self.assertEqual(report.ready_for_target_count, 1)
        self.assertEqual(report.retained_for_notice_query_count, 1)
        self.assertFalse(hasattr(report, "legacy_manual_review_required_count"))
        self.assertEqual(
            {unit.unit_id for unit in report.gap_units},
            {
                "notice_unit:355000:pending_multimodal",
                "notice_unit:355001:unsupported",
                "notice_unit:355003:authority_pending",
            },
        )

    def test_check_internal_notice_processing_gaps_splits_skipped_source_multimodal_counts(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                replace(
                    _projection_entry("355546"),
                    unit_id="notice_unit:355546:notice_window",
                    role_metadata={
                        "source_multimodal_processing_required_count": 1,
                        "pending_multimodal_attachment_count": 0,
                        "multimodal_consumption_policy": (
                            NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP
                        ),
                        "multimodal_skip_reason": (
                            NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER
                        ),
                        "multimodal_skipped_attachment_count": 1,
                    },
                ),
                replace(
                    _projection_entry("355403"),
                    unit_id="notice_unit:355403:pending_multimodal",
                    target_surface=NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
                    role_metadata={
                        "source_multimodal_processing_required_count": 1,
                        "pending_multimodal_attachment_count": 1,
                        "multimodal_consumption_policy": (
                            NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS
                        ),
                        "multimodal_action_required": True,
                        "processing_gap_reason": "multimodal_processing_required",
                    },
                ),
            )
        )

        report = check_internal_notice_processing_gaps(
            projection_store=projection_store,
            source_corpus="campus_notices",
            source_collection="internal_notice",
        )

        self.assertEqual(report.source_multimodal_required_count, 2)
        self.assertEqual(report.multimodal_skipped_low_value_count, 1)
        self.assertEqual(report.multimodal_action_required_count, 1)
        self.assertEqual(report.pending_multimodal_processing_count, 1)
        self.assertEqual(
            {unit.unit_id for unit in report.gap_units},
            {"notice_unit:355403:pending_multimodal"},
        )


if __name__ == "__main__":
    unittest.main()
