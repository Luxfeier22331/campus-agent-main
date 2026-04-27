from __future__ import annotations

import unittest
from pathlib import Path

from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
)
from campus_ingestion_core.internal_notice_consumer_admission_builder import (
    build_internal_notice_consumer_admission_manifest_from_bundle_records,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
)

from .test_authenticated_notice_routing_sampling import _bundle_record


class InternalNoticeConsumerAdmissionBuilderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_authenticated_notice_notice_family_config(
            Path(
                "configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json"
            )
        )

    def test_builder_maps_routing_samples_to_consumer_decisions(self) -> None:
        manifest = build_internal_notice_consumer_admission_manifest_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="course",
                    title="关于2025-2026学年第二学期本科生网上选课的通知",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
                _bundle_record(
                    notice_id="transport",
                    title="关于两校区学生通勤班车增加班次的通知",
                    notice_type="5",
                    notice_type_name="办公通知",
                ),
            ),
            config=self.config,
            admission_run_id="consumer-admission-001",
            selection_source="bundle_dry_run",
            selection_path="bundle.json",
            site_id="muc_internal_portal",
            created_at="2026-04-27T00:00:00+00:00",
        )

        decisions = {record.notice_id: record for record in manifest.decision_records}
        self.assertEqual(
            decisions["course"].target_surface,
            NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        )
        self.assertEqual(
            decisions["course"].consumption_status,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        )
        self.assertEqual(
            decisions["transport"].target_surface,
            NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        )
        self.assertEqual(
            decisions["transport"].consumption_status,
            CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
        )
        self.assertEqual(manifest.selected_notice_ids, ("course", "transport"))

    def test_builder_admits_regulation_candidates_for_institutional_rules_materialization(
        self,
    ) -> None:
        manifest = build_internal_notice_consumer_admission_manifest_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="regulation",
                    title="关于印发《中央民族大学本科生转专业实施办法（试行）》的通知",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
            ),
            config=self.config,
            admission_run_id="consumer-admission-regulation",
            selection_source="bundle_dry_run",
            selection_path="bundle.json",
            site_id="muc_internal_portal",
            created_at="2026-04-27T00:00:00+00:00",
        )

        decision = manifest.decision_records[0]
        self.assertEqual(decision.notice_family, "policy_regulation")
        self.assertEqual(decision.suggested_consumption_route, "regulation_candidate")
        self.assertEqual(decision.target_surface, NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES)
        self.assertEqual(
            decision.consumption_status,
            CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
        )


if __name__ == "__main__":
    unittest.main()
