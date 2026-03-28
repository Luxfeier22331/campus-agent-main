from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from campus_contracts import ActorContext, EvidenceSource, KnowledgeScope
from campus_contracts.models import ALLOWED_DELEGATE_STATUSES, DelegateStatus


CaseSplit = Literal["smoke", "regression_locked", "exploratory", "release_gate"]
SourceType = Literal["expert_authored", "historical_logs", "incident_backfill", "synthetic_expansion"]

ALLOWED_CASE_SPLITS = ("smoke", "regression_locked", "exploratory", "release_gate")
ALLOWED_SOURCE_TYPES = ("expert_authored", "historical_logs", "incident_backfill", "synthetic_expansion")


@dataclass(frozen=True, slots=True)
class ExpectedSourceRef:
    doc_id: str
    version_id: str | None = None
    chunk_id: str | None = None


def expected_source_ref(
    doc_id: str,
    version_id: str | None = None,
    chunk_id: str | None = None,
) -> ExpectedSourceRef:
    return ExpectedSourceRef(doc_id=doc_id, version_id=version_id, chunk_id=chunk_id)


@dataclass(frozen=True, slots=True)
class TraceExpectation:
    selected_scope: KnowledgeScope | None = None
    retrieval_called: bool | None = None
    clarification_expected: bool | None = None
    error_expected: bool | None = None
    fail_closed_expected: bool | None = None
    expected_handoff: str | None = None

    def __post_init__(self) -> None:
        if self.expected_handoff is not None and self.expected_handoff not in ("none", "rag-specialist"):
            raise ValueError(f"unsupported expected_handoff: {self.expected_handoff}")


@dataclass(frozen=True, slots=True)
class GraderPolicy:
    mode: Literal["deterministic_only", "deterministic_plus_llm", "manual_review"] = "deterministic_only"
    grade_status: bool = True
    grade_retrieval: bool = True
    grade_answer: bool = True
    grade_trace: bool = True

    def __post_init__(self) -> None:
        if self.mode not in ("deterministic_only", "deterministic_plus_llm", "manual_review"):
            raise ValueError(f"unsupported grader mode: {self.mode}")


@dataclass(frozen=True, slots=True)
class GoldenCase:
    case_id: str
    split: CaseSplit
    source_type: SourceType
    user_goal: str
    actor: ActorContext
    expected_status: DelegateStatus
    scope: KnowledgeScope
    expected_sources: tuple[ExpectedSourceRef, ...] = field(default_factory=tuple)
    forbidden_sources: tuple[ExpectedSourceRef, ...] = field(default_factory=tuple)
    required_facts: tuple[str, ...] = field(default_factory=tuple)
    forbidden_claims: tuple[str, ...] = field(default_factory=tuple)
    trace_expectation: TraceExpectation | None = None
    grader_policy: GraderPolicy = field(default_factory=GraderPolicy)
    generator_name: str = ""
    generator_version: str = ""
    generation_recipe: str = ""
    seed_case_id: str = ""
    tags: tuple[str, ...] = field(default_factory=tuple)
    notes: str = ""
    metadata: dict[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.split not in ALLOWED_CASE_SPLITS:
            raise ValueError(f"unsupported split: {self.split}")
        if self.source_type not in ALLOWED_SOURCE_TYPES:
            raise ValueError(f"unsupported source_type: {self.source_type}")
        if self.expected_status not in ALLOWED_DELEGATE_STATUSES:
            raise ValueError(f"unsupported expected_status: {self.expected_status}")
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")


@dataclass(frozen=True, slots=True)
class ObservedTrace:
    selected_scope: KnowledgeScope | None = None
    retrieval_called: bool | None = None
    clarification_emitted: bool | None = None
    error_path: bool | None = None
    retrieved_sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)
    supporting_sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)


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
    metric_results: dict[str, DimensionResult] = field(default_factory=dict)
    observed_trace: ObservedTrace | None = None
    supplemental_results: tuple["SupplementalResult", ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class SummaryCount:
    total: int
    passed: int
    failed: int
    pass_rate: float | None
    reason: str = ""


SupplementalVerdict = Literal["passed", "failed", "not_applicable"]


@dataclass(frozen=True, slots=True)
class SupplementalResult:
    adapter_id: str
    metric_name: str
    score: float | None = None
    verdict: SupplementalVerdict | None = None
    rationale: str = ""
    gating: bool = False
    metadata: dict[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.adapter_id.strip():
            raise ValueError("adapter_id must not be empty")
        if not self.metric_name.strip():
            raise ValueError("metric_name must not be empty")
        if self.score is None and self.verdict is None:
            raise ValueError("supplemental result requires score or verdict")


@dataclass(frozen=True, slots=True)
class SupplementalMetricSummary:
    adapter_id: str
    metric_name: str
    total: int
    score_count: int
    average_score: float | None
    verdict_counts: dict[str, int]
    report_only: bool
    reason: str = ""


@dataclass(frozen=True, slots=True)
class RunReport:
    total: int
    passed: int
    failed: int
    by_split: dict[str, SummaryCount]
    by_dimension: dict[str, SummaryCount]
    by_metric: dict[str, SummaryCount]
    results: tuple[CaseResult, ...]
    by_supplemental: dict[str, SupplementalMetricSummary] = field(default_factory=dict)
