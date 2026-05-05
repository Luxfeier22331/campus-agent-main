from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import AgentRequest, AgentResponse, KnowledgeScope, RagPlannerInformationNeed
from campus_retrieval_core import RetrievalPlan

from .planner_decision import RagPlannerDecision, build_rag_planner_decision
from .service_common import _build_empty_evidence
from .service_diagnostics_payload import _build_rag_result_payload
from .service_retrieval import (
    RagRetrievalContext,
    build_rag_retrieval_context,
    build_retrieval_plan_for_context,
)
from .service_versioning_response import _build_version_filter_unresolved_response


@dataclass(frozen=True, slots=True)
class RagPlannerStageResult:
    response: AgentResponse | None
    retrieval_context: RagRetrievalContext | None
    retrieval_plan: RetrievalPlan | None
    information_needs: tuple[RagPlannerInformationNeed, ...] = ()
    planner_decision: RagPlannerDecision | None = None


def execute_rag_planner_stage(
    *,
    request: AgentRequest,
    effective_scope: KnowledgeScope,
    user_goal: str,
    effective_user_goal: str,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
) -> RagPlannerStageResult:
    retrieval_context = build_rag_retrieval_context(
        request=request,
        effective_scope=effective_scope,
        user_goal=user_goal,
        effective_user_goal=effective_user_goal,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    )
    if retrieval_context is None:
        return RagPlannerStageResult(
            response=_build_version_filter_unresolved_response(
                build_rag_result_payload=_build_rag_result_payload,
                build_empty_evidence=_build_empty_evidence,
                request=request,
                resolved_scope=effective_scope,
                user_goal=user_goal,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
            ),
            retrieval_context=None,
            retrieval_plan=None,
            information_needs=(),
            planner_decision=None,
        )
    retrieval_plan = build_retrieval_plan_for_context(
        request=request,
        effective_scope=effective_scope,
        user_goal=user_goal,
        retrieval_context=retrieval_context,
    )
    planner_decision = build_rag_planner_decision(
        user_goal=user_goal,
        effective_scope=effective_scope,
        retrieval_collection=retrieval_context.retrieval_collection,
        retrieval_plan=retrieval_plan,
        handbook_plan=handbook_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    )
    return RagPlannerStageResult(
        response=None,
        retrieval_context=retrieval_context,
        retrieval_plan=retrieval_plan,
        information_needs=planner_decision.information_needs,
        planner_decision=planner_decision,
    )


__all__ = [
    "RagPlannerStageResult",
    "execute_rag_planner_stage",
]
