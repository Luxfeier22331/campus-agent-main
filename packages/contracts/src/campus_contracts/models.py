from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Literal, TypeAlias


AllowedCorpus: TypeAlias = str
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
# Current runtime dispatch targets only. Forward family labels like `rag-agent`
# remain target-side/planning vocabulary until a later migration phase admits them.
SpecialistTarget = Literal[
    "rag-specialist",
    "navigation-specialist",
    "campus-services-agent",
    "notice-agent",
]
SpecialistToolName = Literal[
    "service_status_lookup",
    "transport_schedule_lookup",
    "campus_notice_discover",
    "campus_notice_get",
]
RequestedCapability = Literal["knowledge", "place_lookup"]
SupervisorStatus = Literal[
    "completed",
    "needs_clarification",
    "no_answer",
    "error",
    "rejected",
    "approval_required",
]
MemorySourceType = Literal["verified_record", "user_declared", "conversation_summary", "system_inferred"]
MemoryVisibility = Literal["user_visible", "internal_only"]
PlaceEntityType = Literal["building", "service_point", "office", "gate", "stop"]
CoordinateReferenceSystem = Literal["EPSG:4326"]
TemporalQueryMode = Literal["current", "latest", "effective", "as_of", "current_year"]
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
]
HistoricalDowngradeReason = Literal["current_year_miss", "current_effective_miss"]
NoticeSourceFamily = Literal["official_web_public_notice", "internal_notice_restricted"]
ServiceStatusValue = Literal["open", "closed", "temporarily_closed", "limited_service", "unknown"]
TransportServiceStatusValue = Literal[
    "running",
    "not_running",
    "temporarily_suspended",
    "limited_service",
    "unknown",
]

ALLOWED_REVISION_TRACKS = ("source-faithful", "current-effective", "editorial")
ALLOWED_SOURCE_CHANNELS = ("pdf_ocr", "official_web", "manual_curated", "authenticated_notice_portal")
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
ALLOWED_SPECIALIST_TARGETS = (
    "rag-specialist",
    "navigation-specialist",
    "campus-services-agent",
    "notice-agent",
)
ALLOWED_SPECIALIST_TOOL_NAMES = (
    "service_status_lookup",
    "transport_schedule_lookup",
    "campus_notice_discover",
    "campus_notice_get",
)
ALLOWED_REQUESTED_CAPABILITIES = ("knowledge", "place_lookup")
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
)
ALLOWED_HISTORICAL_DOWNGRADE_REASONS = ("current_year_miss", "current_effective_miss")
ALLOWED_NOTICE_SOURCE_FAMILIES = ("official_web_public_notice", "internal_notice_restricted")
ALLOWED_SERVICE_STATUS_VALUES = ("open", "closed", "temporarily_closed", "limited_service", "unknown")
ALLOWED_TRANSPORT_SERVICE_STATUS_VALUES = (
    "running",
    "not_running",
    "temporarily_suspended",
    "limited_service",
    "unknown",
)
DEFAULT_POLICY_PROJECTION_VERSION = "phase1-authorization-projection-v1"
CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family"
CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program"
CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester"
_SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class TraceContext:
    trace_id: str = ""
    parent_run_id: str = ""
    tool_call_id: str = ""


@dataclass(frozen=True, slots=True)
class ActorContext:
    user_id: str = ""
    principal_id: str = ""
    principal_type: str = ""
    roles: tuple[str, ...] = field(default_factory=tuple)
    departments: tuple[str, ...] = field(default_factory=tuple)
    cohort: str | None = None
    major: str | None = None
    program: str | None = None


@dataclass(frozen=True, slots=True)
class ProfileMemoryItem:
    item_id: str
    key: str
    value: str
    source_type: MemorySourceType = "user_declared"
    confidence: ConfidenceLevel = "low"
    visibility: MemoryVisibility = "user_visible"
    last_verified_at: str = ""

    def __post_init__(self) -> None:
        if not self.item_id.strip():
            raise ValueError("item_id must not be empty")
        if not self.key.strip():
            raise ValueError("key must not be empty")
        if not self.value.strip():
            raise ValueError("value must not be empty")
        if self.source_type not in ALLOWED_MEMORY_SOURCE_TYPES:
            raise ValueError(f"unsupported memory source_type: {self.source_type}")
        if self.confidence not in ALLOWED_CONFIDENCE_LEVELS:
            raise ValueError(f"unsupported confidence level: {self.confidence}")
        if self.visibility not in ALLOWED_MEMORY_VISIBILITIES:
            raise ValueError(f"unsupported visibility: {self.visibility}")


