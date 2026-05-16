from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import EvidenceBundle
from campus_rag_agent.agent import RagAgent, _select_answer_support_rows
from campus_rag_agent.agent_answer_shape import AnswerShape
from campus_rag_agent.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.agent.rag_agent_test_support import _make_handbook_source


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    return {
        INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
            "evidence_contract_version": "answer_ready_evidence.v3",
            "parent_unit_id": "handbook:student-card:article-1",
            **metadata,
        }
    }


def _student_card_procedure_intent() -> RetrievalIntent:
    return RetrievalIntent(
        kind="procedure_steps",
        normalized_query="学生证丢了怎么办",
        expected=RetrievalIntentExpectation(
            answer_kind="procedure_steps",
            evidence_roles=(
                "procedure_step",
                "material_requirement",
                "time_constraint",
                "eligibility_condition",
                "exclusion_rule",
            ),
            coverage_policy="procedure_step_completeness",
            selection_policy="answer_role_first",
        ),
        target=RetrievalIntentTarget(
            corpus="regulations",
            collection="student_rules",
            document_ids=("handbook:student-card",),
            condition_subject="student_card_or_identity_credential",
        ),
    )


class RagAgentProcedureSelectionTest(unittest.TestCase):
    def test_procedure_intent_rejects_category_overview_support_rows(self) -> None:
        procedure_source = _make_handbook_source(
            doc_id="handbook:student-card",
            title="中央民族大学本科(预科)学生证管理办法",
            snippet="学生证遗失后，应及时申请补办并提交书面申请。",
            score=0.91,
            chunk_id_suffix="student-card-reissue-step",
            content_role="procedure",
            is_answer_bearing=True,
            semantic_role="procedure_step",
            polarity="positive",
            action_type="reissue",
            claim_type="procedure",
        )
        procedure_source = replace(
            procedure_source,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
            ),
        )
        category_overview_source = _make_handbook_source(
            doc_id="handbook:student-card-category",
            title="中央民族大学本科生学生证相关制度",
            snippet=(
                "本科生学籍相关制度包括：《中央民族大学本科(预科)学生证管理办法》、"
                "《中央民族大学全日制本科学生学士学位授予规定》。"
            ),
            score=0.89,
            chunk_id_suffix="student-card-category-overview",
            content_role="policy_list",
            is_answer_bearing=True,
            semantic_role="category_overview",
        )
        category_overview_source = replace(
            category_overview_source,
            anchor=_answer_ready_anchor(
                answer_role="category_overview",
                category_id="student_status",
                category_audience="本科生",
                category_member_document_ids=("handbook:student-card",),
                category_member_titles=("中央民族大学本科(预科)学生证管理办法",),
            ),
        )

        rows = _select_answer_support_rows(
            query_text="学生证丢了怎么补办",
            sources=(category_overview_source, procedure_source),
            max_sources=3,
            answer_shape=AnswerShape.DETAIL_CLAUSE,
            retrieval_intent=RetrievalIntent(
                kind="procedure_steps",
                normalized_query="学生证丢了怎么补办",
                expected=RetrievalIntentExpectation(
                    answer_kind="procedure_steps",
                    evidence_roles=("procedure_step", "procedure"),
                ),
                target=RetrievalIntentTarget(
                    corpus="regulations",
                    collection="student_rules",
                    document_ids=("handbook:student-card",),
                    condition_subject="application_procedure",
                ),
            ),
        )

        self.assertEqual(tuple(source.doc_id for source, _ in rows), ("handbook:student-card",))

    def test_procedure_answer_uses_adjacent_material_time_and_report_loss_rows(self) -> None:
        answer = RagAgent().build_answer(
            EvidenceBundle(
                query_text=("中央民族大学本科(预科)学生证管理办法 学生证 挂失 补办 流程 步骤"),
                corpus="regulations",
                collection="student_rules",
                sources=(
                    _student_card_source(
                        chunk_id_suffix="student-card-reissue-step",
                        snippet=(
                            "中央民族大学本科(预科)学生证管理办法 文号：民大学发[2013]8号 "
                            "七、学生遗失学生证应及时申请补办。遗失或损坏的学生证，原则上"
                            "可以申请补办一次。"
                        ),
                        answer_role="procedure_step",
                        condition_subject="application_procedure",
                        procedure_step_index=7,
                        procedure_actor="student",
                        procedure_action="reissue",
                    ),
                    _student_card_source(
                        chunk_id_suffix="student-card-category-overview",
                        snippet="本科生学生证事务相关制度包括：《中央民族大学本科(预科)学生证管理办法》。",
                        answer_role="category_overview",
                        condition_subject="audience_scope",
                        content_role="policy_list",
                        semantic_role="category_overview",
                    ),
                    _student_card_source(
                        chunk_id_suffix="student-card-status-category-overview",
                        snippet=(
                            "本科生学籍相关制度包括：《中央民族大学本科(预科)学生证管理办法》、"
                            "《中央民族大学全日制本科学生学士学位授予规定》。"
                        ),
                        answer_role="category_overview",
                        condition_subject="audience_scope",
                        content_role="policy_list",
                        semantic_role="category_overview",
                    ),
                    _student_card_source(
                        chunk_id_suffix="student-card-application-materials",
                        snippet=(
                            "中央民族大学本科(预科)学生证管理办法 文号：民大学发[2013]8号 "
                            "八、学生补办学生证，必须提出书面申请，并填写"
                            "《中央民族大学补办学生证申请表》。申请表经学院(系)领导审批后，"
                            "到学生处办理补办手续。学生证集中补办时间为每周四下午。"
                        ),
                        answer_role="time_constraint",
                        condition_subject="deadline",
                        procedure_step_index=8,
                        procedure_actor="student",
                        procedure_action="reissue",
                    ),
                    _student_card_source(
                        chunk_id_suffix="student-card-registration",
                        snippet=(
                            "中央民族大学本科(预科)学生证管理办法 文号：民大学发[2013]8号 "
                            "五、新学期开学时，学生应在规定的时间内持学生证到所在学院"
                            "(系)办理注册手续。未按期办理注册手续的，按照《中央民族大学"
                            "本科学生学籍管理规定》处理。"
                        ),
                        answer_role="time_constraint",
                        condition_subject="deadline",
                    ),
                    _student_card_source(
                        chunk_id_suffix="student-card-report-loss",
                        snippet=(
                            "中央民族大学本科(预科)学生证管理办法 文号：民大学发[2013]8号 "
                            "六、学生如将学生证遗失或损坏，应及时到学院(系)挂失，写明遗失"
                            "或损坏的原因、时间、地点等，并报学生处备案。"
                        ),
                        answer_role="time_constraint",
                        condition_subject="deadline",
                        procedure_step_index=6,
                        procedure_actor="student",
                        procedure_action="report_loss",
                    ),
                ),
            ),
            query_text="学生证丢了怎么办",
            retrieval_intent=_student_card_procedure_intent(),
        )

        self.assertIn("挂失", answer.answer_text)
        self.assertIn("书面申请", answer.answer_text)
        self.assertIn("补办学生证申请表", answer.answer_text)
        self.assertIn("学院(系)领导审批", answer.answer_text)
        self.assertIn("学生处办理补办手续", answer.answer_text)
        self.assertIn("每周四下午", answer.answer_text)
        self.assertNotIn("文号：", answer.answer_text)
        self.assertNotIn("注册手续", answer.answer_text)
        self.assertNotIn("未按期办理注册手续", answer.answer_text)
        self.assertLess(answer.answer_text.index("挂失"), answer.answer_text.index("书面申请"))
        self.assertLess(
            answer.answer_text.index("挂失"), answer.answer_text.index("学生处办理补办手续")
        )
        self.assertLess(
            answer.answer_text.index("书面申请"), answer.answer_text.index("每周四下午")
        )
        self.assertEqual(
            tuple(source.chunk_id.rsplit(":", 1)[-1] for source in answer.supporting_sources),
            (
                "student-card-report-loss",
                "student-card-reissue-step",
                "student-card-application-materials",
            ),
        )


