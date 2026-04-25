from __future__ import annotations

import json
import unittest
from dataclasses import asdict, replace
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_COMPLETENESS_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_DEFAULT_AGENT_RAG,
    NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS,
    NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP,
    NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_LECTURE_ACTIVITY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
    NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
    NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE,
    NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NOTICE_TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION,
    NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
    InMemoryNoticeConsumptionProjectionStore,
    build_internal_notice_consumption_projection_entries,
    check_internal_notice_processing_gaps,
    read_notice_consumption_projection_status,
    rebuild_internal_notice_consumption_projection,
    select_ready_target_document_ids,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionDocumentReport,
    InternalNoticeRegulationPromotionManifestReport,
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.notice_consumption_projection import (
    PostgresNoticeConsumptionProjectionStore,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry

from .internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _document_units,
    _FakeObjectStore,
    _inventory_entry,
    _record,
)


class InternalNoticeConsumptionProjectionTest(unittest.TestCase):
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
        service_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355111"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE
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
        self.assertEqual(
            procurement_unit.consumption_status,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        )
        self.assertEqual(roster_unit.target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED)
        self.assertEqual(
            service_unit.role_metadata["notice_query_reason"], "service_status_not_admitted"
        )

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

    def test_build_entries_marks_service_status_override_as_notice_held_service_candidate(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
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

        service_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355111"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE
        )
        self.assertEqual(service_unit.default_agent, NOTICE_DEFAULT_AGENT_NOTICE)
        self.assertEqual(
            service_unit.target_surface, NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        )
        self.assertEqual(
            service_unit.consumption_status,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        )
        self.assertEqual(
            service_unit.role_metadata["notice_query_reason"],
            "service_status_not_admitted",
        )

    def test_build_entries_routes_special_medical_service_notice_to_typed_candidate(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355401",
                    title_slug="hpv-vaccine-appointment",
                    title="关于校医院开放九价HPV疫苗预约接种的通知",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="355401",
                    notice_title="关于校医院开放九价HPV疫苗预约接种的通知",
                    published_date="2026-04-20 10:00",
                ),
            )
        )

        entries = build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        special_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355401"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE
        )
        self.assertEqual(
            special_unit.target_surface, NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE
        )
        self.assertEqual(
            special_unit.consumption_status,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        )
        self.assertEqual(
            special_unit.role_metadata["notice_query_reason"],
            "special_service_not_admitted",
        )

    def test_build_entries_routes_stable_contact_notice_to_typed_candidate(self) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355402",
                    title_slug="finance-office-phone-update",
                    title="关于财务处办公电话和联系方式调整的通知",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="355402",
                    notice_title="关于财务处办公电话和联系方式调整的通知",
                    published_date="2026-04-21 10:00",
                ),
            )
        )

        entries = build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        contact_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355402"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE
        )
        self.assertEqual(
            contact_unit.target_surface, NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE
        )
        self.assertEqual(
            contact_unit.temporal_policy,
            NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
        )
        self.assertEqual(
            contact_unit.role_metadata["notice_query_reason"],
            "stable_contact_not_admitted",
        )

    def test_build_entries_does_not_route_activity_contact_to_stable_contact_candidate(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355403",
                    title_slug="activity-contact",
                    title="关于举办校园开放日活动联系人及电话的通知",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="355403",
                    notice_title="关于举办校园开放日活动联系人及电话的通知",
                    published_date="2026-04-22 10:00",
                ),
            )
        )

        entries = build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertFalse(
            any(
                entry.source_notice_id == "355403"
                and entry.primary_role == NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE
                for entry in entries
            )
        )

    def test_build_entries_marks_attachment_form_template_as_notice_query_hint(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="355119",
                    title_slug="certificate-project-application",
                    title="关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry_with_attachment_projection_plans(
                    notice_id="355119",
                    notice_title="关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
                    plans=(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "classification": "text_extractable",
                            "document_id": (
                                "notice_attachment:muc_internal_portal:355119:attachment-0001"
                            ),
                            "materialization_policy": "required_document",
                            "attachment_filename": "拔尖创新人才证书项目报名表.docx",
                        },
                    ),
                ),
            )
        )

        entries = build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        template_unit = next(
            entry
            for entry in entries
            if entry.source_notice_id == "355119"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE
        )
        self.assertEqual(template_unit.target_surface, NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY)
        self.assertEqual(
            template_unit.consumption_status,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        )
        self.assertEqual(template_unit.source_attachment_ref_ids, ("attachment-0001",))
        self.assertEqual(
            template_unit.source_document_id,
            "notice_attachment:muc_internal_portal:355119:attachment-0001",
        )
        self.assertEqual(
            template_unit.role_metadata["notice_query_reason"],
            "attachment_form_template_query_hint_only",
        )

    def test_machine_processing_promotion_action_becomes_pending_multimodal_processing(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime()
        machine_processing_report = _machine_processing_report(
            document_id="notice:muc_internal_portal:351907",
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
            document_id="notice:muc_internal_portal:355546",
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
            document_id="notice:muc_internal_portal:355403",
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
            document_id="notice:muc_internal_portal:351907",
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
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _projection_entry("355222"),
                replace(
                    _projection_entry("355222"),
                    unit_id="notice_unit:notice:muc_internal_portal:355222:procurement_notice",
                    primary_role=NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
                ),
            )
        )

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


