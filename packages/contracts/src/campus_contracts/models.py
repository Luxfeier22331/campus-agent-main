from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, TypeAlias


AllowedCorpus: TypeAlias = str
RevisionTrack = Literal["source-faithful", "current-effective", "editorial"]
SourceChannel = Literal["pdf_ocr", "official_web", "manual_curated", "authenticated_notice_portal"]
DelegateStatus = Literal["completed", "needs_clarification", "no_answer", "error"]
ConfidenceLevel = Literal["high", "medium", "low"]
SpecialistTarget = Literal["rag-specialist", "availability-specialist"]
RequestedCapability = Literal["knowledge", "availability"]
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

ALLOWED_REVISION_TRACKS = ("source-faithful", "current-effective", "editorial")
ALLOWED_SOURCE_CHANNELS = ("pdf_ocr", "official_web", "manual_curated", "authenticated_notice_portal")
DEFAULT_REVISION_TRACK = "source-faithful"
DEFAULT_SOURCE_CHANNEL = "pdf_ocr"
ALLOWED_DELEGATE_STATUSES = ("completed", "needs_clarification", "no_answer", "error")
ALLOWED_CONFIDENCE_LEVELS = ("high", "medium", "low")
ALLOWED_SPECIALIST_TARGETS = ("rag-specialist", "availability-specialist")
ALLOWED_REQUESTED_CAPABILITIES = ("knowledge", "availability")
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
DEFAULT_POLICY_PROJECTION_VERSION = "phase1-authorization-projection-v1"
CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family"
CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program"
CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester"


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

    def __post_init__(self) -> None:
        _validate_revision_track(self.revision_track)
        _validate_source_channel(self.source_channel)
        _validate_collection(self.collection)


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


@dataclass(frozen=True, slots=True)
class ErrorInfo:
    code: str
    message: str
    retryable: bool = False


@dataclass(frozen=True, slots=True)
class RagRequestPayload:
    scope: KnowledgeScope | None = None


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
    unsupported_fields: tuple[str, ...] = field(default_factory=tuple)
    partial_answer: bool = False
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
class AvailabilityCheckPayload:
    target_id: str
    follow_redirects: bool = True

    def __post_init__(self) -> None:
        if not self.target_id.strip():
            raise ValueError("target_id must not be empty")


@dataclass(frozen=True, slots=True)
class RagResultPayload:
    evidence: EvidenceBundle
    diagnostics: RagResultDiagnostics | None = None


@dataclass(frozen=True, slots=True)
class SupervisorObservability:
    retrieval_attempted: bool | None = None
    candidate_count: int | None = None
    retrieved_source_count: int | None = None
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
    prompt_trace: PromptTrace | None = None


@dataclass(frozen=True, slots=True)
class AvailabilityObservation:
    target_id: str
    observed_status: str
    http_status: int | None = None
    final_url: str = ""
    redirect_chain: tuple[str, ...] = field(default_factory=tuple)
    failure_classification: str = ""

    def __post_init__(self) -> None:
        if not self.target_id.strip():
            raise ValueError("target_id must not be empty")
        if not self.observed_status.strip():
            raise ValueError("observed_status must not be empty")


@dataclass(frozen=True, slots=True)
class SupervisorRequest:
    user_goal: str
    conversation_id: str = ""
    request_id: str = ""
    trace: TraceContext = field(default_factory=TraceContext)
    actor: ActorContext = field(default_factory=ActorContext)
    context: ContextProjection = field(default_factory=ContextProjection)
    requested_capability: RequestedCapability | None = None
    requested_scope: KnowledgeScope | None = None
    availability_target_id: str | None = None
    follow_redirects: bool = True

    def __post_init__(self) -> None:
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")
        _coerce_context_projection(self)
        if (
            self.requested_capability is not None
            and self.requested_capability not in ALLOWED_REQUESTED_CAPABILITIES
        ):
            raise ValueError(f"unsupported requested_capability: {self.requested_capability}")
        if self.availability_target_id is not None and not self.availability_target_id.strip():
            raise ValueError("availability_target_id must not be empty")


@dataclass(frozen=True, slots=True)
class SpecialistRequest:
    target: SpecialistTarget
    user_goal: str
    payload: RagRequestPayload | AvailabilityCheckPayload
    conversation_id: str = ""
    request_id: str = ""
    trace: TraceContext = field(default_factory=TraceContext)
    actor: ActorContext = field(default_factory=ActorContext)
    context: ContextProjection = field(default_factory=ContextProjection)

    def __post_init__(self) -> None:
        if self.target not in ALLOWED_SPECIALIST_TARGETS:
            raise ValueError(f"unsupported specialist target: {self.target}")
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")
        _coerce_context_projection(self)


@dataclass(frozen=True, slots=True)
class SpecialistResponse:
    target: SpecialistTarget
    status: DelegateStatus
    answer_text: str = ""
    follow_up_question: str = ""
    confidence: ConfidenceLevel = "low"
    result: RagResultPayload | AvailabilityObservation | None = None
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
    result: RagResultPayload | AvailabilityObservation | None = None
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