@dataclass(frozen=True, slots=True)
class ProfileMemorySummary:
    items: tuple[ProfileMemoryItem, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class CurriculumFollowUpSlots:
    program_family: str = ""
    program: str = ""
    semester: str = ""


@dataclass(frozen=True, slots=True)
class SessionSlot:
    name: str
    value: str
    confirmed: bool = True

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("session slot name must not be empty")
        if not self.value.strip():
            raise ValueError("session slot value must not be empty")


@dataclass(frozen=True, slots=True)
class SessionSummary:
    confirmed_slots: tuple[SessionSlot, ...] = field(default_factory=tuple)
    turn_count: int = 0

    def __post_init__(self) -> None:
        if self.turn_count < 0:
            raise ValueError("turn_count must not be negative")

    @property
    def curriculum_follow_up(self) -> CurriculumFollowUpSlots:
        return resolve_curriculum_follow_up_slots(self.confirmed_slots)


@dataclass(frozen=True, slots=True)
class AuthorizedRetrievalFilter:
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_level: str = "public"
    visibility_scope: str | None = None
    policy_projection_version: str = DEFAULT_POLICY_PROJECTION_VERSION

    def __post_init__(self) -> None:
        visibility_level = self.visibility_level.strip() or "public"
        policy_projection_version = self.policy_projection_version.strip() or DEFAULT_POLICY_PROJECTION_VERSION

        if visibility_level != self.visibility_level:
            object.__setattr__(self, "visibility_level", visibility_level)
        if policy_projection_version != self.policy_projection_version:
            object.__setattr__(self, "policy_projection_version", policy_projection_version)


@dataclass(frozen=True, slots=True)
class AuthorizationProjection:
    principal_id: str = ""
    projection_source: str = ""
    entitlement_snapshot_id: str = ""
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_scope: str | None = None
    applicability_scope: str | None = None
    ownership_scopes: tuple[str, ...] = field(default_factory=tuple)
    approval_state: str = ""
    retrieval_filter: AuthorizedRetrievalFilter = field(default_factory=AuthorizedRetrievalFilter)


@dataclass(frozen=True, slots=True)
class ContextProjection:
    actor: ActorContext = field(default_factory=ActorContext)
    authorization: AuthorizationProjection = field(default_factory=AuthorizationProjection)
    profile_memory: ProfileMemorySummary = field(default_factory=ProfileMemorySummary)
    session: SessionSummary = field(default_factory=SessionSummary)


@dataclass(frozen=True, slots=True)
class PersonalizationHint:
    actor_claim_terms: tuple[str, ...] = field(default_factory=tuple)
    recent_goal: str = ""
    confirmed_slot_terms: tuple[str, ...] = field(default_factory=tuple)
    curriculum_follow_up: CurriculumFollowUpSlots = field(default_factory=CurriculumFollowUpSlots)


@dataclass(frozen=True, slots=True)
class KnowledgeScope:
    corpus: AllowedCorpus
    collection: str

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)
        _validate_collection(self.collection)
        _validate_collection_scope(self.corpus, self.collection)


@dataclass(frozen=True, slots=True)
class DocumentRef:
    document_id: str
    revision_track: RevisionTrack
    version_id: str
    corpus: AllowedCorpus
    collection: str
    source_uri: str
    content_hash: str

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)
        _validate_collection(self.collection)
        _validate_collection_scope(self.corpus, self.collection)
        _validate_revision_track(self.revision_track)


