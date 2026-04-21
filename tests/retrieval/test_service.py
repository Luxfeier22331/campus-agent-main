from __future__ import annotations

import inspect
import unittest
from dataclasses import fields
from unittest.mock import Mock, patch

from campus_contracts import (
    AuthorizedRetrievalFilter,
    EvidenceBundle,
    EvidenceSource,
    PersonalizationHint,
)
from campus_retrieval_core.backend_qdrant import RestrictedDocumentAccessDeniedError
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
from campus_retrieval_core.service import (
    build_retrieval_backend,
    execute_retrieval_plan,
    retrieve_sources,
)


class RetrievalServiceTest(unittest.TestCase):
    def test_build_retrieval_backend_initializes_backend_from_settings(self) -> None:
        settings = object()
        backend = Mock()

        with (
            patch(
                "campus_retrieval_core.service.RetrievalSettings.from_env", return_value=settings
            ) as from_env,
            patch(
                "campus_retrieval_core.service.QdrantRetrievalBackend", return_value=backend
            ) as backend_ctor,
        ):
            runtime_backend = build_retrieval_backend()

        self.assertIs(runtime_backend, backend)
        from_env.assert_called_once_with()
        backend_ctor.assert_called_once_with(settings)

    def test_build_retrieval_backend_reuses_env_backed_runtime_backend(self) -> None:
        settings = Mock()
        first_backend = Mock()
        second_backend = Mock()

        with (
            patch("campus_retrieval_core.service._RUNTIME_BACKEND_CACHE", {}),
            patch(
                "campus_retrieval_core.service.RetrievalSettings.from_env", return_value=settings
            ) as from_env,
            patch(
                "campus_retrieval_core.service.QdrantRetrievalBackend",
                side_effect=(first_backend, second_backend),
            ) as backend_ctor,
        ):
            first = build_retrieval_backend()
            second = build_retrieval_backend()

        self.assertIs(first, first_backend)
        self.assertIs(second, first_backend)
        self.assertEqual(from_env.call_count, 2)
        backend_ctor.assert_called_once_with(settings)

    def test_retrieve_sources_uses_explicit_backend_without_reinitializing_runtime(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="library hours",
            corpus="regulations",
            collection="student_handbook",
        )

        result = retrieve_sources(
            "library hours",
            corpus="regulations",
            collection="student_handbook",
            authorized_filter=AuthorizedRetrievalFilter(
                entitlement_groups=("students",),
                visibility_level="public",
                policy_projection_version="phase1-authorization-projection-v1",
            ),
            backend=backend,
        )

        self.assertIsInstance(result, EvidenceBundle)
        backend.retrieve.assert_called_once()

    def test_retrieve_sources_uses_runtime_profile_retrieval_budget_when_top_k_is_omitted(
        self,
    ) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
        )

        retrieve_sources(
            "民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.top_k, 5)

    def test_retrieve_sources_keeps_explicit_top_k_override(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
        )

        retrieve_sources(
            "民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
            top_k=7,
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.top_k, 7)

    def test_retrieve_sources_passes_personalization_hint_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="保研流程",
            corpus="regulations",
            collection="student_handbook",
        )

        retrieve_sources(
            "保研流程",
            corpus="regulations",
            collection="student_handbook",
            personalization_hint=PersonalizationHint(
                actor_claim_terms=("2023 cohort", "philosophy major"),
                recent_goal="咨询保研",
                confirmed_slot_terms=("推免资格",),
            ),
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(
            request.personalization_hint,
            PersonalizationHint(
                actor_claim_terms=("2023 cohort", "philosophy major"),
                recent_goal="咨询保研",
                confirmed_slot_terms=("推免资格",),
            ),
        )

    def test_retrieve_sources_passes_authorized_filter_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="保研流程",
            corpus="regulations",
            collection="student_handbook",
        )
        authorized_filter = AuthorizedRetrievalFilter(
            entitlement_groups=("entitled-students",),
            visibility_scope="north",
        )

        retrieve_sources(
            "保研流程",
            corpus="regulations",
            collection="student_handbook",
            authorized_filter=authorized_filter,
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.authorized_filter, authorized_filter)

    def test_retrieve_sources_propagates_restricted_access_denied(self) -> None:
        backend = Mock()
        backend.retrieve.side_effect = RestrictedDocumentAccessDeniedError(
            "restricted document access denied"
        )

        with self.assertRaises(RestrictedDocumentAccessDeniedError):
            retrieve_sources(
                "这条通知写了什么？",
                corpus="regulations",
                collection="student_handbook",
                target_document_ids=("handbook:restricted-notice",),
                backend=backend,
            )

    def test_retrieve_sources_passes_target_document_ids_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="国奖评审办法里的论文要求是什么？",
            corpus="regulations",
            collection="student_handbook",
        )

        retrieve_sources(
            "国奖评审办法里的论文要求是什么？",
            corpus="regulations",
            collection="student_handbook",
            target_document_ids=("handbook:national-scholarship",),
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.target_document_ids, ("handbook:national-scholarship",))

    def test_retrieve_sources_passes_preferred_document_ids_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="基地班培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
        )

        retrieve_sources(
            "基地班培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
            preferred_document_ids=("curriculum:历史学（强基计划）本科人才培养方案",),
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(
            request.preferred_document_ids,
            ("curriculum:历史学（强基计划）本科人才培养方案",),
        )

    def test_retrieve_sources_passes_version_filters_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="旧版国奖评审办法",
            corpus="regulations",
            collection="student_handbook",
        )

        retrieve_sources(
            "旧版国奖评审办法",
            corpus="regulations",
            collection="student_handbook",
            target_document_ids=("handbook:national-scholarship",),
            target_version_ids=("v1:national-scholarship",),
            target_revision_track="source-faithful",
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.target_version_ids, ("v1:national-scholarship",))
        self.assertEqual(request.target_revision_track, "source-faithful")

    def test_retrieve_sources_passes_canonical_course_filters_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="习概有哪些专业要上",
            corpus="curriculum",
            collection="course_facts",
        )

        retrieve_sources(
            "习概有哪些专业要上",
            corpus="curriculum",
            collection="course_facts",
            canonical_course_ids=("course:muc.xigai",),
            canonical_course_family_ids=("course_family:muc.ideological_political_theory",),
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.canonical_course_ids, ("course:muc.xigai",))
        self.assertEqual(
            request.canonical_course_family_ids,
            ("course_family:muc.ideological_political_theory",),
        )

    def test_retrieve_sources_exposes_program_family_filter_surface(self) -> None:
        self.assertIn(
            "canonical_program_family_ids", inspect.signature(retrieve_sources).parameters
        )
        self.assertIn(
            "canonical_program_family_ids",
            {field.name for field in fields(RetrievalRequest)},
        )

    def test_retrieval_request_omits_non_canonical_top_level_authz_fields(self) -> None:
        field_names = {field.name for field in fields(RetrievalRequest)}
        parameter_names = set(inspect.signature(RetrievalRequest).parameters)

        self.assertNotIn("acl_groups", field_names)
        self.assertNotIn("campus_scope", field_names)
        self.assertNotIn("acl_groups", parameter_names)
        self.assertNotIn("campus_scope", parameter_names)

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
            plan_id="regulations:student_handbook:compare",
            query_mode="compare",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_handbook"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=0),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_handbook"),
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
                    scope=RetrievalScope(corpus="regulations", collection="student_handbook"),
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
            plan_id="regulations:student_handbook:replan",
            query_mode="historical",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_handbook"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_handbook"),
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
                        scope=RetrievalScope(corpus="regulations", collection="student_handbook"),
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
            plan_id="regulations:student_handbook:replan-version-tightening",
            query_mode="historical",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_handbook"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_handbook"),
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
                        scope=RetrievalScope(corpus="regulations", collection="student_handbook"),
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
            plan_id="regulations:student_handbook:replan-scope-switch",
            query_mode="current",
            admitted_scopes=(
                RetrievalScope(corpus="regulations", collection="student_handbook"),
                RetrievalScope(corpus="curriculum", collection="curriculum_plan"),
            ),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_handbook"),
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


def _make_source(
    *,
    chunk_id: str,
    version_id: str,
    snippet: str,
    doc_id: str = "handbook:national-scholarship",
    collection: str = "student_handbook",
    source_channel: str = "pdf_ocr",
    canonical_url: str = "https://example.edu/handbook/national-scholarship",
    latest_url: str = "https://example.edu/handbook/national-scholarship/latest",
    source_title: str = "国家奖学金评审办法",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page_start": 1, "page_end": 1},
        canonical_url=canonical_url,
        latest_url=latest_url,
        source_channel=source_channel,
        collection=collection,
        is_current=version_id.startswith("v2:"),
        snippet=snippet,
        score=0.91,
        source_title=source_title,
    )


if __name__ == "__main__":
    unittest.main()
