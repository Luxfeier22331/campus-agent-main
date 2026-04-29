from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from campus_contracts import AgentRequest, KnowledgeScope

from campus_rag_agent.intent import (
    RagIntentFrame,
    build_personalization_hint,
    frame_rag_intent,
)
from campus_rag_agent.prompt_execution import RagPromptExecutor, wrap_rag_prompt_executor

from .service_scope_curriculum import _resolve_effective_curriculum_user_goal
from .service_scope_handbook import _plan_handbook_query
from .service_scope_plans import (
    _plan_curriculum_course_query,
    _plan_curriculum_program_family_query,
    _plan_curriculum_query,
    _resolve_request_scope,
)


@dataclass(frozen=True, slots=True)
class RagPipelineContext:
    prompt_executor: RagPromptExecutor | None
    user_goal: str
    intent_frame: RagIntentFrame
    personalization_hint: Any
    effective_scope: KnowledgeScope | None
    effective_user_goal: str
    handbook_plan: Any
    curriculum_plan: Any
    curriculum_course_plan: Any
    curriculum_program_family_plan: Any


def build_rag_pipeline_context(
    request: AgentRequest,
    *,
    prompt_executor: RagPromptExecutor | None,
) -> RagPipelineContext:
    runtime_prompt_executor = wrap_rag_prompt_executor(prompt_executor)
    user_goal = request.user_goal.strip()
    intent_frame = frame_rag_intent(request)
    personalization_hint = build_personalization_hint(request)
    effective_scope = _resolve_request_scope(request, user_goal=user_goal)
    if effective_scope is None:
        return RagPipelineContext(
            prompt_executor=runtime_prompt_executor,
            user_goal=user_goal,
            intent_frame=intent_frame,
            personalization_hint=personalization_hint,
            effective_scope=None,
            effective_user_goal=user_goal,
            handbook_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
        )
    effective_user_goal = _resolve_effective_curriculum_user_goal(
        effective_scope,
        user_goal=user_goal,
        curriculum_follow_up=personalization_hint.curriculum_follow_up,
        recent_goal=personalization_hint.recent_goal,
    )
    handbook_plan = _plan_handbook_query(effective_scope, user_goal)
    curriculum_plan = _plan_curriculum_query(request, effective_scope, effective_user_goal)
    curriculum_course_plan = _plan_curriculum_course_query(effective_scope, effective_user_goal)
    curriculum_program_family_plan = _plan_curriculum_program_family_query(
        effective_scope,
        effective_user_goal,
    )
    return RagPipelineContext(
        prompt_executor=runtime_prompt_executor,
        user_goal=user_goal,
        intent_frame=intent_frame,
        personalization_hint=personalization_hint,
        effective_scope=effective_scope,
        effective_user_goal=effective_user_goal,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    )
