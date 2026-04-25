from __future__ import annotations

import re
from typing import Literal

type AllowedCorpus = str
RevisionTrack = Literal["source-faithful", "current-effective", "editorial"]
SourceChannel = Literal["pdf_ocr", "official_web", "manual_curated", "authenticated_notice_portal"]
SourceTrustTier = Literal["T0", "T1", "T2", "T3"]
RemoteContentSuspicionLabel = Literal[
    "prompt_override_signal",
    "instructional_imperative",
    "secret_or_credential_request",
    "tool_or_browser_action_request",
    "hidden_or_embedded_text_marker",
]
DelegateStatus = Literal["completed", "needs_clarification", "no_answer", "error"]
ConfidenceLevel = Literal["high", "medium", "low"]
AgentTarget = Literal[
    "rag-agent",
    "navigation-agent",
    "campus-services-agent",
    "notice-agent",
]
AgentToolName = Literal[
    "service_status_lookup",
    "service_guide_lookup",
    "transport_schedule_lookup",
    "campus_notice_discover",
    "campus_notice_get",
]
RequestedCapability = Literal["knowledge", "place_lookup", "campus_services", "notice"]
SupervisorStatus = Literal[
    "completed",
    "needs_clarification",
    "no_answer",
    "error",
    "rejected",
    "approval_required",
]
MemorySourceType = Literal[
    "verified_record", "user_declared", "conversation_summary", "system_inferred"
]
MemoryVisibility = Literal["user_visible", "internal_only"]
PlaceEntityType = Literal["building", "service_point", "office", "gate", "stop"]
CoordinateReferenceSystem = Literal["EPSG:4326"]
TemporalQueryMode = Literal["current", "latest", "effective", "as_of", "current_year"]
VersionQueryMode = Literal["current", "historical", "as_of", "compare"]
ToolBusinessOutcome = Literal[
    "resolved_current",
    "resolved_historical_reference",
    "not_found",
    "temporarily_unverifiable",
    "clarification_required",
]
ToolFailCloseReason = Literal[
    "current_state_unverifiable",
    "source_truth_unavailable",
    "temporal_scope_ambiguous",
    "source_family_unavailable",
    "source_conflict",
    "manual_review_required",
]
ServiceGuideFocus = Literal[
    "overview",
    "procedure",
    "required_materials",
    "entry",
    "office_hours",
    "contact",
    "eligibility",
    "full_guide",
]
ServiceGuideAudience = Literal["student", "faculty", "visitor", "unknown"]
ServiceGuideClarificationReason = Literal[
    "service_ambiguous",
    "campus_scope_required",
    "audience_required",
    "guide_focus_required",
]
HistoricalDowngradeReason = Literal["current_year_miss", "current_effective_miss"]
NoticeSourceFamily = Literal["official_web_public_notice", "internal_notice_restricted"]
NoticeTargetSurface = Literal[
    "notice_level_query",
    "procurement_notice_history",
    "campus_services/service_status_candidate",
    "campus_services/special_service_candidate",
    "campus_services/stable_contact_candidate",
]
ServiceStatusValue = Literal["open", "closed", "temporarily_closed", "limited_service", "unknown"]
TransportServiceStatusValue = Literal[
    "running",
    "not_running",
    "temporarily_suspended",
    "limited_service",
    "unknown",
]
TransportScheduleIntent = Literal[
    "next_departure",
    "first_departure",
    "last_departure",
    "departure_list",
    "service_window",
    "timetable",
    "schedule_snapshot_metadata",
]
TransportScheduleClarificationReason = Literal[
    "route_family_required",
    "route_direction_required",
    "route_variant_ambiguous",
    "origin_stop_ambiguous",
    "destination_stop_ambiguous",
    "service_date_required",
]
TransportServiceDateMode = Literal["today", "tomorrow", "date"]
TransportDaypart = Literal["morning", "afternoon", "evening", "all_day"]

