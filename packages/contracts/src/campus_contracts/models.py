from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, TypeAlias


AllowedCorpus: TypeAlias = str
RevisionTrack = Literal["source-faithful", "current-effective", "editorial"]
SourceChannel = Literal["pdf_ocr", "official_web", "manual_curated"]
DelegateStatus = Literal["completed", "needs_clarification", "no_answer", "error"]
ConfidenceLevel = Literal["high", "medium", "low"]
SpecialistTarget = Literal["rag-specialist", "availability-specialist"]
RequestedCapability = Literal["knowledge", "availability"]

ALLOWED_REVISION_TRACKS = ("source-faithful", "current-effective", "editorial")
ALLOWED_SOURCE_CHANNELS = ("pdf_ocr", "official_web", "manual_curated")
DEFAULT_REVISION_TRACK = "source-faithful"
DEFAULT_SOURCE_CHANNEL = "pdf_ocr"
ALLOWED_DELEGATE_STATUSES = ("completed", "needs_clarification", "no_answer", "error")
ALLOWED_CONFIDENCE_LEVELS = ("high", "medium", "low")
ALLOWED_SPECIALIST_TARGETS = ("rag-specialist", "availability-specialist")
ALLOWED_REQUESTED_CAPABILITIES = ("knowledge", "availability")


@dataclass(frozen=True, slots=True)
class TraceContext:
    trace_id: str = ""
    parent_run_id: str = ""
    tool_call_id: str = ""


@dataclass(frozen=True, slots=True)
class ActorContext:
    user_id: str = ""
    roles: tuple[str, ...] = field(default_factory=tuple)
    departments: tuple[str, ...] = field(default_factory=tuple)
    groups: tuple[str, ...] = field(default_factory=tuple)
    campus_scope: str | None = None
    snapshot: dict[str, object] = field(default_factory=dict)


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
    acl_level: str
    canonical_url: str
    latest_url: str
    source_channel: SourceChannel
    collection: str
    is_current: bool
    snippet: str
    score: float

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
    scope: KnowledgeScope


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
    requested_capability: RequestedCapability | None = None
    requested_scope: KnowledgeScope | None = None
    availability_target_id: str | None = None
    follow_redirects: bool = True

    def __post_init__(self) -> None:
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")
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

    def __post_init__(self) -> None:
        if self.target not in ALLOWED_SPECIALIST_TARGETS:
            raise ValueError(f"unsupported specialist target: {self.target}")
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")


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
