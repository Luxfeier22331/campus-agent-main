from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import EvidenceBundle
from campus_rag_agent.agent import RagAgent
from campus_rag_agent.agent_answer_shape import AnswerShape
from campus_rag_agent.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
)
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
    def test_regulation_answer_shape_projects_from_retrieval_intent(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:appeal",
            title="中央民族大学学生申诉处理办法",
            snippet="学生应当在收到处理决定之日起10日内提出申诉。",
            score=0.91,
            chunk_id_suffix="appeal-deadline-intent-shape",
            content_role="deadline",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_polarity="positive",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="中央民族大学学生申诉处理办法",
                corpus="regulations",
                collection="institutional_rules",
                sources=(source,),
            ),
            retrieval_intent=_retrieval_intent(
                kind="condition_table",
                answer_kind="condition_table",
                collection="institutional_rules",
                document_ids=("handbook:appeal",),
                condition_subject="deadline",
            ),
        )

        self.assertEqual(draft.typed_draft.kind, "condition_table")
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_retrieval_intent_drives_regulation_selection_without_query_cues(self) -> None:
        generic_source = _make_handbook_source(
            doc_id="handbook:appeal",
            title="中央民族大学学生申诉处理办法",
            snippet="学生申诉应当符合规定条件，并按程序办理。",
            score=0.94,
            chunk_id_suffix="appeal-generic-condition",
            content_role="requirement",
            is_answer_bearing=True,
        )
        generic_source = replace(
            generic_source,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
                condition_polarity="positive",
            ),
        )
        deadline_source = _make_handbook_source(
            doc_id="handbook:appeal",
            title="中央民族大学学生申诉处理办法",
            snippet="学生应当在收到处理决定之日起10日内提出申诉。",
            score=0.88,
            chunk_id_suffix="appeal-deadline-driven-by-intent",
            content_role="deadline",
            is_answer_bearing=True,
        )
        deadline_source = replace(
            deadline_source,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_polarity="positive",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="中央民族大学学生申诉处理办法",
                corpus="regulations",
                collection="institutional_rules",
                sources=(generic_source, deadline_source),
            ),
            retrieval_intent=_retrieval_intent(
                kind="condition_table",
                answer_kind="condition_table",
                collection="institutional_rules",
                document_ids=("handbook:appeal",),
                condition_subject="deadline",
            ),
        )

        self.assertIn("10日内", draft.answer_text)
        self.assertEqual(draft.typed_draft.kind, "condition_table")
        self.assertEqual(draft.typed_draft.rows[0].condition_subject, "deadline")
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_typed_draft_validation_rejects_answer_kind_mismatch_against_retrieval_intent(
        self,
    ) -> None:
        source = _make_handbook_source(
            doc_id="handbook:demerit-relief",
            title="中央民族大学解除学生纪律处分实施办法",
            snippet="学生受处分满考察期后，可以提交解除处分申请表，经学院审核后报学生处。",
            score=0.82,
            chunk_id_suffix="discipline-procedure-intent-mismatch",
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
                condition_subject="application_procedure",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
                procedure_materials=("解除处分申请表",),
                procedure_next_actor="college",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="中央民族大学解除学生纪律处分实施办法",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            answer_shape=AnswerShape.DETAIL_CLAUSE,
        )

        result = validate_typed_answer_draft(
            draft.typed_draft,
            expected_answer_kind="condition_table",
        )

        self.assertEqual(draft.typed_draft.kind, "procedure_steps")
        self.assertEqual(result.verdict, "invalid")
        self.assertEqual(result.failure_reason, "typed_answer_kind_mismatch")

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
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="category_overview",
                category_id="scholarship",
                category_audience="本科生",
                category_member_document_ids=("handbook:national-scholarship",),
                category_member_titles=("中央民族大学本科学生国家奖学金评审办法",),
            ),
        )

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

    def test_category_discovery_policy_list_can_be_completed_from_registry_backed_member_document(
        self,
    ) -> None:
        source = _make_handbook_source(
            doc_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
            title="中央民族大学本科学生国家奖学金评审办法",
            snippet="国家奖学金用于奖励特别优秀的全日制本科学生。",
            score=0.83,
            chunk_id_suffix="national-overview-registry-fallback",
            content_role="definition",
            is_answer_bearing=True,
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="本科生有哪些奖学金能申请？",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            answer_shape=AnswerShape.CATEGORY_DISCOVERY_LIST,
            category_id="scholarship",
            category_display_name="奖学金",
            audience="本科生",
        )

        self.assertEqual(draft.typed_draft.kind, "policy_list")
        self.assertEqual(len(draft.typed_draft.items), 1)
        self.assertEqual(draft.typed_draft.items[0].category_id, "scholarship")
        self.assertEqual(draft.typed_draft.items[0].audience, "本科生")
        self.assertIn(source.doc_id, draft.typed_draft.items[0].member_document_ids)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")
        self.assertIn("《中央民族大学本科学生国家奖学金评审办法》", draft.answer_text)

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
                condition_subject="application_procedure",
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

    def test_table_fact_draft_emits_table_fact_claim_support(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:professional-scholarship",
            title="中央民族大学本科学生专业奖学金评定办法",
            snippet="一等奖 | 3000元 | 10人",
            score=0.91,
            chunk_id_suffix="professional-scholarship-table-fact",
            content_role="table_fact",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="table_fact",
                condition_subject="amount_or_quota",
                condition_polarity="positive",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="专业奖学金一等奖金额是多少？",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            )
        )

        result = validate_typed_answer_draft(draft.typed_draft)

        self.assertEqual(result.verdict, "valid")
        self.assertEqual(result.claim_supports[0].claim_type, "table_fact")

    def test_time_constraint_draft_emits_time_constraint_claim_support(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:appeal",
            title="中央民族大学学生申诉处理办法",
            snippet="学生应当在收到处理决定之日起10日内提出申诉。",
            score=0.91,
            chunk_id_suffix="appeal-deadline",
            content_role="deadline",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_polarity="positive",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="申诉有时间限制吗",
                corpus="regulations",
                collection="institutional_rules",
                sources=(source,),
            )
        )

        result = validate_typed_answer_draft(draft.typed_draft)

        self.assertEqual(result.verdict, "valid")
        self.assertEqual(result.claim_supports[0].claim_type, "time_constraint")

    def test_material_requirement_draft_emits_material_requirement_claim_support(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:appeal",
            title="中央民族大学学生申诉处理办法",
            snippet="申诉申请应当提交书面申请和相关证明材料。",
            score=0.91,
            chunk_id_suffix="appeal-materials",
            content_role="requirement",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="material_requirement",
                condition_subject="material_requirement",
                condition_polarity="positive",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="申请复核要交什么材料",
                corpus="regulations",
                collection="institutional_rules",
                sources=(source,),
            )
        )

        result = validate_typed_answer_draft(draft.typed_draft)

        self.assertEqual(result.verdict, "valid")
        self.assertEqual(result.claim_supports[0].claim_type, "material_requirement")

    def test_typed_draft_validation_rejects_missing_support(self) -> None:
        draft = TypedAnswerDraft(kind="policy_list")

        result = validate_typed_answer_draft(draft)

        self.assertEqual(result.verdict, "invalid")
        self.assertEqual(result.failure_reason, "policy_list_item_support_missing")

    def test_typed_draft_validation_rejects_procedure_step_without_typed_fields(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:demerit-relief",
            title="中央民族大学解除学生纪律处分实施办法",
            snippet="学生提交解除处分申请表，经学院审核后报学生处。",
            score=0.82,
            chunk_id_suffix="discipline-procedure-missing-fields",
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
                condition_subject="application_procedure",
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
        result = validate_typed_answer_draft(draft.typed_draft)
        self.assertEqual(result.verdict, "invalid")
        self.assertEqual(result.failure_reason, "procedure_step_contract_missing")

    def test_typed_draft_validation_rejects_judgment_without_condition_metadata(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:national-scholarship",
            title="中央民族大学本科学生国家奖学金评审办法",
            snippet="学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
            score=0.81,
            chunk_id_suffix="rank-threshold-missing-subject",
            content_role="eligibility",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
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
        result = validate_typed_answer_draft(draft.typed_draft)
        self.assertEqual(result.verdict, "invalid")
        self.assertEqual(result.failure_reason, "eligibility_judgment_contract_missing")

    def test_typed_draft_validation_rejects_condition_table_without_subject_or_text(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:demerit-relief",
            title="中央民族大学解除学生纪律处分实施办法",
            snippet="有下列情形之一的，不予解除处分。",
            score=0.81,
            chunk_id_suffix="discipline-exclusion-missing-subject",
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
        result = validate_typed_answer_draft(draft.typed_draft)
        self.assertEqual(result.verdict, "invalid")
        self.assertEqual(result.failure_reason, "condition_row_contract_missing")


if __name__ == "__main__":
    unittest.main()


def _retrieval_intent(
    *,
    kind: str,
    answer_kind: str,
    collection: str = "student_rules",
    document_ids: tuple[str, ...] = (),
    condition_subject: str = "",
) -> RetrievalIntent:
    return RetrievalIntent(
        kind=kind,
        normalized_query="测试 query",
        expected=RetrievalIntentExpectation(answer_kind=answer_kind),
        target=RetrievalIntentTarget(
            corpus="regulations",
            collection=collection,
            document_ids=document_ids,
            condition_subject=condition_subject,
        ),
    )
