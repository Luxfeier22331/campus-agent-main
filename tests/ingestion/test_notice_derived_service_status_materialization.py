from __future__ import annotations

import importlib
import unittest

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
    NoticeConsumptionProjectionEntry,
)

from tests.ingestion.internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _document_units,
    _FakeObjectStore,
    _record,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry

materialization = importlib.import_module(
    "campus_ingestion_core.notice_derived_service_status_materialization"
)


class NoticeDerivedServiceStatusMaterializationTest(unittest.TestCase):
    def test_builds_limited_service_status_for_transport_boarding_point_change(self) -> None:
        notice_id = "353903"
        registry, object_store, entry = _service_status_runtime(
            notice_id=notice_id,
            notice_title="关于更改通勤班车丰台校区乘车点的通知",
            release_time="2025-12-11 10:00",
            parent_markdown=(
                "# 关于更改通勤班车丰台校区乘车点的通知\n\n"
                "各位老师、同学们：\n\n"
                "为切实保障师生员工在丰台校区校园出行安全，根据保卫部12月4日发布的"
                "《关于加强丰台校区校园交通秩序管理的通知》中关于优化道路通行的相关要求，"
                "经现场踏勘，下周一（12月15日）起，两校区通勤班车丰台校区的上车点、"
                "下车点更改为聚雅餐厅东侧停车场路口。\n\n"
                "特此通知。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-27T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        self.assertEqual(len(result.bundle["service_status_records"]), 1)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(
            record["subject_id"],
            "transport:intercampus-commute:boarding-point:fengtai",
        )
        self.assertEqual(record["display_name"], "两校区通勤班车丰台校区乘车点")
        self.assertEqual(record["observed_status"], "limited_service")
        self.assertEqual(record["effective_from"], "2025-12-15T00:00:00+08:00")
        self.assertEqual(record["effective_until"], "2099-12-31T23:59:59+08:00")
        self.assertEqual(record["related_notice_refs"], ["notice:muc_internal_portal:353903"])
        self.assertIn("聚雅餐厅东侧停车场路口", record["status_note"])

    def test_ignores_transport_schedule_notice_without_status_override_fact(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="355122",
            notice_title="关于两校区学生通勤班车增加班次的通知",
            release_time="2026-03-18 11:12",
            parent_markdown=(
                "# 关于两校区学生通勤班车增加班次的通知\n\n"
                "新增班次自2026年3月20日起执行，具体见附件班次表。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-27T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        self.assertEqual(result.bundle["service_status_records"], [])


def _service_status_runtime(
    *,
    notice_id: str,
    notice_title: str,
    release_time: str,
    parent_markdown: str,
):
    parent = _record(
        notice_id=notice_id,
        title_slug=f"{notice_id}-service-status",
        content_hash=f"sha256:{notice_id}:service-status",
        body_key=f"campus_notices/documents/internal_notice/{notice_id}/canonical.md",
        units_key=f"campus_notices/documents/internal_notice/{notice_id}/document-units.jsonl",
        is_current=True,
    )
    registry = InMemoryDocumentRegistry((parent,))
    object_store = _FakeObjectStore(
        objects={
            ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                parent_markdown
            ),
            ("campus-rag-derived", parent.document_units_object_key): _document_units([]),
        }
    )
    entry = NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:notice:muc_internal_portal:{notice_id}:service_status_override",
        primary_role=NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
        completeness_status="complete",
        answerability="body_only_answerable",
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_notice_release_time=release_time,
        role_metadata={
            "notice_title": notice_title,
            "notice_family": "transport_commute_status",
            "service_status_candidate_kind": "transport_schedule",
        },
    )
    return registry, object_store, entry
