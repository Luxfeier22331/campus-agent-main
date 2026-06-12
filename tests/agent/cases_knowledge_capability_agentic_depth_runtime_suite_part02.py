# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.knowledge_capability_agentic_depth_runtime_suite_support import *


class KnowledgeCapabilityAgenticDepthRuntimeTestPart02(unittest.TestCase):
    def test_delegate_to_knowledge_capability_replans_rank_query_when_only_group_example_is_returned(
        self,
    ) -> None:
        calls: list[str] = []

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            calls.append(query)
            if len(calls) == 1:
                return EvidenceBundle(
                    query_text=query,
                    corpus=str(kwargs["corpus"]),
                    collection=str(kwargs["collection"]),
                    sources=(
                        _make_handbook_source(
                            doc_id="handbook:national-scholarship",
                            title="中央民族大学本科学生国家奖学金评审办法",
                            snippet="且在学术研究上取得显著成绩。",
                            score=0.91,
                            chunk_id_suffix="national-scholarship-rank-group-example",
                            content_role="eligibility",
                            is_answer_bearing=True,
                            semantic_role="example_evidence",
                            polarity="positive",
                            claim_type="condition",
                            anchor={
                                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                    "answer_role": "example_evidence",
                                    "condition_subject": "paper_or_publication",
                                    "condition_group_subject": "rank_threshold",
                                    "condition_group_id": (
                                        "handbook:national-scholarship:article-9:"
                                        "group-01:rank_threshold"
                                    ),
                                    "parent_unit_id": "handbook:national-scholarship:article-9",
                                    "evidence_contract_version": "answer_ready_evidence.v3",
                                    "polarity": "positive",
                                    "claim_type": "condition",
                                },
                                "page_start": 1,
                                "page_end": 1,
                            },
                        ),
                    ),
                )
            return EvidenceBundle(
                query_text=query,
                corpus=str(kwargs["corpus"]),
                collection=str(kwargs["collection"]),
                sources=(
                    _make_handbook_source(
                        doc_id="handbook:national-scholarship",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet=(
                            "学习成绩排名或综合测评排名超出前10%,但均位于前30%,"
                            "且单科成绩不低于80分。"
                        ),
                        score=0.79,
                        chunk_id_suffix="national-scholarship-rank-exception",
                        content_role="eligibility",
                        is_answer_bearing=True,
                        semantic_role="exception_rule",
                        polarity="positive",
                        claim_type="condition",
                        anchor={
                            INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                "answer_role": "exception_rule",
                                "condition_subject": "rank_threshold",
                                "condition_group_subject": "rank_threshold",
                                "condition_group_id": (
                                    "handbook:national-scholarship:article-9:"
                                    "group-01:rank_threshold"
                                ),
                                "parent_unit_id": "handbook:national-scholarship:article-9",
                                "evidence_contract_version": "answer_ready_evidence.v3",
                                "polarity": "positive",
                                "claim_type": "condition",
                            },
                            "page_start": 1,
                            "page_end": 1,
                        },
                    ),
                ),
            )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="成绩没前十还能评国奖吗",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("成绩没前十还能评国奖吗", calls[0])
        self.assertEqual(len(calls), 3)
        self.assertIn("前10", calls[1])
        self.assertIn("前30", calls[1])
        self.assertIn("前10", calls[2])
        self.assertIn("前30", calls[2])
        self.assertEqual(response.result.diagnostics.retrieval_plan_summary.replan_count, 1)
        self.assertEqual(
            response.result.diagnostics.replan_decision_summary.trigger_reason,
            "group_support_missing",
        )

    def test_deterministic_answer_fails_closed_when_material_claim_lacks_support(self) -> None:
        evidence = EvidenceBundle(
            query_text="公费医疗报销需要什么材料",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:medical",
                    title="中央民族大学学生公费医疗管理办法",
                    snippet="学生申请公费医疗报销时，应提交门诊收费票据和诊断证明。",
                    score=0.91,
                    chunk_id_suffix="medical-grounding-support",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
            ),
        )

        class UnsupportedClaimAgent:
            def build_answer(self, _evidence):
                from campus_knowledge_capability.answer_runtime import AnswerDraft

                return AnswerDraft(
                    answer_text="需要门诊收费票据、诊断证明和银行卡。",
                    supporting_sources=evidence.sources,
                )

        with patch("tests.agent.knowledge_capability_test_support.KnowledgeCapability", UnsupportedClaimAgent):
            response = delegate_to_knowledge_capability(
                CapabilityRequest(
                    capability="knowledge",
                    user_goal="公费医疗报销需要什么材料",
                    payload=RagRequestPayload(
                        scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                    ),
                ),
                retriever=lambda *args, **kwargs: evidence,
            )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.result.diagnostics.no_answer_reason, "insufficient_grounding")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "unsupported")
        self.assertTrue(
            any(
                entry.support_status == "unsupported"
                for entry in response.result.diagnostics.claim_evidence_graph
            )
        )

    def test_completed_answer_diagnostics_include_claim_evidence_graph(self) -> None:
        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="公费医疗报销需要什么材料",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: _medical_evidence(
                query_text="公费医疗报销需要什么材料"
            ),
        )

        graph = response.result.diagnostics.claim_evidence_graph
        self.assertTrue(graph)
        self.assertEqual(graph[0].support_status, "supported")
        self.assertEqual(graph[0].support_source_doc_ids, ("handbook:medical",))

    def test_no_answer_diagnostics_preserve_planner_information_needs(self) -> None:
        query_text = "解除处分需要什么条件，并说明申请流程"
        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal=query_text,
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text=query_text,
                corpus="regulations",
                collection="student_rules",
                sources=(),
            ),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(
            tuple(
                need.expected_evidence_kind
                for need in response.result.diagnostics.planner_information_needs
            ),
            ("procedure_steps",),
        )

    def test_diagnostics_preserve_semantic_replan_summary(self) -> None:
        source = _medical_source("medical-replan-support")
        execution_result = RetrievalExecutionResult(
            plan=_single_step_plan(),
            replan_count=1,
            merged_evidence=EvidenceBundle(
                query_text="公费医疗报销需要什么材料",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            step_results=(
                RetrievalStepResult(
                    step_id="indexed-lookup",
                    status="succeeded",
                    grounding=(source,),
                    references=(source,),
                    activity=RetrievalStepActivity(
                        step_id="indexed-lookup",
                        step_type="indexed_lookup",
                        corpus="regulations",
                        collection="student_rules",
                        status="succeeded",
                        query_text="公费医疗报销需要什么材料",
                        top_k=2,
                        candidate_count=1,
                        reference_count=1,
                    ),
                ),
            ),
        )

        diagnostics = _build_rag_result_diagnostics(
            evidence=execution_result.merged_evidence,
            resolved_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            handbook_plan=None,
            retrieval_execution_result=execution_result,
        )

        self.assertIsNotNone(diagnostics.replan_decision_summary)
        self.assertEqual(diagnostics.replan_decision_summary.replan_count, 1)
        self.assertEqual(diagnostics.replan_decision_summary.trigger_reason, "evidence_expansion")


if __name__ == "__main__":
    unittest.main()
