from __future__ import annotations

import unittest

from tests.support.in_memory_registry import InMemoryDocumentRegistry

from .notice_derived_transport_schedule_materialization_test_support import (
    _build_runtime,
    _load_module,
)


class NoticeDerivedTransportScheduleMaterializationTest(unittest.TestCase):
    def test_extracts_clean_transport_rows_from_ocr_table_units_with_fill_down_context(
        self,
    ) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime()

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(
            [
                (
                    row.weekday_scope,
                    row.route_direction,
                    row.departure_time,
                    row.rider_type,
                    row.effective_from,
                    row.source_notice_id,
                    row.source_attachment_document_id,
                )
                for row in rows
            ],
            [
                (
                    "weekdays",
                    "haidian_to_fengtai",
                    "19:30",
                    "学生",
                    "2026-03-20",
                    "355122",
                    "notice_attachment:muc_internal_portal:355122:attachment-0001",
                ),
                (
                    "weekdays",
                    "fengtai_to_haidian",
                    "07:30",
                    "学生",
                    "2026-03-20",
                    "355122",
                    "notice_attachment:muc_internal_portal:355122:attachment-0001",
                ),
            ],
        )

    def test_extracts_transport_rows_from_left_shifted_ocr_continuation_rows(
        self,
    ) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            table_cells=[
                ["序号", "运行方向", "发车地点", "发车时间", "乘车人员", "备注"],
                ["1", "海淀校区至丰台校区", "海淀东门", "19:30", "学生", "3月20日起执行"],
                ["2", "8:10", "学生班次"],
            ],
            parent_is_current=False,
            attachment_is_current=False,
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(
            [
                (
                    row.route_id,
                    row.departure_time,
                    row.rider_type,
                    row.effective_from,
                )
                for row in rows
            ],
            [
                ("route:haidian-to-fengtai", "19:30", "学生", "2026-03-20"),
                ("route:haidian-to-fengtai", "08:10", "学生", "2026-03-20"),
            ],
        )

    def test_deduplicates_repeated_ocr_table_units(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            document_units=[
                {
                    "unit_id": "table-1",
                    "unit_type": "table_unit",
                    "table_cells": [
                        ["适用日期", "运行方向", "发车地点", "发车时间", "乘车人员", "备注"],
                        ["工作日", "海淀校区至丰台校区", "海淀东门", "19:30", "学生", ""],
                    ],
                },
                {
                    "unit_id": "table-1-copy",
                    "unit_type": "table_unit",
                    "table_cells": [
                        ["适用日期", "运行方向", "发车地点", "发车时间", "乘车人员", "备注"],
                        ["工作日", "海淀校区至丰台校区", "海淀东门", "19:30", "学生", ""],
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
            [(row.route_id, row.departure_time) for row in rows],
            [("route:haidian-to-fengtai", "19:30")],
        )

    def test_extracts_transport_rows_from_markdown_table_units(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            document_units=[
                {
                    "unit_id": "table-md",
                    "unit_type": "table_unit",
                    "clean_text": (
                        "| 运行方向 | 发车时间 | 乘车人员 |\n"
                        "| --- | --- | --- |\n"
                        "| 丰台校区至五棵松地铁站 | 08:00 | 师生 |\n"
                    ),
                }
            ],
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(
            [(row.route_id, row.departure_time, row.rider_type) for row in rows],
            [("route:fengtai-to-wukesong-subway", "08:00", "师生")],
        )

    def test_extracts_transport_rows_from_html_table_units(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            document_units=[
                {
                    "unit_id": "table-html",
                    "unit_type": "table_unit",
                    "html": (
                        "<table><tr><th>运行方向</th><th>发车时间</th><th>乘车人员</th></tr>"
                        "<tr><td>五棵松地铁站至丰台校区</td><td>17:30</td><td>师生</td></tr>"
                        "</table>"
                    ),
                }
            ],
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(
            [(row.route_id, row.departure_time, row.rider_type) for row in rows],
            [("route:wukesong-subway-to-fengtai", "17:30", "师生")],
        )

    def test_extracts_transport_rows_from_plain_text_schedule_units(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            document_units=[
                {
                    "unit_id": "table-text",
                    "unit_type": "table_unit",
                    "clean_text": "运行方向  发车时间  乘车人员\n丰台校区至海淀校区  07:45  教师\n",
                }
            ],
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(
            [(row.route_id, row.departure_time, row.rider_type) for row in rows],
            [("route:fengtai-to-haidian", "07:45", "教师")],
        )

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

    def test_exception_only_snapshot_covers_all_exception_service_dates(self) -> None:
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
            [{"start_date": "2026-01-17", "end_date": "2026-01-19"}],
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

    def test_build_deduplicates_repeated_scheduled_departures(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            table_cells=[
                ["适用日期", "运行方向", "发车地点", "发车时间", "乘车人员", "备注"],
                ["工作日", "海淀校区至丰台校区", "海淀东门", "19:30", "学生", ""],
                ["工作日", "海淀校区至丰台校区", "海淀东门", "19:30", "学生", ""],
            ],
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
        departures = result.bundle["scheduled_departures"]
        self.assertEqual(len(departures), 1)
        self.assertEqual(departures[0]["route_id"], "route:haidian-to-fengtai")
        self.assertEqual(departures[0]["departure_time"], "19:30")

    def test_build_merges_same_departure_time_across_rider_comments(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            table_cells=[
                ["适用日期", "运行方向", "发车地点", "发车时间", "乘车人员", "备注"],
                ["工作日", "丰台校区至海淀校区", "丰台南门", "6:40", "教师", "1"],
                ["工作日", "丰台校区至海淀校区", "丰台南门", "6:40", "学生", "新增班次"],
            ],
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
        departures = result.bundle["scheduled_departures"]
        self.assertEqual(len(departures), 1)
        self.assertEqual(departures[0]["route_id"], "route:fengtai-to-haidian")
        self.assertEqual(departures[0]["departure_time"], "06:40")
        self.assertIn("乘车人员：教师", departures[0]["operational_comment"])
        self.assertIn("乘车人员：学生", departures[0]["operational_comment"])
        self.assertNotIn("；1", departures[0]["operational_comment"])

    def test_does_not_treat_reservation_open_time_as_departure(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="354777",
            parent_markdown=(
                "# 关于近期丰台校区周末地铁接驳车运营安排的通知\n\n"
                "三、“接驳车预约”系统可预约班次将于发车前一天9：00开放预约"
                "（如：周五9:00释放周六的可预约资源）。\n"
            ),
            attachment_document_ids=(),
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(rows, ())
        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-03-20T09:00:00+08:00",
            service_horizon_days=3,
        )
        self.assertEqual(
            result.rejected_source_records[0]["reason"],
            "reservation_open_time_only",
        )

    def test_temporary_period_departures_keep_bounded_historical_service_dates(
        self,
    ) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            parent_markdown=(
                "# 关于寒假期间两校区通勤班车班次调整的通知\n\n"
                "寒假期间2026年1月19日至2026年1月20日运行以下班次，"
                "1月21日起恢复正常。\n"
            ),
            table_cells=[
                ["适用日期", "运行方向", "发车地点", "发车时间", "乘车人员", "备注"],
                ["每日", "丰台校区至海淀校区", "丰台南门", "7:30", "师生", ""],
            ],
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
        self.assertEqual(snapshot["schedule_scope"], "temporary_period_revision")
        self.assertEqual(
            snapshot["service_date_ranges"],
            [{"start_date": "2026-01-19", "end_date": "2026-01-20"}],
        )
        self.assertEqual(
            result.bundle["scheduled_departures"][0]["service_dates"],
            ["2026-01-19", "2026-01-20"],
        )

    def test_unbounded_weekend_schedule_uses_baseline_revision_scope(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            parent_markdown=(
                "# 关于丰台校区周末地铁接驳车运营时间调整的通知\n\n"
                "周末及节假日地铁接驳车运营时间调整如下。\n"
            ),
            table_cells=[
                ["线路", "发车时间"],
                ["丰台校区至五棵松地铁站", "08:00"],
            ],
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
        self.assertEqual(snapshot["schedule_scope"], "baseline_revision")
        self.assertEqual(snapshot["service_date_ranges"], [])

    def test_unbounded_temporary_keyword_schedule_uses_baseline_revision_scope(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            parent_markdown=(
                "# 关于通勤班车每周增加临时班次的通知\n\n每周通勤班车增加以下临时班次。\n"
            ),
            table_cells=[
                ["运行方向", "发车时间"],
                ["丰台校区至海淀校区", "07:30"],
            ],
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
        self.assertEqual(snapshot["schedule_scope"], "baseline_revision")
        self.assertEqual(snapshot["service_date_ranges"], [])

    def test_build_reports_rejected_transport_candidates_without_supported_schedule_rows(
        self,
    ) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            parent_markdown="# 关于班车候车秩序的通知\n\n请在指定区域排队候车。\n",
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

        self.assertEqual(result.bundle["transport_schedule_snapshots"], [])
        self.assertEqual(
            result.rejected_source_records,
            [
                {
                    "schema_version": "transport_schedule_rejected_sources.v1",
                    "source_notice_id": "355122",
                    "source_ref": "notice:muc_internal_portal:355122",
                    "reason": "no_supported_transport_schedule_rows",
                    "candidate_kind": "transport_schedule",
                }
            ],
        )
        self.assertFalse(hasattr(result, "manual_review_sources"))


if __name__ == "__main__":
    unittest.main()
