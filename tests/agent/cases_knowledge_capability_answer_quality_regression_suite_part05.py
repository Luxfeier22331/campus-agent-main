# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.knowledge_capability_answer_quality_regression_suite_support import *


class KnowledgeCapabilityAnswerQualityRegressionTestPart05(unittest.TestCase):
    def test_detail_clause_answer_splits_paper_and_book_requirements_when_query_asks_both(
        self,
    ) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="国奖第九条里对论文和著作怎么要求的？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national-scholarship",
                        title=title,
                        snippet=(
                            "第九条 在学术研究上取得显著成绩，以第一作者发表的论文被SCI、EI、"
                            "ISTP、SSCI全文收录，以第一、二作者出版学术专著(须通过专家鉴定)。"
                        ),
                        score=0.96,
                        chunk="national-paper-book",
                        detail_label="第九条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="example_evidence",
                        semantic_role="example",
                        claim_type="condition",
                        condition_subject="paper_or_publication",
                        condition_polarity="positive",
                        article_no="第九条",
                    ),
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertEqual(
            draft.answer_text,
            (
                f"《{title}》第九条规定：以第一作者发表的论文被SCI、EI、ISTP、"
                "SSCI全文收录；以第一、二作者出版学术专著(须通过专家鉴定)。"
            ),
        )
        self.assertNotIn("论文要求", draft.answer_text)
        self.assertNotIn("著作要求", draft.answer_text)
        self.assertNotIn("根据学生手册相关规定", draft.answer_text)
        self.assertIn("第一作者", draft.answer_text)
        self.assertIn("第一、二作者", draft.answer_text)
        self.assertIn("第九条", draft.answer_text)

    def test_detail_clause_answer_preserves_policy_title_and_detail_label(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="国奖第九条里对论文和著作怎么要求的？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet=(
                        "第九条 学术研究方面取得显著成绩，以第一作者发表论文或以第一、二作者"
                        "出版学术著作。"
                    ),
                    score=0.91,
                    chunk="national-paper-book",
                    detail_label="第九条",
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("第九条", draft.answer_text)
        self.assertIn("第一作者", draft.answer_text)
        self.assertIn("第一、二作者", draft.answer_text)

    def test_judgment_query_prefers_rank_exception_clause_over_unrelated_subconditions(
        self,
    ) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="成绩没前十还能评国奖吗？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet=(
                        "第九条 参评本科学生国家奖学金还须具备以下条件之一: "
                        "学习成绩优异,所评学年学习成绩排名与综合测评排名均位于前10%以内。"
                    ),
                    score=0.95,
                    chunk="national-top-ten",
                    detail_label="第九条",
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title=title,
                        snippet=(
                            "第九条 学习成绩排名或综合测评排名超出前10%,但均位于前30%,"
                            "且单科成绩不低于80分,平均成绩不低于85分,必须在某一方面表现特别优秀"
                            "且可提供相应证明材料。"
                        ),
                        score=0.94,
                        chunk="national-rank-exception",
                        detail_label="第九条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="exception_rule",
                        semantic_role="condition",
                        claim_type="eligibility_condition",
                        condition_subject="rank_threshold",
                        condition_group_subject="rank_threshold",
                        condition_group_id="handbook:national:article-9:rank_threshold",
                        condition_polarity="positive",
                        condition_subject_taxonomy_version="condition_subject.v1",
                        condition_subject_provenance="suite-fixture",
                        article_no="第九条",
                    ),
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet="在体育竞赛中取得显著成绩,为国家争得荣誉。",
                    score=0.93,
                    chunk="national-sports-subcondition",
                    detail_label="第九条",
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet="在学术研究上取得显著成绩,以第一作者发表的论文被SCI、EI全文收录。",
                    score=0.92,
                    chunk="national-paper-subcondition",
                    detail_label="第九条",
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("超出前10%", draft.answer_text)
        self.assertIn("位于前30%", draft.answer_text)
        self.assertNotIn("体育竞赛", draft.answer_text)
        self.assertNotIn("学术研究上取得显著成绩", draft.answer_text)

    def test_judgment_query_prefers_paper_clause_without_basic_condition_boilerplate(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="论文能不能算国奖条件？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title=title,
                        snippet=(
                            "在学术研究上取得显著成绩,以第一作者发表的论文被SCI、EI、ISTP、SSCI全文收录,"
                            "以第一、二作者出版学术专著(须通过专家鉴定)。"
                        ),
                        score=0.95,
                        chunk="national-paper-condition",
                        detail_label="第九条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="example_evidence",
                        semantic_role="condition",
                        claim_type="eligibility_condition",
                        condition_subject="paper_or_publication",
                        condition_group_subject="paper_or_publication",
                        condition_group_id="handbook:national:article-9:paper_or_publication",
                        condition_polarity="positive",
                        condition_subject_taxonomy_version="condition_subject.v1",
                        condition_subject_provenance="suite-fixture",
                        article_no="第九条",
                    ),
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet="参评本科学生国家奖学金还须具备以下条件之一。",
                    score=0.94,
                    chunk="national-eligibility-intro",
                    detail_label="第九条",
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet="参评本科学生国家奖学金须具备以下基本条件。",
                    score=0.93,
                    chunk="national-basic-condition-intro",
                    detail_label="第八条",
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("发表的论文", draft.answer_text)
        self.assertNotIn("还须具备以下条件之一", draft.answer_text)
        self.assertNotIn("须具备以下基本条件", draft.answer_text)

    def test_judgment_query_trims_rank_exception_clause_before_following_examples(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="成绩没前十还能评国奖吗？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title=title,
                        snippet=(
                            "第九条 参评本科学生国家奖学金还须具备以下条件之一:\n"
                            "(二)学习成绩排名或综合测评排名超出前10%,但均位于前30%,且单科成绩不低于80分,"
                            "平均成绩不低于85分,必须在道德风尚、学术研究、学科竞赛、创新发明、社会实践、"
                            "社会工作、体育竞赛、文艺比赛等某一方面表现特别优秀且可提供相应的证明材料。"
                            "具体表现如下:\n"
                            "1. 在社会主义精神文明建设中表现突出。\n"
                            "2. 在学术研究上取得显著成绩,以第一作者发表的论文被SCI、EI全文收录。\n"
                            "5. 在体育竞赛中取得显著成绩,为国家争得荣誉。"
                        ),
                        score=0.95,
                        chunk="national-rank-exception-tail",
                        detail_label="第九条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="exception_rule",
                        semantic_role="condition",
                        claim_type="eligibility_condition",
                        condition_subject="rank_threshold",
                        condition_group_subject="rank_threshold",
                        condition_group_id="handbook:national:article-9:rank_threshold",
                        condition_polarity="positive",
                        condition_subject_taxonomy_version="condition_subject.v1",
                        condition_subject_provenance="suite-fixture",
                        article_no="第九条",
                    ),
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("超出前10%", draft.answer_text)
        self.assertIn("位于前30%", draft.answer_text)
        self.assertNotIn("具体表现如下", draft.answer_text)
        self.assertNotIn("体育竞赛", draft.answer_text)
        self.assertNotIn("发表的论文", draft.answer_text)

    def test_curriculum_title_lookup_preserves_course_teaching_plan_title(self) -> None:
        title = "中央民族大学通识课程“大学英语”课程教学计划"
        evidence = EvidenceBundle(
            query_text="中央民族大学通识课程大学英语课程教学计划",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0002",
                    source_title=title,
                    snippet=(
                        "各级别大学英语课程在1-4学期课程安排如下\n"
                        "普通级-3 | 大学英语(一) | 大学英语(二) | “X”高阶类课程"
                    ),
                    score=0.93,
                    is_answer_bearing=True,
                    structural_path=(title,),
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("课程教学计划", draft.answer_text)
        self.assertIn("大学英语", draft.answer_text)

    def test_curriculum_table_answer_preserves_relevant_section_label(self) -> None:
        title = "经济学拔尖人才创新班人才培养方案"
        evidence = EvidenceBundle(
            query_text="经济学拔尖人才创新班人才培养方案课程设置怎么安排？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0012",
                    source_title=title,
                    snippet=(
                        "五、课程设置和修读建议\n"
                        "1034030159 | 经济学经典原著选读 | 2 | 36 | 6 | 3\n"
                        "1034030090 | 中级微观经济学 | 3 | 54 | 9 | 2"
                    ),
                    score=0.94,
                    structural_path=(title, "五、课程设置和修读建议"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("课程设置", draft.answer_text)
        self.assertIn("经济学经典原著选读", draft.answer_text)

    def test_program_semester_fact_answer_preserves_program_title(self) -> None:
        title = "法学（民族实验班）本科人才培养方案"
        evidence = EvidenceBundle(
            query_text="法学民族班培养方案里大二下有什么课",
            corpus="curriculum",
            collection="program_semester_facts",
            sources=(
                _make_program_semester_source(
                    source_document_id=f"curriculum:{title}",
                    semester_label="第四学期",
                    snippet="第四学期课程：刑事诉讼法、民事诉讼法、经济法。",
                    score=0.95,
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("第四学期", draft.answer_text)
        self.assertIn("刑事诉讼法", draft.answer_text)

    def test_curriculum_title_lookup_uses_answer_bearing_content_not_found_copy(self) -> None:
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
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertNotIn("已找到", draft.answer_text)
        self.assertIn("培养目标", draft.answer_text)
        self.assertNotIn("0304-1-05-04", draft.answer_text)


if __name__ == "__main__":
    unittest.main()
