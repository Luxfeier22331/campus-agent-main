from __future__ import annotations

import json
from pathlib import Path

from campus_contracts import EvidenceSource

from campus_evals.benchmark_models import (
    RetrievalBenchmarkRun,
    RetrievalCaseMetrics,
    RetrievalMetricSummary,
    RetrievalObservedSource,
    RetrievalQrelsCase,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    RetrievalRunCase,
    _optional_string,
)


def evaluate_retrieval_case(
    case: RetrievalQrelsCase,
    sources: tuple[EvidenceSource, ...] | list[EvidenceSource],
) -> RetrievalCaseMetrics:
    ranked_sources = tuple(sources)
    relevant_sources = case.expected_sources
    relevant_total = len(relevant_sources)
    relevant_doc_ids = tuple(dict.fromkeys(source_ref.doc_id for source_ref in relevant_sources))
    ranked_doc_sources = _dedupe_sources_by_doc_id(ranked_sources)
    relevant_doc_total = len(relevant_doc_ids)
    forbidden_hit = any(
        _matches_expected(source_ref, source)
        for source_ref in case.forbidden_sources
        for source in ranked_sources
    )

    if relevant_total == 0:
        empty_success = 1.0 if not ranked_sources else 0.0
        return RetrievalCaseMetrics(
            case_id=case.case_id,
            split=case.split,
            hit_at_1=empty_success,
            hit_at_3=empty_success,
            recall_at_5=empty_success,
            precision_at_5=empty_success,
            mrr_at_5=empty_success,
            doc_hit_at_1=empty_success,
            doc_hit_at_3=empty_success,
            doc_recall_at_5=empty_success,
            doc_precision_at_5=empty_success,
            doc_mrr_at_5=empty_success,
            forbidden_hit=forbidden_hit,
        )

    def hit_at(limit: int) -> float:
        return (
            1.0
            if any(
                _matches_expected(source_ref, source)
                for source in ranked_sources[:limit]
                for source_ref in relevant_sources
            )
            else 0.0
        )

    def doc_hit_at(limit: int) -> float:
        return (
            1.0
            if any(
                source.doc_id == relevant_doc_id
                for source in ranked_doc_sources[:limit]
                for relevant_doc_id in relevant_doc_ids
            )
            else 0.0
        )

    matched_within_5 = {
        _source_identity(source_ref)
        for source_ref in relevant_sources
        if any(_matches_expected(source_ref, source) for source in ranked_sources[:5])
    }
    matched_doc_ids_within_5 = {
        relevant_doc_id
        for relevant_doc_id in relevant_doc_ids
        if any(source.doc_id == relevant_doc_id for source in ranked_doc_sources[:5])
    }
    relevant_hits_within_5 = len(matched_within_5)
    precision_denominator = min(len(ranked_sources), 5)
    doc_precision_denominator = min(len(ranked_doc_sources), 5)
    first_relevant_rank = next(
        (
            index
            for index, source in enumerate(ranked_sources[:5], start=1)
            if any(_matches_expected(source_ref, source) for source_ref in relevant_sources)
        ),
        None,
    )
    first_relevant_doc_rank = next(
        (
            index
            for index, source in enumerate(ranked_doc_sources[:5], start=1)
            if source.doc_id in matched_doc_ids_within_5
        ),
        None,
    )
    return RetrievalCaseMetrics(
        case_id=case.case_id,
        split=case.split,
        hit_at_1=hit_at(1),
        hit_at_3=hit_at(3),
        recall_at_5=(relevant_hits_within_5 / relevant_total) if relevant_total else 0.0,
        precision_at_5=(relevant_hits_within_5 / precision_denominator)
        if precision_denominator
        else 0.0,
        mrr_at_5=(1.0 / first_relevant_rank) if first_relevant_rank is not None else 0.0,
        doc_hit_at_1=doc_hit_at(1),
        doc_hit_at_3=doc_hit_at(3),
        doc_recall_at_5=(len(matched_doc_ids_within_5) / relevant_doc_total)
        if relevant_doc_total
        else 0.0,
        doc_precision_at_5=(len(matched_doc_ids_within_5) / doc_precision_denominator)
        if doc_precision_denominator
        else 0.0,
        doc_mrr_at_5=(1.0 / first_relevant_doc_rank)
        if first_relevant_doc_rank is not None
        else 0.0,
        forbidden_hit=forbidden_hit,
    )


