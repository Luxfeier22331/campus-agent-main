from __future__ import annotations

import importlib
import unittest

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
    NoticeConsumptionProjectionEntry,
)

from tests.ingestion.internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _FakeObjectStore,
    _record,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry


class NoticeDerivedServiceGuideMaterializationTest(unittest.TestCase):
    def test_builds_transport_reservation_guide_from_ready_special_service_candidate(
        self,
    ) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived service guide materializer is required")
        assert module is not None
        registry, object_store, entry = _build_runtime()

        result = module.build_notice_derived_service_guide_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-27T09:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        self.assertEqual(
            result.bundle["source_families"],
            ["authenticated_notice_service_guide_projection_v1"],
        )
        records = result.bundle["service_guide_records"]
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record["service_id"], "service:transport-reservation:subway-shuttle")
        self.assertEqual(record["display_name"], "地铁接驳车预约说明")
        self.assertEqual(record["category"], "transport_reservation")
        self.assertEqual(record["source_refs"], ["notice:muc_internal_portal:354777"])
        self.assertEqual(record["extraction_status"], "ready")
        self.assertIn("地铁接驳车预约", record["aliases"])
        self.assertIn("接驳车预约", record["aliases"])
        self.assertEqual(
            {section["section_type"] for section in record["guide_sections"]},
            {"overview", "procedure", "entry", "office_hours"},
        )
        procedure = next(
            section
            for section in record["guide_sections"]
            if section["section_type"] == "procedure"
        )
        self.assertIn("发车前一天9:00开放预约", procedure["content"])
        self.assertIn("约满即止", procedure["content"])
        self.assertEqual(
            {entry_ref["label"] for entry_ref in record["entry_refs"]},
            {"服务门户", "企业微信", "接驳车预约系统"},
        )
        self.assertEqual(record["office_hours"][0]["label"], "预约开放时间")
        self.assertEqual(record["office_hours"][0]["day_pattern"], "发车前一天")
        self.assertEqual(record["office_hours"][0]["time_range"], "09:00")

    def test_latest_notice_wins_for_stable_transport_reservation_service_id(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived service guide materializer is required")
        assert module is not None
        registry, object_store, older_entry = _build_runtime()
        newer_record = _record(
            notice_id="355001",
            title_slug="newer-subway-shuttle-reservation",
            content_hash="sha256:newer-subway-shuttle-reservation",
            body_key="campus_notices/documents/internal_notice/355001/canonical.md",
            units_key="campus_notices/documents/internal_notice/355001/document-units.jsonl",
            is_current=True,
        )
        registry = InMemoryDocumentRegistry(
            (*registry.list_by_scope("campus_notices", "internal_notice"), newer_record)
        )
        object_store.objects[("campus-rag-derived", newer_record.canonical_markdown_object_key)] = (
            _canonical_markdown(
                "# 关于近期丰台校区周末地铁接驳车运营安排的通知\n\n"
                "接驳车预约系统可预约班次将于发车前一天10:00开放预约，可通过民大通办理。\n"
            )
        )
        newer_entry = _projection_entry(
            notice_id="355001",
            release_time="2026-03-05 09:00",
        )

        result = module.build_notice_derived_service_guide_projection_bundle(
            projection_entries=(older_entry, newer_entry),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-27T09:00:00+08:00",
        )

        records = result.bundle["service_guide_records"]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["source_refs"], ["notice:muc_internal_portal:355001"])
        self.assertEqual(records[0]["office_hours"][0]["time_range"], "10:00")


def _load_module():
    try:
        return importlib.import_module(
            "campus_ingestion_core.notice_derived_service_guide_materialization"
        )
    except ModuleNotFoundError:
        return None


def _build_runtime():
    parent = _record(
        notice_id="354777",
        title_slug="weekend-subway-shuttle-reservation",
        content_hash="sha256:weekend-subway-shuttle-reservation",
        body_key="campus_notices/documents/internal_notice/354777/canonical.md",
        units_key="campus_notices/documents/internal_notice/354777/document-units.jsonl",
        is_current=True,
    )
    registry = InMemoryDocumentRegistry((parent,))
    object_store = _FakeObjectStore(
        objects={
            (
                "campus-rag-derived",
                parent.canonical_markdown_object_key,
            ): _canonical_markdown(
                "# 关于近期丰台校区周末地铁接驳车运营安排的通知\n\n"
                "三、“接驳车预约”系统可预约班次将于发车前一天9:00开放预约，"
                "约满即止。请通过服务门户或企业微信进入接驳车预约系统，"
                "按要求取消预约并提前到达，扫码签到。"
            ),
        }
    )
    return registry, object_store, _projection_entry()


def _projection_entry(
    *,
    notice_id: str = "354777",
    release_time: str = "2026-02-27 10:00",
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:notice:muc_internal_portal:{notice_id}:special_service_notice",
        primary_role=NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_notice_release_time=release_time,
        role_metadata={
            "notice_title": "关于近期丰台校区周末地铁接驳车运营安排的通知",
            "special_service_candidate_kind": "transport_reservation_instruction",
        },
    )


if __name__ == "__main__":
    unittest.main()