@dataclass(frozen=True, slots=True)
class EvidenceSource:
    doc_id: str
    revision_track: RevisionTrack
    version_id: str
    chunk_id: str
    anchor: dict[str, object]
    canonical_url: str
    latest_url: str
    source_channel: SourceChannel
    collection: str
    is_current: bool
    snippet: str
    score: float
    source_title: str = ""
    structural_path: tuple[str, ...] = field(default_factory=tuple)
    content_kind: str = ""
    content_role: str = ""
    detail_label: str = ""
    is_answer_bearing: bool = False
    canonical_source_id: str = ""
    canonical_source_title: str = ""
    source_unit_kind: str = ""
    source_unit_key: str = ""
    source_trust_tier: SourceTrustTier | str = field(default="", compare=False)
    remote_content_suspicion_labels: tuple[RemoteContentSuspicionLabel | str, ...] = field(
        default_factory=tuple,
        compare=False,
    )

    def __post_init__(self) -> None:
        _validate_revision_track(self.revision_track)
        _validate_source_channel(self.source_channel)
        _validate_collection(self.collection)
        normalized_source_trust_tier = _normalize_source_trust_tier(
            self.source_trust_tier,
            collection=self.collection,
            source_channel=self.source_channel,
        )
        if normalized_source_trust_tier != self.source_trust_tier:
            object.__setattr__(self, "source_trust_tier", normalized_source_trust_tier)
        for label in self.remote_content_suspicion_labels:
            _validate_remote_content_suspicion_label(label)


@dataclass(frozen=True, slots=True)
class EvidenceBundle:
    corpus: AllowedCorpus
    collection: str
    query_text: str = ""
    sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)
        _validate_collection(self.collection)
        _validate_collection_scope(self.corpus, self.collection)
        for source in self.sources:
            normalized_source_trust_tier = _normalize_source_trust_tier(
                source.source_trust_tier,
                collection=source.collection or self.collection,
                source_channel=source.source_channel,
            )
            if normalized_source_trust_tier != source.source_trust_tier:
                object.__setattr__(source, "source_trust_tier", normalized_source_trust_tier)


@dataclass(frozen=True, slots=True)
class ErrorInfo:
    code: str
    message: str
    retryable: bool = False


@dataclass(frozen=True, slots=True)
class RagRequestPayload:
    scope: KnowledgeScope | None = None


@dataclass(frozen=True, slots=True)
class ClaimSupport:
    claim_type: str
    claim_text: str
    supported: bool
    support_source_doc_id: str = ""
    support_snippet: str = ""
    required_source_trust_tier: SourceTrustTier | str = field(default="", compare=False)
    support_source_trust_tier: SourceTrustTier | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.claim_type.strip():
            raise ValueError("claim_type must not be empty")
        if not self.claim_text.strip():
            raise ValueError("claim_text must not be empty")
        if self.required_source_trust_tier:
            _validate_source_trust_tier(self.required_source_trust_tier)
        if self.support_source_trust_tier:
            _validate_source_trust_tier(self.support_source_trust_tier)


@dataclass(frozen=True, slots=True)
class SourceTrustSummary:
    observed_tiers: tuple[SourceTrustTier, ...] = field(default_factory=tuple)
    answer_bearing_tiers: tuple[SourceTrustTier, ...] = field(default_factory=tuple)
    blocked_claim_types: tuple[str, ...] = field(default_factory=tuple)
    freshness_claim_blocked: bool = False
    authorization_claim_blocked: bool = False

    def __post_init__(self) -> None:
        for tier in self.observed_tiers:
            _validate_source_trust_tier(tier)
        for tier in self.answer_bearing_tiers:
            _validate_source_trust_tier(tier)


@dataclass(frozen=True, slots=True)
class RemoteContentSuspicionSummary:
    flagged_source_count: int = 0
    flag_labels: tuple[RemoteContentSuspicionLabel, ...] = field(default_factory=tuple)
    generation_blocked: bool = False

    def __post_init__(self) -> None:
        if self.flagged_source_count < 0:
            raise ValueError("flagged_source_count must not be negative")
        for label in self.flag_labels:
            _validate_remote_content_suspicion_label(label)


