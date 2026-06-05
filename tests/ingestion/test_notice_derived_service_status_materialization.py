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

    def test_builds_it_platform_maintenance_status_with_yearless_end_datetime(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="354674",
            notice_title="关于信息门户升级维护的通知",
            release_time="2026-02-06 16:13",
            parent_markdown=(
                "# 关于信息门户升级维护的通知\n\n"
                "为提升系统性能，我处计划于2026年2月11日20:00—2月12日07:00"
                "对信息门户进行升级维护，期间系统将暂停访问。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-02-11T21:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(record["subject_id"], "it-platform:information-portal")
        self.assertEqual(record["effective_from"], "2026-02-11T20:00:00+08:00")
        self.assertEqual(record["effective_until"], "2026-02-12T07:00:00+08:00")

    def test_builds_it_platform_recharge_shutdown_status(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="247726",
            notice_title="关于临时停用校园一卡通、网费和电费充值功能的通知",
            release_time="2025-12-24 10:31",
            parent_markdown=(
                "# 关于临时停用校园一卡通、网费和电费充值功能的通知\n\n"
                "我处将于2025年12月29日17:00——2026年1月1日10:00关闭校园一卡通充值、"
                "网费充值和电费充值的功能。特别提示：充值功能关闭期间，所有充值方式均将停止使用。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2025-12-30T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(record["subject_id"], "it-platform:campus-card")
        self.assertEqual(record["service_family"], "it_platform")
        self.assertEqual(record["observed_status"], "temporarily_closed")
        self.assertEqual(record["effective_from"], "2025-12-29T17:00:00+08:00")
        self.assertEqual(record["effective_until"], "2026-01-01T10:00:00+08:00")

    def test_status_note_extracts_markdown_heading_status_line(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="247726",
            notice_title="关于临时停用校园一卡通、网费和电费充值功能的通知",
            release_time="2025-12-24 10:31",
            parent_markdown=(
                "# 关于临时停用校园一卡通、网费和电费充值功能的通知\n\n"
                "全校师生：\n\n"
                "## 根据财务处《关于2025年度财务年终工作安排的通知》要求，"
                "我处将于2025年12月29日17:00——2026年1月1日10:00关闭校园一卡通充值、"
                "网费充值和电费充值的功能。\n\n"
                "特别提示：充值功能关闭期间，所有充值方式均将停止使用。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2025-12-30T12:00:00+08:00",
        )

        record = result.bundle["service_status_records"][0]
        self.assertFalse(record["status_note"].startswith("#"))
        self.assertIn("2025年12月29日17:00", record["status_note"])
        self.assertNotIn("信息化建设管理处", record["status_note"])

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

    def test_builds_library_holiday_date_range_status(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="352345",
            notice_title="关于图书馆2025年国庆节、中秋节放假及工作安排的通知",
            release_time="2025-09-26 11:17",
            parent_markdown=(
                "# 关于图书馆2025年国庆节、中秋节放假及工作安排的通知\n\n"
                "放假期间，海淀校区图书馆所有自习空间正常开放，各借阅室关闭；"
                "丰台校区图书馆开馆。10月1日（周三）至8日（周三）放假，共8天。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2025-10-02T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(record["subject_id"], "library:fengtai")
        self.assertEqual(record["service_family"], "library")
        self.assertEqual(record["observed_status"], "limited_service")
        self.assertEqual(record["effective_from"], "2025-10-01T00:00:00+08:00")
        self.assertEqual(record["effective_until"], "2025-10-09T00:00:00+08:00")

    def test_library_status_note_extracts_status_segment_without_markdown_suffix(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="352345",
            notice_title="关于图书馆2025年国庆节、中秋节放假及工作安排的通知",
            release_time="2025-09-26 11:17",
            parent_markdown=(
                "# 关于图书馆2025年国庆节、中秋节放假及工作安排的通知\n\n"
                "各位读者：\n\n"
                "一、放假安排\n\n"
                "10月1日（周三）至8日（周三）放假，共8天。\n\n"
                "二、开放情况\n\n"
                "放假期间，海淀校区图书馆所有自习空间正常开放，各借阅室关闭；"
                "丰台校区图书馆开馆；两校区图书馆所有的电子资源均可正常使用。\n\n"
                "图书馆\n\n"
                "2025年9月26日\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2025-10-02T12:00:00+08:00",
        )

        record = result.bundle["service_status_records"][0]
        self.assertFalse(record["status_note"].startswith("#"))
        self.assertIn("借阅室关闭", record["status_note"])
        self.assertNotIn("2025年9月26日", record["status_note"])

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

    def test_builds_service_counter_holiday_limited_window_from_service_hall_section(
        self,
    ) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="354502",
            notice_title="关于海淀校区寒假期间学生浴室、吹风机室、学生食堂、教工餐厅、体育场馆及后勤综合服务大厅调整开放时间的通知",
            release_time="2026-01-15 09:09",
            parent_markdown=(
                "# 关于海淀校区寒假期间学生浴室、吹风机室、学生食堂、教工餐厅、体育场馆及后勤综合服务大厅调整开放时间的通知\n\n"
                "五、体育场馆开放时间：1月22日-2月26日 逸夫体育馆：8：30-18：30。\n\n"
                "六、后勤综合服务大厅\n"
                "1、服务日期（每周一、每周四）1月：22日、26日、29日"
                "2月：2日、5日、9日、12日、26日\n"
                "2、服务时间：9:00－11:00\n"
                "2月27日起大厅恢复正常服务时间。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-02-11T10:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(record["subject_id"], "service-counter:comprehensive-service-hall")
        self.assertEqual(record["service_family"], "service_counter")
        self.assertEqual(record["observed_status"], "limited_service")
        self.assertEqual(record["effective_from"], "2026-01-22T09:00:00+08:00")
        self.assertEqual(record["effective_until"], "2026-02-27T00:00:00+08:00")
        self.assertNotIn("8：30-18：30", record["status_note"])

    def test_builds_hospital_new_clinic_limited_service_status(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="354845",
            notice_title="关于丰台校区校医院增开皮肤科门诊的通知",
            release_time="2026-03-03 14:31",
            parent_markdown=(
                "# 关于丰台校区校医院增开皮肤科门诊的通知\n\n"
                "丰台校区校医院自2026年3月6日起正式增开皮肤科门诊。"
                "开诊时间：每周二下午、周五下午（14:00—17:00），节假日停诊。\n"
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
        self.assertEqual(record["subject_id"], "service-counter:campus-hospital")
        self.assertEqual(record["display_name"], "校医院")
        self.assertEqual(record["observed_status"], "limited_service")
        self.assertEqual(record["effective_from"], "2026-03-06T00:00:00+08:00")
        self.assertEqual(record["effective_until"], "2099-12-31T23:59:59+08:00")

    def test_service_counter_relevant_text_does_not_start_from_markdown_title(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="354845",
            notice_title="关于丰台校区校医院增开皮肤科门诊的通知",
            release_time="2026-03-03 14:31",
            parent_markdown=(
                "# 关于丰台校区校医院增开皮肤科门诊的通知\n\n"
                "为进一步满足丰台校区师生皮肤病诊疗、皮肤健康护理等就医需求，"
                "丰台校区校医院自2026年3月6日起正式增开皮肤科门诊。\n"
                "开诊时间：每周二下午、周五下午（14:00—17:00），节假日停诊。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-28T12:00:00+08:00",
        )

        record = result.bundle["service_status_records"][0]
        self.assertIn("2026年3月6日起正式增开皮肤科门诊", record["status_note"])
        self.assertNotIn("校医院增开皮肤科门诊的通知", record["status_note"])

    def test_builds_hospital_holiday_duty_limited_service_status(self) -> None:
        registry, object_store, entry = _service_status_runtime(
            notice_id="354575",
            notice_title="2026年校医院寒假值班安排",
            release_time="2026-01-21 10:42",
            parent_markdown=(
                "# 2026年校医院寒假值班安排\n\n"
                "根据学校2026年寒假放假时间安排，2026年1月22日--2月26日为寒假时间，"
                "现将校医院2026年寒假期间值班安排通知如下："
                "海淀校区：一、门诊时间：8：00--11：30 14：00--17：00。\n"
            ),
        )

        result = materialization.build_notice_derived_service_status_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-02-11T12:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid)
        record = result.bundle["service_status_records"][0]
        self.assertEqual(record["subject_id"], "service-counter:campus-hospital")
        self.assertEqual(record["observed_status"], "limited_service")
        self.assertEqual(record["effective_from"], "2026-01-22T00:00:00+08:00")
        self.assertEqual(record["effective_until"], "2026-02-27T00:00:00+08:00")

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
