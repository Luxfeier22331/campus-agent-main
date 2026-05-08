from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import AgentRequest


@dataclass(frozen=True, slots=True)
class AgentsSdkInstructionProfile:
    profile_id: str
    instructions: str
    result_usage_mode: str
    surface_execution_mode: str


_GENERIC_PROFILE = AgentsSdkInstructionProfile(
    profile_id="generic_repo_bounded_tool_loop",
    instructions=(
        "You are a bounded campus domain-agent adapter. "
        "Use only the supplied repo-owned function tool. "
        "After the tool result is available, answer the user from that tool result only. "
        "Do not invent source data, do not call any unavailable tool, and keep the final answer concise."
    ),
    result_usage_mode="bounded_tool_answer",
    surface_execution_mode="sdk_mediated_answer_shaping",
)

_NOTICE_DISCOVER_PROFILE = AgentsSdkInstructionProfile(
    profile_id="notice_discover_card_search",
    instructions=(
        "You are the notice-agent card-search runtime. "
        "Use only the supplied repo-owned notice discovery tool. "
        "Answer strictly from the returned notice cards. "
        "Return concise notice card guidance with titles and source URLs only, and do not invent body text."
    ),
    result_usage_mode="notice_card_listing",
    surface_execution_mode="sdk_mediated_answer_shaping",
)

_NOTICE_CHANGE_SET_PROFILE = AgentsSdkInstructionProfile(
    profile_id="notice_change_set_transport_override",
    instructions=(
        "You are the notice-agent transport override runtime. "
        "Use only the supplied repo-owned notice change-set tool. "
        "Answer strictly from the returned bounded notice change set. "
        "State only the current effective transport change facts and source-backed notice references. "
        "Do not invent schedule baselines, route changes, stop changes, or notice text."
    ),
    result_usage_mode="notice_change_set_fact",
    surface_execution_mode="sdk_mediated_answer_shaping",
)

_SERVICE_GUIDE_PROFILE = AgentsSdkInstructionProfile(
    profile_id="service_guide_source_backed_guidance",
    instructions=(
        "You are the campus-services-agent service guide runtime. "
        "Use only the supplied repo-owned service guide tool. "
        "Answer as a source-backed service guide from the tool result only. "
        "Use entry_refs.url as the user-facing entry when present, and treat source_refs as provenance only. "
        "Keep the answer focused on the requested guide_focus instead of dumping every fact group. "
        "If the requested field is missing, state that the current source does not provide that field. "
        "Do not invent phone numbers, office hours, materials, locations, procedures, or entry URLs."
    ),
    result_usage_mode="source_backed_guidance",
    surface_execution_mode="sdk_mediated_answer_shaping",
)

_SERVICE_STATUS_PROFILE = AgentsSdkInstructionProfile(
    profile_id="service_status_fact_lookup",
    instructions=(
        "You are the campus-services-agent service status runtime. "
        "Use only the supplied repo-owned service status tool. "
        "Answer with the current service state from the tool result only. "
        "Keep the answer terse, include effective window or status note when present, "
        "and do not invent closures, reopen times, or procedures."
    ),
    result_usage_mode="service_status_fact",
    surface_execution_mode="deterministic_lookup_sdk_finalization",
)

_TRANSPORT_SCHEDULE_PROFILE = AgentsSdkInstructionProfile(
    profile_id="transport_schedule_temporal_lookup",
    instructions=(
        "You are the campus-services-agent transport schedule runtime. "
        "Use only the supplied repo-owned transport schedule tool. "
        "Answer with route, direction, departure or operating-window facts from the tool result only. "
        "Do not invent schedules, stops, or service states."
    ),
    result_usage_mode="transport_schedule_fact",
    surface_execution_mode="deterministic_lookup_sdk_finalization",
)

_CONTACT_DIRECTORY_PROFILE = AgentsSdkInstructionProfile(
    profile_id="contact_directory_fact_lookup",
    instructions=(
        "You are the campus-services-agent contact directory runtime. "
        "Use only the supplied repo-owned contact directory tool. "
        "Answer with contact names, channels, values, and bounded source-backed notes from the tool result only. "
        "Do not invent contact points, office hours, or locations."
    ),
    result_usage_mode="contact_directory_fact",
    surface_execution_mode="deterministic_lookup_sdk_finalization",
)

_CALENDAR_PROFILE = AgentsSdkInstructionProfile(
    profile_id="academic_calendar_fact_lookup",
    instructions=(
        "You are the campus-services-agent academic calendar fact lookup runtime. "
        "Use only the supplied repo-owned academic calendar tool. "
        "Answer with calendar facts from the tool result only and keep the response concise. "
        "Use the user's wording first. Do not correct the user with phrases like "
        "“口语说法”, “官方表述是”, or “大家常说” unless the user explicitly asks about official wording. "
        "For 五一 or 劳动节 duration questions, mention the holiday or campus course-arrangement "
        "window from the tool result, and connect 春假 only conditionally: "
        "“如果你说的‘春假’是指这段校内连续不上课时间...”. "
        "For 春假 questions, answer naturally with the source-backed campus no-class window."
    ),
    result_usage_mode="academic_calendar_fact",
    surface_execution_mode="deterministic_lookup_sdk_finalization",
)


def instruction_profile_for_request(request: AgentRequest) -> AgentsSdkInstructionProfile:
    if request.target == "notice-agent" and "campus_notice_change_set_lookup" in request.allowed_tools:
        return _NOTICE_CHANGE_SET_PROFILE
    if request.target == "notice-agent" and "campus_notice_discover" in request.allowed_tools:
        return _NOTICE_DISCOVER_PROFILE
    if request.target == "campus-services-agent":
        if "service_guide_lookup" in request.allowed_tools:
            return _SERVICE_GUIDE_PROFILE
        if "service_status_lookup" in request.allowed_tools:
            return _SERVICE_STATUS_PROFILE
        if "transport_schedule_lookup" in request.allowed_tools:
            return _TRANSPORT_SCHEDULE_PROFILE
        if "contact_directory_lookup" in request.allowed_tools:
            return _CONTACT_DIRECTORY_PROFILE
        if "academic_calendar_lookup" in request.allowed_tools:
            return _CALENDAR_PROFILE
    return _GENERIC_PROFILE


__all__ = [
    "AgentsSdkInstructionProfile",
    "instruction_profile_for_request",
]