ALLOWED_REVISION_TRACKS = ("source-faithful", "current-effective", "editorial")
ALLOWED_SOURCE_CHANNELS = (
    "pdf_ocr",
    "official_web",
    "manual_curated",
    "authenticated_notice_portal",
)
ALLOWED_SOURCE_TRUST_TIERS = ("T0", "T1", "T2", "T3")
ALLOWED_REMOTE_CONTENT_SUSPICION_LABELS = (
    "prompt_override_signal",
    "instructional_imperative",
    "secret_or_credential_request",
    "tool_or_browser_action_request",
    "hidden_or_embedded_text_marker",
)
DEFAULT_REVISION_TRACK = "source-faithful"
DEFAULT_SOURCE_CHANNEL = "pdf_ocr"
ALLOWED_DELEGATE_STATUSES = ("completed", "needs_clarification", "no_answer", "error")
ALLOWED_CONFIDENCE_LEVELS = ("high", "medium", "low")
ALLOWED_AGENT_TARGETS = (
    "rag-agent",
    "navigation-agent",
    "campus-services-agent",
    "notice-agent",
)
ALLOWED_AGENT_TOOL_NAMES = (
    "service_status_lookup",
    "service_guide_lookup",
    "transport_schedule_lookup",
    "campus_notice_discover",
    "campus_notice_get",
)
ALLOWED_REQUESTED_CAPABILITIES = ("knowledge", "place_lookup", "campus_services", "notice")
ALLOWED_SUPERVISOR_STATUSES = (
    "completed",
    "needs_clarification",
    "no_answer",
    "error",
    "rejected",
    "approval_required",
)
ALLOWED_MEMORY_SOURCE_TYPES = (
    "verified_record",
    "user_declared",
    "conversation_summary",
    "system_inferred",
)
ALLOWED_MEMORY_VISIBILITIES = ("user_visible", "internal_only")
ALLOWED_PLACE_ENTITY_TYPES = ("building", "service_point", "office", "gate", "stop")
ALLOWED_TEMPORAL_QUERY_MODES = ("current", "latest", "effective", "as_of", "current_year")
ALLOWED_VERSION_QUERY_MODES = ("current", "historical", "as_of", "compare")
ALLOWED_TOOL_BUSINESS_OUTCOMES = (
    "resolved_current",
    "resolved_historical_reference",
    "not_found",
    "temporarily_unverifiable",
    "clarification_required",
)
ALLOWED_TOOL_FAIL_CLOSE_REASONS = (
    "current_state_unverifiable",
    "source_truth_unavailable",
    "temporal_scope_ambiguous",
    "source_family_unavailable",
    "source_conflict",
    "manual_review_required",
)
ALLOWED_SERVICE_GUIDE_FOCUSES = (
    "overview",
    "procedure",
    "required_materials",
    "entry",
    "office_hours",
    "contact",
    "eligibility",
    "full_guide",
)
ALLOWED_SERVICE_GUIDE_AUDIENCES = ("student", "faculty", "visitor", "unknown")
ALLOWED_SERVICE_GUIDE_CLARIFICATION_REASONS = (
    "service_ambiguous",
    "campus_scope_required",
    "audience_required",
    "guide_focus_required",
)
ALLOWED_HISTORICAL_DOWNGRADE_REASONS = ("current_year_miss", "current_effective_miss")
ALLOWED_NOTICE_SOURCE_FAMILIES = ("official_web_public_notice", "internal_notice_restricted")
ALLOWED_NOTICE_TARGET_SURFACES = (
    "notice_level_query",
    "procurement_notice_history",
    "campus_services/service_status_candidate",
    "campus_services/special_service_candidate",
    "campus_services/stable_contact_candidate",
)
ALLOWED_SERVICE_STATUS_VALUES = (
    "open",
    "closed",
    "temporarily_closed",
    "limited_service",
    "unknown",
)
ALLOWED_TRANSPORT_SERVICE_STATUS_VALUES = (
    "running",
    "not_running",
    "temporarily_suspended",
    "limited_service",
    "unknown",
)
ALLOWED_TRANSPORT_SCHEDULE_INTENTS = (
    "next_departure",
    "first_departure",
    "last_departure",
    "departure_list",
    "service_window",
    "timetable",
    "schedule_snapshot_metadata",
)
ALLOWED_TRANSPORT_SCHEDULE_CLARIFICATION_REASONS = (
    "route_family_required",
    "route_direction_required",
    "route_variant_ambiguous",
    "origin_stop_ambiguous",
    "destination_stop_ambiguous",
    "service_date_required",
)
ALLOWED_TRANSPORT_SERVICE_DATE_MODES = ("today", "tomorrow", "date")
ALLOWED_TRANSPORT_DAYPARTS = ("morning", "afternoon", "evening", "all_day")
DEFAULT_POLICY_PROJECTION_VERSION = "phase1-authorization-projection-v1"
CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family"
CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program"
CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester"
_SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")


def _validate_corpus(corpus: str) -> None:
    if not corpus or not corpus.strip():
        raise ValueError("corpus is required")


def _validate_collection(collection: str) -> None:
    if not collection or not collection.strip():
        raise ValueError("collection is required")


def _validate_collection_scope(corpus: str, collection: str) -> None:
    if not corpus.strip():
        raise ValueError("corpus is required")
    if not collection.strip():
        raise ValueError("collection is required")


def _validate_revision_track(revision_track: str) -> None:
    if revision_track not in ALLOWED_REVISION_TRACKS:
        raise ValueError(f"unsupported revision track: {revision_track}")


def _validate_source_channel(source_channel: str) -> None:
    if source_channel not in ALLOWED_SOURCE_CHANNELS:
        raise ValueError(f"unsupported source channel: {source_channel}")


