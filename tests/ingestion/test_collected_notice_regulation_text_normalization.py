from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
    build_regulation_document_units,
    normalize_regulation_owner_text,
)


class CollectedNoticeRegulationTextNormalizationTests(unittest.TestCase):
    def test_quoted_wrapper_title_does_not_define_canonical_body(self) -> None:
        title = "中央民族大学毕业生就业奖励办法"
        owner_text = (
            "中央民族大学关于印发《中央民族大学毕业生就业奖励办法》的通知\n\n"
            "学校各单位、各部门：\n\n"
            "《中央民族大学毕业生就业奖励办法》已经学校校长办公会研究通过，"
            "现印发给你们，请遵照执行。\n\n"
            "中央民族大学\n\n"
            "2019年10月16日\n\n"
            "中央民族大学毕业生就业奖励办法\n\n"
            "第一章总则\n\n"
            "第一条 为贯彻落实有关文件精神，制定本奖励办法。\n\n"
            "-2-\n\n"
            "第二条 本办法适用于学校毕业生。"
        )

        result = normalize_regulation_owner_text(title=title, owner_text=owner_text)

        self.assertTrue(result.wrapper_removed)
        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotIn("》的通知", result.canonical_body)
        self.assertNotIn("学校各单位", result.canonical_body)
        self.assertNotIn("现印发给你们，请遵照执行", result.canonical_body)
        self.assertNotIn("-2-", result.canonical_body)
        self.assertIn("第一章 总则", result.canonical_body)
        self.assertEqual(result.title_occurrence_count, 3)
        self.assertEqual(result.chapter_count, 1)
        self.assertEqual(result.article_count, 2)
        self.assertGreaterEqual(result.page_artifact_count, 1)

    def test_clean_scoped_rule_keeps_body_and_builds_article_units(self) -> None:
        title = "中央民族大学研究生学位论文评阅办法（试行）"
        owner_text = (
            "中央民族大学研究生学位论文评阅办法（试行）\n\n"
            "民大校发（2021）149号\n\n"
            "一、评阅原则、评阅范围及评阅方式\n\n"
            "（一）评阅原则\n\n"
            "学位论文的评阅须遵守国家宪法和法律。\n\n"
            "二、评阅程序\n\n"
            "（一）申请人提交材料。"
        )

        result = normalize_regulation_owner_text(title=title, owner_text=owner_text)
        units = build_regulation_document_units(
            target_document_id="institutional_regulation:muc:thesis-review",
            title=title,
            canonical_body=result.canonical_body,
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("民大校发", result.canonical_body)
        self.assertGreaterEqual(len(units), 2)
        self.assertEqual(units[0]["unit_type"], "article")
        self.assertEqual(
            units[0]["unit_id"], "institutional_regulation:muc:thesis-review#unit-0001"
        )
        self.assertIn("评阅原则", units[0]["text_preview"])

    def test_sparse_body_is_flagged_for_manual_review(self) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学某事项管理办法",
            owner_text="中央民族大学某事项管理办法\n\n本办法另行解释。",
        )

        self.assertEqual(result.quality_verdict, "flagged_manual_review")
        self.assertIn("insufficient_regulation_structure", result.reason_codes)

    def test_body_citation_to_notice_is_not_wrapper_residue(self) -> None:
        title = "中央民族大学某事项管理办法"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                f"{title}\n\n第一章总则\n\n第一条 根据《关于做好相关工作的通知》要求，制定本办法。"
            ),
        )

        self.assertFalse(result.suspicious_prefix)
        self.assertEqual(result.quality_verdict, "passed")

    def test_canonical_cleaning_repairs_ocr_soft_wrap_and_cjk_punctuation(self) -> None:
        title = "中央民族大学学生社团管理办法"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                "中央民族大学关于印发《中央民族大学学生社团管理办法》的通知\n\n"
                "现印发给你们，请遵照执行。\n\n"
                "中央民族大学学生社团管理办法\n\n"
                "第一章总则\n\n"
                "第一条 为进一步加强学生社团建设, 结合学校实际, 制定本办法。\n\n"
                "第二条 发起人基本情况包括思想政治、日常表现、学习\n\n"
                "成绩等材料。\n\n"
                "第三条 以铸牢中华民族共同体意识为主线, 团结凝聚广大学生, 丰富学生\n\n"
                "课余生活。\n\n"
                "第四条 学生社团指导教师的主要职责是:指导学生社团发展建设。\n\n"
                "(五) 其他不宜批准成立的。\n"
            ),
        )

        self.assertEqual(result.normalizer_version, REGULATION_CANONICAL_NORMALIZER_VERSION)
        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("soft_wrap_repaired", result.reason_codes)
        self.assertIn("readable_text_normalized", result.reason_codes)
        self.assertGreaterEqual(result.soft_wrap_repair_count, 2)
        self.assertGreaterEqual(result.readability_normalization_count, 1)
        self.assertIn("学习成绩", result.canonical_body)
        self.assertIn("学生课余生活", result.canonical_body)
        self.assertIn("建设，结合学校实际，制定本办法。", result.canonical_body)
        self.assertIn("主要职责是：指导学生社团发展建设。", result.canonical_body)
        self.assertIn("（五） 其他不宜批准成立的。", result.canonical_body)
        self.assertNotIn("学习\n\n成绩", result.canonical_body)
        self.assertNotIn("主线,", result.canonical_body)

    def test_canonical_cleaning_repairs_page_artifact_soft_wrap_with_repeated_blank_lines(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学毕业生就业奖励办法",
            owner_text=(
                "中央民族大学毕业生就业奖励办法\n\n"
                "第一章总则\n\n"
                "第一条 学校对到西部地区和基层单位就业的学生（以下简称“到西部\n\n"
                "-2-\n\n"
                "基层就业学生”）给予表彰和奖励。\n\n"
                "第二条 到四川、重庆、陕西、甘肃四省市以及恩施、湘西、\n\n"
                "-3-\n\n"
                "延边三州就业的，一次性奖励500元。"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("page_artifacts_removed", result.reason_codes)
        self.assertIn("soft_wrap_repaired", result.reason_codes)
        self.assertGreaterEqual(result.soft_wrap_repair_count, 2)
        self.assertNotIn("到西部\n\n基层就业学生", result.canonical_body)
        self.assertNotIn("湘西、\n\n延边", result.canonical_body)
        self.assertIn("到西部基层就业学生", result.canonical_body)
        self.assertIn("湘西、延边三州", result.canonical_body)

    def test_canonical_cleaning_does_not_flag_issuer_date_imprint_as_soft_wrap(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学毕业生就业奖励办法",
            owner_text=(
                "中央民族大学毕业生就业奖励办法\n\n"
                "第一章总则\n\n"
                "第一条 本办法适用于学校毕业生。\n\n"
                "第二条 本办法由招生就业工作处负责解释。\n\n"
                "中央民族大学校长办公室\n\n"
                "2019年10月23日印发"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotIn("soft_wrap_residue", result.reason_codes)
        self.assertEqual(result.soft_wrap_residue_count, 0)
        self.assertIn("中央民族大学校长办公室", result.canonical_body)
        self.assertIn("2019年10月23日印发", result.canonical_body)

    def test_unrepaired_soft_wrap_residue_is_flagged_for_manual_review(self) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学某事项管理办法",
            owner_text=(
                "中央民族大学某事项管理办法\n\n"
                "第一条 本办法适用于学生\n\n"
                "A1B2异常断裂文本。\n\n"
                "第二条 本办法由学校解释。"
            ),
        )

        self.assertEqual(result.quality_verdict, "flagged_manual_review")
        self.assertIn("soft_wrap_residue", result.reason_codes)


if __name__ == "__main__":
    unittest.main()
