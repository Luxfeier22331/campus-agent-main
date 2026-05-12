from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_consumption_reset import (
    build_collected_notice_reset_plan,
    choose_service_guide_current_reset_action,
    resolve_collected_notice_reset_database_url,
)


class CollectedNoticeConsumptionResetPlanTest(unittest.TestCase):
    def test_reset_plan_keeps_captured_objects_and_run_ledger_out_of_delete_specs(self) -> None:
        plan = build_collected_notice_reset_plan()

        delete_tables = {action.table for action in plan.planned_deletes}
        self.assertIn(
            "ingestion_projection.authenticated_notice_source_truth_inventory",
            delete_tables,
        )
        self.assertIn("ingestion_registry.document_registry_records", delete_tables)
        self.assertIn("ingestion_registry.raw_asset_registry_records", delete_tables)
        self.assertIn("ingestion_projection.notice_consumption_projection", delete_tables)
        self.assertNotIn("ingestion_projection.authenticated_notice_collector_run", delete_tables)
        self.assertEqual(plan.planned_source_object_deletes, ())

    def test_service_guide_current_reset_prefers_stable_release_when_mixed_current_is_removed(
        self,
    ) -> None:
        action = choose_service_guide_current_reset_action(
            current_release_id="service-guide-transport-merged-20260427T111821",
            deleted_release_ids=("service-guide-transport-merged-20260427T111821",),
            stable_release_ids=("service-guide-campus-card-20260427T110000",),
        )

        self.assertEqual(action.action, "promote_stable_release")
        self.assertEqual(action.release_id, "service-guide-campus-card-20260427T110000")

    def test_service_guide_current_reset_blocks_when_no_stable_release_exists(self) -> None:
        action = choose_service_guide_current_reset_action(
            current_release_id="service-guide-transport-merged-20260427T111821",
            deleted_release_ids=("service-guide-transport-merged-20260427T111821",),
            stable_release_ids=(),
        )

        self.assertEqual(action.action, "blocked_missing_stable_release")
        self.assertIsNone(action.release_id)

    def test_reset_database_url_uses_shared_operator_postgres_url(self) -> None:
        resolved = resolve_collected_notice_reset_database_url(
            {
                "CAMPUS_SHARED_POSTGRES_OPERATOR_URL": "postgresql://shared-operator.example/postgres",
            }
        )

        self.assertEqual(
            resolved,
            (
                "postgresql://shared-operator.example/postgres"
                "?__campus_connection_mode=management_direct"
            ),
        )

    def test_reset_database_url_rejects_registry_urls_without_shared_operator_url(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "CAMPUS_SHARED_POSTGRES_OPERATOR_URL is required",
        ):
            resolve_collected_notice_reset_database_url(
                {
                    "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL": (
                        "postgresql://document-registry-operator.example/postgres"
                    ),
                    "RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL": (
                        "postgresql://raw-registry-operator.example/postgres"
                    ),
                    "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://document-registry.example/postgres",
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                }
            )


if __name__ == "__main__":
    unittest.main()
