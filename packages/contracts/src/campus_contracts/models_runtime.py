from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

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
    ALLOWED_CAPABILITY_IDS,
    ALLOWED_CAPABILITY_TOOL_NAMES,
    ALLOWED_CONFIDENCE_LEVELS,
    ALLOWED_DELEGATE_STATUSES,
    ALLOWED_EXECUTION_STATUSES,
    ALLOWED_REQUESTED_CAPABILITIES,
    CapabilityID,
    CapabilityToolName,
    ConfidenceLevel,
    DelegateStatus,
    ExecutionStatus,
    RequestedCapability,
)
from campus_contracts.models_tools import (
    AcademicCalendarLookupPayload,
    AcademicCalendarLookupResult,
    CampusNoticeChangeSetLookupPayload,
    CampusNoticeChangeSetLookupResult,
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
    ContactDirectoryLookupPayload,
    ContactDirectoryLookupResult,
    PlaceLookupPayload,
    PlaceLookupResult,
    ServiceGuideLookupPayload,
    ServiceGuideLookupResult,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    TransportScheduleLookupPayload,
    TransportScheduleLookupResult,
)

_FORBIDDEN_WORKFLOW_TRACE_KEY_TOKENS = (
    "raw_prompt",
    "raw_transcript",
    "provider_raw_response",
    "raw_response",
    "jwt",
    "cookie",
    "auth_envelope",
    "retrieval_backend_dump",
)
_FORBIDDEN_WORKFLOW_TRACE_VALUE_TOKENS = (
    "authorization:",
    "bearer ",
    "cookie:",
    "set-cookie:",
    "x-app-internal-auth:",
    "access_token=",
    "refresh_token=",
    "sessionid=",
    "session_id=",
    "sso_tgc=",
    "token=",
)
_JWT_VALUE_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")
_REQUIRED_WORKFLOW_PROJECTION_REF_FIELDS = (
    "projection_id",
    "source_step_id",
    "projection_kind",
    "content_hash",
    "safety",
)


def _normalize_workflow_trace_key_token(value: str) -> str:
    return "".join(char for char in value.strip().lower() if char.isalnum())


def _reject_raw_workflow_trace_keys(value: object, field_name: str) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized_key = _normalize_workflow_trace_key_token(str(key))
            if any(
                _normalize_workflow_trace_key_token(token) in normalized_key
                for token in _FORBIDDEN_WORKFLOW_TRACE_KEY_TOKENS
            ):
                raise ValueError(f"{field_name} contains forbidden raw workflow trace key: {key}")
            _reject_raw_workflow_trace_keys(item, field_name)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _reject_raw_workflow_trace_keys(item, field_name)
        return
    if isinstance(value, str):
        _reject_raw_workflow_trace_value(value, field_name)


def _reject_raw_workflow_trace_value(value: str, field_name: str) -> None:
    normalized = value.strip().lower()
    if not normalized:
        return
    if any(token in normalized for token in _FORBIDDEN_WORKFLOW_TRACE_VALUE_TOKENS):
        raise ValueError(f"{field_name} contains forbidden raw workflow trace value")
    if _JWT_VALUE_RE.search(value):
        raise ValueError(f"{field_name} contains forbidden raw workflow trace value")


def _validate_workflow_projection_refs(projection_refs: tuple[dict[str, Any], ...]) -> None:
    for index, projection_ref in enumerate(projection_refs):
        if not isinstance(projection_ref, dict):
            raise ValueError(f"workflow_context.projection_refs[{index}] must be an object")
        for field_name in _REQUIRED_WORKFLOW_PROJECTION_REF_FIELDS:
            value = projection_ref.get(field_name)
            if field_name == "safety":
                if not isinstance(value, dict) or not value:
                    raise ValueError(
                        f"workflow_context.projection_refs[{index}].{field_name} is required"
                    )
                continue
            if not str(value or "").strip():
                raise ValueError(
                    f"workflow_context.projection_refs[{index}].{field_name} is required"
                )


@dataclass(frozen=True, slots=True)
class RagResultPayload:
    evidence: EvidenceBundle
    diagnostics: RagResultDiagnostics | None = None


@dataclass(frozen=True, slots=True)
class CapabilityObservability:
    selected_tool: str = ""
    tool_attempted: bool | None = None
    tool_outcome: str = ""
    failure_class: str = ""
    fail_close_reason: str = ""
    clarification_reason: str = ""
    source_ref_count: int | None = None
    result_outcome: str = ""
    access_decision: str = ""
    safe_details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _reject_raw_workflow_trace_keys(self.safe_details, "safe_details")


