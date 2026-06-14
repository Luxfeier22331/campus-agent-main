from __future__ import annotations

import unittest

from campus_contracts import EvidenceBundle
from campus_retrieval_core.models import (
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalRequest,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepBudget,
)
from campus_retrieval_core.service import execute_retrieval_plan

from tests.retrieval.retrieval_service_test_support import _make_source


class RetrievalServiceFreshnessFailCloseTest(unittest.TestCase):
    def test_execute_retrieval_plan_blocks_freshness_gate_before_indexed_lookup(self) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )

        plan = RetrievalPlan(
            plan_id="official_web:stable_reference:freshness-sensitive",
            query_mode="freshness_sensitive",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="stable_reference"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=0),
            steps=(
                RetrievalStep(
                    step_id="freshness-gate",
                    step_type="freshness_gate",
                    scope=RetrievalScope(corpus="official_web", collection="stable_reference"),
                    query_text="中央民族大学今天有什么讲座",
                    expected_output="freshness_decision",
                ),
                RetrievalStep(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="stable_reference"),
                    query_text="中央民族大学今天有什么讲座",
                    depends_on_step_ids=("freshness-gate",),
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        result = execute_retrieval_plan(plan, retrieve_step=fake_retrieve_step)

        self.assertEqual(seen_requests, [])
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results),
            ("blocked",),
        )
        self.assertEqual(result.step_results[0].failure.failure_kind, "unresolved_freshness")
        self.assertEqual(len(result.merged_evidence.sources), 0)

    def test_execute_retrieval_plan_filters_merged_evidence_below_required_source_trust_tier(
        self,
    ) -> None:
        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="official_web:stable-reference:chunk-1",
                        version_id="owdocver:stable-1",
                        snippet="讲座将于今天下午举行。",
                        doc_id="official_web:stable_reference:article:notice-1",
                        collection="stable_reference",
                        source_channel="official_web",
                        canonical_url="https://example.edu/news/notice-1",
                        latest_url="https://example.edu/news/notice-1",
                        source_title="讲座预告",
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="official_web:stable_reference:trust-gated-freshness",
            query_mode="freshness_sensitive",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="stable_reference"),),
            source_trust_policy=RetrievalSourceTrustPolicy(minimum_tier="T3"),
            budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
            steps=(
                RetrievalStep(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="stable_reference"),
                    query_text="中央民族大学今天有什么讲座",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        result = execute_retrieval_plan(plan, retrieve_step=fake_retrieve_step)

        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results),
            ("succeeded",),
        )
        self.assertEqual(len(result.step_results[0].grounding), 1)
        self.assertEqual(result.step_results[0].grounding[0].source_trust_tier, "T2")
        self.assertEqual(len(result.merged_evidence.sources), 0)

    def test_live_assisted_plan_blocks_when_live_executor_is_unavailable(self) -> None:
        plan = RetrievalPlan(
            plan_id="official_web:stable_reference:live-assisted",
            query_mode="live_assisted",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="stable_reference"),),
            budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
            steps=(
                RetrievalStep(
                    step_id="live-source-lookup",
                    step_type="live_source_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="stable_reference"),
                    query_text="中央民族大学今天有什么讲座",
                    selector=RetrievalSelector(
                        target_document_ids=("official_web:stable_reference:article:notice-1",),
                    ),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(plan)

        self.assertEqual(tuple(step.status for step in result.step_results), ("blocked",))
        self.assertEqual(result.step_results[0].failure.failure_kind, "executor_error")
        self.assertIn("live source lookup executor", result.step_results[0].failure.message)
        self.assertEqual(len(result.merged_evidence.sources), 0)

    def test_live_assisted_plan_executes_bounded_live_lookup(self) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_live_lookup(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="official-web-live-1",
                        version_id="owdocver:live-1",
                        snippet="今天学校发布讲座安排。",
                        doc_id="official_web:stable_reference:article:notice-1",
                        collection="stable_reference",
                        source_channel="official_web",
                        canonical_url="https://example.edu/news/notice-1",
                        latest_url="https://example.edu/news/notice-1",
                        source_title="讲座预告",
                    ),
                    _make_source(
                        chunk_id="official-web-live-2",
                        version_id="owdocver:live-2",
                        snippet="第二条现场候选不应超过 top_k。",
                        doc_id="official_web:stable_reference:article:notice-2",
                        collection="stable_reference",
                        source_channel="official_web",
                        canonical_url="https://example.edu/news/notice-2",
                        latest_url="https://example.edu/news/notice-2",
                        source_title="讲座预告二",
                    ),
                    _make_source(
                        chunk_id="official-web-live-3",
                        version_id="owdocver:live-3",
                        snippet="第三条现场候选必须被预算裁剪。",
                        doc_id="official_web:stable_reference:article:notice-3",
                        collection="stable_reference",
                        source_channel="official_web",
                        canonical_url="https://example.edu/news/notice-3",
                        latest_url="https://example.edu/news/notice-3",
                        source_title="讲座预告三",
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="official_web:stable_reference:live-assisted",
            query_mode="live_assisted",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="stable_reference"),),
            budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
            steps=(
                RetrievalStep(
                    step_id="live-source-lookup",
                    step_type="live_source_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="stable_reference"),
                    query_text="中央民族大学今天有什么讲座",
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(plan, live_source_lookup_step=fake_live_lookup)

        self.assertEqual(len(seen_requests), 1)
        self.assertEqual(seen_requests[0].top_k, 2)
        self.assertEqual(tuple(step.status for step in result.step_results), ("succeeded",))
        self.assertEqual(result.step_results[0].activity.step_type, "live_source_lookup")
        self.assertEqual(result.step_results[0].activity.candidate_count, 2)
        self.assertEqual(len(result.merged_evidence.sources), 2)


if __name__ == "__main__":
    unittest.main()