@dataclass(frozen=True, slots=True)
class RagResultDiagnostics:
    resolved_scope_corpus: AllowedCorpus | None = None
    resolved_scope_collection: str = ""
    resolved_policy_document_id: str = ""
    resolved_policy_title: str = ""
    rewritten_query: str = ""
    clarification_reason: str = ""
    no_answer_reason: str = ""
    semantic_outcome: str = ""
    retrieval_adequacy_verdict: str = ""
    retrieval_adequacy_reason: str = ""
    grounding_verdict: str = ""
    grounding_downgraded: bool = False
    freshness_fail_closed: bool = False
    scope_class: str = ""
    policy_reason: str = ""
    retrieved_title_summary: tuple[str, ...] = field(default_factory=tuple)
    candidate_title_summary: tuple[str, ...] = field(default_factory=tuple)
    resolution_mode: str = ""
    used_verified_identity: bool = False
    used_soft_preference: bool = False
    resolved_entity_type: str = ""
    resolved_course_id: str = ""
    resolved_course_title: str = ""
    resolved_course_family_id: str = ""
    resolved_course_family_title: str = ""
    resolved_program_family_id: str = ""
    resolved_program_family_title: str = ""
    session_program_family: str = ""
    session_program: str = ""
    session_semester: str = ""
    remote_content_suspicion_summary: RemoteContentSuspicionSummary | None = field(
        default=None,
        compare=False,
    )
    source_trust_summary: SourceTrustSummary | None = field(default=None, compare=False)
    claim_supports: tuple[ClaimSupport, ...] = field(default_factory=tuple)
    unsupported_fields: tuple[str, ...] = field(default_factory=tuple)
    partial_answer: bool = False
    prompt_runtime_state: str = ""
    prompt_runtime_detail: str = ""
    retrieved_sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)
    prompt_trace: PromptTrace | None = None


@dataclass(frozen=True, slots=True)
class PromptTrace:
    prompt_id: str = ""
    prompt_version: str = ""
    template_sha256: str = ""
    variables_schema_version: str = ""
    output_schema_version: str = ""
    model_provider: str = ""
    model_name: str = ""


@dataclass(frozen=True, slots=True)
class GeoPoint:
    longitude: float
    latitude: float

    def __post_init__(self) -> None:
        if not -180.0 <= self.longitude <= 180.0:
            raise ValueError("longitude must be within [-180, 180]")
        if not -90.0 <= self.latitude <= 90.0:
            raise ValueError("latitude must be within [-90, 90]")


@dataclass(frozen=True, slots=True)
class PlaceRef:
    place_id: str
    entity_type: PlaceEntityType
    display_name: str
    campus_scope: str
    campus_area: str = ""

    def __post_init__(self) -> None:
        if not self.place_id.strip():
            raise ValueError("place_id must not be empty")
        if self.entity_type not in ALLOWED_PLACE_ENTITY_TYPES:
            raise ValueError(f"unsupported place entity_type: {self.entity_type}")
        if not self.display_name.strip():
            raise ValueError("display_name must not be empty")
        if not self.campus_scope.strip():
            raise ValueError("campus_scope must not be empty")


@dataclass(frozen=True, slots=True)
class PlaceCard:
    place: PlaceRef
    location_description: str
    landmark_hint: str = ""
    access_note: str = ""
    opening_note: str = ""
    service_tags: tuple[str, ...] = field(default_factory=tuple)
    point_geometry: GeoPoint | None = None
    coordinate_reference_system: CoordinateReferenceSystem | str = ""
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.location_description.strip():
            raise ValueError("location_description must not be empty")
        if self.point_geometry is not None and not self.coordinate_reference_system.strip():
            object.__setattr__(self, "coordinate_reference_system", "EPSG:4326")


@dataclass(frozen=True, slots=True)
class PlaceCandidate:
    place: PlaceRef
    clarification_hint: str = ""


@dataclass(frozen=True, slots=True)
class PlaceLookupPayload:
    query_text: str

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")


