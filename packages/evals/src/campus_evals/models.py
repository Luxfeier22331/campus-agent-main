from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from campus_contracts import ActorContext
from campus_contracts.models import ALLOWED_CORPORA, ALLOWED_DELEGATE_STATUSES, DelegateStatus


CaseSplit = Literal["smoke", "regression_locked", "exploratory", "release_gate"]
SourceType = Literal["expert_authored", "historical_logs", "incident_backfill", "synthetic_expansion"]

ALLOWED_CASE_SPLITS = ("smoke", "regression_locked", "exploratory", "release_gate")
ALLOWED_SOURCE_TYPES = ("expert_authored", "historical_logs", "incident_backfill", "synthetic_expansion")


@dataclass(frozen=True, slots=True)
class ExpectedSourceRef:
    doc_id: str
    version_id: str
    chunk_id: str


def expected_source_ref(doc_id: str, version_id: str, chunk_id: str) -> ExpectedSourceRef:
    return ExpectedSourceRef(doc_id=doc_id, version_id=version_id, chunk_id=chunk_id)


@dataclass(frozen=True, slots=True)
class TraceExpectation:
    selected_corpus: str | None = None
    retrieval_called: bool | None = None
    clarification_expected: bool | None = None
    error_expected: bool | None = None

    def __post_init__(self) -> None:
        if self.selected_corpus is not None and self.selected_corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported trace corpus: {self.selected_corpus}")


@dataclass(frozen=True, slots=True)
class GraderPolicy:
    grade_status: bool = True
    grade_retrieval: bool = True
    grade_answer: bool = True
    grade_trace: bool = True


@dataclass(frozen=True, slots=True)
class GoldenCase:
    case_id: str
    split: CaseSplit
    source_type: SourceType
    user_goal: str
    actor: ActorContext
    corpora: tuple[str, ...]
    expected_status: DelegateStatus
    expected_evidence_corpus: str
    expected_sources: tuple[ExpectedSourceRef, ...] = field(default_factory=tuple)
    forbidden_sources: tuple[ExpectedSourceRef, ...] = field(default_factory=tuple)
    required_facts: tuple[str, ...] = field(default_factory=tuple)
    forbidden_claims: tuple[str, ...] = field(default_factory=tuple)
    trace_expectation: TraceExpectation | None = None
    grader_policy: GraderPolicy = field(default_factory=GraderPolicy)

    def __post_init__(self) -> None:
        if self.split not in ALLOWED_CASE_SPLITS:
            raise ValueError(f"unsupported split: {self.split}")
        if self.source_type not in ALLOWED_SOURCE_TYPES:
            raise ValueError(f"unsupported source_type: {self.source_type}")
        if not self.corpora:
            raise ValueError("corpora must not be empty")
        for corpus in self.corpora:
            if corpus not in ALLOWED_CORPORA:
                raise ValueError(f"unsupported corpus: {corpus}")
        if self.expected_status not in ALLOWED_DELEGATE_STATUSES:
            raise ValueError(f"unsupported expected_status: {self.expected_status}")
        if self.expected_evidence_corpus not in self.corpora:
            raise ValueError("expected_evidence_corpus must be included in corpora")
        if self.expected_evidence_corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported expected_evidence_corpus: {self.expected_evidence_corpus}")


@dataclass(frozen=True, slots=True)
class ObservedTrace:
    selected_corpus: str | None = None
    retrieval_called: bool | None = None
    clarification_emitted: bool | None = None
    error_path: bool | None = None

    def __post_init__(self) -> None:
        if self.selected_corpus is not None and self.selected_corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported observed trace corpus: {self.selected_corpus}")


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    response: object
    observed_trace: ObservedTrace | None = None


@dataclass(frozen=True, slots=True)
class DimensionResult:
    passed: bool
    reason: str = ""


@dataclass(frozen=True, slots=True)
class CaseResult:
    case_id: str
    passed: bool
    status_result: DimensionResult
    retrieval_result: DimensionResult
    answer_result: DimensionResult
    trace_result: DimensionResult


@dataclass(frozen=True, slots=True)
class SummaryCount:
    total: int
    passed: int
    failed: int


@dataclass(frozen=True, slots=True)
class RunReport:
    total: int
    passed: int
    failed: int
    by_split: dict[str, SummaryCount]
    by_dimension: dict[str, SummaryCount]
    results: tuple[CaseResult, ...]
