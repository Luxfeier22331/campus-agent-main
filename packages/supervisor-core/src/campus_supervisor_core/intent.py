from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from campus_contracts import (
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    RequestedCapability,
)

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.scope_policy import (
    ScopeDecision,
    evaluate_knowledge_scope,
    has_campus_scope_signal,
)

IntentTaskKind = Literal[
    "knowledge_lookup",
    "place_lookup",
    "campus_services_lookup",
    "notice_lookup",
    "unknown",
]
IntentRiskLevel = Literal["low", "medium", "high"]
IntentNextAction = Literal["delegate", "clarify", "rejected", "approval_required", "out_of_scope"]
IntentPersonalizationMode = Literal["generic", "cohort_grounded", "user_grounded"]
IntentScopeClass = Literal["", "in_scope", "out_of_scope"]
IntentLaunchState = Literal["open", "candidate_only", "closed"]
IntentContextResolutionState = Literal[
    "not_follow_up",
    "resolved",
    "ambiguous",
    "missing_context",
]
IntentContextReferenceType = Literal[
    "none",
    "selected_notice",
    "curriculum_slot",
    "previous_goal",
    "service_temporal_reference",
]
IntentRoutingConfidence = Literal["high", "medium", "low"]
INTENT_SCHEMA_VERSION = "intent-schema-1.0.0"
INTENT_CLASSIFIER_VERSION = "deterministic-intent-v1"

