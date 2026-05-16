# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.retrieval.retrieval_service_replan_execution_suite_support import *


class RetrievalServiceReplanExecutionTestPart03(unittest.TestCase):
    def test_execute_retrieval_plan_skips_reranker_when_intent_disables_it(self) -> None:
        rerank_calls: list[RetrievalRequest] = []
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:reranker-intent-disabled",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="校园卡丢了怎么办",
                    semantic_hint=RetrievalSemanticHint(
                        intent_kind="procedure_steps",
                        answer_kind="procedure_steps",
                        need_kinds=("procedure_steps",),
                        coverage_policy="procedure_step_completeness",
                        selection_policy="answer_role_first",
                        rerank_policy="disabled",
                        replan_policy="intent_gap_replan",
                        expected_answer_roles=("procedure_step",),
                    ),
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        with patch(
            "campus_retrieval_core.service.load_runtime_profile",
            return_value=Mock(reranker_enabled_by_default=True, reranker_top_n=20),
        ):
            result = execute_retrieval_plan(
                plan,
                retrieve_step=lambda request: EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        _make_source(
                            chunk_id="campus-card:chunk-1",
                            version_id="v2:campus-card",
                            snippet="校园卡丢失后可自助补卡。",
                        ),
                    ),
                ),
                rerank_step=lambda request, evidence: rerank_calls.append(request) or evidence,
            )

        self.assertEqual(rerank_calls, [])
        self.assertEqual(result.step_results[0].status, "succeeded")

    def test_execute_retrieval_plan_prefers_semantic_hint_over_raw_query_for_condition_gap(
        self,
    ) -> None:
        plan = RetrievalPlan(
            plan_id="regulations:institutional_rules:semantic-hint-condition-gap",
            query_mode="current",
            admitted_scopes=(
                RetrievalScope(corpus="regulations", collection="institutional_rules"),
            ),
            budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
            steps=(
                RetrievalStep(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="institutional_rules"),
                    query_text="中央民族大学学生申诉处理办法",
                    semantic_hint=RetrievalSemanticHint(
                        intent_kind="condition_table",
                        answer_kind="condition_table",
                        need_kinds=("condition_table",),
                        coverage_policy="condition_subject_alignment",
                        selection_policy="answer_role_first",
                        rerank_policy="disabled",
                        replan_policy="intent_gap_replan",
                        expected_answer_roles=("time_constraint", "eligibility_condition"),
                        condition_subject="deadline",
                    ),
                    selector=RetrievalSelector(
                        target_document_ids=("official_web_regulation:appeal",),
                    ),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(
            plan,
            retrieve_step=lambda request: EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="institutional-appeal-example-only",
                        doc_id="official_web_regulation:appeal",
                        source_title="中央民族大学学生申诉处理办法",
                        snippet="如有特殊情况，可另附说明。",
                        score=0.92,
                        content_role="eligibility",
                        is_answer_bearing=True,
                        semantic_role="example_evidence",
                        polarity="positive",
                        claim_type="condition",
                        anchor=_answer_ready_anchor(
                            answer_role="example_evidence",
                            condition_subject="generic_condition",
                            condition_group_subject="deadline",
                            condition_group_id=(
                                "official_web_regulation:appeal:article-4:group-01:deadline"
                            ),
                            parent_unit_id="official_web_regulation:appeal:article-4",
                            claim_type="condition",
                            polarity="positive",
                        ),
                    ),
                ),
            ),
        )

        self.assertEqual(result.step_results[0].status, "empty")
        self.assertEqual(result.step_results[0].activity.failure_kind, "group_support_missing")

    def test_execute_retrieval_plan_keeps_answer_ready_deadline_despite_negative_context_words(
        self,
    ) -> None:
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:hearing-application-deadline",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
            steps=(
                RetrievalStep(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text=("中央民族大学学生听证实施办法 听证申请 10日内 书面听证申请"),
                    semantic_hint=RetrievalSemanticHint(
                        intent_kind="procedure_steps",
                        answer_kind="procedure_steps",
                        need_kinds=("procedure_steps",),
                        coverage_policy="procedure_step_completeness",
                        selection_policy="answer_role_first",
                        rerank_policy="disabled",
                        replan_policy="intent_gap_replan",
                        expected_answer_roles=(
                            "procedure_step",
                            "time_constraint",
                            "eligibility_condition",
                        ),
                    ),
                    selector=RetrievalSelector(target_document_ids=("handbook:hearing",)),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(
            plan,
            retrieve_step=lambda request: EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="hearing-application-deadline",
                        doc_id="handbook:hearing",
                        source_title="中央民族大学学生听证实施办法",
                        snippet=(
                            "学校拟给予学生开除学籍、退学处理、取消学籍、取消入学资格时,"
                            "应当告知学生有要求听证的权利。学生应当在收到告知书后10日内"
                            "提交书面听证申请。"
                        ),
                        score=0.92,
                        content_role="deadline",
                        is_answer_bearing=True,
                        semantic_role="time_constraint",
                        polarity="positive",
                        claim_type="time_constraint",
                        anchor=_answer_ready_anchor(
                            answer_role="time_constraint",
                            condition_subject="application_procedure",
                            condition_group_subject="application_procedure",
                            condition_group_id="handbook:hearing:article-13:application_procedure",
                            parent_unit_id="handbook:hearing:article-13",
                            semantic_role="time_constraint",
                            claim_type="time_constraint",
                            polarity="positive",
                        ),
                    ),
                ),
            ),
        )

        self.assertEqual(result.step_results[0].status, "succeeded")
        self.assertEqual(
            tuple(source.chunk_id for source in result.step_results[0].grounding),
            ("hearing-application-deadline",),
        )

    def test_execute_retrieval_plan_fail_closes_when_replan_drops_existing_version_filter(
        self,
    ) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:replan-version-tightening",
            query_mode="historical",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国奖",
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                        target_version_ids=("v1:national-scholarship",),
                    ),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(
            plan,
            retrieve_step=fake_retrieve_step,
            replan_callback=lambda _plan, _results, last_result: (
                (
                    RetrievalStep(
                        step_id="replanned",
                        step_type="indexed_lookup",
                        scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                        query_text="国家奖学金",
                        depends_on_step_ids=(last_result.step_id,),
                        selector=RetrievalSelector(
                            target_document_ids=("handbook:national-scholarship",),
                        ),
                        budget=RetrievalStepBudget(top_k=1),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual([request.query_text for request in seen_requests], ["国奖"])
        self.assertEqual(result.replan_count, 0)
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results), ("empty", "failed")
        )
        self.assertEqual(result.step_results[-1].failure.failure_kind, "executor_error")
        self.assertIn("target_version_ids", result.step_results[-1].failure.message)

    def test_execute_retrieval_plan_fail_closes_when_replan_switches_scope(self) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:replan-scope-switch",
            query_mode="current",
            admitted_scopes=(
                RetrievalScope(corpus="regulations", collection="student_rules"),
                RetrievalScope(corpus="curriculum", collection="curriculum_plan"),
            ),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国奖",
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                    ),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(
            plan,
            retrieve_step=fake_retrieve_step,
            replan_callback=lambda _plan, _results, last_result: (
                (
                    RetrievalStep(
                        step_id="replanned",
                        step_type="indexed_lookup",
                        scope=RetrievalScope(corpus="curriculum", collection="curriculum_plan"),
                        query_text="国家奖学金",
                        depends_on_step_ids=(last_result.step_id,),
                        selector=RetrievalSelector(
                            target_document_ids=("handbook:national-scholarship",),
                        ),
                        budget=RetrievalStepBudget(top_k=1),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual([request.query_text for request in seen_requests], ["国奖"])
        self.assertEqual(result.replan_count, 0)
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results), ("empty", "failed")
        )
        self.assertEqual(result.step_results[-1].failure.failure_kind, "executor_error")
        self.assertIn("scope", result.step_results[-1].failure.message)


if __name__ == "__main__":
    unittest.main()
