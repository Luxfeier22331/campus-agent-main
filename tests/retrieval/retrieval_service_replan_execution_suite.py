from __future__ import annotations

import unittest

from campus_contracts import (
    EvidenceBundle,
)
from campus_retrieval_core.models import (
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalRequest,
    RetrievalScope,
    RetrievalSelector,
    RetrievalStep,
    RetrievalStepBudget,
)
from campus_retrieval_core.service import (
    execute_retrieval_plan,
)

from tests.retrieval.retrieval_service_test_support import _make_source


class RetrievalServiceReplanExecutionTest(unittest.TestCase):
    def test_execute_retrieval_plan_merges_dual_step_compare_results(self) -> None:
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
                        chunk_id=f"{version_id}:chunk-1",
                        version_id=version_id,
                        snippet=f"{version_id} content",
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:compare",
            query_mode="compare",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=0),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国奖变化",
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                        target_version_ids=("v1:national-scholarship",),
                    ),
                    budget=RetrievalStepBudget(top_k=2),
                ),
                RetrievalStep(
                    step_id="comparison",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国奖变化",
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                        target_version_ids=("v2:national-scholarship",),
                    ),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(plan, retrieve_step=fake_retrieve_step)

        self.assertEqual(
            [request.target_version_ids for request in seen_requests],
            [("v1:national-scholarship",), ("v2:national-scholarship",)],
        )
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results),
            ("succeeded", "succeeded"),
        )
        self.assertEqual(len(result.merged_evidence.sources), 2)

    def test_execute_retrieval_plan_supports_bounded_replan_append(self) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            if request.query_text == "国奖":
                return EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                )
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="v1:national-scholarship:chunk-1",
                        version_id="v1:national-scholarship",
                        snippet="narrowed content",
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:replan",
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
                            target_version_ids=("v1:national-scholarship",),
                        ),
                        budget=RetrievalStepBudget(top_k=1),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual([request.query_text for request in seen_requests], ["国奖", "国家奖学金"])
        self.assertEqual(result.replan_count, 1)
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results), ("empty", "succeeded")
        )
        self.assertEqual(len(result.merged_evidence.sources), 1)

    def test_execute_retrieval_plan_emits_sanitized_monitoring_observation(self) -> None:
        observations: list[dict[str, object]] = []
        plan = RetrievalPlan(
            plan_id="official_web:stable_reference:no-hit",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="stable_reference"),),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="stable_reference"),
                    query_text="校内宇宙签证办理处",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        result = execute_retrieval_plan(
            plan,
            retrieve_step=lambda request: EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(),
            ),
            observation_sink=observations.append,
            observation_request_id="req-no-hit",
        )

        self.assertEqual(result.step_results[0].status, "empty")
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["request_id"], "req-no-hit")
        self.assertEqual(observations[0]["query"], "校内宇宙签证办理处")
        self.assertEqual(
            observations[0]["scope"],
            {"corpus": "official_web", "collection": "stable_reference"},
        )
        self.assertEqual(observations[0]["candidate_count"], 0)
        self.assertEqual(observations[0]["terminal_state"], "completed")

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
