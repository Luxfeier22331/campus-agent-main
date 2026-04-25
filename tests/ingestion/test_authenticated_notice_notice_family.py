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

    def test_classify_academic_course_exam_operation_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=34,
                title="关于本学期再次开放研究生课程退补选权限的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "academic_course_exam_operation")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_academic_program_selection_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=49,
                title="中央民族大学创新实验班——“孝通班” 2026年开始选拔",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "academic_program_selection")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_strong_base_program_selection_as_academic_program(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=50,
                title="2026年中国少数民族语言文学（古文字学）专业“强基计划” 选拔通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "academic_program_selection")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_course_stop_as_academic_course_operation_not_service_status(
        self,
    ) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=51,
                title="关于2026年春季学期部分专业开放课停开的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "academic_course_exam_operation")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_course_grade_entry_as_academic_course_operation(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=52,
                title="关于2026年春季学期研究生课程期末成绩录入的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "academic_course_exam_operation")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_exam_classroom_occupation_as_service_status_candidate(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=35,
                title="关于2026年3月21日英语专业八级考试（TEM8）考试占用教室的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "facility_transport_classroom_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_student_status_registration_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=36,
                title="关于2026年研究生毕业图像采集的重要通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "student_status_registration")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_student_physical_test_as_student_status_registration(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=53,
                title="关于开展2026-2027年度海淀校区学生体质健康测试的通知",
                notice_type="32",
                notice_type_name="学工通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "student_status_registration")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_student_railway_qualification_as_status_registration(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=54,
                title="关于铁路12306客户端提供学生优惠资质在线核验服务的通知",
                notice_type="32",
                notice_type_name="学工通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "student_status_registration")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_student_program_award_selection_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=37,
                title="关于开展2026年西部计划志愿者招募选拔工作的通知",
                notice_type="32",
                notice_type_name="学工通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "student_program_award_selection")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_three_assistants_selection_as_student_program(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=38,
                title="关于开展2026年春季学期研究生“助管”、“助研”岗位聘任工作的通知",
                notice_type="32",
                notice_type_name="学工通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "student_program_award_selection")
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

    def test_classify_public_medical_reimbursement_as_finance_payment(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=55,
                title="2026年3月公费医疗报销安排及温馨提示",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "finance_payment_action")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_student_subsidy_disbursement_as_finance_payment(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=56,
                title="五月学生补助发放，请注意查收！",
                notice_type="32",
                notice_type_name="学工通知",
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

    def test_classify_health_welfare_service_notice_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=39,
                title="关于备孕妇女领取叶酸的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "health_welfare_service_notice")
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

    def test_classify_oa_pause_as_it_platform_service_status(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=57,
                title="关于OA系统暂停访问的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "it_platform_service_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_ai_minda_upgrade_as_it_platform_service_status(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=58,
                title="关于“AI民大”2.0版本升级上线的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "it_platform_service_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_facility_transport_classroom_status_as_service_status_candidate(
        self,
    ) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=40,
                title="关于本学期暂停周五18:00由丰台校区发往五棵松地铁站接驳车的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "facility_transport_classroom_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_heating_trial_as_facility_service_status(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=59,
                title="关于2026年度海淀校区供暖试运行的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "facility_transport_classroom_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_library_area_closure_as_library_service_status(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=60,
                title="关于海淀校区图书馆一层及六层部分区域暂时关闭的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "library_service_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_it_platform_operation_notice_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=41,
                title="关于我校信息化服务软件登录操作的指南",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "it_platform_operation_notice")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_identity_platform_upgrade_as_it_service_status(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=42,
                title="关于统一身份认证平台升级的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "it_platform_service_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_library_acquisition_service_as_notice_query(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=43,
                title="图书馆关于2025年秋季“云端”图书采购会开幕通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "library_acquisition_service")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_study_abroad_project_briefing_as_exchange_visit_project(
        self,
    ) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=61,
                title="英国牛津大学暑假课程项目宣讲通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "exchange_visit_project")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_public_sponsored_study_abroad_as_exchange_visit_project(
        self,
    ) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=62,
                title="【公派留学】关于2026年国家建设高水平大学公派研究生项目选派工作的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "exchange_visit_project")
        self.assertEqual(classification.admission_policy, "notice_level_query")

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

    def test_classify_staff_internal_admin_as_defer(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=44,
                title="关于非学历教育管理岗位工作人员调整的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "staff_internal_admin")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_education_statistics_as_staff_internal_admin(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=63,
                title="关于开展我校2026年高等学校教育事业统计工作的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "staff_internal_admin")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_budget_notice_as_staff_internal_admin(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=64,
                title="中央民族大学关于编制2026年校内预算的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "staff_internal_admin")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_research_publicity_call_as_defer(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=45,
                title="征稿通知｜第六届平台研究学术工作坊——“溯源与智启：平台社会的新场景与新叙事”征稿启事",
                notice_type="8",
                notice_type_name="科研通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "research_publicity_call")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_teacher_lunch_salon_as_research_publicity_call(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=65,
                title="教师午餐沙龙预告｜边疆思想史：源流、契机与路径",
                notice_type="8",
                notice_type_name="科研通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "research_publicity_call")
        self.assertEqual(classification.admission_policy, "defer")

    def test_project_application_still_wins_over_research_publicity_call(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=46,
                title="关于转发《关于2026年度北京市自然科学基金第一批项目申请的通知》的通知",
                notice_type="8",
                notice_type_name="科研通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "research_project_application")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_governance_party_life_as_defer(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=47,
                title="关于2025年党员发展指标追加名额分配情况的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "governance_party_life")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_party_discipline_study_as_governance_party_life(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=66,
                title="关于暑假期间开展党纪学习教育的指导意见",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "governance_party_life")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_culture_publicity_activity_as_defer(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=48,
                title="关于2026年圆明园新春灯会海淀校友之夜专场活动的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "culture_publicity_activity")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_campus_news_publicity_as_defer(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=67,
                title="喜讯丨我校项目在2026年度北京高校大学生创新创业训练校际合作计划中斩获佳绩！",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "campus_news_publicity")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_teaching_briefing_as_campus_news_publicity(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=68,
                title="开学第一周本科教学情况简报",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "campus_news_publicity")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_three_creations_competition_as_competition_event(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=69,
                title="转发丨《第十四届三创赛乡村振兴实战赛报名指南及实施要点》",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "competition_event")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_midterm_exam_work_as_academic_course_operation(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=70,
                title="关于做好2026年春季学期期中考试工作的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "academic_course_exam_operation")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_social_grant_review_as_student_affairs_application(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=71,
                title="关于做好2026年中央民族大学社会资助评审工作的通知",
                notice_type="32",
                notice_type_name="学工通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "student_affairs_application")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_research_project_bidding_as_research_project_application(
        self,
    ) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=72,
                title="关于开展2026年度北京市大中小学思想政治教育一体化研究项目招标工作的通知",
                notice_type="32",
                notice_type_name="学工通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "research_project_application")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_science_award_nomination_as_research_project_application(
        self,
    ) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=73,
                title="关于2026年度国家科学技术奖提名工作的通知",
                notice_type="8",
                notice_type_name="科研通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "research_project_application")
        self.assertEqual(classification.admission_policy, "notice_level_query")

    def test_classify_information_portal_pause_as_it_service_status(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=74,
                title="关于信息门户暂停访问的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "it_platform_service_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_commute_bus_operation_as_transport_status(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=75,
                title="关于2026年秋季学期两校区学生通勤班车运营的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "transport_commute_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_open_study_classroom_as_facility_status(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=76,
                title="关于增加开放通宵自习教室、加强自习教室管理的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "facility_transport_classroom_status")
        self.assertEqual(classification.admission_policy, "hold_notice_runtime")

    def test_classify_warning_education_meeting_as_governance_life(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=77,
                title="关于参加国家民委警示教育大会的通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "governance_party_life")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_campus_facility_appeal_as_culture_publicity(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=78,
                title="丰台校区倡议一：爱护学校公共设施倡议书",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "culture_publicity_activity")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_psychological_culture_festival_as_culture_publicity(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=79,
                title="关于举办中央民族大学第二十届心理文化节的通知",
                notice_type="32",
                notice_type_name="学工通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "culture_publicity_activity")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_library_database_training_as_research_publicity(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=80,
                title="民图一小时系列讲座 | 第五讲 巧用中国知网 开启AI智能化学习研究",
                notice_type="8",
                notice_type_name="科研通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "research_publicity_call")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_english_story_competition_as_competition_event(self) -> None:
        classification = classify_authenticated_notice_bundle_record(
            _bundle_record(
                notice_id=81,
                title="关于组织举办2026年“用英语讲中国故事”活动的通知",
                notice_type="6",
                notice_type_name="教学通知",
            ),
            config=self.config,
        )

        self.assertEqual(classification.family, "competition_event")
        self.assertEqual(classification.admission_policy, "defer")

    def test_classify_remaining_high_confidence_patterns(self) -> None:
        cases = (
            (
                "关于举行江西省2026年选调生招录笔试的通知",
                "student_affairs_application",
                "notice_level_query",
            ),
            (
                "关于组织开展2026年北京高校红色“1+1”活动总结的通知",
                "governance_party_life",
                "defer",
            ),
            (
                "图书馆关于新增海淀校区考研读者服务的通知",
                "library_service_status",
                "hold_notice_runtime",
            ),
            (
                "关于我校专属“民大通”APP、“学生门户”、新版“服务门户”上线试运行的通知",
                "it_platform_operation_notice",
                "notice_level_query",
            ),
            (
                "关于发布丰台校区校园、教室、办公室及后勤服务相关信息的通知",
                "facility_transport_classroom_status",
                "hold_notice_runtime",
            ),
            (
                "农行扣款通知",
                "finance_payment_action",
                "notice_level_query",
            ),
            (
                "关于开展2026年辅导员岗位等级评聘工作的通知",
                "staff_internal_admin",
                "defer",
            ),
            (
                "关于2026年暑期放假、2026—2027学年秋季开学及学校《2026-2027学年校历》的通知",
                "academic_course_exam_operation",
                "notice_level_query",
            ),
            (
                "关于调整推荐2020年免试硕士研究生名额的通知",
                "academic_program_selection",
                "notice_level_query",
            ),
            (
                "关于清明节期间本(预)科教学调整的通知",
                "course_teaching_arrangement",
                "notice_level_query",
            ),
            (
                "关于调整丰台校区各教学楼上下课时间的通知",
                "facility_transport_classroom_status",
                "hold_notice_runtime",
            ),
            (
                "关于调整信息化建设管理处一卡通中心办公地点的通知",
                "it_platform_service_status",
                "hold_notice_runtime",
            ),
            (
                "关于中央民族大学医院海淀院区双休日门急诊时间调整的通知",
                "service_status_override",
                "hold_notice_runtime",
            ),
            (
                "图书馆开通“馆长接待日”的通知",
                "library_service_status",
                "hold_notice_runtime",
            ),
            (
                "关于2019级新生户口迁移工作的通知",
                "student_status_registration",
                "notice_level_query",
            ),
            (
                "关于领取2021年校园地助学贷款合同的通知",
                "finance_payment_action",
                "notice_level_query",
            ),
            (
                "2026年春季国际公务员职业生涯规划公共讲座的通知",
                "research_publicity_call",
                "defer",
            ),
            (
                "关于校园超市暑期调整营业时间的通知",
                "service_status_override",
                "hold_notice_runtime",
            ),
            (
                "图书馆关于开通试用CNRDS数据库的通知",
                "library_resource_notice",
                "notice_level_query",
            ),
            (
                "图书馆开通校外使用万方数据论文检测系统的通知",
                "library_resource_notice",
                "notice_level_query",
            ),
            (
                "图书馆关于启动线上采书活动的通知",
                "library_acquisition_service",
                "notice_level_query",
            ),
            (
                "图书馆开通在校读者图书预约外借服务的通知",
                "library_service_status",
                "hold_notice_runtime",
            ),
            (
                "关于家属区微信购电暂停的通知",
                "it_platform_service_status",
                "hold_notice_runtime",
            ),
            (
                "第四期“中央民族大学理工科拔尖创新人才培养实验班”选拔方案",
                "academic_program_selection",
                "notice_level_query",
            ),
            (
                "“田野历史调查方法研习营”——温春来教授讲座纪要",
                "research_publicity_call",
                "defer",
            ),
            (
                "关于组织开展2020年校园地国家助学贷款申请工作的通知",
                "finance_payment_action",
                "notice_level_query",
            ),
            (
                "关于开展2024—2025学年度学生社团注册登记申请的通知",
                "student_affairs_application",
                "notice_level_query",
            ),
            (
                "2021级大学英语分班考试结果通知",
                "academic_course_exam_operation",
                "notice_level_query",
            ),
            (
                "关于近期核酸检测时间调整的通知",
                "service_status_override",
                "hold_notice_runtime",
            ),
            (
                "关于细化落实动态调整出入校门有关措施的通知",
                "facility_transport_classroom_status",
                "hold_notice_runtime",
            ),
            (
                "关于海淀校区后勤综合服务大厅对外服务调整的通知",
                "service_status_override",
                "hold_notice_runtime",
            ),
            (
                "关于调整我校教师个人购置文献进行固定资产登记标准的通知",
                "staff_internal_admin",
                "defer",
            ),
            (
                "2022级新生校园一卡通领取通知",
                "it_platform_operation_notice",
                "notice_level_query",
            ),
            (
                "关于丰台校区图书馆向读者开设研修间的通知",
                "library_service_status",
                "hold_notice_runtime",
            ),
            (
                "在线预约参观图书馆文献展的通知",
                "culture_publicity_activity",
                "defer",
            ),
            (
                "预告 | 第四届中国民族志纪录片学术双年展·中央民族大学专场",
                "research_publicity_call",
                "defer",
            ),
            (
                "关于申请2021年学校公共修缮费项目的通知",
                "operational_procedure",
                "admit_next",
            ),
            (
                "关于申请2022年研究生毕业证书和延期毕业申请的通知",
                "student_status_registration",
                "notice_level_query",
            ),
            (
                "关于2023年全国硕士研究生入学考试初试期间学校东西门通行的通知",
                "facility_transport_classroom_status",
                "hold_notice_runtime",
            ),
            (
                "关于考试周期间“丰台校区→海淀校区”16：00班次推迟至16：20发车的通知",
                "transport_commute_status",
                "hold_notice_runtime",
            ),
            (
                "离校系统开放通知",
                "it_platform_service_status",
                "hold_notice_runtime",
            ),
            (
                "关于恢复海淀校区学生浴室的通知",
                "facility_transport_classroom_status",
                "hold_notice_runtime",
            ),
        )
        for index, (title, expected_family, expected_policy) in enumerate(cases, start=82):
            with self.subTest(title=title):
                classification = classify_authenticated_notice_bundle_record(
                    _bundle_record(
                        notice_id=index,
                        title=title,
                    ),
                    config=self.config,
                )

                self.assertEqual(classification.family, expected_family)
                self.assertEqual(classification.admission_policy, expected_policy)

    def test_classify_source_truth_inventory_high_confidence_patterns(self) -> None:
        cases = (
            (
                "中央民族大学工程结算付款审批单",
                "form_template_download",
                "notice_level_query",
            ),
            (
                "“民大通”APP使用手册",
                "it_platform_operation_notice",
                "notice_level_query",
            ),
            (
                "中央民族大学海淀校区2026年财政专项（工程监理服务）竞争性磋商公告",
                "procurement_notice",
                "archive_notice",
            ),
            (
                "中央民族大学海淀校区配套机械车库建设项目资格预审公告",
                "procurement_notice",
                "archive_notice",
            ),
            (
                "2026年度中央民族大学中央空调清洗消毒和运行值班服务成交结果公告",
                "procurement_notice",
                "archive_notice",
            ),
            (
                "截至4.20‖2026年江苏选调生考察人选信息补充公示",
                "roster_publication",
                "admit_after_policy",
            ),
            (
                "学术新声 | 陈俊妮教授等在《国际新闻界》刊文关注“网络舆论空间同情门槛”话题",
                "research_publicity_call",
                "defer",
            ),
            (
                "文学院敬文东教授新著《絮叨》出版",
                "research_publicity_call",
                "defer",
            ),
            (
                "关于暂时停用相关区域停车权限的通知",
                "facility_transport_classroom_status",
                "hold_notice_runtime",
            ),
            (
                "关于静园10号楼负一层女浴室试运行的通知",
                "facility_transport_classroom_status",
                "hold_notice_runtime",
            ),
            (
                "关于本学期劳动教育理论在线学习提醒的通知",
                "academic_course_exam_operation",
                "notice_level_query",
            ),
            (
                "关于开展2026年师生思想政治状况滚动调查工作的通知",
                "survey_feedback_collection",
                "notice_level_query",
            ),
            (
                "关于聘用高等学历继续教育任课教师的通知",
                "staff_internal_admin",
                "defer",
            ),
            (
                "关于推荐北京高校优秀共产党员、 优秀党务工作者、先进基层党组织的通知",
                "governance_party_life",
                "defer",
            ),
            (
                "关于认领和清理历年到校未入账科研经费的通知",
                "finance_payment_action",
                "notice_level_query",
            ),
            (
                "关于召开2026年春季学期高校专项工作部署会的通知",
                "meeting_training",
                "defer",
            ),
            (
                "中央民族大学中科杯“传承精神谱系 擘画时代新篇” 主题活动开始啦",
                "event_activity",
                "defer",
            ),
            (
                "关于开通丰台校区社会实践专车的通知",
                "transport_commute_status",
                "hold_notice_runtime",
            ),
            (
                "关于举办首届图书馆信息素养训练营活动的通知",
                "event_activity",
                "defer",
            ),
            (
                "关于举办第二期“千人读四书·蒲公英成长营”的通知",
                "culture_publicity_activity",
                "defer",
            ),
            (
                "讲座回顾｜乌兹别克斯坦学者古洛姆·伊斯梅洛夫教授：现代乌兹别克语文字和正字法研究",
                "research_publicity_call",
                "defer",
            ),
            (
                "《“两个结合”研究》第三期发布",
                "research_publicity_call",
                "defer",
            ),
            (
                "进击的中央民大马院：2025学科发展12大事",
                "research_publicity_call",
                "defer",
            ),
            (
                "关于丰台校区开展废旧非机动车集中清理及规范停放管理的通知",
                "facility_transport_classroom_status",
                "hold_notice_runtime",
            ),
            (
                "“同研共美”第六期：上穷碧落下黄泉，动手动脚找材料",
                "research_publicity_call",
                "defer",
            ),
            (
                "孔新峰教授在《学习时报》谈政德何以重要",
                "research_publicity_call",
                "defer",
            ),
            (
                "北京市民运会拔河代表队招募队员的通知",
                "competition_event",
                "defer",
            ),
            (
                "文学院博士研究生在权威期刊《文学评论》发表独作",
                "research_publicity_call",
                "defer",
            ),
            (
                "关于开展2026年度“发明创业奖”评选工作的通知",
                "research_project_application",
                "notice_level_query",
            ),
            (
                "春日常见健康问题的应对指南",
                "health_medical_action",
                "notice_level_query",
            ),
            (
                "预告｜管理学院行业导师进课堂第1-3期",
                "research_publicity_call",
                "defer",
            ),
            (
                "关于开展“阅读，看见更远的未来”中国社会科学文库4·23有奖阅读活动的通知",
                "culture_publicity_activity",
                "defer",
            ),
            (
                "关于调整铸牢教育主题研学活动管理费比例的通知",
                "finance_payment_action",
                "notice_level_query",
            ),
            (
                "关于进一步规范学位答辩委员会组成及答辩公告管理的通知",
                "academic_affairs_lifecycle",
                "notice_level_query",
            ),
            (
                "关于组织收看第十三批在韩中国人民志愿军烈士遗骸归国活动直播的通知",
                "culture_publicity_activity",
                "defer",
            ),
            (
                "关于推荐2026年毕业班级校友联络员的通知",
                "staff_internal_admin",
                "defer",
            ),
        )
        for index, (title, expected_family, expected_policy) in enumerate(cases, start=100):
            with self.subTest(title=title):
                classification = classify_authenticated_notice_bundle_record(
                    _bundle_record(
                        notice_id=index,
                        title=title,
                    ),
                    config=self.config,
                )

                self.assertEqual(classification.family, expected_family)
                self.assertEqual(classification.admission_policy, expected_policy)

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
                title="关于校园道路树木修剪温馨提醒",
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
