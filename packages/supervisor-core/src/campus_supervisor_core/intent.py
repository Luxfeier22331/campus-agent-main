from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_contracts import RequestedCapability

from campus_supervisor_core.context import SupervisorRequestContext


IntentTaskKind = Literal["knowledge_lookup", "availability_check", "unknown"]
IntentRiskLevel = Literal["low", "medium", "high"]
IntentNextAction = Literal["delegate", "clarify", "rejected", "approval_required"]
IntentPersonalizationMode = Literal["generic", "cohort_grounded", "user_grounded"]

_HIGH_RISK_PATTERNS = (
    "帮我提交",
    "代我提交",
    "替我提交",
    "帮我申请",
    "代我申请",
    "替我申请",
    "帮我办理",
    "代我办理",
    "替我办理",
)


@dataclass(frozen=True, slots=True)
class IntentFrame:
    capability: RequestedCapability
    task_kind: IntentTaskKind
    domain_candidates: tuple[str, ...]
    missing_slots: tuple[str, ...]
    risk_level: IntentRiskLevel
    needs_clarification: bool
    suggested_next_action: IntentNextAction
    personalization_mode: IntentPersonalizationMode = "generic"
    clarification_subject: str = ""


def frame_intent(
    context: SupervisorRequestContext,
    *,
    capability: RequestedCapability,
) -> IntentFrame:
    normalized_goal = context.user_goal.strip()
    personalization_hint = context.personalization_hint
    personalization_mode = _personalization_mode(context)
    if capability == "availability":
        missing_slots = () if context.availability_target_id is not None else ("availability_target_id",)
        return IntentFrame(
            capability="availability",
            task_kind="availability_check",
            domain_candidates=("availability",),
            missing_slots=missing_slots,
            risk_level="low",
            needs_clarification=bool(missing_slots),
            suggested_next_action="clarify" if missing_slots else "delegate",
            personalization_mode=personalization_mode,
        )

    if any(pattern in normalized_goal for pattern in _HIGH_RISK_PATTERNS):
        return IntentFrame(
            capability="knowledge",
            task_kind="knowledge_lookup",
            domain_candidates=_knowledge_domains(context),
            missing_slots=(),
            risk_level="high",
            needs_clarification=False,
            suggested_next_action="approval_required",
            personalization_mode=personalization_mode,
        )

    return IntentFrame(
        capability="knowledge",
        task_kind="knowledge_lookup",
        domain_candidates=_knowledge_domains(context),
        missing_slots=(),
        risk_level="low",
        needs_clarification=False,
        suggested_next_action="delegate",
        personalization_mode=personalization_mode,
        clarification_subject=_clarification_subject(
            normalized_goal,
            clarification_subject=personalization_hint.clarification_subject,
        ),
    )


def _knowledge_domains(context: SupervisorRequestContext) -> tuple[str, ...]:
    if context.requested_scope is not None:
        return (f"{context.requested_scope.corpus}/{context.requested_scope.collection}",)
    return ("knowledge",)


def _personalization_mode(context: SupervisorRequestContext) -> IntentPersonalizationMode:
    personalization_hint = context.personalization_hint
    if personalization_hint.recent_goal or personalization_hint.confirmed_slot_terms:
        return "user_grounded"
    if personalization_hint.actor_claim_terms:
        return "cohort_grounded"
    return "generic"


def _clarification_subject(
    user_goal: str,
    *,
    clarification_subject: str,
) -> str:
    subject = clarification_subject.strip()
    if not subject:
        return ""
    if subject in user_goal:
        return ""
    return subject