@dataclass(frozen=True, slots=True)
class PlaceLookupResult:
    query_text: str
    matched_alias: str = ""
    resolved_place: PlaceRef | None = None
    place_card: PlaceCard | None = None
    candidate_places: tuple[PlaceCandidate, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")


@dataclass(frozen=True, slots=True)
class TemporalQuery:
    mode: TemporalQueryMode = "current"
    as_of: str = ""
    year_hint: str = ""

    def __post_init__(self) -> None:
        _validate_temporal_query_mode(self.mode)
        normalized_as_of = self.as_of.strip()
        normalized_year_hint = self.year_hint.strip()
        if normalized_as_of != self.as_of:
            object.__setattr__(self, "as_of", normalized_as_of)
        if normalized_year_hint != self.year_hint:
            object.__setattr__(self, "year_hint", normalized_year_hint)
        if self.mode == "as_of":
            if not normalized_as_of:
                raise ValueError("as_of is required when temporal mode is as_of")
        elif normalized_as_of:
            raise ValueError("as_of is only allowed when temporal mode is as_of")
        if self.mode == "current_year":
            if not normalized_year_hint:
                raise ValueError("year_hint is required when temporal mode is current_year")
        elif normalized_year_hint:
            raise ValueError("year_hint is only allowed when temporal mode is current_year")


@dataclass(frozen=True, slots=True)
class NoticeCard:
    notice_id: str
    title: str
    source_family: NoticeSourceFamily | str
    source_url: str
    canonical_url: str = ""
    summary: str = ""
    published_at: str = ""
    effective_at: str = ""
    is_current: bool = False

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        if not self.title.strip():
            raise ValueError("title must not be empty")
        _validate_notice_source_family(self.source_family)
        if not self.source_url.strip():
            raise ValueError("source_url must not be empty")


@dataclass(frozen=True, slots=True)
class ServiceStatusLookupPayload:
    subject_query: str
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    campus_scope: str = ""

    def __post_init__(self) -> None:
        if not self.subject_query.strip():
            raise ValueError("subject_query must not be empty")


@dataclass(frozen=True, slots=True)
class ServiceStatusLookupResult:
    subject_query: str
    outcome: ToolBusinessOutcome
    resolved_subject: str = ""
    observed_status: ServiceStatusValue | str = field(default="", compare=False)
    queried_time_anchor: str = ""
    effective_from: str = ""
    effective_until: str = ""
    override_source_refs: tuple[str, ...] = field(default_factory=tuple)
    related_notice_refs: tuple[str, ...] = field(default_factory=tuple)
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.subject_query.strip():
            raise ValueError("subject_query must not be empty")
        _validate_tool_business_outcome(self.outcome)
        if self.observed_status:
            _validate_service_status_value(self.observed_status)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome == "resolved_current":
            if not self.resolved_subject.strip():
                raise ValueError("resolved_subject must not be empty for resolved service status")
            if not self.observed_status:
                raise ValueError("observed_status must not be empty for resolved service status")
        if self.outcome == "resolved_historical_reference" and not self.historical_downgrade_reason:
            raise ValueError(
                "historical_downgrade_reason must not be empty for historical service status results"
            )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError("fail_close_reason must not be empty for fail-closed service status results")


@dataclass(frozen=True, slots=True)
class TransportStopRef:
    stop_id: str
    display_name: str

    def __post_init__(self) -> None:
        if not self.stop_id.strip():
            raise ValueError("stop_id must not be empty")
        if not self.display_name.strip():
            raise ValueError("display_name must not be empty")


@dataclass(frozen=True, slots=True)
class TransportScheduleLookupPayload:
    route_query: str
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    origin_stop_query: str = ""
    destination_stop_query: str = ""

    def __post_init__(self) -> None:
        if not self.route_query.strip():
            raise ValueError("route_query must not be empty")


@dataclass(frozen=True, slots=True)
class TransportScheduleLookupResult:
    route_query: str
    outcome: ToolBusinessOutcome
    resolved_route: str = ""
    service_status: TransportServiceStatusValue | str = field(default="", compare=False)
    queried_time_anchor: str = ""
    window_start: str = ""
    window_end: str = ""
    stop_refs: tuple[TransportStopRef, ...] = field(default_factory=tuple)
    related_notice_refs: tuple[str, ...] = field(default_factory=tuple)
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.route_query.strip():
            raise ValueError("route_query must not be empty")
        _validate_tool_business_outcome(self.outcome)
        if self.service_status:
            _validate_transport_service_status_value(self.service_status)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome == "resolved_current":
            if not self.resolved_route.strip():
                raise ValueError("resolved_route must not be empty for resolved transport schedule")
            if not self.service_status:
                raise ValueError("service_status must not be empty for resolved transport schedule")
        if self.outcome == "resolved_historical_reference" and not self.historical_downgrade_reason:
            raise ValueError(
                "historical_downgrade_reason must not be empty for historical transport schedule results"
            )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError("fail_close_reason must not be empty for fail-closed transport schedule results")


@dataclass(frozen=True, slots=True)
class CampusNoticeDiscoverPayload:
    query_text: str
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    source_families: tuple[NoticeSourceFamily | str, ...] = field(default_factory=tuple)
    max_results: int = 5

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        for source_family in self.source_families:
            _validate_notice_source_family(source_family)
        if self.max_results <= 0:
            raise ValueError("max_results must be positive")


@dataclass(frozen=True, slots=True)
class CampusNoticeDiscoverResult:
    query_text: str
    outcome: ToolBusinessOutcome
    source_families: tuple[NoticeSourceFamily | str, ...] = field(default_factory=tuple, compare=False)
    notice_cards: tuple[NoticeCard, ...] = field(default_factory=tuple)
    queried_time_anchor: str = ""
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        _validate_tool_business_outcome(self.outcome)
        for source_family in self.source_families:
            _validate_notice_source_family(source_family)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome in {"resolved_current", "resolved_historical_reference"} and not self.notice_cards:
            raise ValueError("notice_cards must not be empty for resolved notice discovery results")
        if self.outcome == "resolved_historical_reference" and not self.historical_downgrade_reason:
            raise ValueError("historical_downgrade_reason must not be empty for historical notice discovery")
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError("fail_close_reason must not be empty for fail-closed notice discovery results")


@dataclass(frozen=True, slots=True)
class CampusNoticeGetPayload:
    notice_id: str
    source_family: NoticeSourceFamily | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        if self.source_family:
            _validate_notice_source_family(self.source_family)


@dataclass(frozen=True, slots=True)
class CampusNoticeGetResult:
    notice_id: str
    outcome: ToolBusinessOutcome
    title: str = ""
    source_family: NoticeSourceFamily | str = field(default="", compare=False)
    source_url: str = ""
    canonical_url: str = ""
    normalized_body: str = ""
    published_at: str = ""
    effective_at: str = ""
    attachment_refs: tuple[str, ...] = field(default_factory=tuple)
    provenance_refs: tuple[str, ...] = field(default_factory=tuple)
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        _validate_tool_business_outcome(self.outcome)
        if self.source_family:
            _validate_notice_source_family(self.source_family)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome in {"resolved_current", "resolved_historical_reference"}:
            if not self.title.strip():
                raise ValueError("title must not be empty for resolved notice results")
            if not self.source_family:
                raise ValueError("source_family must not be empty for resolved notice results")
            if not self.source_url.strip():
                raise ValueError("source_url must not be empty for resolved notice results")
            if not self.normalized_body.strip():
                raise ValueError("normalized_body must not be empty for resolved notice results")
        if self.outcome == "resolved_historical_reference" and not self.historical_downgrade_reason:
            raise ValueError("historical_downgrade_reason must not be empty for historical notice get results")
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError("fail_close_reason must not be empty for fail-closed notice get results")


@dataclass(frozen=True, slots=True)
class RagResultPayload:
    evidence: EvidenceBundle
    diagnostics: RagResultDiagnostics | None = None


@dataclass(frozen=True, slots=True)
class SupervisorObservability:
    retrieval_attempted: bool | None = None
    candidate_count: int | None = None
    retrieved_source_count: int | None = None
    retrieved_sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)
    citation_expected: bool | None = None
    citation_count: int | None = None
    citation_missing: bool | None = None
    refusal_class: str = ""
    semantic_outcome: str = ""
    scope_class: str = ""
    policy_reason: str = ""
    acl_decision: str = ""
    acl_anomaly_code: str = ""
    fail_closed: bool | None = None
    model_provider: str = ""
    model_name: str = ""
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    estimated_cost_microusd: int | None = None
    resolved_scope_corpus: AllowedCorpus | None = None
    resolved_scope_collection: str = ""
    prompt_runtime_state: str = ""
    prompt_runtime_detail: str = ""
    prompt_trace: PromptTrace | None = None


