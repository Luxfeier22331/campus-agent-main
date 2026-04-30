from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from campus_contracts import (
    EvidenceBundle,
)
from campus_retrieval_core.models import (
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalRequest,
    RetrievalScope,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepBudget,
)
from campus_retrieval_core.service import (
    execute_retrieval_plan,
)

from tests.retrieval.retrieval_service_test_support import _make_source


class RetrievalServiceLiveLookupAndFailCloseTest(unittest.TestCase):
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
            tuple(step_result.status for step_result in result.step_results), ("blocked",)
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
            tuple(step_result.status for step_result in result.step_results), ("succeeded",)
        )
        self.assertEqual(len(result.step_results[0].grounding), 1)
        self.assertEqual(result.step_results[0].grounding[0].source_trust_tier, "T2")
        self.assertEqual(len(result.merged_evidence.sources), 0)

    def test_execute_retrieval_plan_uses_live_lookup_executor_when_admitted(self) -> None:
        live_step_ids: list[str] = []

        plan = RetrievalPlan(
            plan_id="official_web:fresh_news:live-assisted",
            query_mode="live_assisted",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="fresh_news"),),
            source_trust_policy=RetrievalSourceTrustPolicy(
                minimum_tier="T3",
                allow_live_source_lookup=True,
            ),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=0, max_live_lookups=1),
            steps=(
                RetrievalStep(
                    step_id="freshness-gate",
                    step_type="freshness_gate",
                    scope=RetrievalScope(corpus="official_web", collection="fresh_news"),
                    query_text="中央民族大学今天有什么新闻",
                    expected_output="freshness_decision",
                ),
                RetrievalStep(
                    step_id="live-source-lookup",
                    step_type="live_source_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="fresh_news"),
                    query_text="中央民族大学今天有什么新闻",
                    depends_on_step_ids=("freshness-gate",),
                    expected_output="live_candidates",
                ),
            ),
        )

        with patch(
            "campus_retrieval_core.service.load_runtime_profile",
            return_value=Mock(
                retrieval_top_k=3,
                requires_freshness_gate=True,
                supports_freshness_sensitive_queries=False,
                live_search_fallback_allowed=True,
            ),
        ):
            result = execute_retrieval_plan(
                plan,
                retrieve_live_step=lambda step: (
                    live_step_ids.append(step.step_id)
                    or EvidenceBundle(
                        query_text=step.query_text,
                        corpus=step.scope.corpus,
                        collection=step.scope.collection,
                        sources=(
                            _make_source(
                                chunk_id="official_web:fresh-news:chunk-1",
                                version_id="owdocver:fresh-1",
                                snippet="今天上午学校发布了一条最新新闻。",
                                doc_id="official_web:fresh_news:article:news-1",
                                collection="fresh_news",
                                source_channel="official_web",
                                canonical_url="https://example.edu/news/fresh-1",
                                latest_url="https://example.edu/news/fresh-1",
                                source_title="校园新闻",
                            ),
                        ),
                    )
                ),
            )

        self.assertEqual(live_step_ids, ["live-source-lookup"])
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results),
            ("succeeded", "succeeded"),
        )
        self.assertEqual(len(result.merged_evidence.sources), 1)
        self.assertEqual(result.merged_evidence.sources[0].source_trust_tier, "T3")
        self.assertEqual(
            result.merged_evidence.sources[0].anchor["retrieval_mode"],
            "live_assisted",
        )
        self.assertFalse(result.merged_evidence.sources[0].anchor["canonical_index_truth"])
        self.assertTrue(result.merged_evidence.sources[0].anchor["as_of"])

    def test_execute_retrieval_plan_blocks_live_lookup_when_live_budget_is_zero(self) -> None:
        live_step_ids: list[str] = []
        plan = RetrievalPlan(
            plan_id="official_web:fresh_news:live-assisted-zero-budget",
            query_mode="live_assisted",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="fresh_news"),),
            source_trust_policy=RetrievalSourceTrustPolicy(
                minimum_tier="T3",
                allow_live_source_lookup=True,
            ),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=0, max_live_lookups=0),
            steps=(
                RetrievalStep(
                    step_id="freshness-gate",
                    step_type="freshness_gate",
                    scope=RetrievalScope(corpus="official_web", collection="fresh_news"),
                    query_text="中央民族大学今天有什么新闻",
                    expected_output="freshness_decision",
                ),
                RetrievalStep(
                    step_id="live-source-lookup",
                    step_type="live_source_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="fresh_news"),
                    query_text="中央民族大学今天有什么新闻",
                    depends_on_step_ids=("freshness-gate",),
                    expected_output="live_candidates",
                ),
            ),
        )

        with patch(
            "campus_retrieval_core.service.load_runtime_profile",
            return_value=Mock(
                retrieval_top_k=3,
                requires_freshness_gate=True,
                supports_freshness_sensitive_queries=False,
                live_search_fallback_allowed=True,
            ),
        ):
            result = execute_retrieval_plan(
                plan,
                retrieve_live_step=lambda step: live_step_ids.append(step.step_id)
                or EvidenceBundle(
                    query_text=step.query_text,
                    corpus=step.scope.corpus,
                    collection=step.scope.collection,
                ),
            )

        self.assertEqual(live_step_ids, [])
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results),
            ("succeeded", "blocked"),
        )
        self.assertEqual(result.step_results[1].failure.failure_kind, "budget_exhausted")

    def test_live_assisted_observation_records_query_and_retrieval_mode(self) -> None:
        observations: list[dict[str, object]] = []
        plan = RetrievalPlan(
            plan_id="official_web:fresh_news:live-assisted-observation",
            query_mode="live_assisted",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="fresh_news"),),
            source_trust_policy=RetrievalSourceTrustPolicy(
                minimum_tier="T3",
                allow_live_source_lookup=True,
            ),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=0, max_live_lookups=1),
            steps=(
                RetrievalStep(
                    step_id="freshness-gate",
                    step_type="freshness_gate",
                    scope=RetrievalScope(corpus="official_web", collection="fresh_news"),
                    query_text="中央民族大学今天有什么新闻",
                    expected_output="freshness_decision",
                ),
                RetrievalStep(
                    step_id="live-source-lookup",
                    step_type="live_source_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="fresh_news"),
                    query_text="中央民族大学今天有什么新闻",
                    depends_on_step_ids=("freshness-gate",),
                    expected_output="live_candidates",
                ),
            ),
        )

        with patch(
            "campus_retrieval_core.service.load_runtime_profile",
            return_value=Mock(
                retrieval_top_k=3,
                requires_freshness_gate=True,
                supports_freshness_sensitive_queries=False,
                live_search_fallback_allowed=True,
            ),
        ):
            execute_retrieval_plan(
                plan,
                retrieve_live_step=lambda step: EvidenceBundle(
                    query_text=step.query_text,
                    corpus=step.scope.corpus,
                    collection=step.scope.collection,
                    sources=(
                        _make_source(
                            chunk_id="official_web:fresh-news:chunk-1",
                            version_id="owdocver:fresh-1",
                            snippet="今天上午学校发布了一条最新新闻。",
                            doc_id="official_web:fresh_news:article:news-1",
                            collection="fresh_news",
                            source_channel="official_web",
                            canonical_url="https://example.edu/news/fresh-1",
                            latest_url="https://example.edu/news/fresh-1",
                            source_title="校园新闻",
                        ),
                    ),
                ),
                observation_sink=observations.append,
                observation_request_id="req-live-assisted",
            )

        live_observation = observations[-1]
        self.assertEqual(live_observation["query_mode"], "live_assisted")
        self.assertEqual(live_observation["retrieval_mode"], "live_assisted")
        self.assertEqual(live_observation["canonical_index_truth"], False)

    def test_execute_retrieval_plan_fail_closes_when_live_lookup_executor_is_missing(self) -> None:
        plan = RetrievalPlan(
            plan_id="official_web:fresh_news:live-assisted-missing-executor",
            query_mode="live_assisted",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="fresh_news"),),
            source_trust_policy=RetrievalSourceTrustPolicy(
                minimum_tier="T3",
                allow_live_source_lookup=True,
            ),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=0, max_live_lookups=1),
            steps=(
                RetrievalStep(
                    step_id="freshness-gate",
                    step_type="freshness_gate",
                    scope=RetrievalScope(corpus="official_web", collection="fresh_news"),
                    query_text="中央民族大学今天有什么新闻",
                    expected_output="freshness_decision",
                ),
                RetrievalStep(
                    step_id="live-source-lookup",
                    step_type="live_source_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="fresh_news"),
                    query_text="中央民族大学今天有什么新闻",
                    depends_on_step_ids=("freshness-gate",),
                    expected_output="live_candidates",
                ),
            ),
        )

        with patch(
            "campus_retrieval_core.service.load_runtime_profile",
            return_value=Mock(
                retrieval_top_k=3,
                requires_freshness_gate=True,
                supports_freshness_sensitive_queries=False,
                live_search_fallback_allowed=True,
            ),
        ):
            result = execute_retrieval_plan(plan)

        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results),
            ("succeeded", "blocked"),
        )
        self.assertEqual(result.step_results[1].failure.failure_kind, "live_lookup_unavailable")
        self.assertEqual(len(result.merged_evidence.sources), 0)
