from __future__ import annotations

import unittest

from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_DEFAULT_AGENT_RAG,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_LECTURE_ACTIVITY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
    NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NOTICE_TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION,
    InMemoryNoticeConsumptionProjectionStore,
    build_internal_notice_consumption_projection_entries,
    rebuild_internal_notice_consumption_projection,
    select_ready_target_document_ids,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.notice_consumption_projection import (
    PostgresNoticeConsumptionProjectionStore,
)

from tests.ingestion.internal_notice_consumption_projection_test_support import (
    _build_runtime,
    _env,
    _inventory_entry,
    _notice_runtime_record,
    _projection_entry,
)


class InternalNoticeConsumptionProjectionCoreTest(unittest.TestCase):
    def test_build_entries_emits_notice_window_and_ready_target_units(self) -> None:
        registry, inventory_store, object_store = _build_runtime()

        entries = build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertEqual(
            {
                entry.primary_role
                for entry in entries
                if entry.primary_role == NOTICE_PRIMARY_ROLE_NOTICE_WINDOW
            },
            {NOTICE_PRIMARY_ROLE_NOTICE_WINDOW},
        )
        notice_window = next(
            entry for entry in entries if entry.primary_role == NOTICE_PRIMARY_ROLE_NOTICE_WINDOW
        )
        self.assertNotIn("manual_review_required_count", notice_window.role_metadata)
        self.assertIn("pending_multimodal_attachment_count", notice_window.role_metadata)
        ready_institutional = next(
            entry
            for entry in entries
            if entry.primary_role == NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY
        )
        self.assertEqual(
            ready_institutional.target_surface, NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES
        )
        self.assertEqual(ready_institutional.default_agent, NOTICE_DEFAULT_AGENT_RAG)
        self.assertEqual(ready_institutional.completeness_status, NOTICE_COMPLETENESS_COMPLETE)
        self.assertEqual(
            ready_institutional.consumption_status,
            NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        )

        ready_scoped = next(
            entry
            for entry in entries
            if entry.source_notice_id == "351907"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
        )
        self.assertEqual(ready_scoped.target_surface, NOTICE_TARGET_SURFACE_SCOPED_RULES)
        self.assertEqual(ready_scoped.default_agent, NOTICE_DEFAULT_AGENT_RAG)
        self.assertEqual(ready_scoped.role_metadata["school_unit_name"], "新闻与传播学院")

        pending_scoped = next(
            entry
            for entry in entries
            if entry.source_notice_id == "351908"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
        )
        self.assertEqual(pending_scoped.default_agent, NOTICE_DEFAULT_AGENT_NOTICE)
        self.assertEqual(
            pending_scoped.completeness_status,
            NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING,
        )
        self.assertEqual(
            pending_scoped.consumption_status,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        )

    def test_notice_level_units_use_query_and_archive_semantics_without_runtime_terms(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355222",
                    title_slug="procurement-bid",
                    title="中央民族大学丰台校区家具采购项目比选公告",
                ),
                _notice_runtime_record(
                    notice_id="355326",
                    title_slug="student-roster",
                    title="关于2026年优秀学生干部拟推荐名单公示",
                ),
                _notice_runtime_record(
                    notice_id="355111",
                    title_slug="summer-service-hours",
                    title="关于暑假期间办理就业相关事务的通知",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="355222",
                    notice_title="中央民族大学丰台校区家具采购项目比选公告",
                    published_date="2026-04-12 10:00",
                ),
                _inventory_entry(
                    notice_id="355326",
                    notice_title="关于2026年优秀学生干部拟推荐名单公示",
                    published_date="2026-04-18 10:00",
                ),
                _inventory_entry(
                    notice_id="355111",
                    notice_title="关于暑假期间办理就业相关事务的通知",
                    published_date="2026-07-01 10:00",
                ),
            )
        )

        entries = build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        notice_window = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355222"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_NOTICE_WINDOW
        )
        procurement_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355222"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE
        )
        roster_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355326"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION
        )

        self.assertEqual(notice_window.target_surface, NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY)
        self.assertEqual(
            notice_window.consumption_status,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        )
        self.assertEqual(
            procurement_unit.target_surface,
            NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
        )
        self.assertEqual(roster_unit.target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED)

    def test_rebuild_projection_store_persists_entries_and_exposes_ready_document_ids(self) -> None:
        registry, inventory_store, object_store = _build_runtime()
        projection_store = InMemoryNoticeConsumptionProjectionStore()

        stored_entries = rebuild_internal_notice_consumption_projection(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
            projection_store=projection_store,
        )

        self.assertEqual(
            projection_store.list_by_scope("campus_notices", "internal_notice"),
            stored_entries,
        )
        self.assertEqual(
            select_ready_target_document_ids(
                stored_entries,
                target_surface=NOTICE_TARGET_SURFACE_SCOPED_RULES,
                primary_roles=(NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,),
            ),
            ("notice:muc_internal_portal:351907",),
        )
        self.assertEqual(
            select_ready_target_document_ids(
                stored_entries,
                target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
                primary_roles=(NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,),
            ),
            ("notice:muc_internal_portal:187233",),
        )

    def test_rebuild_projection_stamps_consumer_admission_provenance(self) -> None:
        registry, inventory_store, object_store = _build_runtime()
        projection_store = InMemoryNoticeConsumptionProjectionStore()

        stored_entries = rebuild_internal_notice_consumption_projection(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
            projection_store=projection_store,
            admission_batch_id="batch-projection-001",
            admission_command="projection_rebuild",
            admission_created_at="2026-04-25T00:00:00Z",
        )

        self.assertTrue(stored_entries)
        self.assertEqual(
            stored_entries[0].role_metadata["consumer_admission_batch_id"],
            "batch-projection-001",
        )
        self.assertEqual(
            stored_entries[0].role_metadata["consumer_admission_command"],
            "projection_rebuild",
        )
        self.assertEqual(
            stored_entries[0].role_metadata["consumer_admission_created_at"],
            "2026-04-25T00:00:00Z",
        )

    def test_rebuild_projection_refuses_persistent_full_scope_without_selected_notice_ids(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime()
        projection_store = object.__new__(PostgresNoticeConsumptionProjectionStore)

        with self.assertRaisesRegex(ValueError, "notice_ids or document_ids"):
            rebuild_internal_notice_consumption_projection(
                env=_env(),
                registry=registry,
                source_truth_inventory_store=inventory_store,
                object_store=object_store,
                projection_store=projection_store,
            )

    def test_build_entries_emits_procurement_notice_unit_without_routing_to_regulation(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355222",
                    title_slug="procurement-bid",
                    title="中央民族大学丰台校区家具采购项目比选公告",
                ),
                _notice_runtime_record(
                    notice_id="355325",
                    title_slug="procurement-result",
                    title="中央民族大学丰台校区家具采购项目中选结果公示",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="355222",
                    notice_title="中央民族大学丰台校区家具采购项目比选公告",
                    published_date="2026-04-12 10:00",
                ),
                _inventory_entry(
                    notice_id="355325",
                    notice_title="中央民族大学丰台校区家具采购项目中选结果公示",
                    published_date="2026-04-16 10:00",
                ),
            )
        )

        entries = build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        procurement_units = [
            entry
            for entry in entries
            if entry.primary_role == NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE
        ]
        self.assertEqual(
            {entry.source_notice_id for entry in procurement_units},
            {"355222", "355325"},
        )
        self.assertTrue(
            all(
                entry.target_surface == NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY
                for entry in procurement_units
            )
        )
        self.assertTrue(
            all(
                entry.temporal_policy == NOTICE_TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION
                for entry in procurement_units
            )
        )
        self.assertNotIn(
            NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
            {entry.primary_role for entry in entries if entry.source_notice_id == "187233"},
        )

    def test_build_entries_marks_internal_roster_publication_as_no_adoption(self) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355326",
                    title_slug="student-roster",
                    title="关于2026年优秀学生干部拟推荐名单公示",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="355326",
                    notice_title="关于2026年优秀学生干部拟推荐名单公示",
                    published_date="2026-04-18 10:00",
                ),
            )
        )

        entries = build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        roster_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355326"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION
        )
        self.assertEqual(roster_unit.consumption_status, NOTICE_CONSUMPTION_STATUS_NO_ADOPTION)
        self.assertEqual(
            roster_unit.role_metadata["no_adoption_reason"],
            "internal_restricted_publication_not_admitted",
        )

    def test_build_entries_marks_internal_lecture_activity_as_no_adoption(self) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355327",
                    title_slug="lecture",
                    title="关于举办文华讲堂讲座预告的通知",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="355327",
                    notice_title="关于举办文华讲堂讲座预告的通知",
                    published_date="2026-04-19 10:00",
                ),
            )
        )

        entries = build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        lecture_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355327"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_LECTURE_ACTIVITY
        )
        self.assertEqual(lecture_unit.consumption_status, NOTICE_CONSUMPTION_STATUS_NO_ADOPTION)
        self.assertEqual(
            lecture_unit.role_metadata["no_adoption_reason"],
            "internal_restricted_publication_not_admitted",
        )
        notice_window = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355327"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_NOTICE_WINDOW
        )
        self.assertEqual(notice_window.role_metadata["suggested_consumption_route"], "defer")
        self.assertEqual(notice_window.role_metadata["machine_processing_policy"], "skip")
        self.assertEqual(
            notice_window.role_metadata["attachment_processing_policy"],
            "metadata_only",
        )
        self.assertEqual(
            notice_window.role_metadata["attachment_processing_reason"],
            "low_value_or_deferred_family",
        )

    def test_partial_rebuild_replaces_existing_units_for_selected_notice_ids(self) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355222",
                    title_slug="general-notice",
                    title="关于召开工作会议的通知",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="355222",
                    notice_title="关于召开工作会议的通知",
                    published_date="2026-04-12 10:00",
                ),
            )
        )
        projection_store = InMemoryNoticeConsumptionProjectionStore((_projection_entry("355222"),))

        stored_entries = rebuild_internal_notice_consumption_projection(
            request=InternalNoticeRegulationPromotionRequest(notice_ids=("355222",)),
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
            projection_store=projection_store,
        )

        self.assertEqual(
            {entry.primary_role for entry in stored_entries},
            {NOTICE_PRIMARY_ROLE_NOTICE_WINDOW},
        )
        self.assertEqual(
            {
                entry.primary_role
                for entry in projection_store.list_by_scope(
                    "campus_notices",
                    "internal_notice",
                    notice_ids=("355222",),
                )
            },
            {NOTICE_PRIMARY_ROLE_NOTICE_WINDOW},
        )


if __name__ == "__main__":
    unittest.main()
