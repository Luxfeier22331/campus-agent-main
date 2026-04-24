from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_contracts import RequestedCapability

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.scope_policy import ScopeDecision, evaluate_knowledge_scope

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


def frame_intent(
    context: SupervisorRequestContext,
    *,
    capability: RequestedCapability,
) -> IntentFrame:
    normalized_goal = context.user_goal.strip()
    compact_goal = "".join(normalized_goal.split()).casefold()
    personalization_hint = context.personalization_hint
    personalization_mode = _personalization_mode(context)
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
    )


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