_DELEGATED_ACTION_PREFIX_SIGNALS = (
    "帮我",
    "代我",
    "替我",
)
_HIGH_RISK_TRANSACTION_ACTION_SIGNALS = (
    "提交",
    "申请",
    "办理",
    "预约",
    "报名",
    "缴费",
    "支付",
    "发送",
    "上传",
    "删除",
    "取消",
    "修改",
    "确认",
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
_CONTEXTUAL_FOLLOW_UP_SIGNALS = (
    "这个流程",
    "该流程",
    "流程怎么办",
)
_NOTICE_CONTEXT_REFERENCE_SIGNALS = (
    "这条通知",
    "这则通知",
    "该通知",
    "这个通知",
    "这条公告",
    "上一条通知",
    "上一条公告",
    "刚才的通知",
    "前面的通知",
)
_CURRICULUM_SEMESTER_SIGNALS = (
    "大一上",
    "大一下",
    "大二上",
    "大二下",
    "大三上",
    "大三下",
    "大四上",
    "大四下",
)
_FOLLOW_UP_LEADING_SIGNALS = (
    "那",
    "这个",
    "该",
    "上一",
    "刚才",
    "前面",
)


@dataclass(frozen=True, slots=True)
class ContextResolution:
    state: IntentContextResolutionState = "not_follow_up"
    reference_type: IntentContextReferenceType = "none"
    resolved_slots: dict[str, str] = field(default_factory=dict)
    missing_slots: tuple[str, ...] = ()
    ambiguity_reason: str = ""
    matched_signal: str = ""


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
    launch_state: IntentLaunchState = "open"
    scope_reason: str = ""
    matched_signal: str = ""
    classifier_version: str = INTENT_CLASSIFIER_VERSION
    schema_version: str = INTENT_SCHEMA_VERSION
    routing_confidence: IntentRoutingConfidence = "high"
    ambiguity_signal: str = ""
    context_resolution_state: IntentContextResolutionState = "not_follow_up"
    context_reference_type: IntentContextReferenceType = "none"
    resolved_slots: dict[str, str] = field(default_factory=dict)
    ambiguity_reason: str = ""


def frame_intent(
    context: SupervisorRequestContext,
    *,
    capability: RequestedCapability,
) -> IntentFrame:
    normalized_goal = context.user_goal.strip()
    compact_goal = "".join(normalized_goal.split()).casefold()
    personalization_hint = context.personalization_hint
    personalization_mode = _personalization_mode(context)
    context_resolution = resolve_context_follow_up(context, compact_goal=compact_goal)
    policy_reason = _evaluate_policy_reason(compact_goal)
    if policy_reason:
        return IntentFrame(
            capability=capability,
            task_kind=_task_kind_for_capability(capability),
            domain_candidates=("policy_refusal",),
            missing_slots=(),
            risk_level="high",
            needs_clarification=False,
            suggested_next_action="rejected",
            personalization_mode=personalization_mode,
            scope_class="in_scope",
            policy_reason=policy_reason,
            launch_state="closed",
            scope_reason="policy_guardrail",
        )

    if _is_high_risk_transaction_action(compact_goal):
        ungrounded_follow_up_decision = _ungrounded_contextual_follow_up_decision(
            context,
            compact_goal,
            capability=capability,
        )
        if ungrounded_follow_up_decision is not None:
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
                policy_reason=ungrounded_follow_up_decision.reason,
                launch_state="closed",
                scope_reason=ungrounded_follow_up_decision.reason,
                matched_signal=ungrounded_follow_up_decision.matched_signal,
            )
        return IntentFrame(
            capability=capability,
            task_kind=_task_kind_for_capability(capability),
            domain_candidates=_domain_candidates_for_capability(context, capability),
            missing_slots=(),
            risk_level="high",
            needs_clarification=False,
            suggested_next_action="approval_required",
            personalization_mode=personalization_mode,
            scope_class="in_scope",
            launch_state="closed",
            scope_reason="transaction_guardrail",
        )

    if context_resolution.state in {"missing_context", "ambiguous"}:
        reason = (
            "context_ambiguous" if context_resolution.state == "ambiguous" else "context_missing"
        )
        return IntentFrame(
            capability=capability,
            task_kind=_task_kind_for_capability(capability),
            domain_candidates=("context_follow_up",),
            missing_slots=context_resolution.missing_slots,
            risk_level="low",
            needs_clarification=True,
            suggested_next_action="clarify",
            personalization_mode=personalization_mode,
            scope_class="in_scope",
            launch_state="candidate_only",
            scope_reason=reason,
            matched_signal=context_resolution.matched_signal,
            routing_confidence="low",
            ambiguity_signal=context_resolution.matched_signal
            if context_resolution.state == "ambiguous"
            else "",
            context_resolution_state=context_resolution.state,
            context_reference_type=context_resolution.reference_type,
            resolved_slots=context_resolution.resolved_slots,
            ambiguity_reason=context_resolution.ambiguity_reason,
        )

    if capability == "place_lookup":
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
            policy_reason="navigation_temporarily_unsupported",
            launch_state="closed",
            scope_reason="navigation_temporarily_unsupported",
            **_context_resolution_frame_fields(context_resolution),
        )
    if capability == "campus_services":
        return IntentFrame(
            capability="campus_services",
            task_kind="campus_services_lookup",
            domain_candidates=("campus_services",),
            missing_slots=(),
            risk_level="low",
            needs_clarification=False,
            suggested_next_action="delegate",
            personalization_mode=personalization_mode,
            scope_class="in_scope",
            launch_state="open",
            scope_reason="explicit_requested_capability",
            **_context_resolution_frame_fields(context_resolution),
        )
    if capability == "notice":
        return IntentFrame(
            capability="notice",
            task_kind="notice_lookup",
            domain_candidates=("notice",),
            missing_slots=(),
            risk_level="low",
            needs_clarification=False,
            suggested_next_action="delegate",
            personalization_mode=personalization_mode,
            scope_class="in_scope",
            launch_state="open",
            scope_reason="explicit_requested_capability",
            **_context_resolution_frame_fields(context_resolution),
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
            launch_state="closed",
            scope_reason=scope_decision.reason,
            matched_signal=scope_decision.matched_signal,
            **_context_resolution_frame_fields(context_resolution),
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
        launch_state=_knowledge_launch_state(scope_decision.reason),
        scope_reason=scope_decision.reason,
        matched_signal=scope_decision.matched_signal,
        **_context_resolution_frame_fields(context_resolution),
    )


