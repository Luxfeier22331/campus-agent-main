# ruff: noqa: F401
from __future__ import annotations

from campus_contracts import (
    AgentRequest,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
    WorkflowAgentContext,
)
from campus_rag_agent.query_planning import plan_curriculum_course_query
from campus_rag_agent.semantic_replan import build_semantic_replan_steps
from campus_rag_agent.service_diagnostics_payload import _build_rag_result_diagnostics
from campus_rag_agent.service_planner_stage import (
    execute_rag_planner_stage as _execute_rag_planner_stage,
)
from campus_retrieval_core import (
    RetrievalExecutionResult,
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSemanticHint,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepActivity,
    RetrievalStepBudget,
    RetrievalStepResult,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.agent.rag_agent_test_support import _make_handbook_source, delegate_to_rag_agent, patch


def execute_rag_planner_stage(*, institutional_rules_plan=None, **kwargs):
    return _execute_rag_planner_stage(
        institutional_rules_plan=institutional_rules_plan,
        **kwargs,
    )


def _plan_student_rules(user_goal: str):
    request = AgentRequest(
        target="rag-agent",
        user_goal=user_goal,
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        ),
    )
    return execute_rag_planner_stage(
        request=request,
        effective_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
        user_goal=request.user_goal,
        effective_user_goal=request.user_goal,
        handbook_plan=None,
        institutional_rules_plan=None,
        curriculum_plan=None,
        curriculum_course_plan=None,
        curriculum_program_family_plan=None,
    )


def _single_step_plan(
    *,
    plan_id: str = "regulations:student_rules:current",
    corpus: str = "regulations",
    collection: str = "student_rules",
    step_type: str = "indexed_lookup",
    query_text: str = "公费医疗报销需要什么材料",
    need_ids: tuple[str, ...] = (),
    selector: RetrievalSelector | None = None,
    expected_output: str = "candidate_set",
    semantic_hint: RetrievalSemanticHint | None = None,
) -> RetrievalPlan:
    step_id = "entity-resolution" if step_type == "entity_resolution" else "indexed-lookup"
    return RetrievalPlan(
        plan_id=plan_id,
        query_mode="current",
        admitted_scopes=(RetrievalScope(corpus=corpus, collection=collection),),
        budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
        source_trust_policy=RetrievalSourceTrustPolicy(minimum_tier="T1"),
        steps=(
            RetrievalStep(
                step_id=step_id,
                step_type=step_type,
                scope=RetrievalScope(corpus=corpus, collection=collection),
                query_text=query_text,
                need_ids=need_ids,
                semantic_hint=semantic_hint,
                selector=selector or RetrievalSelector(),
                budget=RetrievalStepBudget(top_k=2),
                expected_output=expected_output,
            ),
        ),
    )


def _medical_evidence(*, query_text: str) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=query_text,
        corpus="regulations",
        collection="student_rules",
        sources=(
            _medical_source("medical-need-support-1"),
            _make_handbook_source(
                doc_id="handbook:medical",
                title="中央民族大学学生公费医疗管理办法",
                snippet="报销材料经校医院审核后，按学校公费医疗管理办法办理。",
                score=0.88,
                chunk_id_suffix="medical-need-support-2",
                content_role="procedure",
                is_answer_bearing=True,
            ),
        ),
    )


def _discipline_requirement_and_procedure_evidence(*, query_text: str) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=query_text,
        corpus="regulations",
        collection="student_rules",
        sources=(
            _make_handbook_source(
                doc_id="handbook:demerit-relief",
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="第二条 申请解除处分应当满足考察期届满、本人有改正表现等条件。",
                score=0.92,
                chunk_id_suffix="discipline-requirement",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="eligibility",
                polarity="positive",
                action_type="lift_discipline",
                claim_type="requirement",
            ),
            _make_handbook_source(
                doc_id="handbook:demerit-relief",
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="第三条 学生受处分满考察期后，可以申请解除纪律处分。",
                score=0.91,
                chunk_id_suffix="discipline-procedure",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                action_type="lift_discipline",
                claim_type="procedure",
            ),
        ),
    )


def _medical_source(chunk_id_suffix: str):
    return _make_handbook_source(
        doc_id="handbook:medical",
        title="中央民族大学学生公费医疗管理办法",
        snippet="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
        score=0.91,
        chunk_id_suffix=chunk_id_suffix,
        content_role="requirement",
        is_answer_bearing=True,
    )


__all__ = [name for name in globals() if not name.startswith("__")]
