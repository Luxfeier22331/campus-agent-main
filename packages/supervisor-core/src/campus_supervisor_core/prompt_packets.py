from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_contracts import RequestedCapability

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.intent import IntentPersonalizationMode
from campus_supervisor_core.routing import RoutingDecision


SupervisorPromptMode = Literal["clarify", "approval_required", "out_of_scope", "reject"]


@dataclass(frozen=True, slots=True)
class SupervisorTaskPacket:
    request_id: str
    mode: SupervisorPromptMode
    language: str
    task_kind: str
    requested_capability: RequestedCapability
    resolved_scope_corpus: str = ""
    resolved_scope_collection: str = ""
    personalization_mode: IntentPersonalizationMode = "generic"
    allowed_actions: tuple[str, ...] = ()
    forbidden_actions: tuple[str, ...] = ()
    response_constraints: tuple[str, ...] = ()
    output_schema_name: str = ""
    missing_slots: tuple[str, ...] = ()
    clarification_subject: str = ""
    policy_decision: str = ""


@dataclass(frozen=True, slots=True)
class SupervisorPromptPacket:
    prompt_id: str
    task: SupervisorTaskPacket
    user_input_text: str


def build_supervisor_clarify_prompt_packet(
    context: SupervisorRequestContext,
    decision: RoutingDecision,
) -> SupervisorPromptPacket:
    if decision.intent_frame.suggested_next_action != "clarify":
        raise ValueError("supervisor clarify prompt packet requires suggested_next_action='clarify'")

    requested_capability = decision.intent_frame.capability
    resolved_scope_corpus = context.requested_scope.corpus if context.requested_scope is not None else ""
    resolved_scope_collection = (
        context.requested_scope.collection if context.requested_scope is not None else ""
    )
    task = SupervisorTaskPacket(
        request_id=context.request_id,
        mode="clarify",
        language="zh-CN",
        task_kind=decision.intent_frame.task_kind,
        requested_capability=requested_capability,
        resolved_scope_corpus=resolved_scope_corpus,
        resolved_scope_collection=resolved_scope_collection,
        personalization_mode=decision.intent_frame.personalization_mode,
        allowed_actions=("ask_for_missing_information", "use_brief_user_facing_wording"),
        forbidden_actions=(
            "override_authz",
            "invent_scope",
            "invent_facts",
            "use_internal_jargon",
        ),
        response_constraints=(
            "single_follow_up_question",
            "brief",
            "user_facing",
        ),
        output_schema_name="supervisor_clarify_v1",
        missing_slots=decision.intent_frame.missing_slots,
        clarification_subject=decision.intent_frame.clarification_subject,
    )
    return SupervisorPromptPacket(
        prompt_id="supervisor_clarify_v1",
        task=task,
        user_input_text=context.user_goal,
    )


def build_supervisor_approval_required_prompt_packet(
    context: SupervisorRequestContext,
    decision: RoutingDecision,
) -> SupervisorPromptPacket:
    if decision.intent_frame.suggested_next_action != "approval_required":
        raise ValueError(
            "supervisor approval-required prompt packet requires suggested_next_action='approval_required'"
        )

    task = SupervisorTaskPacket(
        request_id=context.request_id,
        mode="approval_required",
        language="zh-CN",
        task_kind=decision.intent_frame.task_kind,
        requested_capability=decision.intent_frame.capability,
        resolved_scope_corpus=context.requested_scope.corpus if context.requested_scope is not None else "",
        resolved_scope_collection=(
            context.requested_scope.collection if context.requested_scope is not None else ""
        ),
        personalization_mode=decision.intent_frame.personalization_mode,
        allowed_actions=("provide_operator_guidance", "use_brief_user_facing_wording"),
        forbidden_actions=(
            "override_authz",
            "approve_request",
            "invent_scope",
            "use_internal_jargon",
        ),
        response_constraints=("brief", "user_facing", "fail_closed"),
        output_schema_name="supervisor_approval_required_v1",
        policy_decision="approval_required",
    )
    return SupervisorPromptPacket(
        prompt_id="supervisor_approval_required_v1",
        task=task,
        user_input_text=context.user_goal,
    )


def build_supervisor_out_of_scope_prompt_packet(
    context: SupervisorRequestContext,
    decision: RoutingDecision,
) -> SupervisorPromptPacket:
    if decision.intent_frame.suggested_next_action != "out_of_scope":
        raise ValueError(
            "supervisor out-of-scope prompt packet requires suggested_next_action='out_of_scope'"
        )

    task = SupervisorTaskPacket(
        request_id=context.request_id,
        mode="out_of_scope",
        language="zh-CN",
        task_kind=decision.intent_frame.task_kind,
        requested_capability=decision.intent_frame.capability,
        personalization_mode=decision.intent_frame.personalization_mode,
        allowed_actions=("explain_product_boundary_briefly", "use_brief_user_facing_wording"),
        forbidden_actions=(
            "override_authz",
            "expand_scope",
            "invent_supported_capability",
            "use_internal_jargon",
        ),
        response_constraints=("brief", "user_facing", "fail_closed"),
        output_schema_name="supervisor_out_of_scope_v1",
        policy_decision=decision.intent_frame.policy_reason or "product_scope_boundary",
    )
    return SupervisorPromptPacket(
        prompt_id="supervisor_out_of_scope_v1",
        task=task,
        user_input_text=context.user_goal,
    )


def build_supervisor_reject_prompt_packet(
    context: SupervisorRequestContext,
    decision: RoutingDecision,
) -> SupervisorPromptPacket:
    if decision.intent_frame.suggested_next_action != "rejected":
        raise ValueError("supervisor reject prompt packet requires suggested_next_action='rejected'")

    task = SupervisorTaskPacket(
        request_id=context.request_id,
        mode="reject",
        language="zh-CN",
        task_kind=decision.intent_frame.task_kind,
        requested_capability=decision.intent_frame.capability,
        resolved_scope_corpus=context.requested_scope.corpus if context.requested_scope is not None else "",
        resolved_scope_collection=(
            context.requested_scope.collection if context.requested_scope is not None else ""
        ),
        personalization_mode=decision.intent_frame.personalization_mode,
        allowed_actions=("explain_boundary_briefly", "use_brief_user_facing_wording"),
        forbidden_actions=(
            "override_authz",
            "invent_policy_reason",
            "expand_scope",
            "use_internal_jargon",
        ),
        response_constraints=("brief", "user_facing", "fail_closed"),
        output_schema_name="supervisor_reject_v1",
        policy_decision="rejected",
    )
    return SupervisorPromptPacket(
        prompt_id="supervisor_reject_v1",
        task=task,
        user_input_text=context.user_goal,
    )


__all__ = [
    "SupervisorPromptMode",
    "SupervisorPromptPacket",
    "SupervisorTaskPacket",
    "build_supervisor_approval_required_prompt_packet",
    "build_supervisor_clarify_prompt_packet",
    "build_supervisor_out_of_scope_prompt_packet",
    "build_supervisor_reject_prompt_packet",
]