def _context_resolution_frame_fields(
    context_resolution: ContextResolution,
) -> dict[str, object]:
    if context_resolution.state == "not_follow_up":
        return {}
    return {
        "context_resolution_state": context_resolution.state,
        "context_reference_type": context_resolution.reference_type,
        "resolved_slots": context_resolution.resolved_slots,
        "ambiguity_reason": context_resolution.ambiguity_reason,
    }


def resolve_context_follow_up(
    context: SupervisorRequestContext,
    *,
    compact_goal: str | None = None,
) -> ContextResolution:
    normalized_goal = compact_goal or "".join(context.user_goal.strip().split()).casefold()
    contextual_signal = _first_compact_match(normalized_goal, _CONTEXTUAL_FOLLOW_UP_SIGNALS)
    if contextual_signal:
        candidates = _previous_goal_context_candidates(context)
        if not candidates:
            return ContextResolution(
                state="missing_context",
                reference_type="previous_goal",
                missing_slots=("previous_goal",),
                matched_signal=contextual_signal,
            )
        if len(candidates) > 1:
            return ContextResolution(
                state="ambiguous",
                reference_type="previous_goal",
                missing_slots=("previous_goal",),
                ambiguity_reason="multiple_previous_goal_candidates",
                matched_signal=contextual_signal,
            )
        return ContextResolution(
            state="resolved",
            reference_type="previous_goal",
            resolved_slots={"previous_goal": candidates[0]},
            matched_signal=contextual_signal,
        )

    notice_signal = _first_compact_match(normalized_goal, _NOTICE_CONTEXT_REFERENCE_SIGNALS)
    if notice_signal:
        selected_notice_ref = context.context.session.selected_notice_ref
        if selected_notice_ref is None:
            return ContextResolution(
                state="missing_context",
                reference_type="selected_notice",
                missing_slots=("selected_notice_ref",),
                matched_signal=notice_signal,
            )
        resolved_slots = {
            "notice_id": selected_notice_ref.notice_id,
        }
        if selected_notice_ref.source_family:
            resolved_slots["notice_source_family"] = selected_notice_ref.source_family
        if selected_notice_ref.title:
            resolved_slots["notice_title"] = selected_notice_ref.title
        return ContextResolution(
            state="resolved",
            reference_type="selected_notice",
            resolved_slots=resolved_slots,
            matched_signal=notice_signal,
        )

    semester_signal = _first_compact_match(normalized_goal, _CURRICULUM_SEMESTER_SIGNALS)
    if semester_signal and _looks_like_contextual_semester_follow_up(normalized_goal):
        curriculum_slots = context.context.session.curriculum_follow_up
        if not curriculum_slots.program and not curriculum_slots.program_family:
            return ContextResolution(
                state="missing_context",
                reference_type="curriculum_slot",
                missing_slots=(CURRICULUM_PROGRAM_SLOT_NAME,),
                matched_signal=semester_signal,
            )
        resolved_slots = {
            CURRICULUM_SEMESTER_SLOT_NAME: semester_signal,
        }
        if curriculum_slots.program:
            resolved_slots[CURRICULUM_PROGRAM_SLOT_NAME] = curriculum_slots.program
        if curriculum_slots.program_family:
            resolved_slots[CURRICULUM_PROGRAM_FAMILY_SLOT_NAME] = curriculum_slots.program_family
        return ContextResolution(
            state="resolved",
            reference_type="curriculum_slot",
            resolved_slots=resolved_slots,
            matched_signal=semester_signal,
        )

    return ContextResolution()


def _previous_goal_context_candidates(context: SupervisorRequestContext) -> tuple[str, ...]:
    candidates: list[str] = []
    seen: set[str] = set()
    for value in context.personalization_hint.confirmed_slot_terms:
        if not _has_campus_scope_signal(value):
            continue
        if value in seen:
            continue
        seen.add(value)
        candidates.append(value)
    for item in context.context.profile_memory.items:
        if item.key != "recent_goal":
            continue
        if not _has_campus_scope_signal(item.value):
            continue
        if item.value in seen:
            continue
        seen.add(item.value)
        candidates.append(item.value)
    return tuple(candidates)