def _validate_source_trust_tier(source_trust_tier: str) -> None:
    if source_trust_tier not in ALLOWED_SOURCE_TRUST_TIERS:
        raise ValueError(f"unsupported source trust tier: {source_trust_tier}")


def _validate_temporal_query_mode(mode: str) -> None:
    if mode not in ALLOWED_TEMPORAL_QUERY_MODES:
        raise ValueError(f"unsupported temporal mode: {mode}")


def _validate_version_query_mode(mode: str) -> None:
    if mode not in ALLOWED_VERSION_QUERY_MODES:
        raise ValueError(f"unsupported version mode: {mode}")


def _validate_tool_business_outcome(outcome: str) -> None:
    if outcome not in ALLOWED_TOOL_BUSINESS_OUTCOMES:
        raise ValueError(f"unsupported tool business outcome: {outcome}")


def _validate_tool_fail_close_reason(reason: str) -> None:
    if reason not in ALLOWED_TOOL_FAIL_CLOSE_REASONS:
        raise ValueError(f"unsupported tool fail-close reason: {reason}")


def _validate_service_guide_focus(focus: str) -> None:
    if focus not in ALLOWED_SERVICE_GUIDE_FOCUSES:
        raise ValueError(f"unsupported service guide focus: {focus}")


def _validate_service_guide_audience(audience: str) -> None:
    if audience not in ALLOWED_SERVICE_GUIDE_AUDIENCES:
        raise ValueError(f"unsupported service guide audience: {audience}")


def _validate_service_guide_clarification_reason(reason: str) -> None:
    if reason not in ALLOWED_SERVICE_GUIDE_CLARIFICATION_REASONS:
        raise ValueError(f"unsupported service guide clarification reason: {reason}")


def _validate_historical_downgrade_reason(reason: str) -> None:
    if reason not in ALLOWED_HISTORICAL_DOWNGRADE_REASONS:
        raise ValueError(f"unsupported historical downgrade reason: {reason}")


def _validate_notice_source_family(source_family: str) -> None:
    if source_family not in ALLOWED_NOTICE_SOURCE_FAMILIES:
        raise ValueError(f"unsupported notice source family: {source_family}")


def _validate_notice_target_surface(target_surface: str) -> None:
    if target_surface not in ALLOWED_NOTICE_TARGET_SURFACES:
        raise ValueError(f"unsupported notice target surface: {target_surface}")


def _validate_service_status_value(status: str) -> None:
    if status not in ALLOWED_SERVICE_STATUS_VALUES:
        raise ValueError(f"unsupported service status value: {status}")


def _validate_transport_service_status_value(status: str) -> None:
    if status not in ALLOWED_TRANSPORT_SERVICE_STATUS_VALUES:
        raise ValueError(f"unsupported transport service status value: {status}")


def _validate_transport_schedule_intent(intent: str) -> None:
    if intent not in ALLOWED_TRANSPORT_SCHEDULE_INTENTS:
        raise ValueError(f"unsupported transport schedule intent: {intent}")


def _validate_transport_schedule_clarification_reason(reason: str) -> None:
    if reason not in ALLOWED_TRANSPORT_SCHEDULE_CLARIFICATION_REASONS:
        raise ValueError(f"unsupported transport clarification reason: {reason}")


def _validate_transport_service_date_mode(mode: str) -> None:
    if mode not in ALLOWED_TRANSPORT_SERVICE_DATE_MODES:
        raise ValueError(f"unsupported transport service date mode: {mode}")


def _validate_transport_daypart(daypart: str) -> None:
    if daypart not in ALLOWED_TRANSPORT_DAYPARTS:
        raise ValueError(f"unsupported transport daypart: {daypart}")


def _validate_remote_content_suspicion_label(remote_content_suspicion_label: str) -> None:
    if remote_content_suspicion_label not in ALLOWED_REMOTE_CONTENT_SUSPICION_LABELS:
        raise ValueError(
            f"unsupported remote content suspicion label: {remote_content_suspicion_label}"
        )


def _normalize_source_trust_tier(
    source_trust_tier: str,
    *,
    collection: str,
    source_channel: str,
) -> SourceTrustTier:
    if source_trust_tier:
        _validate_source_trust_tier(source_trust_tier)
        return source_trust_tier

    normalized_collection = collection.strip().lower()
    if normalized_collection in {
        "curriculum_plan",
        "program_semester_facts",
        "program_family_facts",
        "course_facts",
    }:
        return "T0"
    if normalized_collection == "student_rules":
        return "T1"
    if normalized_collection == "stable_reference":
        return "T2"
    if normalized_collection == "fresh_news":
        return "T3"

    if source_channel == "official_web":
        return "T2"
    if source_channel == "authenticated_notice_portal":
        return "T1"
    if source_channel == "manual_curated":
        return "T0"
    return "T1"