def summarize_retrieval_metrics(
    metrics: tuple[RetrievalCaseMetrics, ...] | list[RetrievalCaseMetrics],
) -> RetrievalMetricSummary:
    return _summarize_retrieval_metrics(metrics, include_splits=True)


def load_retrieval_benchmark_run(path: str | Path) -> RetrievalBenchmarkRun:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return RetrievalBenchmarkRun(
        schema_version=int(payload["schema_version"]),
        cases=tuple(_load_run_case(item) for item in payload.get("cases") or ()),
    )


def evaluate_retrieval_run(
    dataset: RetrievalQrelsDataset,
    run: RetrievalBenchmarkRun,
) -> tuple[RetrievalCaseMetrics, ...]:
    run_case_map = {case.case_id: case for case in run.cases}
    metrics: list[RetrievalCaseMetrics] = []
    for case in dataset.cases:
        run_case = run_case_map.get(case.case_id)
        if run_case is None:
            observed_sources: tuple[EvidenceSource, ...] = ()
        else:
            observed_sources = tuple(
                EvidenceSource(
                    doc_id=source.doc_id,
                    revision_track="source-faithful",
                    version_id=source.version_id or "",
                    chunk_id=source.chunk_id or "",
                    anchor={},
                    canonical_url="",
                    latest_url="",
                    source_channel="pdf_ocr",
                    collection=dataset.scope.collection,
                    is_current=False,
                    snippet="",
                    score=float(source.score or 0.0),
                )
                for source in run_case.retrieved_sources
            )
        metrics.append(evaluate_retrieval_case(case, observed_sources))
    return tuple(metrics)


def render_retrieval_summary_text(summary: RetrievalMetricSummary) -> str:
    lines = [
        "Retrieval Benchmark Summary",
        f"total_cases: {summary.total_cases}",
        f"hit@1: {summary.hit_at_1:.3f}",
        f"hit@3: {summary.hit_at_3:.3f}",
        f"recall@5: {summary.recall_at_5:.3f}",
        f"precision@5: {summary.precision_at_5:.3f}",
        f"mrr@5: {summary.mrr_at_5:.3f}",
        f"doc_hit@1: {summary.doc_hit_at_1:.3f}",
        f"doc_hit@3: {summary.doc_hit_at_3:.3f}",
        f"doc_recall@5: {summary.doc_recall_at_5:.3f}",
        f"doc_precision@5: {summary.doc_precision_at_5:.3f}",
        f"doc_mrr@5: {summary.doc_mrr_at_5:.3f}",
        f"forbidden_hit_rate: {summary.forbidden_hit_rate:.3f}",
    ]
    if summary.by_split:
        lines.append("by_split:")
        for split_name, split_summary in summary.by_split.items():
            lines.append(
                "  "
                f"{split_name}: hit@1={split_summary.hit_at_1:.3f}, "
                f"hit@3={split_summary.hit_at_3:.3f}, "
                f"recall@5={split_summary.recall_at_5:.3f}, "
                f"precision@5={split_summary.precision_at_5:.3f}, "
                f"mrr@5={split_summary.mrr_at_5:.3f}, "
                f"doc_hit@1={split_summary.doc_hit_at_1:.3f}, "
                f"doc_hit@3={split_summary.doc_hit_at_3:.3f}, "
                f"doc_recall@5={split_summary.doc_recall_at_5:.3f}, "
                f"doc_precision@5={split_summary.doc_precision_at_5:.3f}, "
                f"doc_mrr@5={split_summary.doc_mrr_at_5:.3f}, "
                f"forbidden_hit_rate={split_summary.forbidden_hit_rate:.3f}"
            )
    return "\n".join(lines)