class NoticeConsumptionProjectionPostgresStoreTest(unittest.TestCase):
    def test_postgres_store_list_by_scope_rehydrates_record_payloads(self) -> None:
        store = object.__new__(PostgresNoticeConsumptionProjectionStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.notice_consumption_projection"
        entry = _projection_entry("000001")
        cursor = _PagedCursor([[(json.dumps(asdict(entry)),)]])

        with patch(
            "campus_ingestion_core.notice_consumption_projection._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            records = store.list_by_scope(
                "campus_notices",
                "internal_notice",
                notice_ids=("000001",),
            )

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].source_notice_id, entry.source_notice_id)
        self.assertEqual(records[0].primary_role, entry.primary_role)
        self.assertEqual(records[0].target_surface, entry.target_surface)
        self.assertEqual(records[0].consumption_status, entry.consumption_status)
        query, params = cursor.execute_calls[0]
        self.assertIn("source_notice_id = any(%s)", query)
        self.assertEqual(params, ("campus_notices", "internal_notice", ["000001"]))

    def test_postgres_store_replace_notices_deletes_selected_notice_units_before_upsert(
        self,
    ) -> None:
        store = object.__new__(PostgresNoticeConsumptionProjectionStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.notice_consumption_projection"
        entry = _projection_entry("000001")
        cursor = _PagedCursor([])

        with patch(
            "campus_ingestion_core.notice_consumption_projection._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            store.replace_notices(
                "campus_notices",
                "internal_notice",
                notice_ids=("000001",),
                records=(entry,),
            )

        delete_query, delete_params = cursor.execute_calls[0]
        self.assertIn("source_notice_id = any(%s)", delete_query)
        self.assertEqual(delete_params, ("campus_notices", "internal_notice", ["000001"]))
        upsert_query, _upsert_params = cursor.execute_calls[1]
        self.assertIn("jsonb_to_recordset", upsert_query)


def _env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
        "EMBEDDING_PROVIDER": "mock",
        "EMBEDDING_MODEL": "mock-embedding-8d",
        "SPARSE_PROVIDER": "mock",
    }


