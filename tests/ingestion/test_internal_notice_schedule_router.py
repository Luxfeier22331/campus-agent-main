from __future__ import annotations

import unittest

from campus_ingestion_core.internal_notice_schedule_router import (
    ScheduleNoticeImageRoutingInput,
    route_schedule_notice_image,
    route_schedule_notice_images,
)


class InternalNoticeScheduleRouterTest(unittest.TestCase):
    def test_routes_body_only_special_bus_notice_without_image_ocr(self) -> None:
        route = route_schedule_notice_image(
            ScheduleNoticeImageRoutingInput(
                notice_id="355881",
                notice_title="关于开通丰台校区社会实践专车的通知",
                release_time="2026-04-25 16:26",
                organization="丰台校区管理委员会办公室",
                image_index=1,
                attachment_ref_id="attachment-1",
                image_use="mixed_schedule_and_guide_image",
                context_before=(
                    "1.出发：第一班07：30，第二班09：00，第三班10：30，第四班12：00 "
                    "2.接站：第一班18：00，第二班19：30，第三班21：00"
                ),
                context_after="乘车地点：丰台校区智慧中心南侧。预约系统内预约4月28日-30日之间的专车。",
            )
        )

        self.assertEqual(route.image_action, "body_schedule")
        self.assertEqual(route.notice_scope, "body_schedule")
        self.assertFalse(route.should_run_image_ocr)
        self.assertTrue(route.should_run_body_extractor)
        self.assertIn("body_bus_sequence", route.reason_codes)

    def test_routes_mixed_notice_table_image_and_visual_images_separately(self) -> None:
        table_route = route_schedule_notice_image(
            ScheduleNoticeImageRoutingInput(
                notice_id="348457",
                notice_title="关于丰台校区地铁接驳车优化调整的通知",
                release_time="2025-03-07 08:30",
                organization="丰台校区管委会办公室",
                image_index=1,
                attachment_ref_id="attachment-1",
                image_use="mixed_schedule_and_guide_image",
                context_before=(
                    "恢复“丰台校区-篱笆房地铁站”接驳线路，"
                    "早8:30、9:30，晚20:30、21:30。具体班次信息如下："
                ),
                context_after="为方便乘车，线路丰台校区上下车点调整至学生活动中心西侧停车场路口（见图1）。",
            )
        )
        visual_route = route_schedule_notice_image(
            ScheduleNoticeImageRoutingInput(
                notice_id="348457",
                notice_title="关于丰台校区地铁接驳车优化调整的通知",
                release_time="2025-03-07 08:30",
                organization="丰台校区管委会办公室",
                image_index=2,
                attachment_ref_id="attachment-2",
                image_use="mixed_schedule_and_guide_image",
                context_before="为方便乘车，上下车点调整至学生活动中心西侧停车场路口（见图1）。",
                context_after="图1. “丰台校区-篱笆房地铁站”线路校内上下车点实景图。",
            )
        )

        self.assertEqual(table_route.notice_scope, "mixed_schedule_and_visual")
        self.assertEqual(table_route.image_action, "image_schedule_table")
        self.assertTrue(table_route.should_run_image_ocr)
        self.assertFalse(table_route.should_run_body_extractor)
        self.assertEqual(visual_route.notice_scope, "mixed_schedule_and_visual")
        self.assertEqual(visual_route.image_action, "visual_or_guide")
        self.assertFalse(visual_route.should_run_image_ocr)
        self.assertIn("near_visual_anchor", visual_route.reason_codes)

    def test_routes_schedule_table_images_before_reservation_guide(self) -> None:
        route = route_schedule_notice_image(
            ScheduleNoticeImageRoutingInput(
                notice_id="352325",
                notice_title="关于丰台校区地铁接驳车优化调整的通知",
                release_time="2025-09-25 17:06",
                organization="丰台校区管委会办公室",
                image_index=1,
                attachment_ref_id="attachment-1",
                image_use="mixed_schedule_and_guide_image",
                context_before="对地铁接驳车班次进行了优化调整。具体如下：一、接驳车班次调整情况",
                context_after="二、关于接驳车预约的说明。师生通过“接驳车预约”系统预约后方可乘车。",
            )
        )

        self.assertEqual(route.image_action, "image_schedule_table")
        self.assertTrue(route.should_run_image_ocr)
        self.assertIn("near_schedule_table_anchor", route.reason_codes)

    def test_routes_non_schedule_transport_notice_to_skip(self) -> None:
        route = route_schedule_notice_image(
            ScheduleNoticeImageRoutingInput(
                notice_id="100",
                notice_title="关于校园道路临时施工的通知",
                release_time="2026-04-28 09:00",
                organization="后勤保障处",
                image_index=1,
                attachment_ref_id="attachment-1",
                image_use="notice_image",
                context_before="校园道路临时施工，请绕行。",
                context_after="特此通知。",
            )
        )

        self.assertEqual(route.image_action, "not_schedule")
        self.assertFalse(route.should_run_image_ocr)

    def test_routes_notice_batch_with_summary_counts(self) -> None:
        routes = route_schedule_notice_images(
            (
                ScheduleNoticeImageRoutingInput(
                    notice_id="355867",
                    notice_title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                    release_time="2026-04-25 13:11",
                    organization="丰台校区管委会办公室",
                    image_index=1,
                    attachment_ref_id="attachment-1",
                    image_use="schedule_table_image",
                    context_before="现将4月27日-5月5日期间两校区班车及地铁接驳车运营安排通知如下：",
                    context_after="一、4月27日两校区班车安排 二、4月28日-5月5日两校区班车及地铁接驳车安排",
                ),
                ScheduleNoticeImageRoutingInput(
                    notice_id="355881",
                    notice_title="关于开通丰台校区社会实践专车的通知",
                    release_time="2026-04-25 16:26",
                    organization="丰台校区管理委员会办公室",
                    image_index=1,
                    attachment_ref_id="attachment-1",
                    image_use="mixed_schedule_and_guide_image",
                    context_before="出发：第一班07：30，第二班09：00。接站：第一班18：00。",
                    context_after="乘车地点和预约方式。",
                ),
            )
        )

        self.assertEqual(routes.image_count, 2)
        self.assertEqual(routes.image_ocr_count, 1)
        self.assertEqual(routes.body_schedule_count, 1)
        self.assertEqual(routes.counts["image_schedule_table"], 1)
        self.assertEqual(routes.counts["body_schedule"], 1)


if __name__ == "__main__":
    unittest.main()
