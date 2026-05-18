# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from campus_rag_agent.query_planning import plan_curriculum_query

from tests.agent.rag_agent_answer_quality_regression_suite_support import *


class RagAgentAnswerQualityRegressionTestPart06(unittest.TestCase):
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

    def test_curriculum_total_credit_query_extracts_total_from_credit_matrix_total_row(
        self,
    ) -> None:
        title = "汉语国际教育（国际学生）本科人才培养方案"
        evidence = EvidenceBundle(
            query_text="汉语国际教育国际学生本科人才培养方案总学分是多少",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0017",
                    source_title=title,
                    snippet=(
                        "五、课程设置和修读建议\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 开设学期 | 备注\n"
                        "1051040100 | 海外汉语课堂教学与管理专题(双语) | 2 | 36 | 5 | 至少选修1门,完成2学分"
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
                        "板块名称 | 类别 | 学分设置 | 修读性质 | 总学时 | 理论学时 | 实践学时\n"
                        "语言课 | 学科基础课 | 58 | 必修 | 1260 | / | /\n"
                        "通识课 | 基本素养课 | 4 | 必修 | 108 | 36 | 72\n"
                        "合计 | 146"
                    ),
                    score=0.028,
                    structural_path=(title, "四、各教学环节学时学分"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("总学分为146学分", draft.answer_text)
        self.assertEqual(draft.supporting_sources[0].chunk_id, f"curriculum:{title}:chunk-0006")
        self.assertNotIn("完成2学分", draft.answer_text)

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

    def test_curriculum_academic_years_fact_lookup_accepts_non_answer_bearing_section_text(
        self,
    ) -> None:
        title = "教育学本科第二学士学位人才培养方案"
        evidence = EvidenceBundle(
            query_text=f"{title}学制几年",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0005",
                    source_title=title,
                    snippet=(
                        "三、学制、总学分和学位授予\n\n"
                        "学制:2年\n\n"
                        "总学分:60 学分\n\n"
                        "学位授予:教育学第二学士学位"
                    ),
                    score=0.033,
                    content_kind="section_text",
                    structural_path=(title, "三、学制、总学分和学位授予"),
                    is_answer_bearing=False,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0008",
                    source_title=title,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "1041030045 | 教育学原理 | 3 | 54 | 9 | 1"
                    ),
                    score=0.034,
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            retrieval_intent=plan_curriculum_query(evidence.query_text).retrieval_intent,
        )

        self.assertIn("学制为两年", draft.answer_text)
        self.assertEqual(draft.supporting_sources[0].chunk_id, f"curriculum:{title}:chunk-0005")
        self.assertNotIn("教育学原理", draft.answer_text)


if __name__ == "__main__":
    unittest.main()
