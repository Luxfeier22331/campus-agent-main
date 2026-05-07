from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import EvidenceBundle
from campus_rag_agent.agent import RagAgent
from campus_rag_agent.agent_answer_shape import AnswerShape
from campus_rag_agent.typed_answer_drafts import (
    TypedAnswerDraft,
    validate_typed_answer_draft,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.agent.rag_agent_test_support import _make_handbook_source


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    payload = {
        "evidence_contract_version": "answer_ready_evidence.v3",
        "parent_unit_id": "handbook:unit:article-1",
        **metadata,
    }
    return {INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: payload}


class RagAgentTypedAnswerDraftTest(unittest.TestCase):
    def test_category_discovery_answer_has_validated_policy_list_draft(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:national-scholarship",
            title="中央民族大学本科学生国家奖学金评审办法",
            snippet="国家奖学金用于奖励特别优秀的全日制本科学生。",
            score=0.83,
            chunk_id_suffix="national-overview",
            content_role="definition",
            is_answer_bearing=True,
        )
        source = replace(source, anchor=_answer_ready_anchor(answer_role="category_overview"))

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="本科生有哪些奖学金能申请？",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            answer_shape=AnswerShape.CATEGORY_DISCOVERY_LIST,
            category_display_name="奖学金",
            audience="本科生",
        )

        self.assertEqual(draft.typed_draft.kind, "policy_list")
        self.assertEqual(len(draft.typed_draft.items), 1)
        self.assertEqual(draft.typed_draft.items[0].source_id, source.doc_id)
        self.assertEqual(draft.typed_draft.items[0].chunk_id, source.chunk_id)
        self.assertIn("国家奖学金", draft.typed_draft.items[0].text)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")
        self.assertIn("以当年通知/学院细则为准", draft.answer_text)

    def test_procedure_answer_has_validated_procedure_steps_draft(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:demerit-relief",
            title="中央民族大学解除学生纪律处分实施办法",
            snippet="学生受处分满考察期后，可以提交解除处分申请表，经学院审核后报学生处。",
            score=0.82,
            chunk_id_suffix="discipline-procedure",
            content_role="procedure",
            is_answer_bearing=True,
            semantic_role="procedure_step",
            polarity="positive",
            action_type="lift_discipline",
            claim_type="procedure",
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
                procedure_materials=("解除处分申请表",),
                procedure_next_actor="college",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="处分怎么消",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            )
        )

        self.assertEqual(draft.typed_draft.kind, "procedure_steps")
        self.assertEqual(draft.typed_draft.steps[0].source_id, source.doc_id)
        self.assertEqual(draft.typed_draft.steps[0].chunk_id, source.chunk_id)
        self.assertEqual(draft.typed_draft.steps[0].step_index, 1)
        self.assertIn("解除处分申请表", draft.typed_draft.steps[0].excerpt)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_judgment_answer_has_validated_eligibility_judgment_draft(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:national-scholarship",
            title="中央民族大学本科学生国家奖学金评审办法",
            snippet="学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
            score=0.81,
            chunk_id_suffix="rank-threshold",
            content_role="eligibility",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                condition_subject="rank_threshold",
                condition_group_id="handbook:unit:article-1:rank_threshold",
                condition_polarity="positive",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="成绩没前十还能评国奖吗",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            answer_shape=AnswerShape.JUDGMENT_CLAUSE,
        )

        self.assertEqual(draft.typed_draft.kind, "eligibility_judgment")
        self.assertEqual(draft.typed_draft.judgment.condition_subject, "rank_threshold")
        self.assertEqual(draft.typed_draft.judgment.source_id, source.doc_id)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_condition_table_answer_requires_supported_rows(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:demerit-relief",
            title="中央民族大学解除学生纪律处分实施办法",
            snippet="有下列情形之一的，不予解除处分。",
            score=0.81,
            chunk_id_suffix="discipline-exclusion",
            content_role="requirement",
            is_answer_bearing=True,
            semantic_role="exclusion_rule",
            polarity="negative",
            action_type="lift_discipline",
            claim_type="cannot_do",
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="exclusion_rule",
                condition_subject="discipline_relief_condition",
                condition_group_id="handbook:unit:article-1:discipline_relief_condition",
                condition_polarity="negative",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="哪些情况不能解除处分",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            answer_shape=AnswerShape.CONDITION_OVERVIEW,
        )

        self.assertEqual(draft.typed_draft.kind, "condition_table")
        self.assertEqual(draft.typed_draft.rows[0].polarity, "negative")
        self.assertEqual(draft.typed_draft.rows[0].source_id, source.doc_id)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_typed_draft_validation_rejects_missing_support(self) -> None:
        draft = TypedAnswerDraft(kind="policy_list")

        result = validate_typed_answer_draft(draft)

        self.assertEqual(result.verdict, "invalid")
        self.assertEqual(result.failure_reason, "policy_list_item_support_missing")


if __name__ == "__main__":
    unittest.main()