def _has_campus_scope_signal(value: str) -> bool:
    return has_campus_scope_signal(value)


def _looks_like_contextual_semester_follow_up(normalized_goal: str) -> bool:
    return (
        any(_compact_signal(signal) in normalized_goal for signal in _FOLLOW_UP_LEADING_SIGNALS)
        or normalized_goal.endswith("呢")
        or len(normalized_goal) <= 6
    )


def _first_compact_match(normalized_goal: str, signals: tuple[str, ...]) -> str:
    for signal in signals:
        compact_signal = _compact_signal(signal)
        if compact_signal and compact_signal in normalized_goal:
            return signal
    return ""


def _compact_signal(signal: str) -> str:
    return "".join(signal.split()).casefold()


def _knowledge_launch_state(scope_reason: str) -> IntentLaunchState:
    if scope_reason == "structured_runtime_candidate_signal":
        return "candidate_only"
    return "open"


def _knowledge_domains(context: SupervisorRequestContext) -> tuple[str, ...]:
    if context.requested_scope is not None:
        return (f"{context.requested_scope.corpus}/{context.requested_scope.collection}",)
    return ("knowledge",)


def _domain_candidates_for_capability(
    context: SupervisorRequestContext,
    capability: RequestedCapability,
) -> tuple[str, ...]:
    if capability == "knowledge":
        return _knowledge_domains(context)
    if capability == "place_lookup":
        return ("navigation",)
    if capability == "campus_services":
        return ("campus_services",)
    if capability == "notice":
        return ("notice",)
    return ("unknown",)


def _task_kind_for_capability(capability: RequestedCapability) -> IntentTaskKind:
    if capability == "place_lookup":
        return "place_lookup"
    if capability == "campus_services":
        return "campus_services_lookup"
    if capability == "notice":
        return "notice_lookup"
    if capability == "knowledge":
        return "knowledge_lookup"
    return "unknown"


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


def _evaluate_policy_reason(normalized_goal: str) -> str:
    if _is_targeted_political_persuasion(normalized_goal):
        return "political_persuasion"
    return ""


def _is_high_risk_transaction_action(normalized_goal: str) -> bool:
    return any(
        prefix in normalized_goal and action in normalized_goal
        for prefix in _DELEGATED_ACTION_PREFIX_SIGNALS
        for action in _HIGH_RISK_TRANSACTION_ACTION_SIGNALS
    )


def _ungrounded_contextual_follow_up_decision(
    context: SupervisorRequestContext,
    normalized_goal: str,
    *,
    capability: RequestedCapability,
) -> ScopeDecision | None:
    if capability != "knowledge":
        return None
    if not any(
        "".join(signal.split()).casefold() in normalized_goal
        for signal in _CONTEXTUAL_FOLLOW_UP_SIGNALS
    ):
        return None
    scope_decision = evaluate_knowledge_scope(context)
    if scope_decision.scope_class == "out_of_scope":
        return scope_decision
    return None


def _is_targeted_political_persuasion(normalized_goal: str) -> bool:
    has_political_topic = any(signal in normalized_goal for signal in _POLITICAL_TOPIC_SIGNALS)
    if not has_political_topic:
        return False

    has_influence_action = any(
        signal in normalized_goal for signal in _POLITICAL_INFLUENCE_ACTION_SIGNALS
    )
    has_target_audience = any(
        signal in normalized_goal for signal in _POLITICAL_TARGET_AUDIENCE_SIGNALS
    )
    has_position_signal = any(signal in normalized_goal for signal in _POLITICAL_POSITION_SIGNALS)
    has_message_writing = any(
        signal in normalized_goal for signal in _POLITICAL_MESSAGE_WRITING_SIGNALS
    )

    if has_influence_action and (has_target_audience or has_position_signal):
        return True
    if has_message_writing and has_influence_action:
        return True
    return bool(has_message_writing and has_target_audience and has_position_signal)
