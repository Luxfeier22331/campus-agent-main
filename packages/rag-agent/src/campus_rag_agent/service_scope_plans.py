from __future__ import annotations

from campus_contracts import AgentRequest, KnowledgeScope

from campus_rag_agent.query_planning import (
    CurriculumCourseQueryPlan,
    CurriculumProgramFamilyQueryPlan,
    CurriculumQueryPlan,
    HandbookQueryPlan,
    plan_curriculum_course_query,
    plan_curriculum_program_family_query,
    plan_curriculum_query,
    plan_student_handbook_query,
)

from .service_scope_curriculum import _has_curriculum_scope_signal


def _resolve_request_scope(
    request: AgentRequest,
    *,
    user_goal: str,
) -> KnowledgeScope | None:
    if request.payload.scope is not None:
        return request.payload.scope

    handbook_plan = plan_student_handbook_query(user_goal)
    curriculum_plan = plan_curriculum_query(
        user_goal,
        verified_major=request.context.actor.major,
    )
    curriculum_course_plan = plan_curriculum_course_query(user_goal)
    curriculum_program_family_plan = plan_curriculum_program_family_query(user_goal)

    has_curriculum_signal = _has_curriculum_scope_signal(
        user_goal=user_goal,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    )
    has_handbook_signal = handbook_plan.status != "pass_through"

    if has_curriculum_signal and not has_handbook_signal:
        return KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
    if has_handbook_signal and not has_curriculum_signal:
        return KnowledgeScope(corpus="regulations", collection="student_rules")
    if has_curriculum_signal and has_handbook_signal:
        if handbook_plan.status == "resolved":
            return KnowledgeScope(corpus="regulations", collection="student_rules")
        return KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
    return None


def _plan_curriculum_query(
    request: AgentRequest,
    scope: KnowledgeScope,
    user_goal: str,
) -> CurriculumQueryPlan | None:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_query(
        user_goal,
        verified_major=request.context.actor.major,
    )


def _plan_curriculum_course_query(
    scope: KnowledgeScope,
    user_goal: str,
) -> CurriculumCourseQueryPlan | None:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_course_query(user_goal)


def _plan_curriculum_program_family_query(
    scope: KnowledgeScope,
    user_goal: str,
) -> CurriculumProgramFamilyQueryPlan | None:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_program_family_query(user_goal)


def _has_resolved_query_plan(
    *,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> bool:
    if handbook_plan is not None and handbook_plan.status == "resolved":
        return True
    if (
        curriculum_program_family_plan is not None
        and curriculum_program_family_plan.resolution_mode == "resolved_family"
    ):
        return True
    return curriculum_plan is not None and curriculum_plan.status == "resolved"


__all__ = [
    "_has_resolved_query_plan",
    "_plan_curriculum_course_query",
    "_plan_curriculum_program_family_query",
    "_plan_curriculum_query",
    "_resolve_request_scope",
]