def _build_runtime(*, extra_notice_rows=()):
    institutional = _record(
        notice_id="187233",
        title_slug="procurement-rule",
        content_hash="sha256:institutional-187233",
        body_key="campus_notices/documents/internal_notice/187233/canonical.md",
        units_key="campus_notices/documents/internal_notice/187233/document-units.jsonl",
        is_current=True,
    )
    annual_ready = _record(
        notice_id="351907",
        title_slug="recommendation-rule",
        content_hash="sha256:annual-351907",
        body_key="campus_notices/documents/internal_notice/351907/canonical.md",
        units_key="campus_notices/documents/internal_notice/351907/document-units.jsonl",
        is_current=True,
    )
    annual_pending = _record(
        notice_id="351908",
        title_slug="recommendation-rule-missing-owner",
        content_hash="sha256:annual-351908",
        body_key="campus_notices/documents/internal_notice/351908/canonical.md",
        units_key="campus_notices/documents/internal_notice/351908/document-units.jsonl",
        is_current=True,
    )
    registry = InMemoryDocumentRegistry(
        (institutional, annual_ready, annual_pending, *extra_notice_rows)
    )
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_store.upsert_many(
        (
            _inventory_entry(
                notice_id="187233",
                notice_title="关于修订《中央民族大学采购工作管理办法》的通知",
                published_date="2021-02-28 16:09",
            ),
            _inventory_entry(
                notice_id="351907",
                notice_title="新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                published_date="2026-04-01 10:00",
            ),
            _inventory_entry(
                notice_id="351908",
                notice_title="新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                published_date="2026-04-02 10:00",
            ),
        )
    )
    object_store = _FakeObjectStore(
        objects={
            (
                "campus-rag-derived",
                institutional.canonical_markdown_object_key,
            ): _canonical_markdown(
                "# 中央民族大学采购工作管理办法\n\n第一条 为规范学校采购工作，制定本办法。\n第二条 本办法自2021年3月1日起施行。\n"
            ),
            ("campus-rag-derived", annual_ready.canonical_markdown_object_key): _canonical_markdown(
                "# 新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则\n\n第一条 为规范推荐2026届本科生免试攻读研究生工作，制定本细则。\n第二条 本细则适用于新闻与传播学院相关学生。\n"
            ),
            (
                "campus-rag-derived",
                annual_pending.canonical_markdown_object_key,
            ): _canonical_markdown(
                "# 新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则\n\n第一条 本细则所涉具体选拔条件详见附件《新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则》。\n第二条 学生应按附件要求准备材料。\n附件：《新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则》\n"
            ),
            ("campus-rag-derived", institutional.document_units_object_key): _document_units([]),
            ("campus-rag-derived", annual_ready.document_units_object_key): _document_units([]),
            ("campus-rag-derived", annual_pending.document_units_object_key): _document_units([]),
            **{
                ("campus-rag-derived", record.canonical_markdown_object_key): _canonical_markdown(
                    f"# {record.document_id}\n\n{record.document_id}\n"
                )
                for record in extra_notice_rows
            },
            **{
                ("campus-rag-derived", record.document_units_object_key): _document_units([])
                for record in extra_notice_rows
            },
        }
    )
    return registry, inventory_store, object_store


def _notice_runtime_record(*, notice_id: str, title_slug: str, title: str):
    return _record(
        notice_id=notice_id,
        title_slug=title_slug,
        content_hash=f"sha256:{title_slug}",
        body_key=f"campus_notices/documents/internal_notice/{notice_id}/canonical.md",
        units_key=f"campus_notices/documents/internal_notice/{notice_id}/document-units.jsonl",
        is_current=True,
    )


def _inventory_entry_with_attachment_projection_plans(
    *,
    notice_id: str,
    notice_title: str,
    plans: tuple[dict[str, str], ...],
):
    entry = _inventory_entry(notice_id=notice_id, notice_title=notice_title)
    parent_snapshot = dict(entry.parent_snapshot)
    parent_snapshot["attachment_projection_plans"] = [dict(plan) for plan in plans]
    return replace(
        entry,
        attachment_document_count=sum(
            1
            for plan in plans
            if str(plan.get("materialization_policy") or "") == "required_document"
        ),
        attachment_ref_count=len(plans),
        text_extractable_count=sum(
            1 for plan in plans if str(plan.get("classification") or "") == "text_extractable"
        ),
        parent_snapshot=parent_snapshot,
    )


