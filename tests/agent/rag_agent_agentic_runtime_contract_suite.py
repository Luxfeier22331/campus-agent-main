from __future__ import annotations

import unittest

import campus_contracts
from campus_contracts import (
    AgentRequest,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
)
from campus_rag_agent.agent_answer_shape import AnswerShape, infer_answer_shape
from campus_rag_agent.confidence import derive_confidence
from campus_rag_agent.rag_sdk_models import RagSdkEvidenceAnchor, RagSdkRunRequest, RagSdkRunResult
from campus_rag_agent.rag_sdk_output import (
    RagSdkAnswerOutput,
    RagSdkClaim,
    RagSdkClaimSupport,
)
from campus_rag_agent.runtime_stages import (
    RAG_AGENT_RUNTIME_STAGES,
    resolve_stage_contract,
)
from campus_rag_agent.service import delegate_to_rag_agent
from campus_rag_agent.service_evidence_stage import execute_rag_evidence_selection_stage
from campus_rag_agent.service_planner_stage import execute_rag_planner_stage
from campus_rag_agent.service_versioning_context import _VersionAnswerContext
from campus_retrieval_core import (
    RetrievalExecutionResult,
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepActivity,
    RetrievalStepBudget,
    RetrievalStepResult,
)

from tests.agent.rag_agent_test_support import _make_handbook_source


