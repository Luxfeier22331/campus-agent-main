from __future__ import annotations

import unittest

from tests.ingestion.notice_derived_transport_schedule_materialization_test_support import (
    _build_runtime,
    _load_module,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry


class NoticeDerivedTransportScheduleMaterializationTestPart02(unittest.TestCase):
    def test_extracts_body_only_temporary_extra_departure(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            parent_markdown=(
                "# 关于本周六临时增加学生班车班次的通知\n\n"
                "本周六（4月11日），“丰台校区”发往“海淀校区”的通勤班车"
                "临时增加一趟6：40的学生班次。\n"
            ),
            attachment_document_ids=(),
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].route_id, "route:fengtai-to-haidian")
        self.assertEqual(rows[0].departure_time, "06:40")
        self.assertEqual(rows[0].rider_type, "学生")
        self.assertEqual(rows[0].weekday_scope, "weekends")
        self.assertEqual(rows[0].schedule_scope, "temporary_period")
        self.assertEqual(rows[0].service_date_ranges, (("2026-04-11", "2026-04-11"),))

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-26T09:00:00+08:00",
            service_horizon_days=3,
        )

        self.assertEqual(
            [
                (row["route_id"], row["departure_time"], row["service_dates"])
                for row in result.bundle["scheduled_departures"]
            ],
            [("route:fengtai-to-haidian", "06:40", ["2026-04-11"])],
        )

    def test_builds_social_practice_special_bus_from_notice_body(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="355881",
            release_time="2026-04-25 16:26",
            parent_markdown=(
                "# 关于开通丰台校区社会实践专车的通知\n\n"
                "各位同学：根据学校工作安排，为保障2026年春季社会实践周活动顺利开展，"
                "满足丰台校区学生开展专业实习等社会实践的出行需求，"
                "4月28日（周二）至4月30日（周四）临时开通社会实践专车，具体通知如下：\n\n"
                "一、运行区间：\n"
                "1.出发：丰台校区至地铁14号线张郭庄站\n"
                "2.接站：地铁14号线园博园站至丰台校区\n\n"
                "二、运行时间：\n"
                "1.出发：第一班07：30，第二班09：00，第三班10：30，第四班12：00\n"
                "2.接站：第一班18：00，第二班19：30，第三班21：00\n\n"
                "三、乘车地点：\n"
                "1.出发：丰台校区 智慧中心南侧\n"
                "2.接站：园博园地铁站A出口右转西侧50米\n\n"
                "四、乘车方式：4月26日9：00起开放预约，有出行需求的同学可通过服务门户、"
                "企业微信APP、民大通APP等线上预约系统“接驳车预约”内预约4月28日-30日之间"
                "的专车，约满即止。请提前到达上车点，通过企业微信或民大通“扫一扫”"
                "现场扫码签到后排队乘车，准点发车。\n"
            ),
            attachment_document_ids=(),
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(
            [(row.route_id, row.departure_time, row.service_date_ranges) for row in rows],
            [
                (
                    "route:fengtai-to-zhangguozhuang-special-bus",
                    "07:30",
                    (("2026-04-28", "2026-04-30"),),
                ),
                (
                    "route:fengtai-to-zhangguozhuang-special-bus",
                    "09:00",
                    (("2026-04-28", "2026-04-30"),),
                ),
                (
                    "route:fengtai-to-zhangguozhuang-special-bus",
                    "10:30",
                    (("2026-04-28", "2026-04-30"),),
                ),
                (
                    "route:fengtai-to-zhangguozhuang-special-bus",
                    "12:00",
                    (("2026-04-28", "2026-04-30"),),
                ),
                (
                    "route:yuanboyuan-to-fengtai-special-bus",
                    "18:00",
                    (("2026-04-28", "2026-04-30"),),
                ),
                (
                    "route:yuanboyuan-to-fengtai-special-bus",
                    "19:30",
                    (("2026-04-28", "2026-04-30"),),
                ),
                (
                    "route:yuanboyuan-to-fengtai-special-bus",
                    "21:00",
                    (("2026-04-28", "2026-04-30"),),
                ),
            ],
        )
        self.assertTrue(all(row.schedule_scope == "temporary_period" for row in rows))

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-26T09:00:00+08:00",
            service_horizon_days=10,
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        self.assertEqual(result.rejected_source_records, [])
        snapshot = result.bundle["transport_schedule_snapshots"][0]
        self.assertEqual(snapshot["source_ref"], "notice:muc_internal_portal:355881")
        self.assertEqual(snapshot["schedule_scope"], "temporary_period")
        self.assertEqual(
            snapshot["service_date_ranges"],
            [{"start_date": "2026-04-28", "end_date": "2026-04-30"}],
        )
        departures = {
            (row["route_id"], row["departure_time"]): row
            for row in result.bundle["scheduled_departures"]
        }
        self.assertEqual(len(departures), 7)
        self.assertEqual(
            departures[("route:fengtai-to-zhangguozhuang-special-bus", "07:30")]["service_dates"],
            ["2026-04-28", "2026-04-29", "2026-04-30"],
        )
        self.assertEqual(
            departures[("route:yuanboyuan-to-fengtai-special-bus", "21:00")]["service_dates"],
            ["2026-04-28", "2026-04-29", "2026-04-30"],
        )
        self.assertIn(
            "丰台校区 智慧中心南侧",
            departures[("route:fengtai-to-zhangguozhuang-special-bus", "07:30")][
                "operational_comment"
            ],
        )

    def test_builds_body_only_transport_service_exception(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, baseline_entry = _build_runtime()
        _registry, _store, exception_entry = _build_runtime(
            notice_id="354505",
            parent_markdown=(
                "# 关于近期地铁接驳车运营安排的通知\n\n"
                "下周一（1月19日）起，地铁接驳车停止运营，恢复运营时间另行通知。\n"
            ),
            release_time="2026-01-15 09:58",
            attachment_document_ids=(),
        )
        registry = InMemoryDocumentRegistry(
            registry.list_by_scope("campus_notices", "internal_notice")
            + _registry.list_by_scope("campus_notices", "internal_notice")
        )
        object_store.objects.update(_store.objects)

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(baseline_entry, exception_entry),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-03-20T09:00:00+08:00",
            service_horizon_days=3,
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        self.assertEqual(
            [
                (
                    row["route_id"],
                    row["service_date"],
                    row["service_status"],
                    tuple(row["related_notice_refs"]),
                )
                for row in result.bundle["transport_service_exceptions"]
            ],
            [
                (
                    "route:subway-shuttle",
                    "2026-01-19",
                    "temporarily_suspended",
                    ("notice:muc_internal_portal:354505",),
                )
            ],
        )

    def test_batch_build_expands_only_latest_unbounded_baseline_to_current_horizon(
        self,
    ) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        old_registry, old_store, old_entry = _build_runtime(
            notice_id="348483",
            release_time="2025-03-07 12:00",
            parent_markdown=(
                "# 关于两校区师生通勤班车优化调整的通知\n\n"
                "3月10日起，海淀校区至丰台校区工作日发车时间：08:10。\n"
            ),
            attachment_document_ids=(),
        )
        new_registry, new_store, new_entry = _build_runtime(
            notice_id="352218",
            release_time="2025-09-19 20:41",
            parent_markdown=(
                "# 关于两校区师生通勤班车运营时间的通知\n\n"
                "9月22日起，海淀校区至丰台校区工作日发车时间：16:40。\n"
            ),
            attachment_document_ids=(),
        )
        registry = InMemoryDocumentRegistry(
            old_registry.list_by_scope("campus_notices", "internal_notice")
            + new_registry.list_by_scope("campus_notices", "internal_notice")
        )
        old_store.objects.update(new_store.objects)

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(old_entry, new_entry),
            registry=registry,
            object_store=old_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-28T09:00:00+08:00",
            service_horizon_days=3,
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        self.assertEqual(
            [
                (row["departure_time"], tuple(row["related_notice_refs"]))
                for row in result.bundle["scheduled_departures"]
            ],
            [("16:40", ("notice:muc_internal_portal:352218",))],
        )

    def test_suspension_notice_does_not_materialize_cancelled_time_as_departure(
        self,
    ) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="354271",
            release_time="2025-12-30 17:46",
            parent_markdown=(
                "# 关于本学期暂停周五18:00由丰台校区发往五棵松地铁站接驳车的通知\n\n"
                "周五晚上18:00由“丰台校区”发往“五棵松地铁站”的接驳车"
                "自运行以来，乘坐人数一直较少，本学期暂停本班次的运行。\n"
            ),
            attachment_document_ids=(),
        )

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-28T09:00:00+08:00",
            service_horizon_days=8,
        )

        self.assertEqual(result.bundle["scheduled_departures"], [])
        self.assertEqual(result.bundle["transport_service_exceptions"], [])
        self.assertEqual(
            result.rejected_source_records,
            [
                {
                    "schema_version": "transport_schedule_rejected_sources.v1",
                    "source_notice_id": "354271",
                    "source_ref": "notice:muc_internal_portal:354271",
                    "reason": "no_supported_transport_schedule_rows",
                    "candidate_kind": "transport_schedule",
                }
            ],
        )

    def test_exception_extraction_skips_heading_and_normal_operation_clause(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="245395",
            release_time="2024-09-05 15:39",
            parent_markdown=(
                "# 关于本周六丰台校区地铁接驳车暂停运营的通知\n\n"
                "为确保迎新工作顺利，本周六（9月7日）地铁接驳车暂停运营，"
                "周日（9月8日）正常运营。\n"
            ),
            attachment_document_ids=(),
        )

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2024-09-06T09:00:00+08:00",
            service_horizon_days=3,
        )

        self.assertEqual(result.bundle["scheduled_departures"], [])
        self.assertEqual(
            [
                (
                    row["route_id"],
                    row["service_date"],
                    row["service_status"],
                    tuple(row["related_notice_refs"]),
                )
                for row in result.bundle["transport_service_exceptions"]
            ],
            [
                (
                    "route:subway-shuttle",
                    "2024-09-07",
                    "temporarily_suspended",
                    ("notice:muc_internal_portal:245395",),
                )
            ],
        )

    def test_exception_only_snapshot_covers_supported_exception_service_dates(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="354505",
            parent_markdown=(
                "# 关于近期地铁接驳车运营安排的通知\n\n"
                "本周末（1月17、18日）地铁接驳车“丰台校区”发往“五棵松地铁站”"
                "班次正常运行，其余线路暂停运营。\n"
                "下周一（1月19日）起，地铁接驳车停止运营，恢复运营时间另行通知。\n"
            ),
            release_time="2026-01-15 09:58",
            attachment_document_ids=(),
        )

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-03-20T09:00:00+08:00",
            service_horizon_days=3,
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        snapshot = result.bundle["transport_schedule_snapshots"][0]
        self.assertEqual(
            snapshot["service_date_ranges"],
            [{"start_date": "2026-01-19", "end_date": "2026-01-19"}],
        )
        self.assertEqual(snapshot["effective_until"], "2026-01-20T00:00:00+08:00")

    def test_builds_transport_schedule_projection_from_ready_consumption_candidates(
        self,
    ) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime()

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-03-20T09:00:00+08:00",
            service_horizon_days=3,
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        bundle = result.bundle
        self.assertEqual(len(bundle["transport_schedule_snapshots"]), 1)
        self.assertEqual(
            bundle["transport_schedule_snapshots"][0]["source_ref"],
            "notice:muc_internal_portal:355122",
        )
        self.assertEqual(
            bundle["transport_schedule_snapshots"][0]["schedule_scope"],
            "baseline_revision",
        )
        self.assertEqual(bundle["transport_schedule_snapshots"][0]["precedence"], 100)
        self.assertEqual(bundle["transport_schedule_snapshots"][0]["service_date_ranges"], [])
        departures = bundle["scheduled_departures"]
        self.assertEqual(
            {
                (row["route_id"], row["departure_time"], tuple(row["related_notice_refs"]))
                for row in departures
            },
            {
                (
                    "route:haidian-to-fengtai",
                    "19:30",
                    ("notice:muc_internal_portal:355122",),
                ),
                (
                    "route:fengtai-to-haidian",
                    "07:30",
                    ("notice:muc_internal_portal:355122",),
                ),
            },
        )
        self.assertEqual(departures[0]["service_dates"], ["2026-03-20"])
        self.assertIn("学生", departures[0]["operational_comment"])

    def test_builds_fengtai_subway_shuttle_revision_from_recurring_weekday_tables(
        self,
    ) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="352325",
            release_time="2025-09-25 17:06",
            parent_markdown=(
                "# 关于丰台校区地铁接驳车优化调整的通知\n\n"
                "为进一步优化丰台校区地铁接驳车服务，班次安排调整如下。\n"
            ),
            attachment_document_ids=(
                "notice_attachment:muc_internal_portal:352325:attachment-0001",
            ),
            document_units=[
                {
                    "unit_id": "image-1-table",
                    "unit_type": "table_unit",
                    "table_cells": [
                        ["日期", "路线", "发车地点", "发车时间", "备注"],
                        [
                            "周五",
                            "丰台校区→五棵松地铁站",
                            "聚雅餐厅东侧停车场路口",
                            "18:00",
                            "新增班次",
                        ],
                        [
                            "周六、日及法定节假日",
                            "丰台校区→五棵松地铁站",
                            "聚雅餐厅东侧停车场路口",
                            "09:00",
                            "新增班次",
                        ],
                        [
                            "周六、日及法定节假日",
                            "五棵松地铁站→丰台校区",
                            "五棵松地铁站A口北侧国家开放大学东门口",
                            "18:30",
                            "新增班次",
                        ],
                    ],
                },
                {
                    "unit_id": "image-2-table",
                    "unit_type": "table_unit",
                    "table_cells": [
                        ["日期", "路线", "发车地点", "发车时间", "备注"],
                        [
                            "周六、日及法定节假日",
                            "丰台校区→篱笆房地铁站",
                            "学生活动中心西侧停车场路口",
                            "08:00",
                            "调整发车时间",
                        ],
                        [
                            "周六、日及法定节假日",
                            "篱笆房地铁站→丰台校区",
                            "篱笆房地铁站 B2 口",
                            "20:00",
                            "调整发车时间",
                        ],
                    ],
                },
            ],
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(
            {(row.route_id, row.departure_time, row.weekday_scope) for row in rows},
            {
                ("route:fengtai-to-wukesong-subway", "18:00", "weekday:4"),
                ("route:fengtai-to-wukesong-subway", "09:00", "weekends"),
                ("route:wukesong-subway-to-fengtai", "18:30", "weekends"),
                ("route:fengtai-to-libafang-subway", "08:00", "weekends"),
                ("route:libafang-subway-to-fengtai", "20:00", "weekends"),
            },
        )

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2025-09-26T09:00:00+08:00",
            service_horizon_days=3,
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        departures = {
            (row["route_id"], row["departure_time"]): row
            for row in result.bundle["scheduled_departures"]
        }
        self.assertEqual(
            departures[("route:fengtai-to-wukesong-subway", "18:00")]["service_dates"],
            ["2025-09-26"],
        )
        self.assertEqual(
            departures[("route:fengtai-to-libafang-subway", "08:00")]["service_dates"],
            ["2025-09-27", "2025-09-28"],
        )
        self.assertIn(
            "法定节假日",
            departures[("route:fengtai-to-libafang-subway", "08:00")]["operational_comment"],
        )
