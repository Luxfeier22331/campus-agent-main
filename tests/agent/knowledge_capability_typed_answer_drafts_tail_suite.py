from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import EvidenceBundle
from campus_knowledge_capability.answer_runtime import KnowledgeCapability
from campus_knowledge_capability.answer_shape import AnswerShape
from campus_knowledge_capability.typed_answer_drafts import (
    TypedAnswerDraft,
    validate_typed_answer_draft,
)

from tests.agent.knowledge_capability_test_support import _make_handbook_source
from tests.agent.knowledge_capability_typed_answer_drafts_support import (
    _answer_ready_anchor,
    _retrieval_intent,
)


class KnowledgeCapabilityTypedAnswerDraftTailTest(unittest.TestCase):
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

        draft = KnowledgeCapability().build_answer(
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

    def test_condition_table_projects_condition_subject_from_intent_for_focused_supporting_detail(
        self,
    ) -> None:
        source = _make_handbook_source(
            doc_id="handbook:discipline",
            title="中央民族大学学生违纪处分实施办法",
            snippet=(
                "第三十三条 违反学校考勤管理规定，无故旷课者，视情节给予如下处分："
                "一学期累计旷课16节以下者，给予学院通报批评处分。"
            ),
            score=0.91,
            chunk_id_suffix="attendance-threshold-supporting-detail",
            detail_label="第三十三条",
            content_role="article_body",
            is_answer_bearing=True,
            semantic_role="supporting_detail",
            polarity="neutral",
            claim_type="policy_clause",
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="supporting_detail",
                article_no="第三十三条",
                condition_polarity="neutral",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="旷课多少学时会按违纪处理",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            retrieval_intent=_retrieval_intent(
                kind="condition_table",
                answer_kind="condition_table",
                collection="student_rules",
                document_ids=("handbook:discipline",),
                condition_subject="attendance_absence_threshold",
                evidence_roles=("eligibility_condition", "table_fact", "supporting_detail"),
            ),
        )

        self.assertEqual(draft.typed_draft.kind, "condition_table")
        self.assertEqual(
            draft.typed_draft.rows[0].condition_subject,
            "attendance_absence_threshold",
        )
        self.assertEqual(draft.typed_draft.rows[0].polarity, "neutral")
        self.assertEqual(draft.typed_draft.rows[0].answer_role, "supporting_detail")
        self.assertIn("16节", draft.typed_draft.rows[0].condition_text)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_supporting_detail_clause_validates_without_condition_subject(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:three-assists",
            title="中央民族大学研究生“三助”工作管理办法",
            snippet=(
                "第三条 研究生担任助教、助研、助管工作是研究生培养的重要环节，应当依据本办法管理。"
            ),
            score=0.91,
            chunk_id_suffix="three-assists-supporting-detail",
            content_role="article_body",
            is_answer_bearing=True,
            semantic_role="supporting_detail",
            polarity="neutral",
            claim_type="policy_clause",
        )
        source = replace(
            source,
            collection="institutional_rules",
            anchor=_answer_ready_anchor(
                answer_role="supporting_detail",
                article_no="第三条",
                condition_polarity="neutral",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="研究生助教助研助管工作应该依据哪份管理办法？",
                corpus="regulations",
                collection="institutional_rules",
                sources=(source,),
            ),
            answer_shape=AnswerShape.DETAIL_CLAUSE,
        )

        self.assertEqual(draft.typed_draft.kind, "detail_clause")
        self.assertIn("中央民族大学研究生“三助”工作管理办法", draft.answer_text)
        self.assertEqual(draft.typed_draft.detail_clauses[0].article_no, "第三条")
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_specific_clause_intent_accepts_detail_clause_typed_draft(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:three-assists",
            title="中央民族大学研究生“三助”工作管理办法",
            snippet=(
                "第三条 研究生担任助教、助研、助管工作是研究生培养的重要环节，应当依据本办法管理。"
            ),
            score=0.91,
            chunk_id_suffix="three-assists-intent-detail-clause",
            content_role="article_body",
            is_answer_bearing=True,
            semantic_role="supporting_detail",
            polarity="neutral",
            claim_type="policy_clause",
        )
        source = replace(
            source,
            collection="institutional_rules",
            anchor=_answer_ready_anchor(
                answer_role="supporting_detail",
                article_no="第三条",
                condition_polarity="neutral",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="研究生助教助研助管工作应该依据哪份管理办法？",
                corpus="regulations",
                collection="institutional_rules",
                sources=(source,),
            ),
            retrieval_intent=_retrieval_intent(
                kind="specific_clause_lookup",
                answer_kind="specific_clause",
                collection="institutional_rules",
                document_ids=("handbook:three-assists",),
            ),
        )

        self.assertEqual(draft.typed_draft.kind, "detail_clause")
        self.assertIn("中央民族大学研究生“三助”工作管理办法", draft.answer_text)

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

        draft = KnowledgeCapability().build_answer(
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

        draft = KnowledgeCapability().build_answer(
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

    def test_procedure_intent_accepts_typed_application_deadline_step(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:appeal",
            title="中央民族大学学生申诉管理办法",
            snippet=(
                "学生对学校的处理或者处分决定有异议的,可以在接到学校处理或者处分"
                "决定书之日起10日内,向学校学生申诉处理委员会提出书面申诉。"
            ),
            score=0.91,
            chunk_id_suffix="appeal-written-deadline",
            content_role="deadline",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                semantic_role="time_constraint",
                claim_type="time_constraint",
                condition_subject="deadline",
                condition_group_subject="deadline",
                condition_group_id="handbook:appeal:article-7:deadline",
                condition_polarity="positive",
                procedure_step_index=7,
                procedure_actor="student",
                procedure_action="appeal",
                procedure_action_taxonomy_version="procedure_action.v1",
                procedure_action_provenance="keyword:申诉",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="学生对处分决定不服应该按什么程序申诉",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            retrieval_intent=_retrieval_intent(
                kind="procedure_steps",
                answer_kind="procedure_steps",
                collection="student_rules",
                document_ids=("handbook:appeal",),
                condition_subject="application_procedure",
            ),
        )

        result = validate_typed_answer_draft(
            draft.typed_draft,
            expected_answer_kind="procedure_steps",
        )

        self.assertEqual(draft.typed_draft.kind, "procedure_steps")
        self.assertEqual(result.verdict, "valid")
        self.assertEqual(result.claim_supports[0].claim_type, "procedure_step")
        self.assertIn("如对处分决定不服", draft.answer_text)
        self.assertIn("10日内", draft.answer_text)
        self.assertIn("书面申诉", draft.answer_text)

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

        draft = KnowledgeCapability().build_answer(
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

        draft = KnowledgeCapability().build_answer(
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

        draft = KnowledgeCapability().build_answer(
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

        draft = KnowledgeCapability().build_answer(
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
