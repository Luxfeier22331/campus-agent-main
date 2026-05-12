# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.rag_agent_answer_quality_regression_suite_support import *


class RagAgentAnswerQualityRegressionTestPart02(unittest.TestCase):
    def test_curriculum_title_lookup_selection_excludes_table_facts_when_narrative_exists(
        self,
    ) -> None:
        title = "民族学本科人才培养方案"

        rows = _select_answer_support_rows(
            query_text=title,
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0012",
                    source_title=title,
                    snippet="五、课程设置和修读建议 课程号 | 课程名称 | 学分 0304-1-05-04 | 民族学前沿研究 | 2",
                    score=0.92,
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0001",
                    source_title=title,
                    snippet="民族学本科人才培养方案 一、培养目标 本专业培养具有民族学理论基础和田野调查能力的人才。",
                    score=0.9,
                    is_answer_bearing=True,
                ),
            ),
            max_sources=3,
            answer_shape=AnswerShape.TITLE_LOOKUP,
        )

        statements = " ".join(
            statement for _, row_statements in rows for statement in row_statements
        )
        self.assertEqual(tuple(source.content_role for source, _ in rows), ("",))
        self.assertIn("培养目标", statements)
        self.assertNotIn("0304-1-05-04", statements)

    def test_curriculum_title_lookup_does_not_use_table_only_chunks_as_overview(
        self,
    ) -> None:
        title = "民族学本科人才培养方案"
        evidence = EvidenceBundle(
            query_text=title,
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0012",
                    source_title=title,
                    snippet="五、课程设置和修读建议 课程号 | 课程名称 | 学分 0304-1-05-04 | 民族学前沿研究 | 2",
                    score=0.92,
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0013",
                    source_title=title,
                    snippet="课程号 | 课程名称 | 学分 0304-1-05-05 | 民族理论专题 | 2",
                    score=0.91,
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertEqual(draft.answer_text, "")
        self.assertEqual(draft.supporting_sources, ())

    def test_curriculum_course_teaching_plan_total_credit_query_extracts_total_credits(
        self,
    ) -> None:
        title = "中央民族大学通识课程“大学英语”课程教学计划"
        evidence = EvidenceBundle(
            query_text="大学英语课程教学计划一共多少学分",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0001",
                    source_title=title,
                    snippet=(
                        "根据教育部关于深化公共外语教学改革的要求，"
                        "大学英语教学分为基础级、普通级两个级别。"
                    ),
                    score=0.9,
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0005",
                    source_title=title,
                    snippet=(
                        "课程类别 | 课程名称 | 学分 | 学时\n"
                        "大学英语课程 | 大学英语(一) | 2 | 36\n"
                        "总学分 | — | 8 | —"
                    ),
                    score=0.88,
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("总学分为8学分", draft.answer_text)
        self.assertIn("一共8学分", draft.answer_text)
        self.assertNotIn("深化公共外语教学改革", draft.answer_text)
        self.assertNotIn("根据培养方案相关内容", draft.answer_text)

    def test_curriculum_course_teaching_plan_total_credit_query_extracts_inline_total(
        self,
    ) -> None:
        title = "中央民族大学通识课程“大学英语”课程教学计划"
        evidence = EvidenceBundle(
            query_text="大学英语课程教学计划一共多少学分",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0005",
                    source_title=title,
                    snippet=(
                        "二、课程设计\n"
                        "(四) 修读学期学时安排\n"
                        "开设学期为第1-4学期,每学期54学时,每周3学时,合计8学分。"
                    ),
                    score=0.9,
                    content_kind="section_text",
                    structural_path=(title, "二、课程设计"),
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("总学分为8学分", draft.answer_text)
        self.assertIn("一共8学分", draft.answer_text)
        self.assertEqual(draft.supporting_sources[0].chunk_id, f"curriculum:{title}:chunk-0005")

    def test_curriculum_total_credit_query_fail_closes_without_total_credit_fact(
        self,
    ) -> None:
        title = "中央民族大学通识课程“大学英语”课程教学计划"
        evidence = EvidenceBundle(
            query_text="大学英语课程教学计划一共多少学分",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0001",
                    source_title=title,
                    snippet=(
                        "根据教育部关于深化公共外语教学改革的要求，"
                        "大学英语教学分为基础级、普通级两个级别。"
                    ),
                    score=0.9,
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertEqual(draft.answer_text, "")

    def test_curriculum_course_settings_answer_summarizes_table_categories_not_header_only(
        self,
    ) -> None:
        title = "经济学拔尖人才创新班人才培养方案"
        evidence = EvidenceBundle(
            query_text="经济学拔尖人才创新班人才培养方案课程设置怎么安排",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0010",
                    source_title=title,
                    snippet=(
                        "五、课程设置和修读建议\n"
                        "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "综合素养课 | — | 创新创业素养类 | 2 | 36 | / | 2-7\n"
                        "专业核心课程 | 1034030090 | 中级微观经济学 | 3 | 54 | 9 | 2\n"
                        "专业选修课程 | 1034030159 | 经济学经典原著选读 | 2 | 36 | 6 | 3"
                    ),
                    score=0.9,
                    structural_path=(title, "五、课程设置和修读建议"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    detail_label="五、课程设置和修读建议",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("课程设置", draft.answer_text)
        self.assertIn("综合素养课", draft.answer_text)
        self.assertIn("专业核心课程", draft.answer_text)
        self.assertIn("专业选修课程", draft.answer_text)
        self.assertNotIn("类别 | 课程号", draft.answer_text)
        self.assertNotEqual(
            draft.answer_text,
            (
                "根据培养方案相关内容，《经济学拔尖人才创新班人才培养方案》 "
                "五、课程设置和修读建议明确：类别 | 课程号 | 课程名称 | 学分 | 学时 | "
                "实践学时 | 修读学期；综合素养课 | — | 创新创业素养类 | 2 | 36 | / | 2-7"
            ),
        )

    def test_curriculum_course_settings_answer_summarizes_multiple_section_tables(
        self,
    ) -> None:
        title = "经济学拔尖人才创新班人才培养方案"
        evidence = EvidenceBundle(
            query_text="经济学拔尖人才创新班人才培养方案课程设置怎么安排",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0013",
                    source_title=title,
                    snippet=(
                        "五、课程设置和修读建议\n"
                        "(二)专业教育\n"
                        "1.专业核心课程\n"
                        "经济学拔尖人才创新班必修的专业核心课程30学分。\n"
                        "课程清单如下:\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "1034030015 | 经济学说史 | 3 | 54 | / | 3"
                    ),
                    score=0.93,
                    structural_path=(title, "五、课程设置和修读建议", "(二)专业教育", "1.专业核心课程"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0014",
                    source_title=title,
                    snippet=(
                        "五、课程设置和修读建议\n"
                        "(二)专业教育\n"
                        "2.专业选修课程\n"
                        "经济学拔尖人才创新班专业选修课程至少任选7门课程,完成14学分。\n"
                        "课程清单如下:\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "1034030016 | 中国近现代经济史 | 2 | 36 | / | 4"
                    ),
                    score=0.92,
                    structural_path=(title, "五、课程设置和修读建议", "(二)专业教育", "2.专业选修课程"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0012",
                    source_title=title,
                    snippet=(
                        "五、课程设置和修读建议\n"
                        "(一) 大类培养\n"
                        "2.学科基础教育\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "1034030125 | 政治经济学 | 4 | 72 | 9 | 1"
                    ),
                    score=0.91,
                    structural_path=(title, "五、课程设置和修读建议", "(一) 大类培养", "2.学科基础教育"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0010",
                    source_title=title,
                    snippet=(
                        "五、课程设置和修读建议\n"
                        "(一) 大类培养\n"
                        "1. 通识教育\n"
                        "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "基本素养课 | 1049020003 | 大学体育(三) | 1 | 36 | 36 | 3\n"
                        "综合素养课 | — | 人文素养类 | 2 | 36 | / | 2-7"
                    ),
                    score=0.9,
                    structural_path=(title, "五、课程设置和修读建议", "(一) 大类培养", "1. 通识教育"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("通识教育", draft.answer_text)
        self.assertIn("学科基础教育", draft.answer_text)
        self.assertIn("专业核心课程", draft.answer_text)
        self.assertIn("专业选修课程", draft.answer_text)
        self.assertIn("专业核心课程30学分", draft.answer_text)
        self.assertIn("专业选修课程至少任选7门课程,完成14学分", draft.answer_text)
        self.assertIn("课程设置按以下模块安排", draft.answer_text)
        self.assertIn("依据课程设置和修读建议", draft.answer_text)
        self.assertTrue(any("学科基础教育" in item for item in draft.supporting_contexts))
        self.assertTrue(any("专业核心课程" in item for item in draft.supporting_contexts))
        self.assertTrue(any("专业选修课程" in item for item in draft.supporting_contexts))
        self.assertNotIn("课程号 | 课程名称", draft.answer_text)

    def test_student_rules_table_fact_lookup_uses_scholarship_amount_row(self) -> None:
        title = "中央民族大学本科学生专业奖学金评定办法"
        table_source = replace(
            _make_policy_source(
                doc_id="handbook:professional-scholarship",
                title=title,
                snippet=(
                    "专业奖学金等级和金额\n"
                    "奖学金等级 | 奖励金额 | 名额\n"
                    "一等奖 | 3000元 | 10人\n"
                    "二等奖 | 1500元 | 20人"
                ),
                score=0.94,
                chunk="professional-scholarship-amount-table",
            ),
            content_kind="table_unit",
            content_role="table_fact",
            structural_path=(title, "专业奖学金等级和金额"),
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="table_fact",
                semantic_role="table_fact",
                claim_type="amount_or_quota",
                table_fact_type="amount_or_quota",
                condition_subject="amount_or_quota",
                condition_polarity="positive",
            ),
        )
        evidence = EvidenceBundle(
            query_text="专业奖学金一等奖金额是多少？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                table_source,
                _make_policy_source(
                    doc_id="handbook:professional-scholarship",
                    title=title,
                    snippet="专业奖学金用于奖励学习刻苦、成绩优良、表现突出的本科学生。",
                    score=0.91,
                    chunk="professional-scholarship-overview",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("一等奖", draft.answer_text)
        self.assertIn("3000元", draft.answer_text)
        self.assertEqual(draft.supporting_sources[0].chunk_id, table_source.chunk_id)
        self.assertEqual(draft.typed_draft.kind, "condition_table")

    def test_student_rules_table_fact_lookup_uses_quota_row(self) -> None:
        title = "中央民族大学本科学生专业奖学金评定办法"
        table_source = replace(
            _make_policy_source(
                doc_id="handbook:professional-scholarship",
                title=title,
                snippet=(
                    "专业奖学金等级和金额\n"
                    "奖学金等级 | 奖励金额 | 名额\n"
                    "一等奖 | 3000元 | 10人\n"
                    "二等奖 | 1500元 | 20人"
                ),
                score=0.94,
                chunk="professional-scholarship-quota-table",
            ),
            content_kind="table_unit",
            content_role="table_fact",
            structural_path=(title, "专业奖学金等级和金额"),
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="table_fact",
                semantic_role="table_fact",
                claim_type="amount_or_quota",
                table_fact_type="amount_or_quota",
                condition_subject="amount_or_quota",
                condition_polarity="positive",
            ),
        )
        evidence = EvidenceBundle(
            query_text="专业奖学金一等奖名额有多少？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                table_source,
                _make_policy_source(
                    doc_id="handbook:professional-scholarship",
                    title=title,
                    snippet="专业奖学金用于奖励学习刻苦、成绩优良、表现突出的本科学生。",
                    score=0.91,
                    chunk="professional-scholarship-overview-2",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("一等奖", draft.answer_text)
        self.assertIn("10人", draft.answer_text)
        self.assertEqual(draft.supporting_sources[0].chunk_id, table_source.chunk_id)
        self.assertEqual(draft.typed_draft.kind, "condition_table")

    def test_curriculum_fact_lookup_prefers_short_fact_chunk_over_credit_table(
        self,
    ) -> None:
        title = "民族学本科人才培养方案"
        evidence = EvidenceBundle(
            query_text=f"{title}总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0005",
                    source_title=title,
                    snippet=(
                        "三、学制、总学分和学位授予\n\n"
                        "学制:4年\n\n"
                        "总学分:159 学分\n\n"
                        "学位授予:法学学士"
                    ),
                    score=0.028,
                    content_kind="section_text",
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0007",
                    source_title=title,
                    snippet=(
                        "四、各教学环节学时学分\n\n"
                        "培养阶段 | 板块名称 | 类别 | 学分设置 | 修读性质 | 总学时\n"
                        "大类培养 | 通识教育 | 思政课 | 19 | 必修 | 370\n"
                        "总学分 | — | — | 159"
                    ),
                    score=0.029,
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0006",
                    source_title=title,
                    snippet=(
                        "四、各教学环节学时学分\n\n"
                        "大类培养阶段合计78学分，专业培养阶段合计57学分，"
                        "个性化培养阶段选修6学分，实践环节合计18学分。"
                    ),
                    score=0.027,
                    content_kind="section_text",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("总学分为159学分", draft.answer_text)
        self.assertEqual(draft.supporting_sources[0].chunk_id, f"curriculum:{title}:chunk-0005")
        self.assertNotIn("各教学环节学时学分", draft.answer_text)

    def test_curriculum_academic_years_fact_lookup_prefers_academic_years_chunk_over_course_table(
        self,
    ) -> None:
        title = "民族学本科第二学士学位人才培养方案"
        evidence = EvidenceBundle(
            query_text=f"{title}学制几年？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0005",
                    source_title=title,
                    snippet="五、学制\n\n两年",
                    score=0.031,
                    content_kind="section_text",
                    structural_path=(title, "五、学制"),
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0012",
                    source_title=title,
                    snippet=(
                        "八、民族学本科专业教学进程计划表\n\n"
                        "课程类别 | 课程编号 | 课程名称 | 学分 | 学时 | 各学期周学时分配\n"
                        "专业教育 | 1026030031 | 民族学导论 | 2 | 36 | 2"
                    ),
                    score=0.032,
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("学制为两年", draft.answer_text)
        self.assertEqual(draft.supporting_sources[0].chunk_id, f"curriculum:{title}:chunk-0005")
        self.assertNotIn("教学进程计划表", draft.answer_text)


if __name__ == "__main__":
    unittest.main()
