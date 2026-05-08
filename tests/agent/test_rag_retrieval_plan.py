from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_contracts import (
    AgentRequest,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    VersionQuery,
)
from campus_ingestion_core.version_resolution import ResolvedVersionQuery, ResolvedVersionSelection
from campus_rag_agent.query_planning import plan_student_handbook_query
from campus_rag_agent.retrieval_plan import build_ordered_retrieval_plan
from campus_rag_agent.service import delegate_to_rag_agent
from campus_rag_agent.service_retrieval import (
    build_rag_retrieval_context,
    build_retrieval_plan_for_context,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY


class RagRetrievalPlanTest(unittest.TestCase):
    def test_build_ordered_retrieval_plan_uses_single_step_for_current_query(self) -> None:
        plan = build_ordered_retrieval_plan(
            query_text="国奖怎么办",
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            retrieval_collection="student_rules",
            query_mode="current",
            target_document_ids=("handbook:national-scholarship",),
            top_k=4,
            version_query=VersionQuery(mode="current"),
        )

        self.assertEqual(plan.query_mode, "current")
        self.assertEqual(plan.budget.max_steps, 2)
        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].step_type, "indexed_lookup")
        self.assertEqual(
            plan.steps[0].selector.target_document_ids, ("handbook:national-scholarship",)
        )
        self.assertEqual(plan.source_trust_policy.minimum_tier, "T1")

    def test_resolved_policy_clause_query_uses_broad_and_focused_steps(self) -> None:
        request = AgentRequest(
            target="rag-agent",
            user_goal="国奖第九条怎么要求论文和著作？",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                version_query=VersionQuery(mode="current"),
            ),
        )
        handbook_plan = plan_student_handbook_query(request.user_goal)
        retrieval_context = build_rag_retrieval_context(
            request=request,
            effective_scope=request.payload.scope,
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=handbook_plan,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
            build_document_registry_from_env_fn=lambda: object(),
            resolve_version_query_fn=lambda **_: ResolvedVersionQuery(
                mode="current",
                status="resolved",
            ),
        )

        assert retrieval_context is not None
        plan = build_retrieval_plan_for_context(
            request=request,
            effective_scope=request.payload.scope,
            user_goal=request.user_goal,
            retrieval_context=retrieval_context,
        )

        self.assertEqual(len(plan.steps), 2)
        self.assertEqual(plan.steps[0].step_id, "policy-broad-lookup")
        self.assertEqual(plan.steps[0].step_type, "indexed_lookup")
        self.assertEqual(
            plan.steps[0].selector.target_document_ids, handbook_plan.target_document_ids
        )
        self.assertEqual(plan.steps[1].step_id, "policy-focused-lookup")
        self.assertEqual(plan.steps[1].step_type, "indexed_lookup")
        self.assertEqual(
            plan.steps[1].selector.target_document_ids, handbook_plan.target_document_ids
        )
        self.assertEqual(plan.steps[1].selector.focus_detail_labels, ("第九条",))
        self.assertEqual(plan.steps[1].selector.focus_article_nos, ("9",))
        self.assertEqual(plan.steps[1].selector.focus_terms, ("论文", "著作"))
        self.assertEqual(plan.steps[1].depends_on_step_ids, ("policy-broad-lookup",))
        self.assertEqual(plan.budget.max_replans, 1)
        self.assertEqual(plan.budget.max_steps, 3)
        self.assertIn("第九条", plan.steps[1].query_text)
        self.assertIn("论文", plan.steps[1].query_text)
        self.assertIn("著作", plan.steps[1].query_text)

    def test_resolved_policy_historical_clause_query_uses_focused_historical_step(self) -> None:
        request = AgentRequest(
            target="rag-agent",
            user_goal="旧版国奖第九条怎么要求论文和著作？",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                version_query=VersionQuery(mode="historical"),
            ),
        )
        handbook_plan = plan_student_handbook_query(request.user_goal)
        retrieval_context = build_rag_retrieval_context(
            request=request,
            effective_scope=request.payload.scope,
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=handbook_plan,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
            build_document_registry_from_env_fn=lambda: object(),
            resolve_version_query_fn=lambda *args, **kwargs: ResolvedVersionQuery(
                mode="historical",
                status="resolved",
                primary_selection=ResolvedVersionSelection(
                    document_id="handbook:national-scholarship",
                    revision_track="source-faithful",
                    version_id="v1:national-scholarship",
                    anchor="previous",
                ),
            ),
        )

        assert retrieval_context is not None
        plan = build_retrieval_plan_for_context(
            request=request,
            effective_scope=request.payload.scope,
            user_goal=request.user_goal,
            retrieval_context=retrieval_context,
        )

        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].step_type, "historical_version_lookup")
        self.assertEqual(plan.steps[0].selector.target_version_ids, ("v1:national-scholarship",))
        self.assertEqual(plan.steps[0].selector.focus_detail_labels, ("第九条",))
        self.assertEqual(plan.steps[0].selector.focus_article_nos, ("9",))
        self.assertEqual(plan.steps[0].selector.focus_terms, ("论文", "著作"))
        self.assertIn("第九条", plan.steps[0].query_text)
        self.assertIn("论文", plan.steps[0].query_text)
        self.assertIn("著作", plan.steps[0].query_text)

    def test_build_ordered_retrieval_plan_uses_collection_trust_tier_for_stable_reference(
        self,
    ) -> None:
        plan = build_ordered_retrieval_plan(
            query_text="中央民族大学学校简介",
            scope=KnowledgeScope(corpus="official_web", collection="stable_reference"),
            retrieval_collection="stable_reference",
            query_mode="current",
            top_k=3,
            version_query=VersionQuery(mode="current"),
        )

        self.assertEqual(plan.source_trust_policy.minimum_tier, "T2")

    def test_build_ordered_retrieval_plan_uses_dual_steps_for_compare_query(self) -> None:
        plan = build_ordered_retrieval_plan(
            query_text="国奖第九条旧版和新版有什么变化？",
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            retrieval_collection="student_rules",
            query_mode="compare",
            target_document_ids=("handbook:national-scholarship",),
            top_k=3,
            version_query=VersionQuery(mode="compare"),
            primary_version_id="v1:national-scholarship",
            comparison_version_id="v2:national-scholarship",
        )

        self.assertEqual(plan.query_mode, "compare")
        self.assertEqual(plan.budget.max_steps, 2)
        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].step_id, "compare-pair-lookup")
        self.assertEqual(plan.steps[0].step_type, "compare_pair_lookup")
        self.assertEqual(plan.steps[0].expected_output, "compare_inputs")
        self.assertEqual(
            plan.steps[0].selector.target_version_ids,
            ("v1:national-scholarship", "v2:national-scholarship"),
        )

    def test_resolved_policy_compare_clause_query_uses_focused_compare_step(self) -> None:
        request = AgentRequest(
            target="rag-agent",
            user_goal="国奖第九条旧版和新版对论文、著作有什么变化？",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                version_query=VersionQuery(mode="compare"),
            ),
        )
        handbook_plan = plan_student_handbook_query(request.user_goal)
        retrieval_context = build_rag_retrieval_context(
            request=request,
            effective_scope=request.payload.scope,
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=handbook_plan,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
            build_document_registry_from_env_fn=lambda: object(),
            resolve_version_query_fn=lambda *args, **kwargs: ResolvedVersionQuery(
                mode="compare",
                status="resolved",
                primary_selection=ResolvedVersionSelection(
                    document_id="handbook:national-scholarship",
                    revision_track="source-faithful",
                    version_id="v1:national-scholarship",
                    anchor="previous",
                ),
                comparison_selection=ResolvedVersionSelection(
                    document_id="handbook:national-scholarship",
                    revision_track="source-faithful",
                    version_id="v2:national-scholarship",
                    anchor="current",
                ),
            ),
        )

        assert retrieval_context is not None
        plan = build_retrieval_plan_for_context(
            request=request,
            effective_scope=request.payload.scope,
            user_goal=request.user_goal,
            retrieval_context=retrieval_context,
        )

        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].step_type, "compare_pair_lookup")
        self.assertEqual(plan.steps[0].selector.focus_detail_labels, ("第九条",))
        self.assertEqual(plan.steps[0].selector.focus_article_nos, ("9",))
        self.assertEqual(plan.steps[0].selector.focus_terms, ("论文", "著作"))
        self.assertIn("第九条", plan.steps[0].query_text)
        self.assertIn("论文", plan.steps[0].query_text)
        self.assertIn("著作", plan.steps[0].query_text)
        self.assertEqual(
            plan.steps[0].selector.target_version_ids,
            ("v1:national-scholarship", "v2:national-scholarship"),
        )

    def test_build_ordered_retrieval_plan_uses_historical_step_for_versioned_query(
        self,
    ) -> None:
        plan = build_ordered_retrieval_plan(
            query_text="旧版国奖第九条怎么规定？",
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            retrieval_collection="student_rules",
            query_mode="historical",
            target_document_ids=("handbook:national-scholarship",),
            target_version_ids=("v1:national-scholarship",),
            top_k=3,
            version_query=VersionQuery(mode="historical"),
        )

        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].step_type, "historical_version_lookup")
        self.assertEqual(plan.steps[0].expected_output, "candidate_set")
        self.assertEqual(plan.steps[0].selector.target_version_ids, ("v1:national-scholarship",))

    def test_build_ordered_retrieval_plan_uses_entity_resolution_for_entity_selector(
        self,
    ) -> None:
        plan = build_ordered_retrieval_plan(
            query_text="西概课程安排",
            scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan"),
            retrieval_collection="course_facts",
            query_mode="current",
            canonical_course_ids=("course:muc.xigai",),
            top_k=3,
            version_query=VersionQuery(mode="current"),
        )

        self.assertEqual(len(plan.steps), 2)
        self.assertEqual(plan.steps[0].step_type, "entity_resolution")
        self.assertEqual(plan.steps[0].expected_output, "entity_matches")
        self.assertEqual(plan.steps[1].step_type, "indexed_lookup")
        self.assertEqual(plan.steps[1].depends_on_step_ids, ("entity-resolution",))

    def test_build_ordered_retrieval_plan_uses_freshness_gate_for_freshness_sensitive_query(
        self,
    ) -> None:
        plan = build_ordered_retrieval_plan(
            query_text="中央民族大学今天有什么讲座",
            scope=KnowledgeScope(corpus="official_web", collection="stable_reference"),
            retrieval_collection="stable_reference",
            query_mode="freshness_sensitive",
            top_k=3,
            version_query=VersionQuery(mode="current"),
        )

        self.assertEqual(plan.query_mode, "freshness_sensitive")
        self.assertEqual(len(plan.steps), 2)
        self.assertEqual(plan.steps[0].step_type, "freshness_gate")
        self.assertEqual(plan.steps[0].expected_output, "freshness_decision")
        self.assertEqual(plan.steps[1].step_type, "indexed_lookup")
        self.assertEqual(plan.steps[1].depends_on_step_ids, ("freshness-gate",))
        self.assertEqual(plan.source_trust_policy.minimum_tier, "T3")

    def test_build_ordered_retrieval_plan_uses_live_source_lookup_for_live_assisted_query(
        self,
    ) -> None:
        plan = build_ordered_retrieval_plan(
            query_text="中央民族大学今天有什么讲座",
            scope=KnowledgeScope(corpus="official_web", collection="stable_reference"),
            retrieval_collection="stable_reference",
            query_mode="live_assisted",
            top_k=3,
            version_query=VersionQuery(mode="current"),
            allow_live_source_lookup=True,
        )

        self.assertEqual(plan.query_mode, "live_assisted")
        self.assertEqual(len(plan.steps), 2)
        self.assertEqual(plan.steps[0].step_type, "freshness_gate")
        self.assertEqual(plan.steps[1].step_type, "live_source_lookup")
        self.assertEqual(plan.steps[1].depends_on_step_ids, ("freshness-gate",))
        self.assertTrue(plan.source_trust_policy.allow_live_source_lookup)
        self.assertEqual(plan.budget.max_live_lookups, 1)

    def test_delegate_to_rag_agent_executes_compare_plan_as_dual_steps(self) -> None:
        seen_version_ids: list[tuple[str, ...]] = []

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            version_ids = kwargs["target_version_ids"]
            self.assertIsInstance(version_ids, tuple)
            seen_version_ids.append(version_ids)
            version_id = version_ids[0]
            return EvidenceBundle(
                query_text=query,
                corpus="regulations",
                collection="student_rules",
                sources=(
                    EvidenceSource(
                        doc_id="handbook:national-scholarship",
                        revision_track="source-faithful",
                        version_id=version_id,
                        chunk_id=f"handbook:national-scholarship:source-faithful:{version_id}:chunk-1",
                        anchor={
                            "page_start": 1,
                            "page_end": 1,
                            INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                "answer_role": "example_evidence",
                                "parent_unit_id": "handbook:national-scholarship:article-9",
                                "clause_unit_id": (
                                    f"handbook:national-scholarship:{version_id}:article-9:1"
                                ),
                                "evidence_contract_version": "answer_ready_evidence.v3",
                                "condition_subject": "paper_or_publication",
                                "condition_polarity": "positive",
                                "claim_type": "condition",
                            },
                        },
                        canonical_url="https://campus.example/handbook/national-scholarship",
                        latest_url="https://campus.example/handbook/national-scholarship",
                        source_channel="pdf_ocr",
                        collection="student_rules",
                        is_current=version_id.startswith("v2:"),
                        snippet=(
                            "第九条 在前10%的基础上，"
                            f"{'应当提交论文、著作证明材料。' if version_id.startswith('v1:') else '应当提交论文、著作或竞赛证明材料。'}"
                        ),
                        score=0.88,
                        source_title="国家奖学金评审办法",
                        structural_path=("国家奖学金评审办法",),
                        content_role="requirement",
                        detail_label="第九条",
                        is_answer_bearing=True,
                    ),
                ),
            )

        with (
            patch(
                "campus_rag_agent.service_retrieval.build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_rag_agent.service_retrieval.resolve_version_query",
                return_value=ResolvedVersionQuery(
                    mode="compare",
                    status="resolved",
                    primary_selection=ResolvedVersionSelection(
                        document_id="handbook:national-scholarship",
                        revision_track="source-faithful",
                        version_id="v1:national-scholarship",
                        anchor="previous",
                    ),
                    comparison_selection=ResolvedVersionSelection(
                        document_id="handbook:national-scholarship",
                        revision_track="source-faithful",
                        version_id="v2:national-scholarship",
                        anchor="current",
                    ),
                ),
            ),
        ):
            response = delegate_to_rag_agent(
                AgentRequest(
                    target="rag-agent",
                    user_goal="国奖第九条旧版和新版对论文、著作有什么变化？",
                    payload=RagRequestPayload(
                        scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                        version_query=VersionQuery(mode="compare"),
                    ),
                ),
                retriever=fake_retriever,
            )

        self.assertEqual(
            seen_version_ids, [("v1:national-scholarship",), ("v2:national-scholarship",)]
        )
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "compare_grounded_answer")

    def test_delegate_to_rag_agent_emits_sanitized_retrieval_observation(self) -> None:
        observations: list[dict[str, object]] = []

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            return EvidenceBundle(
                query_text=query,
                corpus=str(kwargs["corpus"]),
                collection=str(kwargs["collection"]),
                sources=(
                    _make_source(
                        chunk_id="v2:national-scholarship:chunk-1",
                        version_id="v2:national-scholarship",
                        snippet="国家奖学金评审办法正文",
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="国奖怎么办",
                request_id="req-rag-observation",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                    version_query=VersionQuery(mode="current"),
                ),
            ),
            retriever=fake_retriever,
            retrieval_observation_sink=observations.append,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["request_id"], "req-rag-observation")
        self.assertNotIn("query", observations[0])
        self.assertIn("query_sha256", observations[0])
        self.assertEqual(
            observations[0]["scope"],
            {"corpus": "regulations", "collection": "student_rules"},
        )
        self.assertEqual(observations[0]["candidate_count"], 1)

    def test_delegate_to_rag_agent_uses_freshness_gate_and_skips_retriever_when_local_surface_is_not_fresh(
        self,
    ) -> None:
        retriever_calls: list[str] = []

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            retriever_calls.append(query)
            return EvidenceBundle(
                query_text=query,
                corpus=str(kwargs["corpus"]),
                collection=str(kwargs["collection"]),
            )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="中央民族大学今天有什么讲座",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="stable_reference"),
                    version_query=VersionQuery(mode="current"),
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(retriever_calls, [])
        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.result.diagnostics.no_answer_reason, "freshness_fail_close")


def _make_source(*, chunk_id: str, version_id: str, snippet: str) -> EvidenceSource:
    return EvidenceSource(
        doc_id="handbook:national-scholarship",
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={
            "page_start": 1,
            "page_end": 1,
            INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                "answer_role": "eligibility_condition",
                "parent_unit_id": "handbook:national-scholarship:article-9",
                "clause_unit_id": f"handbook:national-scholarship:{version_id}:article-9:1",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "condition_subject": "generic_condition",
                "condition_polarity": "positive",
                "claim_type": "condition",
            },
        },
        canonical_url="https://example.edu/handbook/national-scholarship",
        latest_url="https://example.edu/handbook/national-scholarship/latest",
        source_channel="pdf_ocr",
        collection="student_rules",
        is_current=version_id.startswith("v2:"),
        snippet=snippet,
        score=0.91,
        source_title="国家奖学金评审办法",
        content_role="eligibility",
        is_answer_bearing=True,
    )


if __name__ == "__main__":
    unittest.main()
