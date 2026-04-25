from __future__ import annotations

import unittest
from pathlib import Path

from campus_ingestion_core.authenticated_notice_notice_family import (
    classify_authenticated_notice_bundle_record,
    load_authenticated_notice_notice_family_config,
    read_authenticated_notice_notice_family_config_path,
)


def _bundle_record(
    *,
    notice_id: int,
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
            "categories": [
                {
                    "notice_type": notice_type,
                    "notice_type_name": notice_type_name,
                }
            ],
        },
        "links": [],
        "notice_attachments": [],
        "attachments": [],
    }


class AuthenticatedNoticeNoticeFamilyConfigTest(unittest.TestCase):
    def test_read_config_path_uses_repo_tracked_internal_notice_config(self) -> None:
        path = read_authenticated_notice_notice_family_config_path({})

        self.assertEqual(
            path,
            Path(
                "configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json"
            ).resolve(),
        )
        self.assertTrue(path.exists())

    def test_load_repo_tracked_config(self) -> None:
        config = load_authenticated_notice_notice_family_config(
            Path(
                "configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json"
            )
        )

        self.assertEqual(config.corpus, "campus_notices")
        self.assertEqual(config.collection, "internal_notice")
        self.assertEqual(config.default_family, "other")
        self.assertGreaterEqual(len(config.rules), 5)


class AuthenticatedNoticeNoticeFamilyClassificationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_authenticated_notice_notice_family_config(
            Path(
                "configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json"
            )
        )

    def test_classify_policy_regulation_notice_as_priority_now(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=1,
                title="关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "policy_regulation")
        self.assertEqual(classification.admission_policy, "priority_now")

    def test_classify_guiding_opinion_notice_as_policy_regulation(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=10,
                title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "policy_regulation")
        self.assertEqual(classification.admission_policy, "priority_now")

    def test_do_not_classify_report_release_notice_as_policy_regulation(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=11,
                title="关于发布《中央民族大学新一轮本科教育教学审核评估自评报告》的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "other")
        self.assertEqual(classification.admission_policy, "review_later")

    def test_do_not_classify_poster_pickup_notice_as_policy_regulation(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=12,
                title="关于领取《新时代高校教师职业行为十项准则》宣传海报的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "other")
        self.assertEqual(classification.admission_policy, "review_later")

    def test_classify_operational_procedure_notice_as_admit_next(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=2,
                title="关于校园监控录像查询申请流程的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "operational_procedure")
        self.assertEqual(classification.admission_policy, "admit_next")

    def test_classify_course_teaching_arrangement_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=16,
                title="关于2025-2026学年第二学期本科生网上选课的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "course_teaching_arrangement")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_exchange_visit_project_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=17,
                title="关于启动2026年国家留学基金委与加拿大麦克马斯特大学合作奖学金项目校内遴选工作的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "exchange_visit_project")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_document_collection_deadline_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=18,
                title="关于做好2025-2026学年全国大学生实习公共服务平台数据报送工作的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "document_collection_deadline")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_academic_affairs_lifecycle_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=20,
                title="关于开展2026届本科生毕业论文（设计）检测工作的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "academic_affairs_lifecycle")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_finance_payment_action_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=21,
                title="关于确认发放2025年12月份研究生助管、助研岗位津贴的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "finance_payment_action")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_health_medical_action_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=22,
                title="关于组织2026年度教职工体检的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "health_medical_action")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_form_template_download_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=23,
                title="关于发布2025年寒假期间学校值班汇总表的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "form_template_download")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_survey_feedback_collection_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=24,
                title="关于组织填答党纪学习教育调查问卷的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "survey_feedback_collection")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_facility_service_status_as_service_status_candidate(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=25,
                title="关于海淀校区部分配电室停电抢修的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "facility_service_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_it_platform_service_status_as_service_status_candidate(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=26,
                title="关于信息门户升级维护的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "it_platform_service_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_library_service_status_as_service_status_candidate(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=27,
                title="中央民族大学图书馆2026年寒假期间开放安排",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "library_service_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_library_resource_notice_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=28,
                title="关于 JSTOR 数据库恢复开通的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "library_resource_notice")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_transport_commute_status_as_service_status_candidate(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=29,
                title="关于两校区学生通勤班车增加班次的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "transport_commute_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_internal_governance_party_admin_as_defer(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=30,
                title="关于召开中央民族大学第九届党委第一轮巡察动员部署会的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "internal_governance_party_admin")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_general_publicity_culture_as_defer(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=31,
                title="民图影坛第五十七期 |《高山盛装》",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "general_publicity_culture")
        self.assertEqual(classification.admission_policy, "defer")

    def test_policy_regulation_still_wins_over_internal_governance_terms(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=32,
                title="关于修订《中央民族大学党委会议事规则》的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "policy_regulation")
        self.assertEqual(classification.admission_policy, "priority_now")

    def test_database_trial_is_library_resource_not_service_status(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=33,
                title="关于 “SpecialSci专题数据库”试用开通的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "library_resource_notice")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_job_recruitment_as_defer(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=19,
                title="国际教育学院招聘学生助理的通知",
                notice_type="10",
                notice_type_name="就业信息",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "job_recruitment")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_social_practice_notice_as_event_activity(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=3,
                title="关于开展“知行中华”铸魂育人工程——中央民族大学2026年大学生寒假社会实践活动的通知",
                body="<p>活动主题：青春返乡行，奋进新时代</p><p>活动时间：2026年1月-3月</p>",
                notice_type="32",
                notice_type_name="学工通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "event_activity")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_lecture_notice_as_lecture_publicity(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=4,
                title="讲座预告 | 文华讲堂·民族学系列第六讲 城市人类学前沿第一讲",
                notice_type="8",
                notice_type_name="科研通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "lecture_publicity")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_unknown_notice_as_other(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=5,
                title="关于非学历教育管理岗位工作人员调整的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "other")
        self.assertEqual(classification.admission_policy, "review_later")

    def test_classify_procurement_notice_as_procurement_notice(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=13,
                title="中央民族大学丰台校区家具采购项目比选公告",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "procurement_notice")
        self.assertEqual(classification.admission_policy, "archive_notice")

    def test_classify_service_status_override_as_notice_runtime_hold(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=15,
                title="关于暑假期间办理就业相关事务的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "service_status_override")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_procurement_regulation_remains_policy_regulation(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=14,
                title="关于修订《中央民族大学采购工作管理办法》的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "policy_regulation")
        self.assertEqual(classification.admission_policy, "priority_now")
