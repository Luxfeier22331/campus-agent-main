from __future__ import annotations

import unittest

from tests.ingestion.notice_derived_transport_schedule_materialization_test_support import (
    _attachment_record,
    _build_runtime,
    _load_module,
)


class NoticeDerivedTransportScheduleMaterializationTestPart01(unittest.TestCase):
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

    def test_resolves_schedule_ocr_child_document_from_attachment_lineage(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="355867",
            release_time="2026-04-25 13:11",
            parent_markdown=(
                "# 关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知\n\n"
                "具体班车安排见图片附件。\n"
            ),
            attachment_document_ids=(
                "notice_attachment:muc_internal_portal:355867:attachment-0001",
            ),
            table_cells=[
                ["日期", "运行方向", "发车时间", "乘车人员"],
                ["4月27日", "丰台校区至海淀校区", "06:40", "教师"],
            ],
        )
        original_document_id = "notice_attachment:muc_internal_portal:355867:attachment-0001"
        original_record = registry.current_version(
            original_document_id,
            preferred_revision_tracks=("source-faithful",),
        )
        assert original_record is not None
        schedule_ocr_record = _attachment_record(
            notice_id="355867",
            attachment_ref_id="attachment-0001:schedule-ocr",
            units_key=(
                "campus_notices/documents/internal_notice/355867/attachment-0001/"
                "source-faithful/2026/document-units.jsonl"
            ),
        )
        assert original_record.document_units_object_key is not None
        assert schedule_ocr_record.document_units_object_key is not None
        object_store.objects[
            ("campus-rag-derived", schedule_ocr_record.document_units_object_key)
        ] = object_store.objects[("campus-rag-derived", original_record.document_units_object_key)]
        registry.delete_document(original_document_id)
        registry.upsert(schedule_ocr_record)

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].departure_time, "06:40")
        self.assertEqual(
            rows[0].source_attachment_document_id,
            "notice_attachment:muc_internal_portal:355867:attachment-0001:schedule-ocr",
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

    def test_table_rows_inherit_parenthetical_parent_effective_date(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            parent_markdown=(
                "# 关于两校区学生通勤班车增加班次的通知\n\n"
                "为方便师生两校区通勤，3月20日（本周五）起，"
                "对两校区学生通勤班车增加2个班次。具体见下表。\n\n"
                "丰台校区管委会办公室\n\n"
                "2026年3月18日\n"
            ),
            table_cells=[
                ["星期", "线路", "序号", "发车时间", "类型", "备注"],
                ["周一至周五", "海淀校区→丰台校区", "1", "19:30", "学生班次", "新增班次"],
                ["", "丰台校区→海淀校区", "2", "7:30", "学生班次", "新增班次"],
            ],
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual([row.effective_from for row in rows], ["2026-03-20", "2026-03-20"])

    def test_table_rows_inherit_attachment_ocr_effective_date_context(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None

        cases = (
            (
                "353901",
                "2025-12-11 15:40",
                "表1 师生通勤班车班次表（新班次 12月13日起执行）",
                "2025-12-13",
            ),
            (
                "354270",
                "2025-12-30 10:01",
                "表1 师生通勤班车班次表（新班次2026年1月4日起执行）",
                "2026-01-04",
            ),
        )
        for notice_id, release_time, attachment_context, expected_effective_from in cases:
            with self.subTest(notice_id=notice_id):
                registry, object_store, entry = _build_runtime(
                    notice_id=notice_id,
                    parent_markdown=(
                        "# 关于两校区通勤班车新增班次的通知\n\n"
                        "为方便师生两校区通勤，新增班次详见附件。\n"
                    ),
                    release_time=release_time,
                    attachment_document_ids=(
                        f"notice_attachment:muc_internal_portal:{notice_id}:attachment-0001",
                    ),
                    table_cells=[
                        ["星期", "线路", "序号", "发车时间", "类型", "备注"],
                        [
                            "周一至周五",
                            "丰台校区→海淀校区",
                            "5",
                            "12:45",
                            "教师班次",
                            "新增班次",
                        ],
                    ],
                )
                attachment_record = registry.current_version(
                    f"notice_attachment:muc_internal_portal:{notice_id}:attachment-0001",
                    preferred_revision_tracks=("source-faithful",),
                )
                assert attachment_record is not None
                assert attachment_record.canonical_markdown_object_key is not None
                object_store.objects[
                    ("campus-rag-derived", attachment_record.canonical_markdown_object_key)
                ] = attachment_context.encode("utf-8")

                rows = module.extract_notice_derived_transport_schedule_rows(
                    projection_entry=entry,
                    registry=registry,
                    object_store=object_store,
                    derived_bucket="campus-rag-derived",
                )

                self.assertEqual([row.effective_from for row in rows], [expected_effective_from])

    def test_drops_adjustment_remark_copied_to_non_matching_departure_rows(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            parent_markdown=(
                "# 关于两校区教师通勤班车班次优化调整的通知\n\n"
                "3月9日（下周一）起，对丰台校区发往海淀校区的两趟教师班车"
                "发车时间进行优化调整。具体见下表。\n"
            ),
            table_cells=[
                ["星期", "线路", "序号", "发车时间", "类型", "备注"],
                [
                    "周一至周五",
                    "丰台校区→海淀校区",
                    "5",
                    "13:00",
                    "教师班次",
                    "3月9日起，发车时间由原12:45调整为13：00",
                ],
                [
                    "周一至周五",
                    "丰台校区→海淀校区",
                    "7",
                    "16:00",
                    "教师班次",
                    "3月9日起，发车时间由原13:15调整为13：30",
                ],
            ],
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        remarks_by_time = {row.departure_time: row.remarks for row in rows}
        self.assertNotIn("12:45", remarks_by_time)
        self.assertIn("调整为13:00", remarks_by_time["13:00"])
        self.assertNotIn("调整为13:30", remarks_by_time["16:00"])

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

    def test_table_cells_are_not_reparsed_from_clean_text_context(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="353901",
            parent_markdown=(
                "# 关于两校区通勤班车新增班次的通知\n\n为方便师生两校区通勤，新增班次详见附件。\n"
            ),
            release_time="2025-12-11 15:40",
            attachment_document_ids=(
                "notice_attachment:muc_internal_portal:353901:attachment-0001",
            ),
            document_units=[
                {
                    "unit_id": "table-1",
                    "unit_type": "table_unit",
                    "clean_text": (
                        "表1 师生通勤班车班次表（新班次 12月13日起执行）\n"
                        "星期 | 线路 | 序号 | 发车时间 | 类型 | 备注\n"
                        "周一至周五 | 丰台校区→海淀校区 | 5 | 13:15 | 教师班次 | 新增班次"
                    ),
                    "table_cells": [
                        ["星期", "线路", "序号", "发车时间", "类型", "备注"],
                        [
                            "周一至周五",
                            "丰台校区→海淀校区",
                            "5",
                            "13:15",
                            "教师班次",
                            "",
                        ],
                    ],
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
            [(row.route_id, row.departure_time, row.effective_from) for row in rows],
            [("route:fengtai-to-haidian", "13:15", "2025-12-13")],
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

    def test_table_row_date_range_overrides_parent_notice_date_range(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="355867",
            release_time="2026-04-25 13:11",
            parent_markdown=(
                "# 关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知\n\n"
                "根据学校近期相关安排，现将4月27日-5月5日期间两校区班车及地铁接驳车"
                "运营安排通知如下：\n"
                "一、4月27日两校区班车安排\n"
                "二、4月28日-5月5日两校区班车及地铁接驳车安排\n"
            ),
            attachment_document_ids=(
                "notice_attachment:muc_internal_portal:355867:attachment-0001",
            ),
            table_cells=[
                ["日期", "线路", "序号", "发车时间", "类型", "发车地点"],
                ["4月27日", "丰台校区→海淀校区", "1", "06:40", "教师班次", "聚雅餐厅"],
                [
                    "4月28日—5月5日",
                    "丰台校区→海淀校区",
                    "1",
                    "08:00",
                    "学生班次",
                    "聚雅餐厅",
                ],
                [
                    "4 月 28 日—5 月 5 日",
                    "丰台校区→五棵松地铁站",
                    "1",
                    "09:00",
                    "接驳班次",
                    "聚雅餐厅",
                ],
            ],
        )

        rows = module.extract_notice_derived_transport_schedule_rows(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
        )

        self.assertEqual(
            [(row.departure_time, row.service_date_ranges) for row in rows],
            [
                ("06:40", (("2026-04-27", "2026-04-27"),)),
                ("08:00", (("2026-04-28", "2026-05-05"),)),
                ("09:00", (("2026-04-28", "2026-05-05"),)),
            ],
        )

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-28T09:00:00+08:00",
            service_horizon_days=8,
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        departures = {row["departure_time"]: row for row in result.bundle["scheduled_departures"]}
        self.assertEqual(departures["06:40"]["service_dates"], ["2026-04-27"])
        self.assertNotIn("2026-04-27", departures["08:00"]["service_dates"])
        self.assertEqual(
            departures["08:00"]["service_dates"],
            [
                "2026-04-28",
                "2026-04-29",
                "2026-04-30",
                "2026-05-01",
                "2026-05-04",
                "2026-05-05",
            ],
        )
        self.assertNotIn("2026-04-27", departures["09:00"]["service_dates"])
        self.assertEqual(
            departures["09:00"]["service_dates"],
            [
                "2026-04-28",
                "2026-04-29",
                "2026-04-30",
                "2026-05-01",
                "2026-05-02",
                "2026-05-03",
                "2026-05-04",
                "2026-05-05",
            ],
        )