@dataclass(frozen=True, slots=True)
class WorkflowTraceSummary:
    routing_frame: dict[str, Any] = field(default_factory=dict)
    context_resolution: dict[str, Any] = field(default_factory=dict)
    planning_outcome: str = ""
    direct_vs_delegate_branch: str = ""
    workflow_mode: str = ""
    handoff: dict[str, Any] = field(default_factory=dict)
    handoff_chain: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    capability_invocations: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    selected_capability: str = ""
    selected_tools: tuple[str, ...] = field(default_factory=tuple)
    context_projections: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    answer_artifact_projection_ids: tuple[str, ...] = field(default_factory=tuple)
    answer_artifact_kinds: tuple[str, ...] = field(default_factory=tuple)
    tool_argument_summary: dict[str, Any] = field(default_factory=dict)
    trace_steps: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    tool_call_summaries: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    guardrail_outcomes: dict[str, Any] = field(default_factory=dict)
    fail_close_reason: str = ""
    runtime_versions: dict[str, Any] = field(default_factory=dict)
    policy_artifact_versions: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for field_name, payload in (
            ("routing_frame", self.routing_frame),
            ("context_resolution", self.context_resolution),
            ("handoff", self.handoff),
            ("context_projections", self.context_projections),
            ("capability_invocations", self.capability_invocations),
            ("tool_argument_summary", self.tool_argument_summary),
            ("trace_steps", self.trace_steps),
            ("tool_call_summaries", self.tool_call_summaries),
            ("guardrail_outcomes", self.guardrail_outcomes),
            ("runtime_versions", self.runtime_versions),
            ("policy_artifact_versions", self.policy_artifact_versions),
        ):
            _reject_raw_workflow_trace_keys(payload, field_name)
        for field_name, values in (
            ("answer_artifact_projection_ids", self.answer_artifact_projection_ids),
            ("answer_artifact_kinds", self.answer_artifact_kinds),
        ):
            for index, value in enumerate(values):
                if not str(value or "").strip():
                    raise ValueError(f"{field_name}[{index}] must be a non-empty string")