def _summarize_retrieval_metrics(
    metrics: tuple[RetrievalCaseMetrics, ...] | list[RetrievalCaseMetrics],
    *,
    include_splits: bool,
) -> RetrievalMetricSummary:
    metric_items = tuple(metrics)
    split_names = sorted({item.split for item in metric_items})
    if not metric_items:
        return RetrievalMetricSummary(
            total_cases=0,
            hit_at_1=0.0,
            hit_at_3=0.0,
            recall_at_5=0.0,
            precision_at_5=0.0,
            mrr_at_5=0.0,
            doc_hit_at_1=0.0,
            doc_hit_at_3=0.0,
            doc_recall_at_5=0.0,
            doc_precision_at_5=0.0,
            doc_mrr_at_5=0.0,
            forbidden_hit_rate=0.0,
            by_split={},
        )
    return RetrievalMetricSummary(
        total_cases=len(metric_items),
        hit_at_1=_average(item.hit_at_1 for item in metric_items),
        hit_at_3=_average(item.hit_at_3 for item in metric_items),
        recall_at_5=_average(item.recall_at_5 for item in metric_items),
        precision_at_5=_average(item.precision_at_5 for item in metric_items),
        mrr_at_5=_average(item.mrr_at_5 for item in metric_items),
        doc_hit_at_1=_average(item.doc_hit_at_1 for item in metric_items),
        doc_hit_at_3=_average(item.doc_hit_at_3 for item in metric_items),
        doc_recall_at_5=_average(item.doc_recall_at_5 for item in metric_items),
        doc_precision_at_5=_average(item.doc_precision_at_5 for item in metric_items),
        doc_mrr_at_5=_average(item.doc_mrr_at_5 for item in metric_items),
        forbidden_hit_rate=_average(1.0 if item.forbidden_hit else 0.0 for item in metric_items),
        by_split=(
            {
                split: _summarize_retrieval_metrics(
                    tuple(item for item in metric_items if item.split == split),
                    include_splits=False,
                )
                for split in split_names
            }
            if include_splits
            else {}
        ),
    )


def _source_identity(source_ref: RetrievalQrelsSourceRef) -> tuple[str, str | None, str | None]:
    return (source_ref.doc_id, source_ref.version_id, source_ref.chunk_id)


def _dedupe_sources_by_doc_id(
    sources: tuple[EvidenceSource, ...] | list[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    deduped: list[EvidenceSource] = []
    seen_doc_ids: set[str] = set()
    for source in sources:
        if source.doc_id in seen_doc_ids:
            continue
        deduped.append(source)
        seen_doc_ids.add(source.doc_id)
    return tuple(deduped)


def _matches_expected(source_ref: RetrievalQrelsSourceRef, source: EvidenceSource) -> bool:
    if source.doc_id != source_ref.doc_id:
        return False
    if source_ref.version_id is not None and source.version_id != source_ref.version_id:
        return False
    if source_ref.chunk_id is not None and source.chunk_id != source_ref.chunk_id:
        return False
    return True


def _average(values) -> float:
    collected = tuple(values)
    if not collected:
        return 0.0
    return sum(collected) / len(collected)


def _load_run_case(payload: dict[str, object]) -> RetrievalRunCase:
    return RetrievalRunCase(
        case_id=str(payload["case_id"]),
        retrieved_sources=tuple(
            _load_observed_source(item) for item in payload.get("retrieved_sources") or ()
        ),
    )


def _load_observed_source(payload: dict[str, object]) -> RetrievalObservedSource:
    return RetrievalObservedSource(
        doc_id=str(payload["doc_id"]),
        version_id=_optional_string(payload.get("version_id")),
        chunk_id=_optional_string(payload.get("chunk_id")),
        score=float(payload["score"]) if payload.get("score") is not None else None,
    )


__all__ = [
    "evaluate_retrieval_case",
    "evaluate_retrieval_run",
    "load_retrieval_benchmark_run",
    "render_retrieval_summary_text",
    "summarize_retrieval_metrics",
]
