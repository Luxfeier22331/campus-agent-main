from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from campus_contracts import KnowledgeScope

from campus_evals.models import ALLOWED_CASE_SPLITS, CaseSplit

HybridQueryCategory = Literal[
    "article_number_exact_match",
    "policy_title_exact_match",
    "policy_alias_targeted",
    "fixed_phrase_sparse_win",
    "semantic_dense_win",
    "short_fact_section",
    "table_retrieval",
    "needs_clarification",
    "restricted_entitlement_filter",
    "restricted_visibility_scope_filter",
    "no_hit",
]
ALLOWED_HYBRID_QUERY_CATEGORIES = (
    "article_number_exact_match",
    "policy_title_exact_match",
    "policy_alias_targeted",
    "fixed_phrase_sparse_win",
    "semantic_dense_win",
    "short_fact_section",
    "table_retrieval",
    "needs_clarification",
    "restricted_entitlement_filter",
    "restricted_visibility_scope_filter",
    "no_hit",
)
ALLOWED_HYBRID_QUERY_SCOPE_KEYS = (
    "entitlement_groups",
    "visibility_scope",
)
FixtureValidationSeverity = Literal["warn", "error"]


@dataclass(frozen=True, slots=True)
class RetrievalHybridQueryCase:
    case_id: str
    category: HybridQueryCategory
    query: str
    scope: dict[str, object] = field(default_factory=dict)
    expected_keywords: tuple[str, ...] = field(default_factory=tuple)
    forbidden_doc_ids: tuple[str, ...] = field(default_factory=tuple)
    notes: str = ""

    def __post_init__(self) -> None:
        if self.category not in ALLOWED_HYBRID_QUERY_CATEGORIES:
            raise ValueError(f"unsupported hybrid query category: {self.category}")
        if not self.case_id.strip():
            raise ValueError("case_id must not be empty")
        if not self.query.strip():
            raise ValueError("query must not be empty")


@dataclass(frozen=True, slots=True)
class RetrievalHybridQueryDataset:
    schema_version: int
    scope: KnowledgeScope
    baseline: dict[str, object]
    cases: tuple[RetrievalHybridQueryCase, ...]


@dataclass(frozen=True, slots=True)
class RetrievalQrelsSourceRef:
    doc_id: str
    grade: int
    rationale: str = ""
    version_id: str | None = None
    chunk_id: str | None = None

    def __post_init__(self) -> None:
        if not self.doc_id.strip():
            raise ValueError("doc_id must not be empty")
        if self.grade <= 0:
            raise ValueError("grade must be greater than zero")


@dataclass(frozen=True, slots=True)
class RetrievalQrelsCase:
    case_id: str
    split: CaseSplit
    query: str
    scope: KnowledgeScope
    request_overrides: dict[str, object] = field(default_factory=dict)
    expected_sources: tuple[RetrievalQrelsSourceRef, ...] = field(default_factory=tuple)
    forbidden_sources: tuple[RetrievalQrelsSourceRef, ...] = field(default_factory=tuple)
    notes: str = ""

    def __post_init__(self) -> None:
        if self.split not in ALLOWED_CASE_SPLITS:
            raise ValueError(f"unsupported split: {self.split}")
        if not self.case_id.strip():
            raise ValueError("case_id must not be empty")
        if not self.query.strip():
            raise ValueError("query must not be empty")


@dataclass(frozen=True, slots=True)
class RetrievalQrelsDataset:
    schema_version: int
    scope: KnowledgeScope
    baseline: dict[str, object]
    cases: tuple[RetrievalQrelsCase, ...]


@dataclass(frozen=True, slots=True)
class RetrievalCaseMetrics:
    case_id: str
    split: CaseSplit
    hit_at_1: float
    hit_at_3: float
    recall_at_5: float
    precision_at_5: float
    mrr_at_5: float
    doc_hit_at_1: float
    doc_hit_at_3: float
    doc_recall_at_5: float
    doc_precision_at_5: float
    doc_mrr_at_5: float
    forbidden_hit: bool


@dataclass(frozen=True, slots=True)
class RetrievalMetricSummary:
    total_cases: int
    hit_at_1: float
    hit_at_3: float
    recall_at_5: float
    precision_at_5: float
    mrr_at_5: float
    doc_hit_at_1: float
    doc_hit_at_3: float
    doc_recall_at_5: float
    doc_precision_at_5: float
    doc_mrr_at_5: float
    forbidden_hit_rate: float
    by_split: dict[str, "RetrievalMetricSummary"] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RetrievalObservedSource:
    doc_id: str
    version_id: str | None = None
    chunk_id: str | None = None
    score: float | None = None


@dataclass(frozen=True, slots=True)
class RetrievalRunCase:
    case_id: str
    retrieved_sources: tuple[RetrievalObservedSource, ...]


@dataclass(frozen=True, slots=True)
class RetrievalBenchmarkRun:
    schema_version: int
    cases: tuple[RetrievalRunCase, ...]


def _optional_string(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


__all__ = [
    "ALLOWED_HYBRID_QUERY_CATEGORIES",
    "ALLOWED_HYBRID_QUERY_SCOPE_KEYS",
    "FixtureValidationSeverity",
    "HybridQueryCategory",
    "RetrievalBenchmarkRun",
    "RetrievalCaseMetrics",
    "RetrievalHybridQueryCase",
    "RetrievalHybridQueryDataset",
    "RetrievalMetricSummary",
    "RetrievalObservedSource",
    "RetrievalQrelsCase",
    "RetrievalQrelsDataset",
    "RetrievalQrelsSourceRef",
    "RetrievalRunCase",
]