@dataclass(frozen=True, slots=True)
class SupervisorRequest:
    user_goal: str
    conversation_id: str = ""
    request_id: str = ""
    safety_identifier: str | None = None
    trace: TraceContext = field(default_factory=TraceContext)
    actor: ActorContext = field(default_factory=ActorContext)
    context: ContextProjection = field(default_factory=ContextProjection)
    requested_capability: RequestedCapability | None = None
    requested_scope: KnowledgeScope | None = None

    def __post_init__(self) -> None:
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")
        normalized_safety_identifier = _normalize_optional_safety_identifier(
            self.safety_identifier
        )
        if normalized_safety_identifier != self.safety_identifier:
            object.__setattr__(self, "safety_identifier", normalized_safety_identifier)
        _coerce_context_projection(self)
        if (
            self.requested_capability is not None
            and self.requested_capability not in ALLOWED_REQUESTED_CAPABILITIES
        ):
            raise ValueError(f"unsupported requested_capability: {self.requested_capability}")


@dataclass(frozen=True, slots=True)
class SpecialistRequest:
    target: SpecialistTarget
    user_goal: str
    payload: (
        RagRequestPayload
        | PlaceLookupPayload
        | ServiceStatusLookupPayload
        | TransportScheduleLookupPayload
        | CampusNoticeDiscoverPayload
        | CampusNoticeGetPayload
    )
    allowed_tools: tuple[SpecialistToolName, ...] = field(default_factory=tuple)
    conversation_id: str = ""
    request_id: str = ""
    safety_identifier: str | None = None
    trace: TraceContext = field(default_factory=TraceContext)
    actor: ActorContext = field(default_factory=ActorContext)
    context: ContextProjection = field(default_factory=ContextProjection)

    def __post_init__(self) -> None:
        if self.target not in ALLOWED_SPECIALIST_TARGETS:
            raise ValueError(f"unsupported specialist target: {self.target}")
        for allowed_tool in self.allowed_tools:
            if allowed_tool not in ALLOWED_SPECIALIST_TOOL_NAMES:
                raise ValueError(f"unsupported allowed_tool: {allowed_tool}")
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")
        normalized_safety_identifier = _normalize_optional_safety_identifier(
            self.safety_identifier
        )
        if normalized_safety_identifier != self.safety_identifier:
            object.__setattr__(self, "safety_identifier", normalized_safety_identifier)
        _coerce_context_projection(self)


