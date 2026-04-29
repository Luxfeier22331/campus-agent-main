from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from campus_contracts import (
    ALLOWED_AGENT_TARGETS,
    ActorContext,
    AgentResponse,
    AgentTarget,
    EvidenceSource,
    KnowledgeScope,
    SupervisorResponse,
    SupervisorStatus,
    VersionQuery,
    WorkflowTraceSummary,
)
from campus_contracts.models import ALLOWED_SUPERVISOR_STATUSES

from campus_evals.operator_observability import OperatorRequestCorrelation

CaseSplit = Literal["smoke", "regression_locked", "exploratory", "release_gate"]
SourceType = Literal[
    "expert_authored", "historical_logs", "incident_backfill", "synthetic_expansion"
]

ALLOWED_CASE_SPLITS = ("smoke", "regression_locked", "exploratory", "release_gate")
ALLOWED_SOURCE_TYPES = (
    "expert_authored",
    "historical_logs",
    "incident_backfill",
    "synthetic_expansion",
)
ExpectedRuntimeTarget = AgentTarget | Literal["none"]
CapabilityFamilyLabel = Literal[
    "none", "rag-agent", "navigation-agent", "campus-services-agent", "notice-agent"
]
ALLOWED_EXPECTED_RUNTIME_TARGETS = ("none", *ALLOWED_AGENT_TARGETS)
ALLOWED_CAPABILITY_FAMILY_LABELS = (
    "none",
    "rag-agent",
    "navigation-agent",
    "campus-services-agent",
    "notice-agent",
)
_RUNTIME_TARGET_TO_CAPABILITY_FAMILY: dict[AgentTarget, CapabilityFamilyLabel] = {
    "rag-agent": "rag-agent",
    "navigation-agent": "navigation-agent",
    "campus-services-agent": "campus-services-agent",
    "notice-agent": "notice-agent",
}
_FORBIDDEN_WORKFLOW_TRACE_KEY_TOKENS = (
    "raw_prompt",
    "raw_transcript",
    "provider_raw_response",
    "raw_response",
    "raw_auth_material",
    "raw_retrieval_dump",
    "restricted_document_payload",
    "restricted_payload",
    "raw_restricted_payload",
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


def capability_family_for_runtime_target(target: AgentTarget | None) -> CapabilityFamilyLabel:
    if target is None:
        return "none"
    return _RUNTIME_TARGET_TO_CAPABILITY_FAMILY[target]


def reject_forbidden_workflow_trace_keys(payload: object, field_name: str) -> None:
    _reject_raw_workflow_trace_keys(payload, field_name, field_name)


def _reject_raw_workflow_trace_keys(payload: object, field_name: str, path: str) -> None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            normalized_key = _normalize_forbidden_key_token(str(key))
            child_path = f"{path}.{key}"
            if any(
                _normalize_forbidden_key_token(token) in normalized_key
                for token in _FORBIDDEN_WORKFLOW_TRACE_KEY_TOKENS
            ):
                raise ValueError(
                    f"{field_name} contains forbidden raw workflow trace key: {child_path}"
                )
            _reject_raw_workflow_trace_keys(value, field_name, child_path)
    elif isinstance(payload, list | tuple):
        for index, value in enumerate(payload):
            _reject_raw_workflow_trace_keys(value, field_name, f"{path}[{index}]")
    elif isinstance(payload, str):
        _reject_raw_workflow_trace_value(payload, field_name, path)


def _normalize_forbidden_key_token(value: str) -> str:
    return "".join(ch for ch in value.strip().lower() if ch.isalnum())


def _reject_raw_workflow_trace_value(value: str, field_name: str, path: str) -> None:
    normalized = value.strip().lower()
    if not normalized:
        return
    if any(token in normalized for token in _FORBIDDEN_WORKFLOW_TRACE_VALUE_TOKENS):
        raise ValueError(f"{field_name} contains forbidden raw workflow trace value: {path}")
    if _JWT_VALUE_RE.search(value):
        raise ValueError(f"{field_name} contains forbidden raw workflow trace value: {path}")


@dataclass(frozen=True, slots=True)
class ExpectedSourceRef:
    doc_id: str
    version_id: str | None = None
    chunk_id: str | None = None
    canonical_source_id: str | None = None
    source_unit_kind: str | None = None
    source_unit_key: str | None = None


def expected_source_ref(
    doc_id: str,
    version_id: str | None = None,
    chunk_id: str | None = None,
    canonical_source_id: str | None = None,
    source_unit_kind: str | None = None,
    source_unit_key: str | None = None,
) -> ExpectedSourceRef:
    return ExpectedSourceRef(
        doc_id=doc_id,
        version_id=version_id,
        chunk_id=chunk_id,
        canonical_source_id=canonical_source_id,
        source_unit_kind=source_unit_kind,
        source_unit_key=source_unit_key,
    )


@dataclass(frozen=True, slots=True)
class TraceExpectation:
    selected_scope: KnowledgeScope | None = None
    retrieval_called: bool | None = None
    clarification_expected: bool | None = None
    error_expected: bool | None = None
    fail_closed_expected: bool | None = None
    expected_runtime_target: ExpectedRuntimeTarget | None = None
    expected_capability_family: CapabilityFamilyLabel | None = None

    def __post_init__(self) -> None:
        if (
            self.expected_runtime_target is not None
            and self.expected_runtime_target not in ALLOWED_EXPECTED_RUNTIME_TARGETS
        ):
            raise ValueError(f"unsupported expected_runtime_target: {self.expected_runtime_target}")
        if (
            self.expected_capability_family is not None
            and self.expected_capability_family not in ALLOWED_CAPABILITY_FAMILY_LABELS
        ):
            raise ValueError(
                f"unsupported expected_capability_family: {self.expected_capability_family}"
            )
        if self.expected_runtime_target is not None and self.expected_capability_family is not None:
            runtime_target = (
                None if self.expected_runtime_target == "none" else self.expected_runtime_target
            )
            expected_family = capability_family_for_runtime_target(runtime_target)
            if expected_family != self.expected_capability_family:
                raise ValueError(
                    "expected_runtime_target and expected_capability_family must describe the same lane"
                )


@dataclass(frozen=True, slots=True)
class GraderPolicy:
    mode: Literal["deterministic_only", "deterministic_plus_llm", "manual_review"] = (
        "deterministic_only"
    )
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
    expected_status: SupervisorStatus
    scope: KnowledgeScope
    version_query: VersionQuery = field(default_factory=VersionQuery)
    conversation_turns: tuple[str, ...] = field(default_factory=tuple)
    expected_sources: tuple[ExpectedSourceRef, ...] = field(default_factory=tuple)
    forbidden_sources: tuple[ExpectedSourceRef, ...] = field(default_factory=tuple)
    required_facts: tuple[str, ...] = field(default_factory=tuple)
    reference_facts: tuple[str, ...] = field(default_factory=tuple)
    reference_context_ids: tuple[str, ...] = field(default_factory=tuple)
    reference_contexts: tuple[str, ...] = field(default_factory=tuple)
    supplemental_metric_overrides: dict[str, bool] = field(default_factory=dict)
    forbidden_claims: tuple[str, ...] = field(default_factory=tuple)
    trace_expectation: TraceExpectation | None = None
    grader_policy: GraderPolicy = field(default_factory=GraderPolicy)
    expected_semantic_outcome: str = ""
    expected_scope_class: str = ""
    expected_policy_reason: str = ""
    expected_retrieval_adequacy_verdict: str = ""
    expected_retrieval_adequacy_reason: str = ""
    expected_grounding_verdict: str = ""
    expected_unsupported_fields: tuple[str, ...] = field(default_factory=tuple)
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
        if self.expected_status not in ALLOWED_SUPERVISOR_STATUSES:
            raise ValueError(f"unsupported expected_status: {self.expected_status}")
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")
        if any(not turn.strip() for turn in self.conversation_turns):
            raise ValueError("conversation_turns must not contain empty turns")
        invalid_metric_keys = [
            key
            for key, value in self.supplemental_metric_overrides.items()
            if not str(key).strip() or not isinstance(value, bool)
        ]
        if invalid_metric_keys:
            raise ValueError(
                "supplemental_metric_overrides must map non-empty metric names to bool values"
            )
        if any(not str(field_name).strip() for field_name in self.expected_unsupported_fields):
            raise ValueError("expected_unsupported_fields must not contain empty items")


@dataclass(frozen=True, slots=True)
class ObservedTrace:
    selected_scope: KnowledgeScope | None = None
    retrieval_called: bool | None = None
    clarification_emitted: bool | None = None
    error_path: bool | None = None
    retrieved_sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)
    supporting_sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class DimensionResult:
    passed: bool
    reason: str = ""


@dataclass(frozen=True, slots=True)
class OrchestrationCaseResults:
    direct_vs_delegate_branch_correctness: DimensionResult
    handoff_correctness: DimensionResult
    tool_argument_precision: DimensionResult
    guardrail_correctness: DimensionResult
    fail_close_correctness: DimensionResult
    trace_projection_completeness: DimensionResult


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    response: AgentResponse | SupervisorResponse
    observed_trace: ObservedTrace | None = None
    request_correlation: OperatorRequestCorrelation | None = None
    workflow_trace_summary: WorkflowTraceSummary | None = None
    orchestration_case_results: OrchestrationCaseResults | None = None


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
    request_correlation: OperatorRequestCorrelation | None = None
    workflow_trace_summary: WorkflowTraceSummary | None = None
    orchestration_case_results: OrchestrationCaseResults | None = None
    supplemental_results: tuple[SupplementalResult, ...] = field(default_factory=tuple)


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
