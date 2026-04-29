from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_classification import (
    classify_collected_notice_unit,
)

from tests.ingestion.authenticated_notice_notice_family_test_support import (
    load_notice_family_config,
)


class CollectedNoticeClassificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_notice_family_config()

    def test_transport_target_requires_explicit_commute_schedule_signal(self) -> None:
        true_transport_titles = (
            "关于两校区学生通勤班车增加班次的通知",
            "关于本周六临时增加学生班车班次的通知",
            "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
            "关于开通丰台校区社会实践专车的通知",
        )

        for index, title in enumerate(true_transport_titles, start=1):
            with self.subTest(title=title):
                classification = self._classify(source_identifier=f"transport-{index}", title=title)
                self.assertEqual(classification["target_candidates"], ["transport_schedule"])
                self.assertEqual(classification["evidence_strength"], "strong")

    def test_facility_and_classroom_status_do_not_become_transport_target(self) -> None:
        false_transport_titles = (
            "关于丰台校区开展废旧非机动车集中清理及规范停放管理的通知",
            "关于海淀区教委所属事业单位公开招聘考试使用教室的通知",
            "关于2026届教师职业能力测试（笔试）期间使用教室的通知",
            "关于暂时停用相关区域停车权限的通知",
            "关于丰台校区废旧非机动车清理后认领事宜的通知",
            "关于静园10号楼负一层女浴室试运行的通知",
            "关于地方人才招录考试占用教室的通知",
        )

        for index, title in enumerate(false_transport_titles, start=1):
            with self.subTest(title=title):
                classification = self._classify(source_identifier=f"facility-{index}", title=title)
                self.assertNotIn("transport_schedule", classification["target_candidates"])

    def test_procurement_and_project_notices_do_not_become_service_status_target(self) -> None:
        false_service_status_titles = (
            "中央民族大学海淀校区运动场地改造建设项目施工资格预审公告",
            "中央民族大学音乐舞蹈排演厅及周边更新改造项目施工资格预审公告",
            "2026年度中央民族大学海淀校区水泵和空调等机电设备维修维护服务比选公告",
            "中央民族大学2026年度公共修缮及应急抢修项目造价咨询项目比选公告",
            "2026年度中央民族大学海淀校区水泵和空调等机电设备维修维护服务成交结果公告",
        )

        for index, title in enumerate(false_service_status_titles, start=1):
            with self.subTest(title=title):
                classification = self._classify(
                    source_identifier=f"procurement-{index}", title=title
                )
                self.assertEqual(classification["target_candidates"], [])
                self.assertEqual(classification["primary_route"], "notice_level_query")

    def test_stable_file_release_policy_titles_become_regulation_target(self) -> None:
        regulation_titles = (
            "中央民族大学接收校内外优秀应届本科毕业生免试攻读博士研究生工作办法（试行）",
            "中央民族大学研究生学位论文评阅办法（试行）",
            "中央民族大学优秀研究生导师、优秀研究生导师团队评选办法（试行）",
            "中央民族大学党建工作考核办法（试行）",
            "中央民族大学毕业生就业奖励办法",
            "中央民族大学本科学生专业奖学金评定办法（修订）",
            "中央民族大学本科教学事故认定与处理办法",
            "中央民族大学落实习惯过紧日子工作细则",
            "中央民族大学招募选拔 “中国青年志愿者扶贫接力计划研究生支教团”成员规定",
            "中央民族大学教学行为规范",
        )

        for index, title in enumerate(regulation_titles, start=1):
            with self.subTest(title=title):
                classification = self._classify(
                    source_identifier=f"file-release-{index}",
                    source_surface="file_release",
                    title=title,
                )
                self.assertEqual(classification["target_candidates"], ["regulation"])
                self.assertEqual(classification["primary_route"], "regulation_candidate")

    def _classify(
        self,
        *,
        source_identifier: str,
        title: str,
        source_surface: str = "notice",
        body_text: str = "",
    ) -> dict[str, object]:
        return classify_collected_notice_unit(
            source_identifier=source_identifier,
            source_surface=source_surface,
            title=title,
            body_text=body_text,
            attachment_refs=(),
            config=self.config,
        )


if __name__ == "__main__":
    unittest.main()
