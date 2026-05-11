from __future__ import annotations

import unittest

from campus_contracts import AgentRequest, EvidenceBundle, KnowledgeScope, RagRequestPayload
from campus_rag_agent.rag_sdk_models import RagSdkEvidenceAnchor, RagSdkRunRequest, RagSdkRunResult
from campus_rag_agent.rag_sdk_output import (
    RagSdkAnswerOutput,
    RagSdkClaim,
    RagSdkClaimSupport,
)
from campus_rag_agent.service import delegate_to_rag_agent

from tests.agent.rag_agent_test_support import _make_handbook_source


class RagAgentSdkServiceTest(unittest.TestCase):
    def test_sdk_runner_answers_after_deterministic_retrieval(self) -> None:
        captured: RagSdkRunRequest | None = None
        evidence = _evidence()
        source = evidence.sources[0]

        def runner(request: RagSdkRunRequest) -> RagSdkRunResult:
            nonlocal captured
            captured = request
            anchor = RagSdkEvidenceAnchor(
                source_id=source.doc_id,
                chunk_id=source.chunk_id,
                excerpt=source.snippet,
                span_ref="chunk-0001:0-24",
            )
            return RagSdkRunResult(
                output=RagSdkAnswerOutput(
                    answer_text="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
                    answer_kind="short_answer",
                    semantic_outcome="grounded_answer",
                    confidence="medium",
                    cited_source_ids=(source.doc_id,),
                    claims=(
                        RagSdkClaim(
                            claim_id="claim-1",
                            text="公费医疗报销需提交门诊收费票据、诊断证明和校园卡信息。",
                        ),
                    ),
                    claim_supports=(RagSdkClaimSupport(claim_id="claim-1", anchors=(anchor,)),),
                    evidence_anchors=(anchor,),
                ),
                trace_projection={"schema_version": "rag-sdk-trace-projection-v1"},
            )

        response = delegate_to_rag_agent(
            _request(),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=runner,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("门诊收费票据", response.answer_text)
        self.assertIsNotNone(captured)
        assert captured is not None
        self.assertEqual(captured.evidence.anchors[0].source_id, source.doc_id)
        self.assertEqual(response.result.diagnostics.prompt_runtime_state, "rag_sdk_completed")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")

    def test_sdk_runner_returns_answer_with_sanitized_trace_projection(self) -> None:
        captured: RagSdkRunRequest | None = None
        evidence = _evidence()
        source = evidence.sources[0]

        def runner(request: RagSdkRunRequest) -> RagSdkRunResult:
            nonlocal captured
            captured = request
            anchor = RagSdkEvidenceAnchor(
                source_id=source.doc_id,
                chunk_id=source.chunk_id,
                excerpt=source.snippet,
                span_ref="chunk-0001:0-24",
            )
            return RagSdkRunResult(
                output=RagSdkAnswerOutput(
                    answer_text="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
                    answer_kind="short_answer",
                    semantic_outcome="grounded_answer",
                    confidence="medium",
                    cited_source_ids=(source.doc_id,),
                    claims=(
                        RagSdkClaim(
                            claim_id="claim-1",
                            text="公费医疗报销需提交门诊收费票据、诊断证明和校园卡信息。",
                        ),
                    ),
                    claim_supports=(RagSdkClaimSupport(claim_id="claim-1", anchors=(anchor,)),),
                    evidence_anchors=(anchor,),
                ),
                trace_projection={
                    "schema_version": "rag-sdk-trace-projection-v1",
                    "runtime": "openai_agents_sdk",
                    "tool_names": ["retrieve_evidence"],
                    "latency_ms": 12,
                },
            )

        response = delegate_to_rag_agent(
            _request(),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=runner,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured)
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        trace_projection = response.agent_observability.safe_details["rag_sdk_trace_projection"]
        self.assertEqual(trace_projection["schema_version"], "rag-sdk-trace-projection-v1")
        self.assertNotIn("raw_prompt", str(response.agent_observability.safe_details))

    def test_sdk_guardrail_failure_fails_closed_without_legacy_blend(self) -> None:
        evidence = _evidence()
        source = evidence.sources[0]

        def runner(_request: RagSdkRunRequest) -> RagSdkRunResult:
            return RagSdkRunResult(
                output=RagSdkAnswerOutput(
                    answer_text="模型编造了额外办理地点。",
                    answer_kind="short_answer",
                    semantic_outcome="grounded_answer",
                    confidence="medium",
                    cited_source_ids=(source.doc_id,),
                    claims=(RagSdkClaim(claim_id="claim-1", text="模型编造了额外办理地点。"),),
                    claim_supports=(),
                )
            )

        response = delegate_to_rag_agent(
            _request(),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=runner,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertEqual(response.result.diagnostics.no_answer_reason, "")
        self.assertEqual(response.result.diagnostics.fail_close_reason, "rag_sdk_guardrail_failed")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "fail_closed_generation")
        self.assertEqual(
            response.result.diagnostics.prompt_runtime_state, "rag_sdk_guardrail_failed"
        )
        self.assertNotIn("报销时，应提交", response.answer_text)

    def test_sdk_unsafe_trace_projection_fails_closed(self) -> None:
        evidence = _evidence()
        source = evidence.sources[0]

        def runner(_request: RagSdkRunRequest) -> RagSdkRunResult:
            anchor = RagSdkEvidenceAnchor(
                source_id=source.doc_id,
                chunk_id=source.chunk_id,
                excerpt=source.snippet,
                span_ref="chunk-0001:0-24",
            )
            return RagSdkRunResult(
                output=RagSdkAnswerOutput(
                    answer_text="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
                    answer_kind="short_answer",
                    semantic_outcome="grounded_answer",
                    confidence="medium",
                    cited_source_ids=(source.doc_id,),
                    claims=(
                        RagSdkClaim(
                            claim_id="claim-1",
                            text="公费医疗报销需提交门诊收费票据、诊断证明和校园卡信息。",
                        ),
                    ),
                    claim_supports=(RagSdkClaimSupport(claim_id="claim-1", anchors=(anchor,)),),
                    evidence_anchors=(anchor,),
                ),
                trace_projection={
                    "schema_version": "rag-sdk-trace-projection-v1",
                    "raw_prompt": "forbidden",
                },
            )

        response = delegate_to_rag_agent(
            _request(),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=runner,
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "rag_sdk_runtime_failed")
        self.assertEqual(response.result.diagnostics.no_answer_reason, "")
        self.assertEqual(response.result.diagnostics.fail_close_reason, "rag_sdk_runtime_failed")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "runtime_error")

    def test_direct_service_requires_explicit_sdk_runner(self) -> None:
        response = delegate_to_rag_agent(
            _request(),
            retriever=lambda *args, **kwargs: _evidence(),
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "rag_sdk_runtime_unavailable")
        self.assertEqual(response.result.diagnostics.no_answer_reason, "")
        self.assertEqual(response.result.diagnostics.fail_close_reason, "rag_sdk_runtime_unavailable")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "runtime_error")


def _request() -> AgentRequest:
    return AgentRequest(
        target="rag-agent",
        user_goal="公费医疗报销需要什么材料",
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        ),
    )


def _evidence() -> EvidenceBundle:
    return EvidenceBundle(
        query_text="公费医疗报销需要什么材料",
        corpus="regulations",
        collection="student_rules",
        sources=(
            _make_handbook_source(
                doc_id="handbook:medical",
                title="中央民族大学学生公费医疗管理办法",
                snippet="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
                score=0.91,
                chunk_id_suffix="medical-support-1",
                content_role="requirement",
                is_answer_bearing=True,
            ),
        ),
    )


if __name__ == "__main__":
    unittest.main()