@dataclass(frozen=True, slots=True)
class SpecialistResponse:
    target: SpecialistTarget
    status: DelegateStatus
    answer_text: str = ""
    follow_up_question: str = ""
    confidence: ConfidenceLevel = "low"
    result: (
        RagResultPayload
        | PlaceLookupResult
        | ServiceStatusLookupResult
        | TransportScheduleLookupResult
        | CampusNoticeDiscoverResult
        | CampusNoticeGetResult
        | None
    ) = None
    error: ErrorInfo | None = None

    def __post_init__(self) -> None:
        if self.target not in ALLOWED_SPECIALIST_TARGETS:
            raise ValueError(f"unsupported specialist target: {self.target}")
        if self.status not in ALLOWED_DELEGATE_STATUSES:
            raise ValueError(f"unsupported delegate status: {self.status}")
        if self.confidence not in ALLOWED_CONFIDENCE_LEVELS:
            raise ValueError(f"unsupported confidence level: {self.confidence}")


@dataclass(frozen=True, slots=True)
class SupervisorResponse:
    selected_target: SpecialistTarget | None
    status: SupervisorStatus
    answer_text: str = ""
    follow_up_question: str = ""
    confidence: ConfidenceLevel = "low"
    result: (
        RagResultPayload
        | PlaceLookupResult
        | ServiceStatusLookupResult
        | TransportScheduleLookupResult
        | CampusNoticeDiscoverResult
        | CampusNoticeGetResult
        | None
    ) = None
    error: ErrorInfo | None = None
    observability: SupervisorObservability | None = None

    def __post_init__(self) -> None:
        if self.selected_target is not None and self.selected_target not in ALLOWED_SPECIALIST_TARGETS:
            raise ValueError(f"unsupported selected_target: {self.selected_target}")
        if self.status not in ALLOWED_SUPERVISOR_STATUSES:
            raise ValueError(f"unsupported supervisor status: {self.status}")
        if self.confidence not in ALLOWED_CONFIDENCE_LEVELS:
            raise ValueError(f"unsupported confidence level: {self.confidence}")


