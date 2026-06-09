from __future__ import annotations

from typing import Any

from campus_contracts import CapabilityRequest, CapabilityResponse

from .service_answer_synthesis import RagSdkRunner, build_required_rag_sdk_response


def execute_rag_synthesis_stage(
    *,
    request: CapabilityRequest,
    pipeline: Any,
    retrieval_plan: Any,
    retrieval_stage: Any,
    evidence_selection_stage: Any,
    confidence: str,
    runner: RagSdkRunner | None | object,
    planner_information_needs: tuple[str, ...],
    projection_context_summaries: tuple[object, ...],
) -> CapabilityResponse:
    resolved_scope = pipeline.effective_scope
    if resolved_scope is None:
        raise RuntimeError("synthesis stage requires resolved scope")
    return build_required_rag_sdk_response(
        request=request,
        resolved_scope=resolved_scope,
        user_goal=pipeline.user_goal,
        supporting_evidence=evidence_selection_stage.supporting_evidence,
        retrieved_evidence=retrieval_stage.evidence,
        retrieval_plan=retrieval_plan,
        retrieval_execution_result=retrieval_stage.retrieval_execution_result,
        handbook_plan=pipeline.handbook_plan,
        curriculum_plan=pipeline.curriculum_plan,
        curriculum_course_plan=pipeline.curriculum_course_plan,
        curriculum_program_family_plan=pipeline.curriculum_program_family_plan,
        confidence=confidence,
        intent_frame=pipeline.intent_frame,
        runner=runner,
        planner_information_needs=planner_information_needs,
        projection_context_summaries=projection_context_summaries,
        retrieval_intent=pipeline.retrieval_intent,
    )
