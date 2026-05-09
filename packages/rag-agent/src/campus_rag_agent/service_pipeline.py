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

from .institutional_rules_query_planning import plan_institutional_rules_query
from .retrieval_intent import (
    RetrievalIntent,
    retrieval_intent_for_general_fact_scope,
    retrieval_intent_for_official_web_stable_reference,
)
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
    institutional_rules_plan: Any
    curriculum_plan: Any
    curriculum_course_plan: Any
    curriculum_program_family_plan: Any
    retrieval_intent: RetrievalIntent | None


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
            institutional_rules_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
            retrieval_intent=None,
        )
    effective_user_goal = _resolve_effective_curriculum_user_goal(
        effective_scope,
        user_goal=user_goal,
        curriculum_follow_up=personalization_hint.curriculum_follow_up,
        recent_goal=personalization_hint.recent_goal,
    )
    handbook_plan = _plan_handbook_query(effective_scope, user_goal)
    institutional_rules_plan = (
        plan_institutional_rules_query(effective_user_goal)
        if (
            effective_scope.corpus == "regulations"
            and effective_scope.collection == "institutional_rules"
        )
        else None
    )
    curriculum_plan = _plan_curriculum_query(request, effective_scope, effective_user_goal)
    curriculum_course_plan = _plan_curriculum_course_query(effective_scope, effective_user_goal)
    curriculum_program_family_plan = _plan_curriculum_program_family_query(
        effective_scope,
        effective_user_goal,
    )
    retrieval_intent = _resolve_retrieval_intent(
        effective_scope=effective_scope,
        handbook_plan=handbook_plan,
        institutional_rules_plan=institutional_rules_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        user_goal=user_goal,
    )
    return RagPipelineContext(
        prompt_executor=runtime_prompt_executor,
        user_goal=user_goal,
        intent_frame=intent_frame,
        personalization_hint=personalization_hint,
        effective_scope=effective_scope,
        effective_user_goal=effective_user_goal,
        handbook_plan=handbook_plan,
        institutional_rules_plan=institutional_rules_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        retrieval_intent=retrieval_intent,
    )


def _resolve_retrieval_intent(
    *,
    effective_scope: KnowledgeScope,
    handbook_plan,
    institutional_rules_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    user_goal: str,
) -> RetrievalIntent | None:
    if handbook_plan is not None and getattr(handbook_plan, "status", "") != "pass_through":
        return handbook_plan.retrieval_intent
    if institutional_rules_plan is not None:
        return institutional_rules_plan.retrieval_intent
    if curriculum_program_family_plan is not None:
        return curriculum_program_family_plan.retrieval_intent
    if curriculum_course_plan is not None:
        return curriculum_course_plan.retrieval_intent
    if curriculum_plan is not None:
        return curriculum_plan.retrieval_intent
    if effective_scope.corpus == "official_web":
        return retrieval_intent_for_official_web_stable_reference(
            query_text=user_goal,
            scope=effective_scope,
        )
    if effective_scope.corpus == "regulations":
        return retrieval_intent_for_general_fact_scope(
            query_text=user_goal,
            scope=effective_scope,
        )
    return None
