from __future__ import annotations

from campus_contracts import CapabilityRequest

from .service_outcomes import RagOutcomeContext


def build_outcome_context(
    *,
    request: CapabilityRequest,
    effective_scope,
    user_goal: str,
    personalization_hint,
    intent_frame,
    prompt_executor,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    evidence,
    retrieval_execution_result,
    planner_information_needs=(),
    projection_context_summaries=(),
) -> RagOutcomeContext:
    return RagOutcomeContext(
        request=request,
        resolved_scope=effective_scope,
        user_goal=user_goal,
        personalization_hint=personalization_hint,
        intent_frame=intent_frame,
        prompt_executor=prompt_executor,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        retrieved_evidence=evidence,
        retrieval_execution_result=retrieval_execution_result,
        planner_information_needs=planner_information_needs,
        projection_context_summaries=projection_context_summaries,
    )
