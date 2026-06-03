from __future__ import annotations

import unittest

from tests.ingestion.notice_derived_transport_schedule_materialization_test_support import (
    _build_runtime,
    _load_module,
)


class NoticeDerivedTransportScheduleMaterializationTestPart03(unittest.TestCase):
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
        self.assertEqual(result.rejected_source_records, [])
        self.assertEqual(result.bundle["transport_operational_notices"], [])

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
        self.assertEqual(
            result.bundle["transport_rejected_sources"],
            result.rejected_source_records,
        )
        self.assertFalse(hasattr(result, "manual_review_sources"))
