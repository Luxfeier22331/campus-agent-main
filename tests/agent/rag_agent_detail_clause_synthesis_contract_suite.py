from __future__ import annotations

import unittest
from dataclasses import replace

from campus_rag_agent.query_planning import plan_student_handbook_query

from tests.agent.rag_agent_answer_quality_regression_suite_support import (
    EvidenceBundle,
    RagAgent,
    _answer_ready_anchor,
    _make_handbook_source,
    _make_policy_source,
)


class RagAgentDetailClauseSynthesisContractTest(unittest.TestCase):
    def test_detail_clause_answer_uses_source_clause_without_derived_subheadings(
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

        draft = RagAgent().build_answer(evidence)

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

    def test_procedure_answer_renders_typed_steps_without_inferred_sequence_words(
        self,
    ) -> None:
        title = "中央民族大学全日制本科学生学士学位授予规定"
        doc_id = "handbook:742d4831bfb443b99323041e263fac2fd9aafcf6"
        evidence = EvidenceBundle(
            query_text="毕业前申请学位的流程是什么",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _procedure_source(
                    doc_id=doc_id,
                    title=title,
                    chunk="degree-step-1",
                    detail_label="1.",
                    snippet="1.学生本人提出申请,填报学士学位申请表",
                    step_index=1,
                ),
                _procedure_source(
                    doc_id=doc_id,
                    title=title,
                    chunk="degree-step-2",
                    detail_label="2.",
                    snippet=(
                        "2. 院(系)学位委员会对提出申请授予学士学位的学生进行审核,"
                        "提出建议授予学士学位名单和不授予学士学位名单。"
                    ),
                    step_index=2,
                ),
                _procedure_source(
                    doc_id=doc_id,
                    title=title,
                    chunk="degree-step-3",
                    detail_label="3.",
                    snippet=(
                        "3. 教务处审核全部学生材料并负责向校学位委员会提出召开"
                        "学士学位评定委员会会议。"
                    ),
                    step_index=3,
                ),
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            retrieval_intent=plan_student_handbook_query(evidence.query_text).retrieval_intent,
        )

        self.assertIn("1. 学生本人提出申请,填报学士学位申请表", draft.answer_text)
        self.assertIn("毕业前申请学位流程：", draft.answer_text)
        self.assertIn("2. 院(系)学位委员会对提出申请授予学士学位的学生进行审核", draft.answer_text)
        self.assertIn("3. 教务处审核全部学生材料", draft.answer_text)
        self.assertNotIn("先学生本人提出申请", draft.answer_text)
        self.assertNotIn("再填报学士学位申请表", draft.answer_text)


def _procedure_source(
    *,
    doc_id: str,
    title: str,
    chunk: str,
    detail_label: str,
    snippet: str,
    step_index: int,
):
    return _make_handbook_source(
        doc_id=doc_id,
        title=title,
        snippet=snippet,
        score=0.96 - (step_index * 0.01),
        chunk_id_suffix=chunk,
        detail_label=detail_label,
        content_role="procedure",
        is_answer_bearing=True,
        semantic_role="procedure_step",
        polarity="positive",
        action_type="application",
        claim_type="procedure",
        anchor=_answer_ready_anchor(
            answer_role="procedure_step",
            semantic_role="procedure_step",
            claim_type="procedure",
            condition_subject="application_procedure",
            procedure_step_index=step_index,
            procedure_actor="student" if step_index == 1 else "school",
            procedure_action="submit_materials" if step_index == 1 else "review",
        ),
    )


if __name__ == "__main__":
    unittest.main()