def _coerce_context_projection(request: SupervisorRequest | SpecialistRequest) -> None:
    default_actor = ActorContext()
    default_context = ContextProjection()
    if request.actor == default_actor and request.context == default_context:
        return
    if request.context == default_context:
        object.__setattr__(
            request,
            "context",
            ContextProjection(actor=request.actor),
        )
        return
    if request.actor == default_actor:
        object.__setattr__(request, "actor", request.context.actor)
        return
    if request.actor != request.context.actor:
        raise ValueError("actor and context.actor must match")


def _normalize_optional_safety_identifier(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if not _SHA256_HEX_RE.fullmatch(normalized):
        raise ValueError(
            "safety_identifier must be a 64-character lowercase hex string"
        )
    return normalized


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


def resolve_curriculum_follow_up_slots(
    confirmed_slots: tuple[SessionSlot, ...],
) -> CurriculumFollowUpSlots:
    program_family = ""
    program = ""
    semester = ""
    for slot in confirmed_slots:
        if not slot.confirmed:
            continue
        value = slot.value.strip()
        if not value:
            continue
        if slot.name == CURRICULUM_PROGRAM_FAMILY_SLOT_NAME:
            program_family = value
        elif slot.name == CURRICULUM_PROGRAM_SLOT_NAME:
            program = value
        elif slot.name == CURRICULUM_SEMESTER_SLOT_NAME:
            semester = value
    return CurriculumFollowUpSlots(
        program_family=program_family,
        program=program,
        semester=semester,
    )


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


def _validate_tool_business_outcome(outcome: str) -> None:
    if outcome not in ALLOWED_TOOL_BUSINESS_OUTCOMES:
        raise ValueError(f"unsupported tool business outcome: {outcome}")


def _validate_tool_fail_close_reason(reason: str) -> None:
    if reason not in ALLOWED_TOOL_FAIL_CLOSE_REASONS:
        raise ValueError(f"unsupported tool fail-close reason: {reason}")


def _validate_historical_downgrade_reason(reason: str) -> None:
    if reason not in ALLOWED_HISTORICAL_DOWNGRADE_REASONS:
        raise ValueError(f"unsupported historical downgrade reason: {reason}")


def _validate_notice_source_family(source_family: str) -> None:
    if source_family not in ALLOWED_NOTICE_SOURCE_FAMILIES:
        raise ValueError(f"unsupported notice source family: {source_family}")


def _validate_service_status_value(status: str) -> None:
    if status not in ALLOWED_SERVICE_STATUS_VALUES:
        raise ValueError(f"unsupported service status value: {status}")


def _validate_transport_service_status_value(status: str) -> None:
    if status not in ALLOWED_TRANSPORT_SERVICE_STATUS_VALUES:
        raise ValueError(f"unsupported transport service status value: {status}")


def _validate_remote_content_suspicion_label(remote_content_suspicion_label: str) -> None:
    if remote_content_suspicion_label not in ALLOWED_REMOTE_CONTENT_SUSPICION_LABELS:
        raise ValueError(
            "unsupported remote content suspicion label: "
            f"{remote_content_suspicion_label}"
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
    if normalized_collection == "student_handbook":
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
