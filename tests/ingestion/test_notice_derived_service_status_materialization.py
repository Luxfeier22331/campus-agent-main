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

    def test_builds_it_platform_maintenance_status(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="355201",
            notice_title="关于信息门户升级维护暂停访问的通知",
            release_time="2026-04-28 09:00",
            parent_markdown=(
                "# 关于信息门户升级维护暂停访问的通知\n\n"
                "信息门户将于2026年5月1日0:00至2026年5月1日6:00进行升级维护，"
                "期间暂停访问。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-28T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(record["subject_id"], "it-platform:information-portal")
        self.assertEqual(record["service_family"], "it_platform")
        self.assertEqual(record["observed_status"], "temporarily_closed")
        self.assertEqual(record["effective_from"], "2026-05-01T00:00:00+08:00")
        self.assertEqual(record["effective_until"], "2026-05-01T06:00:00+08:00")

    def test_builds_library_limited_service_status(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="355202",
            notice_title="关于图书馆开放时间调整的通知",
            release_time="2026-04-28 09:00",
            parent_markdown=(
                "# 关于图书馆开放时间调整的通知\n\n"
                "5月1日至5月5日，海淀校区图书馆开放时间调整为8:00-17:00。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-28T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(record["subject_id"], "library:haidian")
        self.assertEqual(record["service_family"], "library")
        self.assertEqual(record["observed_status"], "limited_service")
        self.assertEqual(record["effective_from"], "2026-05-01T08:00:00+08:00")
        self.assertEqual(record["effective_until"], "2026-05-05T17:00:00+08:00")

    def test_builds_service_counter_closure_status(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="355203",
            notice_title="关于综合服务大厅暂停办理业务的通知",
            release_time="2026-04-27 09:00",
            parent_markdown=(
                "# 关于综合服务大厅暂停办理业务的通知\n\n"
                "因系统维护，综合服务大厅4月28日暂停办理线下业务，4月29日起恢复办理。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-28T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(record["subject_id"], "service-counter:comprehensive-service-hall")
        self.assertEqual(record["service_family"], "service_counter")
        self.assertEqual(record["observed_status"], "temporarily_closed")
        self.assertEqual(record["effective_from"], "2026-04-28T00:00:00+08:00")
        self.assertEqual(record["effective_until"], "2026-04-29T00:00:00+08:00")

    def test_builds_facility_closure_status(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="355204",
            notice_title="关于自习室临时关闭的通知",
            release_time="2026-04-27 09:00",
            parent_markdown=(
                "# 关于自习室临时关闭的通知\n\n"
                "丰台校区公共自习室自4月28日起临时关闭，恢复开放时间另行通知。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-28T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(record["subject_id"], "facility:self-study-room:fengtai")
        self.assertEqual(record["service_family"], "facility")
        self.assertEqual(record["observed_status"], "temporarily_closed")
        self.assertEqual(record["effective_from"], "2026-04-28T00:00:00+08:00")

    def test_builds_facility_trial_operation_status(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="355650",
            notice_title="关于静园10号楼负一层女浴室试运行的通知",
            release_time="2026-04-15 16:21",
            parent_markdown=(
                "# 关于静园10号楼负一层女浴室试运行的通知\n\n"
                "静园10号楼负一层女浴室目前已建成，将于本周四（4月16日）试运行。"
                "该浴室共有两个区域，开放时间如下。\n\n"
                "电热水器浴室区：开放时间为每日 6:00-23:00。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-28T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        self.assertEqual(len(result.bundle["service_status_records"]), 1)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(record["subject_id"], "facility:bathroom:jingyuan-10")
        self.assertEqual(record["display_name"], "静园10号楼负一层女浴室")
        self.assertEqual(record["service_family"], "facility")
        self.assertEqual(record["observed_status"], "limited_service")
        self.assertEqual(record["effective_from"], "2026-04-16T00:00:00+08:00")
        self.assertEqual(record["effective_until"], "2099-12-31T23:59:59+08:00")

    def test_rejects_service_status_candidate_without_effective_window(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="355205",
            notice_title="关于校园网服务说明的通知",
            release_time="2026-04-27 09:00",
            parent_markdown="# 关于校园网服务说明的通知\n\n校园网服务请通过信息门户查看。\n",
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-28T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        self.assertEqual(result.bundle["service_status_records"], [])
        self.assertEqual(
            result.bundle["service_status_rejected_sources"][0]["reason"],
            "missing_effective_window_or_status_signal",
        )


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