@dataclass(frozen=True, slots=True)
class WorkflowCapabilityContext:
    schema_version: str = "workflow-capability-context-v1"
    visibility: str = "capability_private"
    workflow_run_ref: str = ""
    step_id: str = ""
    capability_id: str = ""
    capability: str = ""
    required_projection_kind: str = ""
    expected_output_artifacts: tuple[str, ...] = field(default_factory=tuple)
    projection_refs: tuple[dict[str, Any], ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if self.schema_version != "workflow-capability-context-v1":
            raise ValueError("workflow_context.schema_version must be workflow-capability-context-v1")
        if self.visibility != "capability_private":
            raise ValueError("workflow_context.visibility must be capability_private")
        workflow_used = bool(
            self.workflow_run_ref.strip()
            or self.step_id.strip()
            or self.capability_id.strip()
            or self.capability.strip()
            or self.required_projection_kind.strip()
            or self.projection_refs
        )
        if workflow_used:
            if not self.workflow_run_ref.strip():
                raise ValueError("workflow_context.workflow_run_ref is required")
            if not self.step_id.strip():
                raise ValueError("workflow_context.step_id is required")
            if self.capability_id not in ALLOWED_CAPABILITY_IDS:
                raise ValueError("workflow_context.capability_id is required")
        if self.required_projection_kind and not any(
            str(item.get("projection_kind") or "").strip() == self.required_projection_kind
            for item in self.projection_refs
        ):
            raise ValueError("workflow_context required projection is missing")
        normalized_expected_output_artifacts: list[str] = []
        for index, artifact_kind in enumerate(self.expected_output_artifacts):
            normalized = str(artifact_kind or "").strip()
            if not normalized:
                raise ValueError(
                    "workflow_context.expected_output_artifacts"
                    f"[{index}] must be a non-empty string"
                )
            normalized_expected_output_artifacts.append(normalized)
        if tuple(normalized_expected_output_artifacts) != self.expected_output_artifacts:
            object.__setattr__(
                self,
                "expected_output_artifacts",
                tuple(normalized_expected_output_artifacts),
            )
        _reject_raw_workflow_trace_keys(self.projection_refs, "workflow_context.projection_refs")
        _validate_workflow_projection_refs(self.projection_refs)


@dataclass(frozen=True, slots=True)
class ExecutionObservability:
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
    service_guide_focus: str = ""
    matched_service_category: str = ""
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


def _coerce_context_projection(request: ExecutionRequest | CapabilityRequest) -> None:
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
class ExecutionRequest:
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
class CapabilityRequest:
    capability: CapabilityID
    user_goal: str
    payload: (
        RagRequestPayload
        | PlaceLookupPayload
        | AcademicCalendarLookupPayload
        | ServiceGuideLookupPayload
        | ServiceStatusLookupPayload
        | TransportScheduleLookupPayload
        | ContactDirectoryLookupPayload
        | CampusNoticeChangeSetLookupPayload
        | CampusNoticeDiscoverPayload
        | CampusNoticeGetPayload
    )
    allowed_tools: tuple[CapabilityToolName, ...] = field(default_factory=tuple)
    conversation_id: str = ""
    request_id: str = ""
    safety_identifier: str | None = None
    trace: TraceContext = field(default_factory=TraceContext)
    actor: ActorContext = field(default_factory=ActorContext)
    context: ContextProjection = field(default_factory=ContextProjection)
    workflow_context: WorkflowCapabilityContext = field(default_factory=WorkflowCapabilityContext)

    def __post_init__(self) -> None:
        if self.capability not in ALLOWED_CAPABILITY_IDS:
            raise ValueError(f"unsupported capability: {self.capability}")
        for allowed_tool in self.allowed_tools:
            if allowed_tool not in ALLOWED_CAPABILITY_TOOL_NAMES:
                raise ValueError(f"unsupported allowed_tool: {allowed_tool}")
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")
        normalized_safety_identifier = _normalize_optional_safety_identifier(self.safety_identifier)
        if normalized_safety_identifier != self.safety_identifier:
            object.__setattr__(self, "safety_identifier", normalized_safety_identifier)
        _coerce_context_projection(self)


@dataclass(frozen=True, slots=True)
class CapabilityResponse:
    capability: CapabilityID
    status: DelegateStatus
    answer_text: str = ""
    follow_up_question: str = ""
    confidence: ConfidenceLevel = "low"
    result: (
        RagResultPayload
        | PlaceLookupResult
        | AcademicCalendarLookupResult
        | ServiceGuideLookupResult
        | ServiceStatusLookupResult
        | TransportScheduleLookupResult
        | ContactDirectoryLookupResult
        | CampusNoticeChangeSetLookupResult
        | CampusNoticeDiscoverResult
        | CampusNoticeGetResult
        | None
    ) = None
    error: ErrorInfo | None = None
    capability_observability: CapabilityObservability | None = None

    def __post_init__(self) -> None:
        if self.capability not in ALLOWED_CAPABILITY_IDS:
            raise ValueError(f"unsupported capability: {self.capability}")
        if self.status not in ALLOWED_DELEGATE_STATUSES:
            raise ValueError(f"unsupported delegate status: {self.status}")
        if self.confidence not in ALLOWED_CONFIDENCE_LEVELS:
            raise ValueError(f"unsupported confidence level: {self.confidence}")


@dataclass(frozen=True, slots=True)
class ExecutionResponse:
    selected_capability: CapabilityID | None
    status: ExecutionStatus
    answer_text: str = ""
    follow_up_question: str = ""
    confidence: ConfidenceLevel = "low"
    result: (
        RagResultPayload
        | PlaceLookupResult
        | AcademicCalendarLookupResult
        | ServiceGuideLookupResult
        | ServiceStatusLookupResult
        | TransportScheduleLookupResult
        | ContactDirectoryLookupResult
        | CampusNoticeChangeSetLookupResult
        | CampusNoticeDiscoverResult
        | CampusNoticeGetResult
        | None
    ) = None
    error: ErrorInfo | None = None
    observability: ExecutionObservability | None = None
    workflow_trace_summary: WorkflowTraceSummary | None = None

    def __post_init__(self) -> None:
        if (
            self.selected_capability is not None
            and self.selected_capability not in ALLOWED_CAPABILITY_IDS
        ):
            raise ValueError(f"unsupported selected_capability: {self.selected_capability}")
        if self.status not in ALLOWED_EXECUTION_STATUSES:
            raise ValueError(f"unsupported execution status: {self.status}")
        if self.confidence not in ALLOWED_CONFIDENCE_LEVELS:
            raise ValueError(f"unsupported confidence level: {self.confidence}")
