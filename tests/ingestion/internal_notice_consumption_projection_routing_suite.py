from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
    NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
    build_internal_notice_consumption_projection_entries,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)

from tests.ingestion.internal_notice_consumption_projection_test_support import (
    _COMMUTE_NOTICE_TITLES,
    _attachment_runtime_record,
    _build_runtime,
    _commute_inventory_entry,
    _env,
    _inventory_entry,
    _inventory_entry_with_attachment_projection_plans,
    _manifest_report,
    _notice_runtime_record,
    _promotion_report,
)


class InternalNoticeConsumptionProjectionRoutingTest(unittest.TestCase):
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
        self.assertEqual(service_unit.default_agent, NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES)
        self.assertEqual(
            service_unit.target_surface, NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        )
        self.assertEqual(
            service_unit.consumption_status,
            NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        )
        self.assertEqual(
            service_unit.role_metadata["notice_query_reason"],
            "service_status_typed_materialization_candidate",
        )

    def test_build_entries_routes_commute_and_shuttle_notices_via_notice_family_taxonomy(
        self,
    ) -> None:
        commute_notice_rows = tuple(
            _notice_runtime_record(
                notice_id=notice_id,
                title_slug=f"transport-{notice_id}",
                title=title,
            )
            for notice_id, title in _COMMUTE_NOTICE_TITLES
        )
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                *commute_notice_rows,
                _attachment_runtime_record(
                    notice_id="354889",
                    attachment_ref_id="attachment-0001",
                    title_slug="teacher-commute-ocr",
                ),
                _attachment_runtime_record(
                    notice_id="355122",
                    attachment_ref_id="attachment-0001",
                    title_slug="student-commute-ocr",
                ),
            )
        )
        inventory_store.upsert_many(
            tuple(
                _commute_inventory_entry(notice_id=notice_id, notice_title=title)
                for notice_id, title in _COMMUTE_NOTICE_TITLES
            )
        )

        entries = build_internal_notice_consumption_projection_entries(
            request=InternalNoticeRegulationPromotionRequest(
                notice_ids=tuple(notice_id for notice_id, _title in _COMMUTE_NOTICE_TITLES)
            ),
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        service_units = [
            entry
            for entry in entries
            if entry.source_notice_id in {notice_id for notice_id, _title in _COMMUTE_NOTICE_TITLES}
            and entry.primary_role == NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE
        ]
        self.assertEqual(
            {entry.source_notice_id for entry in service_units},
            {notice_id for notice_id, _title in _COMMUTE_NOTICE_TITLES},
        )
        self.assertTrue(
            all(
                entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
                for entry in service_units
            )
        )
        self.assertTrue(
            all(
                entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
                for entry in service_units
            )
        )
        self.assertTrue(
            all(
                entry.default_agent == NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES
                for entry in service_units
            )
        )
        self.assertTrue(
            all(
                entry.role_metadata["service_status_candidate_kind"] == "transport_schedule"
                for entry in service_units
            )
        )
        ocr_backed_units = {
            entry.source_notice_id: entry
            for entry in service_units
            if entry.source_notice_id in {"354889", "355122"}
        }
        self.assertEqual(
            ocr_backed_units["354889"].role_metadata["attachment_document_ids"],
            ("notice_attachment:muc_internal_portal:354889:attachment-0001",),
        )
        self.assertEqual(
            ocr_backed_units["355122"].source_attachment_ref_ids,
            ("attachment-0001",),
        )
        self.assertFalse(
            any(
                entry.source_notice_id
                in {notice_id for notice_id, _title in _COMMUTE_NOTICE_TITLES}
                and entry.target_surface == NOTICE_TARGET_SURFACE_SCOPED_RULES
                for entry in entries
            )
        )

    def test_build_entries_suppresses_regulation_promotion_for_service_status_notices(
        self,
    ) -> None:
        registry, inventory_store, object_store = _build_runtime(
            extra_notice_rows=(
                _notice_runtime_record(
                    notice_id="354578",
                    title_slug="winter-commute-adjustment",
                    title="关于寒假期间两校区通勤班车班次调整的通知",
                ),
            )
        )
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="354578",
                    notice_title="关于寒假期间两校区通勤班车班次调整的通知",
                    published_date="2026-01-21 10:00",
                ),
            )
        )
        scoped_report = _promotion_report(
            document_id="notice:muc_internal_portal:354578",
            notice_id="354578",
            source_title="关于寒假期间两校区通勤班车班次调整的通知",
            document_nature=NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
        )

        with patch(
            "campus_ingestion_core.internal_notice_consumption_projection.build_internal_notice_regulation_promotion_manifest",
            return_value=_manifest_report((scoped_report,)),
        ):
            entries = build_internal_notice_consumption_projection_entries(
                env=_env(),
                registry=registry,
                source_truth_inventory_store=inventory_store,
                object_store=object_store,
            )

        self.assertTrue(
            any(
                entry.source_notice_id == "354578"
                and entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
                for entry in entries
            )
        )
        self.assertFalse(
            any(
                entry.source_notice_id == "354578"
                and entry.target_surface == NOTICE_TARGET_SURFACE_SCOPED_RULES
                for entry in entries
            )
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


if __name__ == "__main__":
    unittest.main()