def _student_card_source(
    *,
    chunk_id_suffix: str,
    snippet: str,
    answer_role: str,
    condition_subject: str,
    content_role: str = "procedure",
    semantic_role: str = "",
    doc_id: str = "handbook:student-card",
    procedure_step_index: int | None = None,
    procedure_actor: str = "",
    procedure_action: str = "",
):
    metadata: dict[str, object] = {
        "answer_role": answer_role,
        "condition_subject": condition_subject,
        "condition_group_subject": condition_subject,
        "condition_polarity": "positive",
    }
    if procedure_step_index is not None:
        metadata.update(
            {
                "procedure_step_index": procedure_step_index,
                "procedure_actor": procedure_actor,
                "procedure_action": procedure_action,
            }
        )
    return replace(
        _make_handbook_source(
            doc_id=doc_id,
            title=(
                "中央民族大学本科(预科)学生证管理办法"
                if doc_id == "handbook:student-card"
                else "本科生学生证事务相关制度"
            ),
            snippet=snippet,
            score=0.91,
            chunk_id_suffix=chunk_id_suffix,
            content_role=content_role,
            is_answer_bearing=True,
            semantic_role=semantic_role or answer_role,
        ),
        anchor=_answer_ready_anchor(**metadata),
    )


if __name__ == "__main__":
    unittest.main()
