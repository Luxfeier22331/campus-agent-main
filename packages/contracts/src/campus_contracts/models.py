from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


AllowedCorpus = Literal["student_handbook"]
DelegateStatus = Literal["completed", "needs_clarification", "no_answer", "error"]
ConfidenceLevel = Literal["high", "medium", "low"]

ALLOWED_CORPORA = ("student_handbook",)
ALLOWED_DELEGATE_STATUSES = ("completed", "needs_clarification", "no_answer", "error")
ALLOWED_CONFIDENCE_LEVELS = ("high", "medium", "low")


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
class DocumentRef:
    document_id: str
    version_id: str
    corpus: AllowedCorpus
    source_uri: str
    content_hash: str

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)


@dataclass(frozen=True, slots=True)
class EvidenceSource:
    doc_id: str
    version_id: str
    chunk_id: str
    anchor: dict[str, object]
    acl_level: str
    canonical_url: str
    latest_url: str
    snippet: str
    score: float


@dataclass(frozen=True, slots=True)
class EvidenceBundle:
    query_text: str = ""
    corpus: AllowedCorpus = "student_handbook"
    sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)


@dataclass(frozen=True, slots=True)
class ErrorInfo:
    code: str
    message: str
    retryable: bool = False


@dataclass(frozen=True, slots=True)
class DelegateToRagAgentRequest:
    user_goal: str
    conversation_id: str = "bootstrap-conversation"
    request_id: str = ""
    trace: TraceContext = field(default_factory=TraceContext)
    actor: ActorContext = field(default_factory=ActorContext)
    corpora: tuple[AllowedCorpus, ...] = field(default_factory=lambda: ALLOWED_CORPORA)

    def __post_init__(self) -> None:
        if not self.corpora:
            raise ValueError("corpora must not be empty")
        for corpus in self.corpora:
            _validate_corpus(corpus)


@dataclass(frozen=True, slots=True)
class DelegateToRagAgentResponse:
    status: DelegateStatus
    answer_text: str = ""
    follow_up_question: str = ""
    confidence: ConfidenceLevel = "low"
    evidence: EvidenceBundle = field(default_factory=EvidenceBundle)
    error: ErrorInfo | None = None

    def __post_init__(self) -> None:
        if self.status not in ALLOWED_DELEGATE_STATUSES:
            raise ValueError(f"unsupported delegate status: {self.status}")
        if self.confidence not in ALLOWED_CONFIDENCE_LEVELS:
            raise ValueError(f"unsupported confidence level: {self.confidence}")


def _validate_corpus(corpus: str) -> None:
    if corpus not in ALLOWED_CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
