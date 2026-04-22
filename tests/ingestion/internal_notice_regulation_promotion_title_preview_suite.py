from __future__ import annotations

import unittest

from .internal_notice_regulation_promotion_test_support import *  # noqa: F401,F403


class InternalNoticeRegulationPromotionTitlePreviewTest(unittest.TestCase):
    def test_split_regulation_title_fields_preserves_full_edition_label_in_display_title(
        self,
    ) -> None:
        guidance_title = "中央民族大学关于学生使用人工智能的指导意见（2026版）"
        self.assertEqual(
            _split_regulation_title_fields(guidance_title),
            (
                "中央民族大学关于学生使用人工智能的指导意见",
                "2026版",
                "中央民族大学关于学生使用人工智能的指导意见 / 2026版",
                guidance_title,
            ),
        )
        self.assertNotEqual(
            _split_regulation_title_fields(guidance_title)[2],
            "中央民族大学关于学生使用人工智能的指导意见 / 2026",
        )

        revised_title = "中央民族大学实验室安全管理规定（2026年修订）"
        self.assertEqual(
            _split_regulation_title_fields(revised_title),
            (
                "中央民族大学实验室安全管理规定",
                "2026年修订",
                "中央民族大学实验室安全管理规定 / 2026年修订",
                revised_title,
            ),
        )
        self.assertNotEqual(
            _split_regulation_title_fields(revised_title)[2],
            "中央民族大学实验室安全管理规定 / 2026",
        )

    def test_split_regulation_title_fields_does_not_misclassify_status_doc_no_or_cohort_year(
        self,
    ) -> None:
        temporary_title = "中央民族大学丰台校区就医管理办法（暂行）"
        self.assertEqual(
            _split_regulation_title_fields(temporary_title),
            (
                temporary_title,
                None,
                temporary_title,
                temporary_title,
            ),
        )

        file_number_title = "中央民族大学差旅费管理办法（民大校发〔2025〕104号）"
        self.assertEqual(
            _split_regulation_title_fields(file_number_title),
            (
                file_number_title,
                None,
                file_number_title,
                file_number_title,
            ),
        )

        cohort_title = "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则"
        self.assertEqual(
            _split_regulation_title_fields(cohort_title),
            (
                cohort_title,
                None,
                cohort_title,
                cohort_title,
            ),
        )

    def test_extract_parent_notice_preview_strips_wrapper_boilerplate_for_procurement_notice(
        self,
    ) -> None:
        preview = extract_internal_notice_parent_regulation_body_preview(
            "# 关于修订《中央民族大学采购工作管理办法》的通知\n\n"
            "学校各单位、各部门：\n\n"
            "为进一步规范采购与招标管理工作，优化资源配置，提升工作效率，提高采购质量，我校于2021年2月28日印发了《中央民族大学采购工作管理办法》（民大校发〔2021〕10号文），对原有采购管理办法进行了修订，现将有关事项通知如下：\n\n"
            "一、主要修订内容\n\n"
            "（一）、校内集中采购限额标准及范围调整\n\n"
            "工程、货物（不含进口货物）、服务校内集中采购限额标准，统一调整到20万元（含）以上。\n\n"
            "二、采购注意事项\n\n"
            "（一）采购意向公示要求\n\n"
            "1. 为进一步提高政府采购透明度，根据《关于开展政府采购意向公开工作的通知》要求，必须在项目采购活动开始前35日将采购意向公开文件发送至指定邮箱。\n\n"
            "特此通知。\n\n"
            "附件：采购意向公开参考文本\n\n"
            "资产管理处（招标采购中心）\n\n"
            "2021年2月28日\n",
            source_title="关于修订《中央民族大学采购工作管理办法》的通知",
        )

        self.assertEqual(preview.regulation_title_normalized, "中央民族大学采购工作管理办法")
        self.assertTrue(preview.wrapper_semantics_removed)
        self.assertTrue(preview.standalone_body_quality_passed)
        self.assertTrue(preview.regulation_structure_retained)
        self.assertTrue(preview.promotable_standalone_body)
        self.assertTrue(preview.cleaned_body.startswith("一、主要修订内容"))
        self.assertNotIn("学校各单位、各部门", preview.cleaned_body)
        self.assertNotIn("现将有关事项通知如下", preview.cleaned_body)
        self.assertNotIn("特此通知", preview.cleaned_body)
        self.assertNotIn("附件：采购意向公开参考文本", preview.cleaned_body)

    def test_extract_parent_notice_preview_keeps_summary_notice_non_promotable(self) -> None:
        preview = extract_internal_notice_parent_regulation_body_preview(
            "# 关于印发实施《中央民族大学学生申诉管理办法》的通知\n\n"
            "各学院：\n\n"
            "《中央民族大学学生申诉管理办法》已经于2019年12月25日经学校校长办公会议审议通过，自2020年1月1日起施行。本办法调整了学校学生申诉处理委员会成员构成，学生申诉处理委员会办公室设在校长办公室。\n\n"
            "特此通知，请遵照执行。\n\n"
            "党委学生工作部、学生处\n\n"
            "2020年1月7日\n",
            source_title="关于印发实施《中央民族大学学生申诉管理办法》的通知",
        )

        self.assertEqual(preview.regulation_title_normalized, "中央民族大学学生申诉管理办法")
        self.assertTrue(preview.wrapper_semantics_removed)
        self.assertFalse(preview.regulation_structure_retained)
        self.assertFalse(preview.promotable_standalone_body)
        self.assertIn("《中央民族大学学生申诉管理办法》已经于2019年12月25日", preview.cleaned_body)
        self.assertNotIn("各学院：", preview.cleaned_body)
        self.assertNotIn("特此通知", preview.cleaned_body)

    def test_extract_parent_notice_preview_strips_document_number_before_wrapper_intro(
        self,
    ) -> None:
        preview = extract_internal_notice_parent_regulation_body_preview(
            "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n"
            "生环实发【2021】02号\n\n"
            "根据学校近期关于加强暑假期间安全稳定的有关指示精神，现将2021年暑假期间实验室安全管理规定如下：\n\n"
            "一、基本要求\n\n"
            "1. 暑假期间实验须两人以上同时在场。\n\n"
            "2. 假期期间严禁在实验室食宿。\n\n"
            "二、安全责任\n\n"
            "1. 实验室负责人应在放假前完成危险源排查并做好记录。\n\n"
            "2. 值班教师应保持通讯畅通，发现异常情况立即上报。\n\n"
            "生命与环境科学学院\n\n"
            "2021年7月12日\n",
            source_title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
        )

        self.assertEqual(
            preview.regulation_title_normalized,
            "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
        )
        self.assertEqual(
            preview.removed_leading_lines,
            (
                "生环实发【2021】02号",
                "根据学校近期关于加强暑假期间安全稳定的有关指示精神，现将2021年暑假期间实验室安全管理规定如下：",
            ),
        )
        self.assertEqual(preview.removed_trailing_lines, ("生命与环境科学学院", "2021年7月12日"))
        self.assertTrue(preview.wrapper_semantics_removed)
        self.assertTrue(preview.standalone_body_quality_passed)
        self.assertTrue(preview.regulation_structure_retained)
        self.assertTrue(preview.promotable_standalone_body)
        self.assertTrue(preview.cleaned_body.startswith("一、基本要求"))
        self.assertNotIn("生环实发【2021】02号", preview.cleaned_body)
        self.assertNotIn("现将2021年暑假期间实验室安全管理规定如下", preview.cleaned_body)

    def test_extract_parent_notice_preview_does_not_use_section_heading_as_regulation_title(
        self,
    ) -> None:
        preview = extract_internal_notice_parent_regulation_body_preview(
            "# 关于2025-2026学年第一学期本科生网上选课的通知\n\n"
            "各学院、各位同学：\n\n"
            "根据学校本科教学工作安排，现将2025-2026学年第一学期本科生网上选课有关事项通知如下。\n\n"
            "一、选课范围\n\n"
            "2023级、2024级本科生均可参加本轮选课。\n\n"
            "二、选课时间\n\n"
            "学生应在规定时段登录系统完成选课。\n",
            source_title="关于2025-2026学年第一学期本科生网上选课的通知",
        )

        self.assertIsNone(preview.regulation_title_normalized)
        self.assertTrue(preview.cleaned_body.startswith("一、选课范围"))
