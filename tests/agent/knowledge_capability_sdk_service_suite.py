from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import (
    CapabilityRequest,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
    WorkflowCapabilityContext,
)
from campus_knowledge_capability.rag_sdk_models import (
    RagSdkEvidenceAnchor,
    RagSdkRunRequest,
    RagSdkRunResult,
)
from campus_knowledge_capability.rag_sdk_output import (
    RagSdkAnswerOutput,
    RagSdkClaim,
    RagSdkClaimSupport,
)
from campus_knowledge_capability.service import delegate_to_knowledge_capability
from campus_knowledge_capability.service_answer_synthesis import build_required_rag_sdk_response
from campus_retrieval_core import RetrievalPlan, RetrievalPlanBudget, RetrievalScope, RetrievalStep
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY
from campus_retrieval_core.models import RetrievalSelector

from tests.agent.knowledge_capability_test_support import _make_handbook_source
from tests.agent.knowledge_capability_test_support_evidence import _make_program_semester_source


class KnowledgeCapabilitySdkServiceTest(unittest.TestCase):
    def test_sdk_runner_synthesis_required_returns_sanitized_packet_projection(self) -> None:
        evidence = _evidence()

        def runner(request: RagSdkRunRequest) -> RagSdkRunResult:
            return RagSdkRunResult(
                output=None,
                failure_class="go_provider_synthesis_required",
                failure_detail="RAG synthesis must be executed by execution-control provider adapter.",
                trace_projection={
                    "schema_version": "rag-sdk-trace-projection-v1",
                    "runtime": "execution_control_go_provider_synthesis",
                    "rag_synthesis_packet": {
                        "run_id": "run-rag-packet",
                        "step_id": "synthesis",
                        "request_id": request.request_id,
                        "query_intent": request.query_intent.normalized_query,
                        "output_schema_id": "rag_answer_v1",
                        "payload_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "prompt_refs": ("prompt://rag/rag_answer_v1",),
                        "selected_evidence": (
                            {
                                "source_id": evidence.sources[0].doc_id,
                                "chunk_id": evidence.sources[0].chunk_id,
                                "span_ref": "chunk-0001:0-24",
                                "excerpt": evidence.sources[0].snippet,
                                "source_ref": "source://student_rules",
                                "title": evidence.sources[0].source_title,
                            },
                        ),
                    },
                },
            )

        response = delegate_to_knowledge_capability(
            _request_with_workflow_context(),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=runner,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.capability_observability)
        assert response.capability_observability is not None
        packet = response.capability_observability.safe_details["rag_synthesis_packet"]
        self.assertEqual(packet["run_id"], "run-rag-packet")
        self.assertEqual(packet["step_id"], "synthesis")
        self.assertEqual(packet["output_schema_id"], "rag_answer_v1")
        self.assertNotIn("raw_prompt", str(packet))

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

        response = delegate_to_knowledge_capability(
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

    def test_sdk_runner_receives_canonical_curriculum_query_for_semester_lookup(self) -> None:
        captured: RagSdkRunRequest | None = None
        evidence = EvidenceBundle(
            query_text="法学民族实验班培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="program_semester_facts",
            sources=(
                _make_program_semester_source(
                    source_document_id="curriculum:法学（民族实验班）本科人才培养方案",
                    semester_label="第四学期",
                    snippet="第四学期有侵权责任法、公司法、翻译学导论。",
                    score=0.95,
                ),
            ),
        )
        source = evidence.sources[0]

        def runner(request: RagSdkRunRequest) -> RagSdkRunResult:
            nonlocal captured
            captured = request
            anchor = RagSdkEvidenceAnchor(
                source_id=source.doc_id,
                chunk_id=source.chunk_id,
                excerpt=source.snippet,
                span_ref="row-0001:0-17",
            )
            return RagSdkRunResult(
                output=RagSdkAnswerOutput(
                    answer_text="根据培养方案相关内容，第四学期有侵权责任法、公司法、翻译学导论。",
                    answer_kind="short_answer",
                    semantic_outcome="grounded_answer",
                    confidence="medium",
                    cited_source_ids=(source.doc_id,),
                    claims=(
                        RagSdkClaim(
                            claim_id="claim-1",
                            text="第四学期有侵权责任法、公司法、翻译学导论。",
                        ),
                    ),
                    claim_supports=(RagSdkClaimSupport(claim_id="claim-1", anchors=(anchor,)),),
                    evidence_anchors=(anchor,),
                ),
                trace_projection={"schema_version": "rag-sdk-trace-projection-v1"},
            )

        response = delegate_to_knowledge_capability(
            _curriculum_request(),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=runner,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured)
        assert captured is not None
        self.assertEqual(captured.user_goal, evidence.query_text)
        self.assertEqual(captured.query_intent.normalized_query, evidence.query_text)
        self.assertEqual(captured.evidence.query_text, evidence.query_text)
        self.assertIn("第四学期有侵权责任法", response.answer_text)

    def test_sdk_fails_closed_when_retrieval_intent_is_missing(self) -> None:
        request = _request()
        evidence = _evidence()
        runner_calls = 0

        def runner(_request: RagSdkRunRequest) -> RagSdkRunResult:
            nonlocal runner_calls
            runner_calls += 1
            raise AssertionError("rag sdk runner must not be called without retrieval intent")

        response = build_required_rag_sdk_response(
            request=request,
            resolved_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            user_goal=request.user_goal,
            supporting_evidence=evidence,
            retrieved_evidence=evidence,
            retrieval_plan=_retrieval_plan(),
            retrieval_execution_result=None,
            handbook_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
            confidence="medium",
            intent_frame=None,
            runner=runner,
            retrieval_intent=None,
        )

        self.assertEqual(response.status, "error")
        assert response.error is not None
        self.assertEqual(response.error.code, "rag_sdk_runtime_failed")
        self.assertEqual(response.error.message, "rag_sdk_answer_query_missing")
        self.assertEqual(response.result.diagnostics.fail_close_reason, "rag_sdk_runtime_failed")
        self.assertEqual(
            response.result.diagnostics.prompt_runtime_detail, "rag_sdk_answer_query_missing"
        )
        self.assertEqual(runner_calls, 0)

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

        response = delegate_to_knowledge_capability(
            _request(),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=runner,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured)
        self.assertIsNotNone(response.capability_observability)
        assert response.capability_observability is not None
        trace_projection = response.capability_observability.safe_details[
            "rag_sdk_trace_projection"
        ]
        self.assertEqual(trace_projection["schema_version"], "rag-sdk-trace-projection-v1")
        self.assertNotIn("raw_prompt", str(response.capability_observability.safe_details))

    def test_sdk_receives_answer_selected_evidence_order_for_condition_table(self) -> None:
        captured: RagSdkRunRequest | None = None
        evidence = _professional_scholarship_amount_evidence()
        table_source = evidence.sources[2]

        def runner(request: RagSdkRunRequest) -> RagSdkRunResult:
            nonlocal captured
            captured = request
            lead_anchor = request.evidence.anchors[0]
            return RagSdkRunResult(
                output=RagSdkAnswerOutput(
                    answer_text="专业一等奖学奖金奖励标准为2000元。",
                    answer_kind="short_answer",
                    semantic_outcome="grounded_answer",
                    confidence="medium",
                    cited_source_ids=(lead_anchor.source_id,),
                    claims=(
                        RagSdkClaim(
                            claim_id="claim-1",
                            text="专业一等奖学奖金奖励标准为2000元。",
                            claim_type="table_fact",
                        ),
                    ),
                    claim_supports=(
                        RagSdkClaimSupport(claim_id="claim-1", anchors=(lead_anchor,)),
                    ),
                    evidence_anchors=(lead_anchor,),
                ),
                trace_projection={"schema_version": "rag-sdk-trace-projection-v1"},
            )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="专业奖学金一等奖金额是多少？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=runner,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured)
        assert captured is not None
        self.assertEqual(captured.evidence.anchors[0].chunk_id, table_source.chunk_id)
        self.assertEqual(response.result.evidence.sources[0].chunk_id, table_source.chunk_id)

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

        response = delegate_to_knowledge_capability(
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

        response = delegate_to_knowledge_capability(
            _request(),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=runner,
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "rag_sdk_runtime_failed")
        self.assertEqual(response.result.diagnostics.no_answer_reason, "")
        self.assertEqual(response.result.diagnostics.fail_close_reason, "rag_sdk_runtime_failed")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "runtime_error")

    def test_policy_object_identity_completes_without_sdk_runner(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        source = _make_handbook_source(
            doc_id="handbook:national-scholarship",
            title=title,
            snippet="第一条 为奖励特别优秀的全日制本科学生，设立国家奖学金。",
            score=0.33,
            chunk_id_suffix="national-scholarship-policy-object-identity",
            content_role="requirement",
            is_answer_bearing=True,
            semantic_role="eligibility_condition",
            polarity="positive",
            claim_type="condition",
        )
        evidence = EvidenceBundle(
            query_text=title,
            corpus="regulations",
            collection="student_rules",
            sources=(source,),
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal=title,
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn(f"《{title}》", response.answer_text)
        self.assertEqual(
            response.result.diagnostics.prompt_runtime_state, "deterministic_typed_answer"
        )
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertEqual(response.result.diagnostics.answer_presentation_kind, "document_identity")

    def test_direct_service_requires_explicit_sdk_runner(self) -> None:
        response = delegate_to_knowledge_capability(
            _request(),
            retriever=lambda *args, **kwargs: _evidence(),
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "rag_sdk_runtime_unavailable")
        self.assertEqual(response.result.diagnostics.no_answer_reason, "")
        self.assertEqual(
            response.result.diagnostics.fail_close_reason, "rag_sdk_runtime_unavailable"
        )
        self.assertEqual(response.result.diagnostics.semantic_outcome, "runtime_error")


def _request() -> CapabilityRequest:
    return CapabilityRequest(
        capability="knowledge",
        user_goal="公费医疗报销需要什么材料",
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        ),
    )


def _request_with_workflow_context() -> CapabilityRequest:
    return replace(
        _request(),
        workflow_context=WorkflowCapabilityContext(
            workflow_run_ref="run-rag-packet",
            step_id="semantic.rag",
            capability_id="knowledge",
            capability="knowledge",
        ),
    )


def _curriculum_request() -> CapabilityRequest:
    return CapabilityRequest(
        capability="knowledge",
        user_goal="法学民族班培养方案里大二下有什么课",
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
        ),
    )


def _retrieval_plan() -> RetrievalPlan:
    scope = RetrievalScope(corpus="regulations", collection="student_rules")
    return RetrievalPlan(
        plan_id="regulations:student_rules:single-step",
        query_mode="current",
        admitted_scopes=(scope,),
        steps=(
            RetrievalStep(
                step_id="indexed-lookup",
                step_type="indexed_lookup",
                scope=scope,
                query_text="公费医疗报销需要什么材料",
                selector=RetrievalSelector(),
            ),
        ),
        budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
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


def _professional_scholarship_amount_evidence() -> EvidenceBundle:
    doc_id = "handbook:professional-scholarship"
    title = "中央民族大学本科学生专业奖学金评定办法"
    return EvidenceBundle(
        query_text="专业奖学金一等奖金额是多少？",
        corpus="regulations",
        collection="student_rules",
        sources=(
            _condition_source(
                doc_id=doc_id,
                title=title,
                snippet="专业一等奖学金从班内综合测评排名前10%以内评选,按应参评学生人数的5%评定。",
                chunk_id_suffix="professional-scholarship-quota-1",
            ),
            _condition_source(
                doc_id=doc_id,
                title=title,
                snippet="专业二等奖学金从班内综合测评排名前25%以内评选,按应参评学生人数的15%评定。",
                chunk_id_suffix="professional-scholarship-quota-2",
            ),
            replace(
                _make_handbook_source(
                    doc_id=doc_id,
                    title=title,
                    snippet="专业一等奖学奖金奖励标准为2000元,专业二等奖学奖金奖励标准为1200元。",
                    score=0.9,
                    chunk_id_suffix="professional-scholarship-amount",
                    detail_label="第十六条",
                    content_role="table_fact",
                    is_answer_bearing=True,
                    semantic_role="table_fact",
                    claim_type="amount_or_quota",
                ),
                content_kind="table_unit",
                anchor=_answer_ready_anchor(
                    doc_id=doc_id,
                    answer_role="table_fact",
                    condition_subject="amount_or_quota",
                    condition_polarity="positive",
                    semantic_role="table_fact",
                    claim_type="amount_or_quota",
                    table_fact_type="amount_or_quota",
                ),
            ),
        ),
    )


def _condition_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    chunk_id_suffix: str,
):
    return replace(
        _make_handbook_source(
            doc_id=doc_id,
            title=title,
            snippet=snippet,
            score=0.91,
            chunk_id_suffix=chunk_id_suffix,
            detail_label="第十二条",
            content_role="eligibility",
            is_answer_bearing=True,
            semantic_role="eligibility_condition",
            claim_type="condition",
        ),
        anchor=_answer_ready_anchor(
            doc_id=doc_id,
            answer_role="eligibility_condition",
            condition_subject="amount_or_quota",
            condition_polarity="positive",
            semantic_role="condition",
            claim_type="condition",
        ),
    )


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    doc_id = str(metadata.pop("doc_id"))
    return {
        INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
            "evidence_contract_version": "answer_ready_evidence.v3",
            "parent_unit_id": f"{doc_id}:article-1",
            "condition_group_subject": metadata.get("condition_subject"),
            "condition_group_id": f"{doc_id}:article-1:{metadata.get('condition_subject')}",
            "condition_subject_taxonomy_version": "condition_subject.v1",
            "condition_subject_provenance": "suite-fixture",
            **metadata,
        }
    }


if __name__ == "__main__":
    unittest.main()
