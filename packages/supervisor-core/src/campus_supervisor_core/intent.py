from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_contracts import RequestedCapability

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.scope_policy import evaluate_knowledge_scope


IntentTaskKind = Literal["knowledge_lookup", "availability_check", "place_lookup", "unknown"]
IntentRiskLevel = Literal["low", "medium", "high"]
IntentNextAction = Literal["delegate", "clarify", "rejected", "approval_required", "out_of_scope"]
IntentPersonalizationMode = Literal["generic", "cohort_grounded", "user_grounded"]
IntentScopeClass = Literal["", "in_scope", "out_of_scope"]

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
_POLITICAL_TOPIC_SIGNALS = (
    "政治",
    "政策",
    "候选人",
    "选举",
    "投票",
    "政党",
    "政府",
    "国家主席",
    "总统",
    "意识形态",
)
_POLITICAL_INFLUENCE_ACTION_SIGNALS = (
    "说服",
    "劝说",
    "拉票",
    "动员",
    "煽动",
    "影响",
    "宣传",
)
_POLITICAL_TARGET_AUDIENCE_SIGNALS = (
    "同学",
    "学生",
    "老师",
    "家长",
    "公众",
    "大家",
    "群里",
    "选民",
)
_POLITICAL_POSITION_SIGNALS = (
    "支持",
    "反对",
    "投票给",
    "不要投票给",
)
_POLITICAL_MESSAGE_WRITING_SIGNALS = (
    "写一段话",
    "写文案",
    "写帖子",
    "写宣传稿",
    "写一篇",
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
    scope_class: IntentScopeClass = ""
    policy_reason: str = ""


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

    if capability == "place_lookup":
        scope_decision = evaluate_knowledge_scope(context)
        if scope_decision.scope_class == "out_of_scope":
            return IntentFrame(
                capability="place_lookup",
                task_kind="place_lookup",
                domain_candidates=("out_of_scope",),
                missing_slots=(),
                risk_level="low",
                needs_clarification=False,
                suggested_next_action="out_of_scope",
                personalization_mode=personalization_mode,
                scope_class="out_of_scope",
                policy_reason=scope_decision.reason,
            )

        return IntentFrame(
            capability="place_lookup",
            task_kind="place_lookup",
            domain_candidates=("navigation",),
            missing_slots=(),
            risk_level="low",
            needs_clarification=False,
            suggested_next_action="delegate",
            personalization_mode=personalization_mode,
            scope_class="in_scope",
        )

    policy_reason = _evaluate_knowledge_policy_reason(normalized_goal)
    if policy_reason:
        return IntentFrame(
            capability="knowledge",
            task_kind="knowledge_lookup",
            domain_candidates=("policy_refusal",),
            missing_slots=(),
            risk_level="high",
            needs_clarification=False,
            suggested_next_action="rejected",
            personalization_mode=personalization_mode,
            scope_class="in_scope",
            policy_reason=policy_reason,
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

    scope_decision = evaluate_knowledge_scope(context)
    if scope_decision.scope_class == "out_of_scope":
        return IntentFrame(
            capability="knowledge",
            task_kind="knowledge_lookup",
            domain_candidates=("out_of_scope",),
            missing_slots=(),
            risk_level="low",
            needs_clarification=False,
            suggested_next_action="out_of_scope",
            personalization_mode=personalization_mode,
            scope_class="out_of_scope",
            policy_reason=scope_decision.reason,
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
        scope_class="in_scope",
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


def _evaluate_knowledge_policy_reason(normalized_goal: str) -> str:
    if _is_targeted_political_persuasion(normalized_goal):
        return "political_persuasion"
    return ""


def _is_targeted_political_persuasion(normalized_goal: str) -> bool:
    has_political_topic = any(signal in normalized_goal for signal in _POLITICAL_TOPIC_SIGNALS)
    if not has_political_topic:
        return False

    has_influence_action = any(
        signal in normalized_goal for signal in _POLITICAL_INFLUENCE_ACTION_SIGNALS
    )
    has_target_audience = any(signal in normalized_goal for signal in _POLITICAL_TARGET_AUDIENCE_SIGNALS)
    has_position_signal = any(signal in normalized_goal for signal in _POLITICAL_POSITION_SIGNALS)
    has_message_writing = any(signal in normalized_goal for signal in _POLITICAL_MESSAGE_WRITING_SIGNALS)

    if has_influence_action and (has_target_audience or has_position_signal):
        return True
    if has_message_writing and has_target_audience and has_position_signal:
        return True
    return False
