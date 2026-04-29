from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_regulation_text_normalization import (
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


if __name__ == "__main__":
    unittest.main()
