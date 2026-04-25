from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_context import (
    ActorContext,
    ContextProjection,
    TraceContext,
)
from campus_contracts.models_retrieval import (
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    PromptTrace,
    RagRequestPayload,
    RagResultDiagnostics,
    VersionQuery,
)
from campus_contracts.models_shared import (
    _SHA256_HEX_RE,
    ALLOWED_CONFIDENCE_LEVELS,
    ALLOWED_DELEGATE_STATUSES,
    ALLOWED_REQUESTED_CAPABILITIES,
    ALLOWED_SPECIALIST_TARGETS,
    ALLOWED_SPECIALIST_TOOL_NAMES,
    ALLOWED_SUPERVISOR_STATUSES,
    ConfidenceLevel,
    DelegateStatus,
    RequestedCapability,
    SpecialistTarget,
    SpecialistToolName,
    SupervisorStatus,
)
from campus_contracts.models_tools import (
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
    PlaceLookupPayload,
    PlaceLookupResult,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    TransportScheduleLookupPayload,
    TransportScheduleLookupResult,
)


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
    intent_capability: str = ""
    intent_task_kind: str = ""
    intent_launch_state: str = ""
    intent_next_action: str = ""
    intent_scope_class: str = ""
    intent_scope_reason: str = ""
    intent_policy_reason: str = ""
    intent_classifier_version: str = ""
    intent_schema_version: str = ""
    intent_routing_confidence: str = ""
    intent_ambiguity_signal: str = ""
    intent_context_resolution_state: str = ""
    intent_context_reference_type: str = ""
    intent_resolved_slots: dict[str, str] = field(default_factory=dict)
    intent_missing_slots: tuple[str, ...] = field(default_factory=tuple)
    intent_ambiguity_reason: str = ""
    acl_decision: str = ""
    acl_anomaly_code: str = ""
    fail_closed: bool | None = None
    selected_tool: str = ""
    tool_business_outcome: str = ""
    tool_fail_close_reason: str = ""
    tool_historical_downgrade_reason: str = ""
    notice_source_family_summary: str = ""
    temporal_posture: str = ""
    model_provider: str = ""
    model_name: str = ""
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    estimated_cost_microusd: int | None = None
    resolved_scope_corpus: str | None = None
    resolved_scope_collection: str = ""
    prompt_runtime_state: str = ""
    prompt_runtime_detail: str = ""
    prompt_trace: PromptTrace | None = None


def _normalize_optional_safety_identifier(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if not _SHA256_HEX_RE.fullmatch(normalized):
        raise ValueError("safety_identifier must be a 64-character lowercase hex string")
    return normalized


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
    version_query: VersionQuery = field(default_factory=VersionQuery)

    def __post_init__(self) -> None:
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")
        normalized_safety_identifier = _normalize_optional_safety_identifier(self.safety_identifier)
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
        normalized_safety_identifier = _normalize_optional_safety_identifier(self.safety_identifier)
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
        if (
            self.selected_target is not None
            and self.selected_target not in ALLOWED_SPECIALIST_TARGETS
        ):
            raise ValueError(f"unsupported selected_target: {self.selected_target}")
        if self.status not in ALLOWED_SUPERVISOR_STATUSES:
            raise ValueError(f"unsupported supervisor status: {self.status}")
        if self.confidence not in ALLOWED_CONFIDENCE_LEVELS:
            raise ValueError(f"unsupported confidence level: {self.confidence}")
