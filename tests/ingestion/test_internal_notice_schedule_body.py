from __future__ import annotations

import unittest

from campus_ingestion_core.internal_notice_schedule_body import (
    ScheduleNoticeBody,
    extract_schedule_from_notice_body,
)


class InternalNoticeScheduleBodyTest(unittest.TestCase):
    def test_extracts_shuttle_times_from_social_practice_special_bus_body(self) -> None:
        body = ScheduleNoticeBody(
            notice_id="355881",
            notice_title="关于开通丰台校区社会实践专车的通知",
            release_time="2026-04-25 16:26",
            organization="丰台校区管理委员会办公室 后勤保障处（后勤集团）",
            context_before=(
                "一、运行区间： 1.出发：丰台校区至地铁14号线张郭庄站 "
                "2.接站：地铁14号线园博园站至丰台校区 "
                "二、运行时间： "
                "1.出发：第一班07：30，第二班09：00，第三班10：30，第四班12：00 "
                "2.接站：第一班18：00，第二班19：30，第三班21：00 "
                "三、乘车地点： 1.出发：丰台校区 智慧中心南侧 "
                "2.接站：园博园地铁站A出口右转西侧50米"
            ),
            context_after=(
                "4月26日9：00起开放预约，有出行需求的同学可通过服务门户、企业微信APP、"
                "民大通APP等线上预约系统“接驳车预约”内预约4月28日-30日之间的专车。"
            ),
        )

        extraction = extract_schedule_from_notice_body(body)

        self.assertEqual(extraction.status, "extracted")
        self.assertEqual(extraction.notice_id, "355881")
        self.assertEqual(len(extraction.rows), 7)
        self.assertEqual(extraction.rows[0]["direction_label"], "出发")
        self.assertEqual(extraction.rows[0]["route_text"], "丰台校区至地铁14号线张郭庄站")
        self.assertEqual(extraction.rows[0]["sequence_label"], "第一班")
        self.assertEqual(extraction.rows[0]["departure_time"], "07:30")
        self.assertEqual(extraction.rows[0]["boarding_location"], "丰台校区 智慧中心南侧")
        self.assertEqual(extraction.rows[-1]["direction_label"], "接站")
        self.assertEqual(extraction.rows[-1]["route_text"], "地铁14号线园博园站至丰台校区")
        self.assertEqual(extraction.rows[-1]["departure_time"], "21:00")
        self.assertEqual(extraction.rows[-1]["boarding_location"], "园博园地铁站A出口右转西侧50米")
        self.assertIn("4月28日-30日", extraction.service_window)

    def test_extracts_parenthesized_service_window_from_special_bus_body(self) -> None:
        body = ScheduleNoticeBody(
            notice_id="355881",
            notice_title="关于开通丰台校区社会实践专车的通知",
            release_time="2026-04-25 16:26",
            organization="丰台校区管理委员会办公室 后勤保障处（后勤集团）",
            context_before=(
                "4月28日（周二）至4月30日（周四）临时开通社会实践专车。"
                "一、运行区间：1.出发：丰台校区至地铁14号线张郭庄站 "
                "2.接站：地铁14号线园博园站至丰台校区 "
                "二、运行时间：1.出发：第一班07：30，第二班09：00"
            ),
            context_after="",
        )

        extraction = extract_schedule_from_notice_body(body)

        self.assertEqual(extraction.status, "extracted")
        self.assertEqual(extraction.service_window, "4月28日（周二）至4月30日（周四）")

    def test_does_not_extract_body_schedule_without_explicit_bus_times(self) -> None:
        body = ScheduleNoticeBody(
            notice_id="348457",
            notice_title="关于丰台校区地铁接驳车优化调整的通知",
            release_time="2025-03-07 08:30",
            organization="丰台校区管委会办公室",
            context_before="图1. “丰台校区-篱笆房地铁站”线路校内上下车点实景图",
            context_after="图2. “丰台校区-五棵松地铁站”线路校内上车点实景图",
        )

        extraction = extract_schedule_from_notice_body(body)

        self.assertEqual(extraction.status, "no_schedule_body")
        self.assertEqual(extraction.rows, ())


if __name__ == "__main__":
    unittest.main()
