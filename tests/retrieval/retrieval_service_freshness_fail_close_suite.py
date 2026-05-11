from __future__ import annotations

import unittest

from campus_contracts import EvidenceBundle
from campus_retrieval_core.models import (
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalRequest,
    RetrievalScope,
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


if __name__ == "__main__":
    unittest.main()
