from __future__ import annotations

import unittest

from campus_contracts import EvidenceBundle
from campus_retrieval_core.models import (
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalRequest,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSemanticHint,
    RetrievalStep,
    RetrievalStepBudget,
)
from campus_retrieval_core.service import execute_retrieval_plan

from tests.retrieval.retrieval_service_test_support import _make_source


class RetrievalServiceTypedStepExecutionTest(unittest.TestCase):
    def test_execute_retrieval_plan_executes_compare_pair_lookup_as_bounded_dual_request(
        self,
    ) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            version_id = request.target_version_ids[0]
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id=f"{version_id}:compare-chunk",
                        version_id=version_id,
                        snippet=f"{version_id} compare content",
                    ),
                ),
            )

        result = execute_retrieval_plan(
            _typed_step_plan(
                query_mode="compare",
                step_type="compare_pair_lookup",
                selector=RetrievalSelector(
                    target_document_ids=("handbook:national-scholarship",),
                    target_version_ids=("v1:national-scholarship", "v2:national-scholarship"),
                ),
                expected_output="compare_inputs",
            ),
            retrieve_step=fake_retrieve_step,
        )

        self.assertEqual(
            [request.target_version_ids for request in seen_requests],
            [("v1:national-scholarship",), ("v2:national-scholarship",)],
        )
        self.assertEqual(tuple(step.status for step in result.step_results), ("succeeded",))
        self.assertEqual(result.step_results[0].activity.step_type, "compare_pair_lookup")
        self.assertEqual(result.step_results[0].activity.candidate_count, 2)
        self.assertEqual(len(result.merged_evidence.sources), 2)

    def test_execute_retrieval_plan_executes_historical_lookup_with_version_filter(
        self,
    ) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="v1:national-scholarship:historical-chunk",
                        version_id="v1:national-scholarship",
                        snippet="historical content",
                    ),
                ),
            )

        result = execute_retrieval_plan(
            _typed_step_plan(
                query_mode="historical",
                step_type="historical_version_lookup",
                selector=RetrievalSelector(
                    target_document_ids=("handbook:national-scholarship",),
                    target_version_ids=("v1:national-scholarship",),
                ),
            ),
            retrieve_step=fake_retrieve_step,
        )

        self.assertEqual(seen_requests[0].target_version_ids, ("v1:national-scholarship",))
        self.assertEqual(result.step_results[0].status, "succeeded")
        self.assertEqual(result.step_results[0].activity.step_type, "historical_version_lookup")

    def test_execute_retrieval_plan_blocks_historical_lookup_without_version_filter(
        self,
    ) -> None:
        result = execute_retrieval_plan(
            _typed_step_plan(
                query_mode="historical",
                step_type="historical_version_lookup",
                selector=RetrievalSelector(
                    target_document_ids=("handbook:national-scholarship",),
                ),
            ),
            retrieve_step=lambda request: EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            ),
        )

        self.assertEqual(result.step_results[0].status, "blocked")
        self.assertEqual(result.step_results[0].failure.failure_kind, "unsupported_step_type")
        self.assertIn("target_version_ids", result.step_results[0].failure.message)

    def test_execute_retrieval_plan_executes_entity_resolution_as_bounded_lookup(self) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        doc_id="course:muc.xigai",
                        chunk_id="course:muc.xigai:entity",
                        version_id="v2:course:muc.xigai",
                        snippet="西概课程实体",
                    ),
                ),
            )

        result = execute_retrieval_plan(
            RetrievalPlan(
                plan_id="curriculum:course_facts:entity",
                query_mode="current",
                admitted_scopes=(RetrievalScope(corpus="curriculum", collection="course_facts"),),
                budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
                steps=(
                    RetrievalStep(
                        step_id="entity",
                        step_type="entity_resolution",
                        scope=RetrievalScope(corpus="curriculum", collection="course_facts"),
                        query_text="西概",
                        selector=RetrievalSelector(canonical_course_ids=("course:muc.xigai",)),
                        budget=RetrievalStepBudget(top_k=2),
                        expected_output="entity_matches",
                    ),
                ),
            ),
            retrieve_step=fake_retrieve_step,
        )

        self.assertEqual(seen_requests[0].canonical_course_ids, ("course:muc.xigai",))
        self.assertEqual(result.step_results[0].status, "succeeded")
        self.assertEqual(result.step_results[0].activity.step_type, "entity_resolution")

    def test_execute_retrieval_plan_passes_semantic_hint_to_backend_request(self) -> None:
        seen_requests: list[RetrievalRequest] = []
        semantic_hint = RetrievalSemanticHint(
            intent_kind="condition_table",
            answer_kind="condition_table",
            need_kinds=("condition_table",),
            coverage_policy="condition_subject_alignment",
            selection_policy="answer_role_first",
            rerank_policy="disabled",
            replan_policy="intent_gap_replan",
            expected_answer_roles=(
                "eligibility_condition",
                "exception_rule",
                "eligibility_intro",
                "table_fact",
            ),
            condition_subject="generic_condition",
            category_id="scholarship",
        )

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="national-scholarship-condition",
                        snippet="参评本科学生国家奖学金须具备品行测评优秀、学习成绩优异等条件。",
                    ),
                ),
            )

        result = execute_retrieval_plan(
            RetrievalPlan(
                plan_id="regulations:student_rules:semantic-hint-request",
                query_mode="current",
                admitted_scopes=(
                    RetrievalScope(corpus="regulations", collection="student_rules"),
                ),
                budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
                steps=(
                    RetrievalStep(
                        step_id="condition-table",
                        step_type="indexed_lookup",
                        scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                        query_text="申请奖学金需要满足什么条件",
                        semantic_hint=semantic_hint,
                        selector=RetrievalSelector(
                            target_document_ids=("handbook:national-scholarship",),
                        ),
                        budget=RetrievalStepBudget(top_k=3),
                    ),
                ),
            ),
            retrieve_step=fake_retrieve_step,
        )

        self.assertEqual(result.step_results[0].status, "succeeded")
        self.assertIs(seen_requests[0].semantic_hint, semantic_hint)


def _typed_step_plan(
    *,
    query_mode: str,
    step_type: str,
    selector: RetrievalSelector,
    expected_output: str = "candidate_set",
) -> RetrievalPlan:
    return RetrievalPlan(
        plan_id=f"regulations:student_rules:{step_type}",
        query_mode=query_mode,
        admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
        budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
        steps=(
            RetrievalStep(
                step_id="typed-step",
                step_type=step_type,
                scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                query_text="国奖变化",
                selector=selector,
                budget=RetrievalStepBudget(top_k=2),
                expected_output=expected_output,
            ),
        ),
    )


if __name__ == "__main__":
    unittest.main()