class RagAgentAgenticRuntimeContractTest(unittest.TestCase):
    def test_title_lookup_shape_cannot_turn_weak_title_hit_into_completed_answer(self) -> None:
        title = "中央民族大学学生公费医疗管理办法"
        evidence = EvidenceBundle(
            query_text=f"查看{title}",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:medical",
                    title=title,
                    snippet="目录 公费医疗管理办法 附表 文件下载",
                    score=0.91,
                    chunk_id_suffix="medical-title-weak-hit",
                    content_role="navigation",
                    is_answer_bearing=False,
                ),
            ),
        )

        self.assertEqual(infer_answer_shape(evidence=evidence), AnswerShape.TITLE_LOOKUP)

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal=f"查看{title}",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertEqual(
            response.result.diagnostics.semantic_outcome,
            "unsupported_by_evidence",
        )
        self.assertEqual(
            response.result.diagnostics.retrieval_adequacy_reason,
            "weak_supporting_evidence",
        )
        stage_by_name = {
            stage.stage_name: stage for stage in response.result.diagnostics.stage_activities
        }
        self.assertEqual(stage_by_name["planner"].stage_status, "completed")
        self.assertEqual(stage_by_name["retrieval"].candidate_count, 1)
        self.assertEqual(stage_by_name["evidence_selection"].stage_status, "failed_closed")
        self.assertEqual(
            stage_by_name["evidence_selection"].fallback_reason,
            "weak_supporting_evidence",
        )

    def test_discovery_query_shape_uses_category_discovery_list_for_regulation_family(self) -> None:
        evidence = EvidenceBundle(
            query_text="学校层面的学生管理制度有哪些",
            corpus="regulations",
            collection="institutional_rules",
            sources=(
                _make_handbook_source(
                    doc_id="official_web_regulation:0a420e3fe367027c",
                    title="校园服务制度目录",
                    snippet=(
                        "当前已收录依据中，校园成员校园服务制度相关制度包括："
                        "《中央民族大学信息公开实施细则》、"
                        "《中央民族大学信息门户运行管理办法（试行）》。"
                    ),
                    score=0.91,
                    chunk_id_suffix="institutional-category-overview",
                    content_role="policy_list",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(
            infer_answer_shape(evidence=evidence),
            AnswerShape.CATEGORY_DISCOVERY_LIST,
        )

    def test_completed_answer_preserves_retrieval_step_provenance_on_supporting_evidence(
        self,
    ) -> None:
        evidence = EvidenceBundle(
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
                _make_handbook_source(
                    doc_id="handbook:medical",
                    title="中央民族大学学生公费医疗管理办法",
                    snippet="报销材料经校医院审核后，按学校公费医疗管理办法办理。",
                    score=0.88,
                    chunk_id_suffix="medical-support-2",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="公费医疗报销需要什么材料",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=_grounded_runner_for_evidence(evidence),
        )

        self.assertEqual(response.status, "completed")
        for source in response.result.evidence.sources:
            self.assertEqual(
                source.anchor["retrieval_plan_id"],
                "regulations:student_rules:current",
            )
            self.assertEqual(source.anchor["retrieval_step_ids"], ("indexed-lookup",))
            self.assertEqual(source.anchor["retrieval_replan_count"], 0)

    def test_executable_retrieval_seam_types_are_not_public_contracts(self) -> None:
        executable_type_names = (
            "RetrievalPlan",
            "RetrievalStep",
            "RetrievalStepResult",
            "RetrievalExecutionResult",
        )

        for type_name in executable_type_names:
            with self.subTest(type_name=type_name):
                self.assertNotIn(type_name, campus_contracts.__all__)
                self.assertFalse(hasattr(campus_contracts, type_name))

        self.assertIn("RetrievalPlanSummary", campus_contracts.__all__)
        self.assertIn("RetrievalStepActivitySummary", campus_contracts.__all__)

    def test_agentic_runtime_stage_contract_is_explicit_and_ordered(self) -> None:
        self.assertEqual(
            tuple(stage.stage_name for stage in RAG_AGENT_RUNTIME_STAGES),
            (
                "planner",
                "retrieval",
                "evidence_selection",
                "synthesis",
                "grounding",
            ),
        )

        planner = resolve_stage_contract("planner")
        retrieval = resolve_stage_contract("retrieval")
        evidence = resolve_stage_contract("evidence_selection")
        synthesis = resolve_stage_contract("synthesis")
        grounding = resolve_stage_contract("grounding")

        self.assertEqual(planner.owner, "packages/rag-agent")
        self.assertIn("RetrievalPlan", planner.output_artifacts)
        self.assertEqual(retrieval.owner, "packages/retrieval-core")
        self.assertIn("RetrievalStepResult", retrieval.output_artifacts)
        self.assertIn("supporting EvidenceBundle", evidence.output_artifacts)
        self.assertNotIn("answer success", synthesis.allowed_legacy_heuristic_authority)
        self.assertEqual(grounding.fail_close_semantic, "insufficient_grounding")

    def test_evidence_selection_stage_returns_support_bundle_and_confidence(self) -> None:
        evidence = EvidenceBundle(
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
                _make_handbook_source(
                    doc_id="handbook:medical",
                    title="中央民族大学学生公费医疗管理办法",
                    snippet="报销材料经校医院审核后，按学校公费医疗管理办法办理。",
                    score=0.88,
                    chunk_id_suffix="medical-support-2",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = execute_rag_evidence_selection_stage(
            retrieved_evidence=evidence,
            version_answer_context=_VersionAnswerContext(),
        )

        self.assertIsNone(result.response)
        self.assertEqual(result.supporting_evidence.sources, evidence.sources)
        self.assertEqual(result.confidence, derive_confidence(result.supporting_evidence))
        self.assertIn(result.confidence, {"medium", "high"})
        self.assertFalse(result.compare_support_incomplete)

    def test_evidence_selection_stage_preserves_step_level_support_provenance(self) -> None:
        primary_source = _make_handbook_source(
            doc_id="handbook:medical",
            title="中央民族大学学生公费医疗管理办法",
            snippet="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
            score=0.91,
            chunk_id_suffix="medical-support-primary",
            content_role="requirement",
            is_answer_bearing=True,
        )
        follow_up_source = _make_handbook_source(
            doc_id="handbook:medical",
            title="中央民族大学学生公费医疗管理办法",
            snippet="报销材料经校医院审核后，按学校公费医疗管理办法办理。",
            score=0.88,
            chunk_id_suffix="medical-support-follow-up",
            content_role="procedure",
            is_answer_bearing=True,
        )
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:current",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            source_trust_policy=RetrievalSourceTrustPolicy(minimum_tier="T1"),
            steps=(
                RetrievalStep(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="公费医疗报销需要什么材料",
                    selector=RetrievalSelector(),
                    budget=RetrievalStepBudget(top_k=2),
                ),
                RetrievalStep(
                    step_id="indexed-lookup-follow-up",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="公费医疗报销材料",
                    depends_on_step_ids=("indexed-lookup",),
                    selector=RetrievalSelector(),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )
        execution_result = RetrievalExecutionResult(
            plan=plan,
            replan_count=1,
            merged_evidence=EvidenceBundle(
                query_text="公费医疗报销需要什么材料",
                corpus="regulations",
                collection="student_rules",
                sources=(primary_source, follow_up_source),
            ),
            step_results=(
                RetrievalStepResult(
                    step_id="indexed-lookup",
                    status="succeeded",
                    grounding=(primary_source,),
                    references=(primary_source,),
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
                RetrievalStepResult(
                    step_id="indexed-lookup-follow-up",
                    status="succeeded",
                    grounding=(follow_up_source,),
                    references=(follow_up_source,),
                    activity=RetrievalStepActivity(
                        step_id="indexed-lookup-follow-up",
                        step_type="indexed_lookup",
                        corpus="regulations",
                        collection="student_rules",
                        status="succeeded",
                        query_text="公费医疗报销材料",
                        top_k=2,
                        candidate_count=1,
                        reference_count=1,
                    ),
                ),
            ),
        )

        result = execute_rag_evidence_selection_stage(
            retrieved_evidence=execution_result.merged_evidence,
            version_answer_context=_VersionAnswerContext(),
            retrieval_execution_result=execution_result,
        )

        provenance_by_chunk = {
            source.chunk_id: source.anchor for source in result.supporting_evidence.sources
        }
        self.assertEqual(
            provenance_by_chunk[primary_source.chunk_id]["retrieval_step_ids"],
            ("indexed-lookup",),
        )
        self.assertEqual(
            provenance_by_chunk[follow_up_source.chunk_id]["retrieval_step_ids"],
            ("indexed-lookup-follow-up",),
        )
        self.assertEqual(
            provenance_by_chunk[follow_up_source.chunk_id]["retrieval_plan_id"],
            "regulations:student_rules:current",
        )
        self.assertEqual(result.step_support_count, 2)

    def test_planner_stage_returns_retrieval_context_without_executing_retrieval(self) -> None:
        request = AgentRequest(
            target="rag-agent",
            user_goal="公费医疗报销需要什么材料",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
        )

        result = execute_rag_planner_stage(
            request=request,
            effective_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
        )

        self.assertIsNone(result.response)
        self.assertIsNotNone(result.retrieval_context)
        self.assertEqual(result.retrieval_context.retrieval_goal, request.user_goal)
        self.assertEqual(result.retrieval_context.retrieval_collection, "student_rules")
        self.assertEqual(result.retrieval_context.version_answer_context.mode, "current")
        self.assertIsNotNone(result.retrieval_plan)
        self.assertEqual(result.retrieval_plan.plan_id, "regulations:student_rules:current")
        self.assertEqual(result.retrieval_plan.steps[0].step_type, "indexed_lookup")


if __name__ == "__main__":
    unittest.main()


def _grounded_runner_for_evidence(evidence: EvidenceBundle):
    primary_source = evidence.sources[0]

    def runner(_request: RagSdkRunRequest) -> RagSdkRunResult:
        anchor = RagSdkEvidenceAnchor(
            source_id=primary_source.doc_id,
            chunk_id=primary_source.chunk_id,
            excerpt=primary_source.snippet,
            span_ref="chunk-0001:0-24",
        )
        return RagSdkRunResult(
            output=RagSdkAnswerOutput(
                answer_text=primary_source.snippet,
                answer_kind="short_answer",
                semantic_outcome="grounded_answer",
                confidence="medium",
                cited_source_ids=(primary_source.doc_id,),
                claims=(
                    RagSdkClaim(
                        claim_id="claim-1",
                        text=primary_source.snippet,
                    ),
                ),
                claim_supports=(RagSdkClaimSupport(claim_id="claim-1", anchors=(anchor,)),),
                evidence_anchors=(anchor,),
            ),
            trace_projection={"schema_version": "rag-sdk-trace-projection-v1"},
        )

    return runner
