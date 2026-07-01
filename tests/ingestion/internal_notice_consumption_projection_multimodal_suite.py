from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_COMPLETENESS_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS,
    NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP,
    NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    build_internal_notice_consumption_projection_entries,
)

from tests.ingestion.internal_notice_consumption_projection_test_support import (
    _build_runtime,
    _env,
    _inventory_entry_with_multimodal_inline_images,
    _machine_processing_report,
    _manifest_report,
    _notice_runtime_record,
)


class InternalNoticeConsumptionProjectionMultimodalTest(unittest.TestCase):
    def test_machine_processing_promotion_action_becomes_pending_multimodal_processing(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime()
        machine_processing_report = _machine_processing_report(
            document_id="notice:example_internal_portal:351907",
            notice_id="351907",
            document_nature=NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
            reasons=("promotion_class_ambiguous",),
        )

        with patch(
            "campus_ingestion_core.internal_notice_consumption_projection.build_internal_notice_regulation_promotion_manifest",
            return_value=_manifest_report((machine_processing_report,)),
        ):
            entries = build_internal_notice_consumption_projection_entries(
                env=_env(),
                registry=registry,
                source_truth_inventory_store=inventory_store,
                object_store=object_store,
            )

        pending_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "351907"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
        )
        self.assertEqual(
            pending_unit.target_surface,
            NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
        )
        self.assertEqual(
            pending_unit.completeness_status,
            NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
        )
        self.assertEqual(
            pending_unit.consumption_status,
            NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        )
        self.assertEqual(pending_unit.default_agent, NOTICE_DEFAULT_AGENT_NOTICE)
        self.assertEqual(
            pending_unit.role_metadata["processing_gap_reason"],
            "multimodal_processing_required",
        )
        self.assertEqual(
            pending_unit.role_metadata["multimodal_consumption_policy"],
            NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS,
        )
        self.assertTrue(pending_unit.role_metadata["multimodal_action_required"])

    def test_low_value_event_poster_multimodal_gap_is_retained_without_token_spend(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355546",
                    title_slug="dance-lecture-poster",
                    title="讲座预告丨舞蹈学院名家讲堂",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry_with_multimodal_inline_images(
                    notice_id="355546",
                    notice_title="讲座预告丨舞蹈学院名家讲堂",
                    count=1,
                ),
            )
        )
        machine_processing_report = _machine_processing_report(
            document_id="notice:example_internal_portal:355546",
            notice_id="355546",
            document_nature=NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
            reasons=("promotion_class_ambiguous",),
            source_title="讲座预告丨舞蹈学院名家讲堂",
        )

        with patch(
            "campus_ingestion_core.internal_notice_consumption_projection.build_internal_notice_regulation_promotion_manifest",
            return_value=_manifest_report((machine_processing_report,)),
        ):
            entries = build_internal_notice_consumption_projection_entries(
                env=_env(),
                registry=registry,
                source_truth_inventory_store=inventory_store,
                object_store=object_store,
            )

        notice_window = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355546"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_NOTICE_WINDOW
        )
        retained_machine_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355546"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
        )

        self.assertEqual(notice_window.role_metadata["pending_multimodal_attachment_count"], 0)
        self.assertEqual(
            notice_window.role_metadata["source_multimodal_processing_required_count"],
            1,
        )
        self.assertEqual(
            notice_window.role_metadata["multimodal_consumption_policy"],
            NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP,
        )
        self.assertEqual(
            notice_window.role_metadata["multimodal_skip_reason"],
            NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
        )
        self.assertEqual(
            retained_machine_unit.target_surface, NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY
        )
        self.assertEqual(
            retained_machine_unit.completeness_status,
            NOTICE_COMPLETENESS_REFERENCE_ONLY,
        )
        self.assertEqual(
            retained_machine_unit.consumption_status,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        )
        self.assertEqual(
            retained_machine_unit.role_metadata["multimodal_consumption_policy"],
            NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP,
        )
        self.assertEqual(
            retained_machine_unit.role_metadata["multimodal_skip_reason"],
            NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
        )
        self.assertFalse(
            any(
                entry.consumption_status == NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING
                for entry in entries
                if entry.source_notice_id == "355546"
            )
        )

    def test_high_value_multimodal_gap_stays_action_required(self) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355403",
                    title_slug="research-manual",
                    title="关于科研系统操作手册详见附件的通知",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry_with_multimodal_inline_images(
                    notice_id="355403",
                    notice_title="关于科研系统操作手册详见附件的通知",
                    count=1,
                ),
            )
        )
        machine_processing_report = _machine_processing_report(
            document_id="notice:example_internal_portal:355403",
            notice_id="355403",
            document_nature=NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
            reasons=("promotion_class_ambiguous",),
            source_title="关于科研系统操作手册详见附件的通知",
        )

        with patch(
            "campus_ingestion_core.internal_notice_consumption_projection.build_internal_notice_regulation_promotion_manifest",
            return_value=_manifest_report((machine_processing_report,)),
        ):
            entries = build_internal_notice_consumption_projection_entries(
                env=_env(),
                registry=registry,
                source_truth_inventory_store=inventory_store,
                object_store=object_store,
            )

        pending_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355403"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
        )
        self.assertEqual(
            pending_unit.consumption_status,
            NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        )
        self.assertEqual(
            pending_unit.role_metadata["multimodal_consumption_policy"],
            NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS,
        )
        self.assertTrue(pending_unit.role_metadata["multimodal_action_required"])

    def test_hard_machine_processing_reasons_become_unsupported_no_adoption(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime()
        machine_processing_report = _machine_processing_report(
            document_id="notice:example_internal_portal:351907",
            notice_id="351907",
            document_nature=NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
            reasons=("input_lane_not_admitted",),
        )

        with patch(
            "campus_ingestion_core.internal_notice_consumption_projection.build_internal_notice_regulation_promotion_manifest",
            return_value=_manifest_report((machine_processing_report,)),
        ):
            entries = build_internal_notice_consumption_projection_entries(
                env=_env(),
                registry=registry,
                source_truth_inventory_store=inventory_store,
                object_store=object_store,
            )

        unsupported_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "351907"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
        )
        self.assertEqual(unsupported_unit.target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED)
        self.assertEqual(unsupported_unit.consumption_status, NOTICE_CONSUMPTION_STATUS_NO_ADOPTION)
        self.assertEqual(
            unsupported_unit.role_metadata["no_adoption_reason"],
            "unsupported_machine_processing_reason",
        )


if __name__ == "__main__":
    unittest.main()
