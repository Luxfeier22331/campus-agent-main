from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_contracts import (
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    SpecialistRequest,
    VersionQuery,
)
from campus_ingestion_core.version_resolution import ResolvedVersionQuery, ResolvedVersionSelection
from campus_rag_agent.retrieval_plan import build_ordered_retrieval_plan
from campus_rag_agent.service import delegate_to_rag_agent


class RagRetrievalPlanTest(unittest.TestCase):
    def test_build_ordered_retrieval_plan_uses_single_step_for_current_query(self) -> None:
        plan = build_ordered_retrieval_plan(
            query_text="国奖怎么办",
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            retrieval_collection="student_handbook",
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
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            retrieval_collection="student_handbook",
            query_mode="compare",
            target_document_ids=("handbook:national-scholarship",),
            top_k=3,
            version_query=VersionQuery(mode="compare"),
            primary_version_id="v1:national-scholarship",
            comparison_version_id="v2:national-scholarship",
        )

        self.assertEqual(plan.query_mode, "compare")
        self.assertEqual(plan.budget.max_steps, 3)
        self.assertEqual(len(plan.steps), 2)
        self.assertEqual(plan.steps[0].step_id, "indexed-lookup-primary")
        self.assertEqual(plan.steps[1].step_id, "indexed-lookup-comparison")
        self.assertEqual(plan.steps[0].selector.target_version_ids, ("v1:national-scholarship",))
        self.assertEqual(plan.steps[1].selector.target_version_ids, ("v2:national-scholarship",))

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
                collection="student_handbook",
                sources=(
                    _make_source(
                        chunk_id=f"{version_id}:chunk-1",
                        version_id=version_id,
                        snippet=f"{version_id} 第九条要求",
                    ),
                ),
            )

        with (
            patch(
                "campus_rag_agent.service.build_document_registry_from_env", return_value=object()
            ),
            patch(
                "campus_rag_agent.service.resolve_version_query",
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
                SpecialistRequest(
                    target="rag-agent",
                    user_goal="国奖第九条旧版和新版有什么变化？",
                    payload=RagRequestPayload(
                        scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
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
            SpecialistRequest(
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
        anchor={"page_start": 1, "page_end": 1},
        canonical_url="https://example.edu/handbook/national-scholarship",
        latest_url="https://example.edu/handbook/national-scholarship/latest",
        source_channel="pdf_ocr",
        collection="student_handbook",
        is_current=version_id.startswith("v2:"),
        snippet=snippet,
        score=0.91,
        source_title="国家奖学金评审办法",
    )


if __name__ == "__main__":
    unittest.main()