def _inventory_entry_with_multimodal_inline_images(
    *,
    notice_id: str,
    notice_title: str,
    count: int,
):
    plans = tuple(
        {
            "attachment_ref_id": f"inline-image-{index + 1:04d}",
            "classification": "multimodal_processing_required",
            "content_kind": "inline_image",
            "materialization_policy": "multimodal_processing",
            "resource_role": "inline_image",
        }
        for index in range(count)
    )
    entry = _inventory_entry(notice_id=notice_id, notice_title=notice_title)
    parent_snapshot = dict(entry.parent_snapshot)
    parent_snapshot["attachment_projection_plans"] = [dict(plan) for plan in plans]
    parent_snapshot["multimodal_processing_required_count"] = count
    return replace(
        entry,
        attachment_ref_count=count,
        multimodal_processing_required_count=count,
        notice_risk_label="body_with_spatial_attachments",
        attachment_mix_score=count + 1,
        has_spatial_attachment=count > 0,
        parent_snapshot=parent_snapshot,
    )


def _projection_entry(notice_id: str):
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_store.upsert_many(
        (
            _inventory_entry(
                notice_id=notice_id,
                notice_title=f"测试通知 {notice_id}",
            ),
        )
    )
    return next(
        entry
        for entry in build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=InMemoryDocumentRegistry(()),
            source_truth_inventory_store=inventory_store,
            object_store=_FakeObjectStore(objects={}),
        )
        if entry.primary_role == NOTICE_PRIMARY_ROLE_NOTICE_WINDOW
    )


def _machine_processing_report(
    *,
    document_id: str,
    notice_id: str,
    document_nature: str,
    reasons: tuple[str, ...],
    source_title: str = "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
) -> InternalNoticeRegulationPromotionDocumentReport:
    return InternalNoticeRegulationPromotionDocumentReport(
        document_id=document_id,
        notice_id=notice_id,
        site_id="muc_internal_portal",
        source_kind="parent_notice",
        source_title=source_title,
        input_lane="notice_body",
        revision_track="source-faithful",
        version_id=f"sha256:{notice_id}:source-faithful",
        action="requires_multimodal_processing",
        promotion_class="scoped_rule",
        document_nature=document_nature,
        semantic_owner_kind="notice_body",
        target_corpus="regulations",
        target_collection="scoped_rules",
        regulation_title_normalized=source_title,
        issuing_org="中央民族大学",
        effective_date=None,
        revision_signal=None,
        source_notice_release_time="2026-04-01 10:00",
        source_parent_document_id=document_id,
        source_attachment_ref_id=None,
        source_attachment_sha256=None,
        duplicate_group_key=None,
        duplicate_primary_document_id=None,
        quality_gates_passed=("canonical_text_available",),
        missing_required_metadata=(),
        reasons=reasons,
        artifact_key=None,
    )


def _manifest_report(
    documents: tuple[InternalNoticeRegulationPromotionDocumentReport, ...],
) -> InternalNoticeRegulationPromotionManifestReport:
    return InternalNoticeRegulationPromotionManifestReport(
        corpus="campus_notices",
        collection="internal_notice",
        target_corpus="regulations",
        target_collection="institutional_rules",
        target_serving_stage="candidate",
        registry_record_count=len(documents),
        selected_record_count=len(documents),
        selected_notice_ids=tuple(sorted({document.notice_id for document in documents})),
        selected_document_ids=(),
        scanned_document_count=len(documents),
        candidate_count=0,
        hold_count=0,
        machine_processing_required_count=len(documents),
        promotion_class_counts={},
        action_counts={"requires_multimodal_processing": len(documents)},
        lane_counts={},
        documents=documents,
    )


class _FakeCursorContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> object:
        return self._cursor

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeConnectionContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> _FakeConnectionContextManager:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def cursor(self) -> _FakeCursorContextManager:
        return _FakeCursorContextManager(self._cursor)


class _PagedCursor:
    def __init__(self, pages: list[list[tuple[object, ...]]]) -> None:
        self._pages = list(pages)
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.execute_calls.append((query, params))

    def fetchall(self) -> list[tuple[object, ...]]:
        if not self._pages:
            return []
        return self._pages.pop(0)
