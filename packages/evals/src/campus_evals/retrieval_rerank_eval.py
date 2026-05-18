from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from campus_contracts import EvidenceSource

from campus_evals.benchmark_metrics import evaluate_retrieval_case, summarize_retrieval_metrics
from campus_evals.benchmark_models import (
    RetrievalCaseMetrics,
    RetrievalMetricSummary,
    RetrievalQrelsDataset,
)

_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+")


@dataclass(frozen=True, slots=True)
class RerankCandidateSource:
    doc_id: str
    version_id: str = ""
    chunk_id: str = ""
    score: float | None = None
    title: str = ""
    snippet: str = ""


@dataclass(frozen=True, slots=True)
class RerankRunCase:
    case_id: str
    retrieved_sources: tuple[RerankCandidateSource, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class DeterministicRerankBranchReport:
    case_count: int
    changed_case_count: int
    improved_case_ids: tuple[str, ...]
    regressed_case_ids: tuple[str, ...]
    baseline_metrics: RetrievalMetricSummary
    reranked_metrics: RetrievalMetricSummary
    baseline_case_metrics: tuple[RetrievalCaseMetrics, ...]
    reranked_case_metrics: tuple[RetrievalCaseMetrics, ...]


@dataclass(frozen=True, slots=True)
class RerankerAdoptionThresholds:
    min_doc_hit_at_1_delta: float = 0.0
    max_latency_p95_ms: float = 1000.0
    max_cost_units_per_query: float = 1.0
    max_forbidden_hit_rate_delta: float = 0.0


@dataclass(frozen=True, slots=True)
class RerankerAdoptionGateResult:
    status: str
    reasons: tuple[str, ...]
    doc_hit_at_1_delta: float
    forbidden_hit_rate_delta: float
    latency_p95_ms: float
    cost_units_per_query: float
    profile_patch: Mapping[str, object] = field(default_factory=dict)


def evaluate_deterministic_rerank_branch(
    *,
    dataset: RetrievalQrelsDataset,
    run: Sequence[RerankRunCase],
) -> DeterministicRerankBranchReport:
    run_by_case_id = {case.case_id: case for case in run}
    baseline_metrics: list[RetrievalCaseMetrics] = []
    reranked_metrics: list[RetrievalCaseMetrics] = []
    improved_case_ids: list[str] = []
    regressed_case_ids: list[str] = []
    changed_case_count = 0
    for case in dataset.cases:
        run_case = run_by_case_id.get(case.case_id, RerankRunCase(case_id=case.case_id))
        baseline_sources = _evidence_sources(
            run_case.retrieved_sources,
            collection=dataset.scope.collection,
        )
        reranked_candidates = rerank_candidate_sources(
            query=case.query,
            sources=run_case.retrieved_sources,
        )
        reranked_sources = _evidence_sources(
            reranked_candidates,
            collection=dataset.scope.collection,
        )
        if tuple(source.doc_id for source in baseline_sources) != tuple(
            source.doc_id for source in reranked_sources
        ):
            changed_case_count += 1
        before = evaluate_retrieval_case(case, baseline_sources)
        after = evaluate_retrieval_case(case, reranked_sources)
        baseline_metrics.append(before)
        reranked_metrics.append(after)
        if after.doc_hit_at_1 > before.doc_hit_at_1 or after.hit_at_1 > before.hit_at_1:
            improved_case_ids.append(case.case_id)
        elif after.doc_hit_at_1 < before.doc_hit_at_1 or after.hit_at_1 < before.hit_at_1:
            regressed_case_ids.append(case.case_id)
    return DeterministicRerankBranchReport(
        case_count=len(dataset.cases),
        changed_case_count=changed_case_count,
        improved_case_ids=tuple(improved_case_ids),
        regressed_case_ids=tuple(regressed_case_ids),
        baseline_metrics=summarize_retrieval_metrics(baseline_metrics),
        reranked_metrics=summarize_retrieval_metrics(reranked_metrics),
        baseline_case_metrics=tuple(baseline_metrics),
        reranked_case_metrics=tuple(reranked_metrics),
    )


def evaluate_reranker_adoption_gate(
    *,
    report: DeterministicRerankBranchReport,
    latency_p95_ms: float,
    cost_units_per_query: float,
    thresholds: RerankerAdoptionThresholds | None = None,
    profile_patch: Mapping[str, object] | None = None,
) -> RerankerAdoptionGateResult:
    runtime_thresholds = thresholds or RerankerAdoptionThresholds()
    doc_hit_at_1_delta = report.reranked_metrics.doc_hit_at_1 - report.baseline_metrics.doc_hit_at_1
    forbidden_hit_rate_delta = (
        report.reranked_metrics.forbidden_hit_rate - report.baseline_metrics.forbidden_hit_rate
    )
    reasons: list[str] = []
    if doc_hit_at_1_delta < runtime_thresholds.min_doc_hit_at_1_delta:
        reasons.append("doc_hit_at_1_delta_below_threshold")
    if latency_p95_ms > runtime_thresholds.max_latency_p95_ms:
        reasons.append("latency_p95_above_budget")
    if cost_units_per_query > runtime_thresholds.max_cost_units_per_query:
        reasons.append("cost_units_per_query_above_budget")
    if report.regressed_case_ids:
        reasons.append("rerank_regression_cases")
    if forbidden_hit_rate_delta > runtime_thresholds.max_forbidden_hit_rate_delta:
        reasons.append("forbidden_hit_rate_regression")
    return RerankerAdoptionGateResult(
        status="fail" if reasons else "pass",
        reasons=tuple(reasons),
        doc_hit_at_1_delta=doc_hit_at_1_delta,
        forbidden_hit_rate_delta=forbidden_hit_rate_delta,
        latency_p95_ms=float(latency_p95_ms),
        cost_units_per_query=float(cost_units_per_query),
        profile_patch=dict(profile_patch or {}),
    )


def rerank_candidate_sources(
    *,
    query: str,
    sources: Sequence[RerankCandidateSource],
) -> tuple[RerankCandidateSource, ...]:
    query_tokens = set(_tokens(query))
    return tuple(
        sorted(
            sources,
            key=lambda source: (
                -_source_rerank_score(query_tokens=query_tokens, source=source),
                source.doc_id,
                source.version_id,
                source.chunk_id,
            ),
        )
    )


def deterministic_rerank_report_to_dict(
    report: DeterministicRerankBranchReport,
) -> dict[str, object]:
    return {
        "case_count": report.case_count,
        "changed_case_count": report.changed_case_count,
        "improved_case_ids": list(report.improved_case_ids),
        "regressed_case_ids": list(report.regressed_case_ids),
        "baseline": _summary_to_dict(report.baseline_metrics),
        "reranked": _summary_to_dict(report.reranked_metrics),
    }


def _source_rerank_score(
    *,
    query_tokens: set[str],
    source: RerankCandidateSource,
) -> float:
    source_tokens = set(_tokens(" ".join((source.title, source.snippet, source.doc_id))))
    lexical_overlap = len(query_tokens & source_tokens)
    return float(source.score or 0.0) + lexical_overlap


def _tokens(text: str) -> tuple[str, ...]:
    normalized = unicodedata.normalize("NFKC", text).lower()
    return tuple(match.group(0) for match in _TOKEN_RE.finditer(normalized))


def _evidence_sources(
    sources: Sequence[RerankCandidateSource],
    *,
    collection: str,
) -> tuple[EvidenceSource, ...]:
    return tuple(
        EvidenceSource(
            doc_id=source.doc_id,
            revision_track="source-faithful",
            version_id=source.version_id,
            chunk_id=source.chunk_id,
            anchor={},
            canonical_url="",
            latest_url="",
            source_channel="pdf_ocr",
            collection=collection,
            is_current=False,
            snippet=source.snippet,
            score=float(source.score or 0.0),
        )
        for source in sources
    )


def _summary_to_dict(summary: RetrievalMetricSummary) -> dict[str, object]:
    return {
        "total_cases": summary.total_cases,
        "hit_at_1": summary.hit_at_1,
        "hit_at_3": summary.hit_at_3,
        "recall_at_5": summary.recall_at_5,
        "precision_at_5": summary.precision_at_5,
        "mrr_at_5": summary.mrr_at_5,
        "doc_hit_at_1": summary.doc_hit_at_1,
        "doc_hit_at_3": summary.doc_hit_at_3,
        "doc_recall_at_5": summary.doc_recall_at_5,
        "doc_precision_at_5": summary.doc_precision_at_5,
        "doc_mrr_at_5": summary.doc_mrr_at_5,
        "forbidden_hit_rate": summary.forbidden_hit_rate,
    }


__all__ = [
    "DeterministicRerankBranchReport",
    "RerankCandidateSource",
    "RerankRunCase",
    "RerankerAdoptionGateResult",
    "RerankerAdoptionThresholds",
    "deterministic_rerank_report_to_dict",
    "evaluate_deterministic_rerank_branch",
    "evaluate_reranker_adoption_gate",
    "rerank_candidate_sources",
]
