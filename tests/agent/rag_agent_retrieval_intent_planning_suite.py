from __future__ import annotations

import unittest

from campus_contracts import AgentRequest, KnowledgeScope, RagRequestPayload
from campus_rag_agent.curriculum_query_planning import (
    plan_curriculum_course_query,
    plan_curriculum_query,
)
from campus_rag_agent.institutional_rules_query_planning import (
    plan_institutional_rules_query,
)
from campus_rag_agent.query_planning import plan_student_handbook_query
from campus_rag_agent.retrieval_intent import (
    retrieval_intent_for_official_web_stable_reference,
)
from campus_rag_agent.service_pipeline import build_rag_pipeline_context


class RagAgentRetrievalIntentPlanningTest(unittest.TestCase):
    def test_handbook_category_discovery_exposes_policy_list_intent(self) -> None:
        plan = plan_student_handbook_query("有哪些本科生可以申请的奖学金")

        intent = plan.retrieval_intent

        self.assertEqual(intent.kind, "policy_list")
        self.assertEqual(intent.expected.answer_kind, "policy_list")
        self.assertEqual(intent.target.corpus, "regulations")
        self.assertEqual(intent.target.collection, "student_rules")
        self.assertEqual(intent.target.category_id, "scholarship")
        self.assertEqual(
            intent.target.category_member_document_ids, plan.category_member_document_ids
        )
        self.assertEqual(intent.expected.coverage_policy, "category_member_coverage")

    def test_handbook_specific_clause_and_judgment_intents_are_distinct(self) -> None:
        clause_plan = plan_student_handbook_query("国奖第九条怎么要求论文和著作？")
        judgment_plan = plan_student_handbook_query("成绩没前十还能评国奖吗？")

        self.assertEqual(clause_plan.retrieval_intent.kind, "specific_clause_lookup")
        self.assertEqual(clause_plan.retrieval_intent.expected.answer_kind, "specific_clause")
        self.assertEqual(clause_plan.retrieval_intent.target.article_nos, ("9",))
        self.assertEqual(clause_plan.retrieval_intent.target.focus_terms, ("论文", "著作"))

        self.assertEqual(judgment_plan.retrieval_intent.kind, "eligibility_judgment")
        self.assertEqual(
            judgment_plan.retrieval_intent.expected.answer_kind,
            "eligibility_judgment",
        )
        self.assertEqual(judgment_plan.retrieval_intent.target.focus_terms, ("前10", "前30"))

    def test_handbook_procedure_and_condition_intents_are_distinct(self) -> None:
        procedure_plan = plan_student_handbook_query("学生证丢了怎么办")
        condition_plan = plan_student_handbook_query("学位有什么要求")

        self.assertEqual(procedure_plan.retrieval_intent.kind, "procedure_steps")
        self.assertEqual(procedure_plan.retrieval_intent.expected.answer_kind, "procedure_steps")

        self.assertEqual(condition_plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(condition_plan.retrieval_intent.expected.answer_kind, "condition_table")

    def test_single_member_category_query_resolves_to_specific_policy_intent(self) -> None:
        plan = plan_student_handbook_query("公费医疗报销需要什么材料")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(plan.category_id, "public_medical")
        self.assertEqual(
            plan.resolved_policy_document_id,
            "handbook:b85de1cb327a26dc63488e247403ae3126d524be",
        )
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            ("handbook:b85de1cb327a26dc63488e247403ae3126d524be",),
        )
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "material_requirement",
        )

    def test_multi_member_category_specific_award_condition_query_fails_closed_as_clarification(
        self,
    ) -> None:
        plan = plan_student_handbook_query("奖学金申请条件是什么")

        self.assertEqual(plan.status, "needs_clarification")
        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(plan.category_id, "scholarship")
        self.assertEqual(plan.retrieval_intent.kind, "clarification_required")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "clarification")
        self.assertEqual(plan.retrieval_intent.clarification_reason, "category_policy_ambiguous")

    def test_multi_member_category_overview_condition_query_uses_condition_intent(self) -> None:
        plan = plan_student_handbook_query("申请奖学金需要满足什么条件")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(plan.category_id, "scholarship")
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.target.category_member_document_ids,
            plan.category_member_document_ids,
        )

    def test_attendance_absence_threshold_query_uses_condition_intent_without_clarification(
        self,
    ) -> None:
        plan = plan_student_handbook_query("旷课多少学时会按违纪处理")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(
            plan.target_document_ids,
            ("handbook:9350d885657d7409e524e73666b828b826f07191",),
        )
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            ("handbook:9350d885657d7409e524e73666b828b826f07191",),
        )
        self.assertIn("旷课", plan.retrieval_intent.critical_terms)

    def test_disciplinary_relief_how_long_query_uses_condition_intent_not_procedure(
        self,
    ) -> None:
        plan = plan_student_handbook_query("被处分后多久可以申请解除处分")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "discipline_relief_condition",
        )
        self.assertIn("考察期", plan.retrieval_intent.critical_terms)

    def test_curriculum_named_document_total_credit_query_uses_fact_lookup_intent(self) -> None:
        plan = plan_curriculum_query("民族学本科人才培养方案总学分要求是多少")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_fact_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "curriculum_fact")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            ("curriculum:民族学本科人才培养方案",),
        )

    def test_handbook_clarification_exposes_clarification_intent(self) -> None:
        plan = plan_student_handbook_query("奖学金怎么申请？")

        self.assertEqual(plan.retrieval_intent.kind, "clarification_required")
        self.assertEqual(plan.retrieval_intent.clarification_reason, "ambiguous_procedure")

    def test_institutional_public_service_plan_exposes_policy_list_intent(self) -> None:
        plan = plan_institutional_rules_query("校园网密码怎么改")

        self.assertEqual(plan.retrieval_intent.kind, "policy_list")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "policy_list")
        self.assertEqual(plan.retrieval_intent.target.corpus, "regulations")
        self.assertEqual(plan.retrieval_intent.target.collection, "institutional_rules")
        self.assertEqual(plan.retrieval_intent.target.category_id, "public_service")
        self.assertEqual(
            plan.retrieval_intent.target.category_member_document_ids,
            plan.target_document_ids,
        )

    def test_institutional_governance_plan_exposes_policy_object_intent(self) -> None:
        plan = plan_institutional_rules_query("学术委员会章程是什么")

        self.assertEqual(plan.retrieval_intent.kind, "policy_object_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "policy_object")
        self.assertEqual(plan.retrieval_intent.target.collection, "institutional_rules")
        self.assertEqual(plan.retrieval_intent.target.document_ids, plan.target_document_ids)
        self.assertEqual(plan.retrieval_intent.target.category_member_document_ids, ())

    def test_institutional_exact_released_title_uses_policy_object_intent_without_static_group(
        self,
    ) -> None:
        title = "中央民族大学丰台校区就医管理办法（暂行）"
        plan = plan_institutional_rules_query(title)

        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(plan.retrieval_intent.kind, "policy_object_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "policy_object")
        self.assertEqual(plan.retrieval_intent.target.collection, "institutional_rules")
        self.assertEqual(plan.retrieval_intent.target.document_ids, ())
        self.assertEqual(plan.retrieval_intent.target.document_titles, (title,))
        self.assertEqual(plan.retrieval_intent.target.category_member_document_ids, ())

    def test_institutional_public_service_deadline_query_exposes_typed_condition_intent(
        self,
    ) -> None:
        plan = plan_institutional_rules_query("二级网站安全问题要多久上报")

        self.assertEqual(plan.target_document_ids, ("official_web_regulation:ce565b348ca6ee31",))
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.target.collection, "institutional_rules")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            ("official_web_regulation:ce565b348ca6ee31",),
        )
        self.assertEqual(plan.retrieval_intent.target.condition_subject, "deadline")
        self.assertIn("time_constraint", plan.retrieval_intent.expected.evidence_roles)

    def test_explicit_institutional_rules_scope_uses_institutional_retrieval_intent(self) -> None:
        pipeline = build_rag_pipeline_context(
            AgentRequest(
                target="rag-agent",
                user_goal="二级网站安全问题要多久上报",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="institutional_rules")
                ),
            ),
            prompt_executor=None,
        )

        self.assertIsNotNone(pipeline.retrieval_intent)
        assert pipeline.retrieval_intent is not None
        self.assertEqual(pipeline.retrieval_intent.kind, "condition_table")
        self.assertEqual(pipeline.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            pipeline.retrieval_intent.target.document_ids,
            ("official_web_regulation:ce565b348ca6ee31",),
        )
        self.assertEqual(pipeline.retrieval_intent.target.condition_subject, "deadline")

    def test_curriculum_plan_exposes_curriculum_fact_intent(self) -> None:
        plan = plan_curriculum_query("计算机科学与技术培养方案总学分是多少")

        self.assertEqual(plan.retrieval_intent.kind, "curriculum_fact_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "curriculum_fact")
        self.assertEqual(plan.retrieval_intent.target.corpus, "curriculum")
        self.assertEqual(plan.retrieval_intent.target.collection, "curriculum_plan")

    def test_curriculum_title_only_query_exposes_reference_intent(self) -> None:
        plan = plan_curriculum_query("民族学本科人才培养方案")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.intent_kind, "generic")
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_document_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "curriculum_document")
        self.assertEqual(plan.retrieval_intent.target.corpus, "curriculum")
        self.assertEqual(plan.retrieval_intent.target.collection, "curriculum_plan")
        self.assertEqual(plan.retrieval_intent.target.document_ids, plan.target_document_ids)

    def test_curriculum_course_plan_exposes_curriculum_fact_intent(self) -> None:
        plan = plan_curriculum_course_query("思政课第几学期开")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_fact_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "curriculum_fact")
        self.assertEqual(plan.retrieval_intent.target.collection, "course_facts")
        self.assertEqual(plan.retrieval_intent.target.document_ids, ())
        self.assertEqual(plan.retrieval_intent.critical_terms, ("schedule",))

    def test_official_web_stable_reference_exposes_reference_intent(self) -> None:
        intent = retrieval_intent_for_official_web_stable_reference(
            query_text="中央民族大学学校简介",
            scope=KnowledgeScope(corpus="official_web", collection="stable_reference"),
        )

        self.assertEqual(intent.kind, "official_reference_lookup")
        self.assertEqual(intent.expected.answer_kind, "official_reference")
        self.assertEqual(intent.target.corpus, "official_web")
        self.assertEqual(intent.target.collection, "stable_reference")

    def test_explicit_student_rules_scope_never_leaves_retrieval_intent_unset(self) -> None:
        pipeline = build_rag_pipeline_context(
            AgentRequest(
                target="rag-agent",
                user_goal="学校几点开门",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            prompt_executor=None,
        )

        self.assertIsNotNone(pipeline.retrieval_intent)
        assert pipeline.retrieval_intent is not None
        self.assertEqual(pipeline.retrieval_intent.kind, "general_fact_lookup")
        self.assertEqual(pipeline.retrieval_intent.expected.answer_kind, "general_fact")
        self.assertEqual(pipeline.retrieval_intent.target.corpus, "regulations")
        self.assertEqual(pipeline.retrieval_intent.target.collection, "student_rules")

    def test_explicit_curriculum_scope_never_leaves_retrieval_intent_unset(self) -> None:
        pipeline = build_rag_pipeline_context(
            AgentRequest(
                target="rag-agent",
                user_goal="学校几点开门",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            prompt_executor=None,
        )

        self.assertIsNotNone(pipeline.retrieval_intent)
        assert pipeline.retrieval_intent is not None
        self.assertEqual(pipeline.retrieval_intent.kind, "curriculum_fact_lookup")
        self.assertEqual(pipeline.retrieval_intent.expected.answer_kind, "curriculum_fact")
        self.assertEqual(pipeline.retrieval_intent.target.corpus, "curriculum")
        self.assertEqual(pipeline.retrieval_intent.target.collection, "curriculum_plan")


if __name__ == "__main__":
    unittest.main()
