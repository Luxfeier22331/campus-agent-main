from __future__ import annotations

import unittest
from dataclasses import replace
from pathlib import Path

from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
)
from campus_ingestion_core.authenticated_notice_routing_sampling import (
    build_authenticated_notice_routing_audit_report_from_bundle_records,
    build_authenticated_notice_routing_sample_report_from_bundle_records,
    build_authenticated_notice_routing_sample_report_from_inventory_entries,
)

from .internal_notice_scoped_rule_materialization_test_support import _inventory_entry


def _bundle_record(
    *,
    notice_id: str,
    title: str,
    body: str = "",
    notice_type: str = "5",
    notice_type_name: str = "办公通知",
) -> dict:
    return {
        "notice_id": notice_id,
        "notice": {
            "notice_id": notice_id,
            "notice_title": title,
            "notice_content": body,
            "notice_release_time": "2026-04-10 10:00",
            "categories": [
                {
                    "notice_type": notice_type,
                    "notice_type_name": notice_type_name,
                }
            ],
        },
        "notice_attachments": [],
        "attachments": [],
        "links": [],
    }


class AuthenticatedNoticeRoutingSamplingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_authenticated_notice_notice_family_config(
            Path(
                "configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json"
            )
        )

    def test_sample_report_groups_refined_notice_families_and_routes(self) -> None:
        report = build_authenticated_notice_routing_sample_report_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="355546",
                    title="讲座预告丨舞蹈学院名家讲堂",
                    notice_type="8",
                    notice_type_name="科研通知",
                ),
                _bundle_record(
                    notice_id="354192",
                    title="关于2025-2026学年第二学期本科生网上选课的通知",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
                _bundle_record(
                    notice_id="355385",
                    title="关于启动2026年国家留学基金委与加拿大麦克马斯特大学合作奖学金项目校内遴选工作的通知",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
                _bundle_record(
                    notice_id="353466",
                    title="暖心助农，甜蜜相约——新疆阿克苏地区冰糖心苹果采购通知",
                ),
            ),
            config=self.config,
            sample_limit_per_group=2,
            boundary_sample_limit=4,
        )

        self.assertEqual(report.notice_count, 4)
        self.assertEqual(report.family_counts["lecture_publicity"], 1)
        self.assertEqual(report.family_counts["course_teaching_arrangement"], 1)
        self.assertEqual(report.family_counts["exchange_visit_project"], 1)
        self.assertEqual(report.family_counts["procurement_notice"], 1)
        route_by_notice = {sample.notice_id: sample for sample in report.samples}
        self.assertEqual(
            route_by_notice["354192"].suggested_consumption_route,
            "notice_level_query",
        )
        self.assertEqual(
            route_by_notice["355385"].suggested_consumption_route,
            "notice_level_query",
        )
        self.assertEqual(
            route_by_notice["353466"].suggested_consumption_route,
            "procurement_notice_history",
        )
        self.assertEqual(
            route_by_notice["355546"].machine_processing_policy,
            "skip",
        )

    def test_inventory_entries_preserve_attachment_counts_for_review(self) -> None:
        inventory = _inventory_entry(
            notice_id="355119",
            notice_title="关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
        )
        inventory = replace(
            inventory,
            attachment_ref_count=2,
            text_extractable_count=1,
            multimodal_processing_required_count=1,
            parent_snapshot={
                **inventory.parent_snapshot,
                "notice_type_names": ["教学通知"],
            },
        )

        report = build_authenticated_notice_routing_sample_report_from_inventory_entries(
            inventory_entries=(inventory,),
            config=self.config,
            sample_limit_per_group=4,
            boundary_sample_limit=4,
        )

        sample = report.samples[0]
        self.assertEqual(sample.notice_id, "355119")
        self.assertEqual(sample.attachment_ref_count, 2)
        self.assertEqual(sample.text_extractable_count, 1)
        self.assertEqual(sample.multimodal_processing_required_count, 1)
        self.assertEqual(sample.machine_processing_policy, "process")
        self.assertEqual(sample.reviewer_verdict, "")

    def test_review_later_other_skips_machine_processing_even_with_attachment_signal(
        self,
    ) -> None:
        inventory = _inventory_entry(
            notice_id="review-later",
            notice_title="关于校园道路树木修剪温馨提醒附件说明",
        )
        inventory = replace(
            inventory,
            attachment_ref_count=1,
            multimodal_processing_required_count=1,
            parent_snapshot={
                **inventory.parent_snapshot,
                "notice_type_names": ["办公通知"],
            },
        )

        report = build_authenticated_notice_routing_sample_report_from_inventory_entries(
            inventory_entries=(inventory,),
            config=self.config,
            sample_limit_per_group=4,
            boundary_sample_limit=4,
        )

        sample = report.samples[0]
        self.assertEqual(sample.notice_family, "other")
        self.assertEqual(sample.suggested_consumption_route, "review_later")
        self.assertEqual(sample.machine_processing_policy, "skip")

    def test_audit_report_exports_review_later_notices_and_clusters(self) -> None:
        report = build_authenticated_notice_routing_audit_report_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="other-action-1",
                    title="关于领取校庆纪念品的温馨提醒",
                ),
                _bundle_record(
                    notice_id="other-action-2",
                    title="关于领取校园文化衫的温馨提醒",
                ),
                _bundle_record(
                    notice_id="course",
                    title="关于2025-2026学年第二学期本科生网上选课的通知",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
            ),
            config=self.config,
        )

        self.assertEqual(report.notice_count, 3)
        self.assertEqual(report.review_later_count, 2)
        self.assertEqual(
            [sample.notice_id for sample in report.review_later_notices],
            ["other-action-1", "other-action-2"],
        )
        self.assertEqual(len(report.review_later_clusters), 1)
        cluster = report.review_later_clusters[0]
        self.assertEqual(cluster.count, 2)
        self.assertEqual(cluster.notice_type_names, ("办公通知",))
        self.assertEqual(cluster.action_signals, ("领取",))
        self.assertEqual(cluster.service_signals, ())
        self.assertEqual(cluster.publicity_signals, ())
        self.assertEqual(cluster.attachment_bucket, "no_attachments")
        self.assertEqual(cluster.recommended_action, "candidate_notice_level_query_rule")
        self.assertEqual(cluster.sample_notice_ids, ("other-action-1", "other-action-2"))

    def test_audit_report_clusters_unsignaled_review_later_without_regex_error(
        self,
    ) -> None:
        report = build_authenticated_notice_routing_audit_report_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="other-unsignaled",
                    title="关于校园道路树木修剪温馨提醒",
                ),
            ),
            config=self.config,
        )

        self.assertEqual(report.review_later_count, 1)
        cluster = report.review_later_clusters[0]
        self.assertEqual(cluster.recommended_action, "keep_other_review_later")
        self.assertEqual(cluster.action_signals, ())
        self.assertEqual(cluster.service_signals, ())
        self.assertEqual(cluster.publicity_signals, ())
        self.assertTrue(cluster.title_signature)

    def test_new_notice_level_and_service_status_families_route_explicitly(self) -> None:
        report = build_authenticated_notice_routing_sample_report_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="academic",
                    title="关于开展2026届本科生毕业论文（设计）检测工作的通知",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
                _bundle_record(
                    notice_id="it-status",
                    title="关于信息门户升级维护的通知",
                ),
                _bundle_record(
                    notice_id="student-program",
                    title="关于开展2026年西部计划志愿者招募选拔工作的通知",
                    notice_type="32",
                    notice_type_name="学工通知",
                ),
                _bundle_record(
                    notice_id="classroom-status",
                    title="关于2026年3月21日英语专业八级考试（TEM8）考试占用教室的通知",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
                _bundle_record(
                    notice_id="staff-admin",
                    title="关于非学历教育管理岗位工作人员调整的通知",
                ),
                _bundle_record(
                    notice_id="academic-program",
                    title="2026年中国少数民族语言文学（古文字学）专业“强基计划” 选拔通知",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
                _bundle_record(
                    notice_id="campus-news",
                    title="开学第一周本科教学情况简报",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
                _bundle_record(
                    notice_id="competition",
                    title="转发丨《第十四届三创赛乡村振兴实战赛报名指南及实施要点》",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
                _bundle_record(
                    notice_id="culture",
                    title="民图影坛第五十七期 |《高山盛装》",
                ),
            ),
            config=self.config,
            sample_limit_per_group=3,
            boundary_sample_limit=3,
        )

        route_by_notice = {sample.notice_id: sample for sample in report.samples}
        self.assertEqual(
            route_by_notice["academic"].suggested_consumption_route,
            "notice_level_query",
        )
        self.assertEqual(
            route_by_notice["it-status"].suggested_consumption_route,
            "service_status_candidate",
        )
        self.assertEqual(
            route_by_notice["student-program"].suggested_consumption_route,
            "notice_level_query",
        )
        self.assertEqual(
            route_by_notice["classroom-status"].suggested_consumption_route,
            "service_status_candidate",
        )
        self.assertEqual(
            route_by_notice["staff-admin"].suggested_consumption_route,
            "defer",
        )
        self.assertEqual(route_by_notice["staff-admin"].machine_processing_policy, "skip")
        self.assertEqual(
            route_by_notice["academic-program"].suggested_consumption_route,
            "notice_level_query",
        )
        self.assertEqual(
            route_by_notice["campus-news"].suggested_consumption_route,
            "defer",
        )
        self.assertEqual(route_by_notice["campus-news"].machine_processing_policy, "skip")
        self.assertEqual(
            route_by_notice["competition"].suggested_consumption_route,
            "defer",
        )
        self.assertEqual(route_by_notice["competition"].machine_processing_policy, "skip")
        self.assertEqual(
            route_by_notice["culture"].suggested_consumption_route,
            "defer",
        )
        self.assertEqual(route_by_notice["culture"].machine_processing_policy, "skip")


if __name__ == "__main__":
    unittest.main()
