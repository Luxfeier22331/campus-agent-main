from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import (
    KnowledgeScope,
    RagEntityResolutionSummary,
    RagPlannerInformationNeed,
)
from campus_retrieval_core import RetrievalPlan, RetrievalStep

from .agentic_depth_diagnostics import build_planner_information_needs
from .retrieval_intent import RetrievalIntent


@dataclass(frozen=True, slots=True)
class RagPlannedStep:
    step_id: str
    step_type: str
    target_collection: str
    expected_output: str
    need_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RagPlannerFailCloseCondition:
    reason: str
    terminal: bool = True


@dataclass(frozen=True, slots=True)
class RagPlannerDecision:
    query_mode: str
    target_collection: str
    information_needs: tuple[RagPlannerInformationNeed, ...]
    planned_steps: tuple[RagPlannedStep, ...]
    fail_close_conditions: tuple[RagPlannerFailCloseCondition, ...]
    entity_resolution_summary: RagEntityResolutionSummary | None = None


def build_rag_planner_decision(
    *,
    user_goal: str,
    effective_scope: KnowledgeScope,
    retrieval_collection: str,
    retrieval_plan: RetrievalPlan,
    handbook_plan=None,
    curriculum_course_plan=None,
    curriculum_program_family_plan=None,
    retrieval_intent: RetrievalIntent | None = None,
) -> RagPlannerDecision:
    information_needs = build_planner_information_needs(
        user_goal=user_goal,
        effective_scope=effective_scope,
        retrieval_collection=retrieval_collection,
        query_mode=retrieval_plan.query_mode,
        retrieval_intent=retrieval_intent,
    )
    return RagPlannerDecision(
        query_mode=retrieval_plan.query_mode,
        target_collection=retrieval_collection,
        information_needs=information_needs,
        planned_steps=tuple(_planned_step(step) for step in retrieval_plan.steps),
        fail_close_conditions=_fail_close_conditions(retrieval_plan),
        entity_resolution_summary=_entity_resolution_summary(
            retrieval_collection=retrieval_collection,
            handbook_plan=handbook_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
        ),
    )


def _planned_step(step: RetrievalStep) -> RagPlannedStep:
    return RagPlannedStep(
        step_id=step.step_id,
        step_type=step.step_type,
        target_collection=step.scope.collection,
        expected_output=step.expected_output,
        need_ids=step.need_ids,
    )


def _fail_close_conditions(
    retrieval_plan: RetrievalPlan,
) -> tuple[RagPlannerFailCloseCondition, ...]:
    conditions: list[RagPlannerFailCloseCondition] = []
    if retrieval_plan.fail_close_on_budget_exhausted:
        conditions.append(RagPlannerFailCloseCondition(reason="budget_exhausted"))
    if retrieval_plan.fail_close_on_unresolved_freshness:
        conditions.append(RagPlannerFailCloseCondition(reason="unresolved_freshness"))
    if retrieval_plan.fail_close_on_empty_supporting_evidence:
        conditions.append(RagPlannerFailCloseCondition(reason="empty_supporting_evidence"))
    return tuple(conditions)


def _entity_resolution_summary(
    *,
    retrieval_collection: str,
    handbook_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
) -> RagEntityResolutionSummary | None:
    if curriculum_course_plan is not None:
        if curriculum_course_plan.entity_type == "course":
            return RagEntityResolutionSummary(
                resolution_status="resolved",
                entity_type="course",
                canonical_id=curriculum_course_plan.canonical_course_id,
                canonical_title=curriculum_course_plan.canonical_course_title,
                target_collection=retrieval_collection,
                resolution_source="canonical_alias_governance",
                confidence=0.95,
            )
        return RagEntityResolutionSummary(
            resolution_status="resolved",
            entity_type="course_family",
            canonical_id=curriculum_course_plan.canonical_course_family_id,
            canonical_title=curriculum_course_plan.canonical_course_family_title,
            target_collection=retrieval_collection,
            resolution_source="canonical_alias_governance",
            confidence=0.95,
        )
    if curriculum_program_family_plan is not None:
        status = (
            "resolved"
            if curriculum_program_family_plan.resolution_mode == "resolved_family"
            else "ambiguous"
        )
        return RagEntityResolutionSummary(
            resolution_status=status,
            entity_type="program_family",
            canonical_id=curriculum_program_family_plan.canonical_program_family_id,
            canonical_title=curriculum_program_family_plan.canonical_program_family_title,
            target_collection=retrieval_collection,
            resolution_source="program_family_alias_governance",
            confidence=0.95 if status == "resolved" else 0.0,
            ambiguity_reason=curriculum_program_family_plan.clarification_reason,
        )
    if handbook_plan is not None:
        if handbook_plan.task_kind == "category_discovery":
            return RagEntityResolutionSummary(
                resolution_status="resolved",
                entity_type="policy_category",
                canonical_id=handbook_plan.category_id,
                canonical_title=handbook_plan.category_display_name,
                target_collection=retrieval_collection,
                resolution_source="policy_category_registry",
                confidence=0.9,
            )
        if handbook_plan.status == "resolved":
            return RagEntityResolutionSummary(
                resolution_status="resolved",
                entity_type="policy_document",
                canonical_id=handbook_plan.resolved_policy_document_id,
                canonical_title=handbook_plan.resolved_policy_title,
                target_collection=retrieval_collection,
                resolution_source="policy_object_alias_governance",
                confidence=0.95,
            )
        if handbook_plan.status == "needs_clarification":
            return RagEntityResolutionSummary(
                resolution_status="ambiguous",
                entity_type="policy_document",
                target_collection=retrieval_collection,
                resolution_source="policy_object_alias_governance",
                ambiguity_reason=handbook_plan.clarification_reason,
            )
    return None


__all__ = [
    "RagEntityResolutionSummary",
    "RagPlannedStep",
    "RagPlannerDecision",
    "RagPlannerFailCloseCondition",
    "build_rag_planner_decision",
]
