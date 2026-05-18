from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_media_role_classifier import (
    MEDIA_ROLE_SCHEDULE_TABLE_CARRIER,
    MEDIA_ROLE_SUPPLEMENTAL_LOCATION_VISUAL,
    classify_notice_media_roles,
)


def _unit(
    *,
    source_notice_id: str,
    title: str,
    body_text: str,
    attachment_filename: str = "image.png",
) -> dict[str, object]:
    return {
        "unit_id": f"searchable:notice:muc_internal_portal:{source_notice_id}",
        "source_notice_id": source_notice_id,
        "title": title,
        "body_text": body_text,
        "attachment_refs": [
            {
                "filename": attachment_filename,
                "object_ref": {
                    "bucket": "campus-rag-source",
                    "key": f"notices/{source_notice_id}/{attachment_filename}",
                },
            }
        ],
        "target_hints": {"candidate_targets": ["transport_schedule"]},
        "multimodal_status": "pending",
    }


class CollectedNoticeMediaRoleClassifierTests(unittest.TestCase):
    def test_classifies_text_complete_schedule_image_as_supplemental_location_visual(
        self,
    ) -> None:
        unit = _unit(
            source_notice_id="355881",
            title="关于开通丰台校区社会实践专车的通知",
            body_text=(
                "4月28日（周二）至4月30日（周四）临时开通社会实践专车。"
                "一、运行区间：1.出发：丰台校区至地铁14号线张郭庄站。"
                "2.接站：地铁14号线园博园站至丰台校区。"
                "二、运行时间：1.出发：第一班07：30，第二班09：00，"
                "第三班10：30，第四班12：00。"
                "2.接站：第一班18：00，第二班19：30，第三班21：00。"
                "三、乘车地点：1.出发：丰台校区智慧中心南侧。"
                "2.接站：园博园地铁站A出口右转西侧50米。"
            ),
            attachment_filename="图片1.png",
        )

        roles = classify_notice_media_roles(
            unit=unit,
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": unit["unit_id"],
                        "status": "pending",
                        "media_kind": "image",
                        "media_ref_id": "图片1.png",
                    }
                ]
            },
            target="transport_schedule",
            text_fact_complete=True,
        )

        self.assertEqual(len(roles), 1)
        self.assertEqual(roles[0]["media_role"], MEDIA_ROLE_SUPPLEMENTAL_LOCATION_VISUAL)
        self.assertEqual(roles[0]["media_state"], "pending")
        self.assertFalse(roles[0]["target_blocking"])

    def test_classifies_schedule_notice_without_text_rows_as_schedule_table_carrier(
        self,
    ) -> None:
        unit = _unit(
            source_notice_id="355867",
            title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
            body_text=(
                "现将4月27日-5月5日期间两校区班车及地铁接驳车运营安排通知如下："
                "一、4月27日两校区班车安排。二、4月28日-5月5日两校区班车及地铁接驳车安排。"
            ),
        )

        roles = classify_notice_media_roles(
            unit=unit,
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": unit["unit_id"],
                        "status": "pending",
                        "media_kind": "image",
                        "processing_family": "schedule_image_ocr",
                    }
                ]
            },
            target="transport_schedule",
            text_fact_complete=False,
        )

        self.assertEqual(roles[0]["media_role"], MEDIA_ROLE_SCHEDULE_TABLE_CARRIER)
        self.assertTrue(roles[0]["target_blocking"])

    def test_low_confidence_status_maps_to_manual_review_lifecycle(self) -> None:
        unit = _unit(
            source_notice_id="355867",
            title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
            body_text="具体班次见图片。",
        )

        roles = classify_notice_media_roles(
            unit=unit,
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": unit["unit_id"],
                        "status": "manual_review",
                        "media_kind": "image",
                        "processing_family": "schedule_image_ocr",
                    }
                ]
            },
            target="transport_schedule",
            text_fact_complete=False,
        )

        self.assertEqual(roles[0]["media_state"], "manual_review")
        self.assertTrue(roles[0]["target_blocking"])

    def test_attachment_refs_do_not_create_implicit_media_candidates(self) -> None:
        unit = _unit(
            source_notice_id="355867",
            title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
            body_text="具体班次见图片。",
            attachment_filename="班车安排.png",
        )

        roles = classify_notice_media_roles(
            unit=unit,
            multimodal_candidate_inventory={"candidates": []},
            target="transport_schedule",
            text_fact_complete=False,
        )

        self.assertEqual(roles, [])


if __name__ == "__main__":
    unittest.main()
