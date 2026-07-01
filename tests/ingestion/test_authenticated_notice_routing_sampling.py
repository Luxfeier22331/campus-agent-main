from __future__ import annotations

import json
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

from .internal_notice_scoped_rule_materialization_test_support import (
    _FakeObjectStore,
    _inventory_entry,
)


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
            "notice_level_query",
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

    def test_default_other_no_adopts_even_with_attachment_signal(
        self,
    ) -> None:
        inventory = _inventory_entry(
            notice_id="default-other",
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
        self.assertEqual(sample.suggested_consumption_route, "no_adoption")
        self.assertEqual(sample.machine_processing_policy, "skip")
        self.assertEqual(sample.attachment_processing_policy, "metadata_only")
        self.assertEqual(
            sample.attachment_processing_reason,
            "low_confidence_residual_without_actionable_signal",
        )

    def test_low_value_generic_card_family_keeps_attachment_metadata_only(self) -> None:
        inventory = _inventory_entry(
            notice_id="low-value-lecture",
            notice_title="讲座预告丨舞蹈学院名家讲堂",
        )
        inventory = replace(
            inventory,
            attachment_ref_count=2,
            ocr_required_count=2,
            parent_snapshot={
                **inventory.parent_snapshot,
                "notice_type_names": ["科研通知"],
            },
        )

        report = build_authenticated_notice_routing_sample_report_from_inventory_entries(
            inventory_entries=(inventory,),
            config=self.config,
            sample_limit_per_group=4,
            boundary_sample_limit=4,
        )

        sample = report.samples[0]
        self.assertEqual(sample.notice_family, "lecture_publicity")
        self.assertEqual(sample.suggested_consumption_route, "notice_level_query")
        self.assertEqual(sample.machine_processing_policy, "skip")
        self.assertEqual(sample.attachment_processing_policy, "metadata_only")
        self.assertEqual(
            sample.attachment_processing_reason,
            "route_skips_attachment_processing",
        )
        self.assertEqual(report.attachment_processing_policy_counts["metadata_only"], 1)
        self.assertEqual(report.attachment_processing_ref_counts["metadata_only"], 2)

    def test_non_first_phase_downstream_families_route_to_generic_notice_card(
        self,
    ) -> None:
        report = build_authenticated_notice_routing_sample_report_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="procurement",
                    title="示例大学海淀校区学生宿舍供电智能管理系统维保服务项目比选公告",
                ),
                _bundle_record(
                    notice_id="lecture",
                    title="民图一小时系列讲座 | 巧用中国知网 开启AI智能化学习研究",
                    notice_type="8",
                    notice_type_name="科研通知",
                ),
                _bundle_record(
                    notice_id="activity",
                    title="关于举办示例大学第二十届心理文化节的通知",
                    notice_type="32",
                    notice_type_name="学工通知",
                ),
                _bundle_record(
                    notice_id="campus-news",
                    title="喜讯丨我校项目在北京高校大学生创新创业训练计划中斩获佳绩！",
                    notice_type="6",
                    notice_type_name="教学通知",
                ),
            ),
            config=self.config,
            sample_limit_per_group=4,
            boundary_sample_limit=4,
        )

        route_by_notice = {sample.notice_id: sample for sample in report.samples}
        for notice_id in ("procurement", "lecture", "activity", "campus-news"):
            with self.subTest(notice_id=notice_id):
                self.assertEqual(
                    route_by_notice[notice_id].suggested_consumption_route,
                    "notice_level_query",
                )
                self.assertEqual(route_by_notice[notice_id].machine_processing_policy, "skip")

    def test_high_value_route_processes_existing_attachment_refs(self) -> None:
        inventory = _inventory_entry(
            notice_id="transport-attachment",
            notice_title="关于两校区学生通勤班车增加班次的通知",
        )
        inventory = replace(
            inventory,
            attachment_ref_count=1,
            ocr_required_count=1,
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
        self.assertEqual(sample.notice_family, "transport_commute_status")
        self.assertEqual(sample.suggested_consumption_route, "service_status_candidate")
        self.assertEqual(sample.attachment_processing_policy, "process")
        self.assertEqual(
            sample.attachment_processing_reason,
            "route_requires_attachment_processing",
        )
        self.assertEqual(report.attachment_processing_policy_counts["process"], 1)
        self.assertEqual(report.attachment_processing_ref_counts["process"], 1)

    def test_notice_level_query_with_complete_body_keeps_attachments_metadata_only(
        self,
    ) -> None:
        inventory = _inventory_entry(
            notice_id="355702",
            notice_title="关于做好2025-2026学年第二学期期末考试工作的通知",
        )
        inventory = replace(
            inventory,
            attachment_ref_count=3,
            text_extractable_count=3,
            parent_snapshot={
                **inventory.parent_snapshot,
                "notice_content": (
                    "各教学单位：为做好本学期期末考试工作，根据校历，现就期末"
                    "考试工作做如下安排。6月22日-26日大学体育、人工智能素养课、"
                    "通识教育选修课、部分专业选修课随堂考试。6月29日-7月3日"
                    "大学英语、思政课和高等数学等通识教育必修课考试。7月6日-10日"
                    "各学院专业课考试。"
                ),
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
        self.assertEqual(sample.notice_family, "academic_course_exam_operation")
        self.assertEqual(sample.suggested_consumption_route, "notice_level_query")
        self.assertEqual(sample.attachment_processing_policy, "metadata_only")
        self.assertEqual(
            sample.attachment_processing_reason,
            "notice_level_query_keeps_attachment_metadata_only",
        )
        self.assertEqual(report.attachment_processing_ref_counts["metadata_only"], 3)

    def test_owner_like_form_without_admitted_target_keeps_attachment_metadata_only(
        self,
    ) -> None:
        inventory = _inventory_entry(
            notice_id="199724",
            notice_title="示例大学财务事项问答手册",
        )
        inventory = replace(
            inventory,
            attachment_ref_count=1,
            attachment_document_count=1,
            text_extractable_count=1,
            parent_snapshot={
                **inventory.parent_snapshot,
                "notice_content": "请下载附件查看",
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
        self.assertEqual(sample.notice_family, "form_template_download")
        self.assertEqual(sample.suggested_consumption_route, "notice_level_query")
        self.assertEqual(sample.attachment_processing_policy, "metadata_only")
        self.assertEqual(
            sample.attachment_processing_reason,
            "notice_level_query_keeps_attachment_metadata_only",
        )
        self.assertEqual(report.attachment_processing_ref_counts["metadata_only"], 1)

    def test_audit_report_exports_terminal_residual_notices_and_clusters(self) -> None:
        report = build_authenticated_notice_routing_audit_report_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="other-unsignaled-1",
                    title="关于校园道路树木修剪温馨提醒",
                ),
                _bundle_record(
                    notice_id="other-unsignaled-2",
                    title="关于校园道路树木修剪温馨提醒",
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
        self.assertEqual(report.residual_count, 2)
        self.assertEqual(
            [sample.notice_id for sample in report.residual_notices],
            ["other-unsignaled-1", "other-unsignaled-2"],
        )
        self.assertEqual(len(report.residual_clusters), 1)
        cluster = report.residual_clusters[0]
        self.assertEqual(cluster.count, 2)
        self.assertEqual(cluster.notice_type_names, ("办公通知",))
        self.assertEqual(cluster.action_signals, ())
        self.assertEqual(cluster.service_signals, ())
        self.assertEqual(cluster.publicity_signals, ())
        self.assertEqual(cluster.attachment_bucket, "no_attachments")
        self.assertEqual(cluster.recommended_action, "keep_terminal_no_adoption")
        self.assertEqual(
            cluster.sample_notice_ids,
            ("other-unsignaled-1", "other-unsignaled-2"),
        )

    def test_audit_report_clusters_unsignaled_residual_without_regex_error(
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

        self.assertEqual(report.residual_count, 1)
        cluster = report.residual_clusters[0]
        self.assertEqual(cluster.recommended_action, "keep_terminal_no_adoption")
        self.assertEqual(cluster.action_signals, ())
        self.assertEqual(cluster.service_signals, ())
        self.assertEqual(cluster.publicity_signals, ())
        self.assertTrue(cluster.title_signature)

    def test_default_other_classification_converges_to_automated_terminal_routes(self) -> None:
        report = build_authenticated_notice_routing_sample_report_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="obituary",
                    title="讣告",
                ),
                _bundle_record(
                    notice_id="placeholder",
                    title="通    知",
                    body="校园超市定于2020年12月31日闭店盘点，暂停营业一天。2021年1月1日正常营业。",
                ),
                _bundle_record(
                    notice_id="gift-pickup",
                    title="关于领取校庆纪念品的温馨提醒",
                ),
            ),
            config=self.config,
            sample_limit_per_group=4,
            boundary_sample_limit=4,
        )

        route_by_notice = {sample.notice_id: sample for sample in report.samples}
        self.assertEqual(route_by_notice["obituary"].notice_family, "other")
        self.assertEqual(route_by_notice["obituary"].suggested_consumption_route, "no_adoption")
        self.assertEqual(route_by_notice["obituary"].machine_processing_policy, "skip")
        self.assertEqual(route_by_notice["placeholder"].notice_family, "other")
        self.assertEqual(
            route_by_notice["placeholder"].suggested_consumption_route,
            "service_status_candidate",
        )
        self.assertEqual(route_by_notice["placeholder"].machine_processing_policy, "not_required")
        self.assertEqual(route_by_notice["gift-pickup"].notice_family, "other")
        self.assertEqual(
            route_by_notice["gift-pickup"].suggested_consumption_route,
            "notice_level_query",
        )
        self.assertEqual(route_by_notice["gift-pickup"].machine_processing_policy, "not_required")

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
            "notice_level_query",
        )
        self.assertEqual(route_by_notice["staff-admin"].machine_processing_policy, "skip")
        self.assertEqual(
            route_by_notice["academic-program"].suggested_consumption_route,
            "notice_level_query",
        )
        self.assertEqual(
            route_by_notice["campus-news"].suggested_consumption_route,
            "notice_level_query",
        )
        self.assertEqual(route_by_notice["campus-news"].machine_processing_policy, "skip")
        self.assertEqual(
            route_by_notice["competition"].suggested_consumption_route,
            "notice_level_query",
        )
        self.assertEqual(route_by_notice["competition"].machine_processing_policy, "skip")
        self.assertEqual(
            route_by_notice["culture"].suggested_consumption_route,
            "notice_level_query",
        )
        self.assertEqual(route_by_notice["culture"].machine_processing_policy, "skip")

    def test_payment_and_hospital_status_notices_route_to_service_status_candidate(
        self,
    ) -> None:
        report = build_authenticated_notice_routing_sample_report_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="campus-card-recharge-shutdown",
                    title="关于临时停用校园一卡通、网费和电费充值功能的通知",
                ),
                _bundle_record(
                    notice_id="hospital-new-clinic",
                    title="关于丰台校区校医院增开皮肤科门诊的通知",
                ),
                _bundle_record(
                    notice_id="hospital-holiday-duty",
                    title="2026年校医院寒假值班安排",
                ),
                _bundle_record(
                    notice_id="normal-health-action",
                    title="关于2026年无偿献血活动安排的通知",
                ),
            ),
            config=self.config,
            sample_limit_per_group=4,
            boundary_sample_limit=4,
        )

        route_by_notice = {sample.notice_id: sample for sample in report.samples}
        self.assertEqual(
            route_by_notice["campus-card-recharge-shutdown"].notice_family,
            "it_platform_service_status",
        )
        self.assertEqual(
            route_by_notice["campus-card-recharge-shutdown"].suggested_consumption_route,
            "service_status_candidate",
        )
        self.assertEqual(
            route_by_notice["hospital-new-clinic"].notice_family,
            "service_status_override",
        )
        self.assertEqual(
            route_by_notice["hospital-new-clinic"].suggested_consumption_route,
            "service_status_candidate",
        )
        self.assertEqual(
            route_by_notice["hospital-holiday-duty"].notice_family,
            "service_status_override",
        )
        self.assertEqual(
            route_by_notice["hospital-holiday-duty"].suggested_consumption_route,
            "service_status_candidate",
        )
        self.assertEqual(
            route_by_notice["normal-health-action"].suggested_consumption_route,
            "notice_level_query",
        )

    def test_inventory_content_blocks_drive_bare_title_service_status_route(self) -> None:
        inventory = _inventory_entry(
            notice_id="bare-service",
            notice_title="通知",
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "source",
                    inventory.content_blocks_key,
                ): _content_blocks_jsonl(
                    (
                        ("title", "通知"),
                        (
                            "paragraph",
                            "校园超市定于2020年12月31日闭店盘点，暂停营业一天。2021年1月1日正常营业。",
                        ),
                    )
                )
            }
        )

        report = build_authenticated_notice_routing_sample_report_from_inventory_entries(
            inventory_entries=(inventory,),
            config=self.config,
            sample_limit_per_group=4,
            boundary_sample_limit=4,
            object_store=object_store,
            source_bucket="source",
        )

        sample = report.samples[0]
        self.assertEqual(sample.notice_family, "other")
        self.assertEqual(sample.suggested_consumption_route, "service_status_candidate")
        self.assertEqual(sample.machine_processing_policy, "not_required")

    def test_inventory_missing_content_blocks_falls_back_to_title_only_routing(self) -> None:
        inventory = _inventory_entry(
            notice_id="missing-content",
            notice_title="关于校园道路树木修剪温馨提醒",
        )

        report = build_authenticated_notice_routing_sample_report_from_inventory_entries(
            inventory_entries=(inventory,),
            config=self.config,
            sample_limit_per_group=4,
            boundary_sample_limit=4,
            object_store=_FakeObjectStore(objects={}),
            source_bucket="source",
        )

        sample = report.samples[0]
        self.assertEqual(sample.notice_family, "other")
        self.assertEqual(sample.suggested_consumption_route, "no_adoption")

    def test_default_service_override_does_not_treat_general_maintain_as_status(
        self,
    ) -> None:
        report = build_authenticated_notice_routing_sample_report_from_bundle_records(
            bundle_records=(
                _bundle_record(
                    notice_id="student-award-candidate",
                    title="关于遴选曾宪梓教育基金会第七期“优秀大学生奖励计划”候选人的通知",
                    body=(
                        "热爱祖国，维护民族团结。凡符合条件学生均可提出申请，"
                        "申请材料于10月18日前报送学校资助管理中心。"
                    ),
                    notice_type="32",
                    notice_type_name="学工通知",
                ),
            ),
            config=self.config,
            sample_limit_per_group=4,
            boundary_sample_limit=4,
        )

        sample = report.samples[0]
        self.assertEqual(sample.notice_family, "other")
        self.assertEqual(sample.suggested_consumption_route, "notice_level_query")
        self.assertEqual(sample.machine_processing_policy, "not_required")

    def test_all_notice_families_have_explicit_route_policy(self) -> None:
        configured_families = {rule.family for rule in self.config.rules}
        policy_families = set(self.config.routing_policy.family_policies)

        self.assertEqual(configured_families - policy_families, set())
        self.assertIn(self.config.default_family, policy_families)


def _content_blocks_jsonl(rows: tuple[tuple[str, str], ...]) -> bytes:
    payload = []
    for index, (role, text) in enumerate(rows, start=1):
        payload.append(
            json.dumps(
                {
                    "schema_version": "authenticated_notice_block_v1",
                    "row_id": f"block-{index:04d}",
                    "row_index": index - 1,
                    "block_order": index,
                    "block_role": role,
                    "text_raw": text,
                    "text_normalized": text,
                },
                ensure_ascii=False,
            )
        )
    return ("\n".join(payload) + "\n").encode("utf-8")


if __name__ == "__main__":
    unittest.main()
