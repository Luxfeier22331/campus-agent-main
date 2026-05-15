from __future__ import annotations

from pathlib import Path
from typing import Any

from campus_evals.benchmark import RetrievalQrelsCase, load_retrieval_qrels_dataset
from campus_evals.ragas_diagnostic_constants import (
    DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
    DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION,
)
from campus_evals.ragas_diagnostic_fixtures import (
    PREFERRED_RAGAS_DIAGNOSTIC_CASE_IDS,
    RAGAS_DIAGNOSTIC_CASE_METRIC_OVERRIDES,
    SURFACE_QRELS_FIXTURES,
)


def build_ragas_diagnostic_sample_manifest(
    *,
    sample_limit_per_surface: int = DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    metric_names: tuple[str, ...] = DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
    case_ids: tuple[str, ...] = (),
    repo_root: str | Path | None = None,
) -> dict[str, object]:
    if sample_limit_per_surface <= 0:
        raise ValueError("sample_limit_per_surface must be greater than zero")
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    cases: list[dict[str, object]] = []
    requested_case_ids = tuple(dict.fromkeys(case_id for case_id in case_ids if case_id))
    missing_case_ids = set(requested_case_ids)
    for surface_key in SURFACE_QRELS_FIXTURES:
        dataset = load_retrieval_qrels_dataset(_qrels_path(root=root, surface_key=surface_key))
        by_case_id = {case.case_id: case for case in dataset.cases}
        if requested_case_ids:
            selected = [
                by_case_id[case_id] for case_id in requested_case_ids if case_id in by_case_id
            ]
            missing_case_ids.difference_update(case.case_id for case in selected)
        else:
            selected = [
                by_case_id[case_id]
                for case_id in PREFERRED_RAGAS_DIAGNOSTIC_CASE_IDS[surface_key]
                if case_id in by_case_id
            ][:sample_limit_per_surface]
        _reject_doc_level_article_number_cases(
            selected,
            surface_key=surface_key,
            coverage_scenarios=getattr(dataset, "coverage_scenarios", {}) or {},
        )
        empty_result_reasons = _empty_result_reasons(dataset)
        cases.extend(
            _manifest_case(
                surface_key=surface_key,
                case=case,
                expected_empty_result_reason=empty_result_reasons.get(case.case_id, ""),
            )
            for case in selected
        )
    if missing_case_ids:
        raise ValueError(f"unknown RAGAS diagnostic case_id: {sorted(missing_case_ids)[0]}")
    return {
        "schema_version": RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION,
        "sample_limit_per_surface": sample_limit_per_surface,
        "metric_names": list(metric_names),
        "case_ids": list(requested_case_ids),
        "cases": cases,
    }


def _reject_doc_level_article_number_cases(
    cases: list[RetrievalQrelsCase],
    *,
    surface_key: str,
    coverage_scenarios: object,
) -> None:
    if not isinstance(coverage_scenarios, dict):
        return
    article_case_ids = {
        str(case_id).strip()
        for case_id in coverage_scenarios.get("article_number_exact_match") or ()
        if str(case_id).strip()
    }
    for case in cases:
        if case.case_id not in article_case_ids:
            continue
        if any(source.chunk_id or source.version_id for source in case.expected_sources):
            continue
        raise ValueError(
            f"{surface_key}:{case.case_id} doc-level article-number qrels case is not "
            "answer-ready for RAGAS; keep it in retrieval or release gates until "
            "clause-level expected sources exist"
        )


def _manifest_case(
    *,
    surface_key: str,
    case: RetrievalQrelsCase,
    expected_empty_result_reason: str = "",
) -> dict[str, object]:
    metric_overrides = {
        **case.supplemental_metric_overrides,
        **RAGAS_DIAGNOSTIC_CASE_METRIC_OVERRIDES.get(case.case_id, {}),
    }
    return {
        "surface_key": surface_key,
        "case_id": case.case_id,
        "split": case.split,
        "query": case.query,
        "expected_doc_ids": [source.doc_id for source in case.expected_sources],
        "forbidden_doc_ids": [source.doc_id for source in case.forbidden_sources],
        "supplemental_metric_overrides": dict(metric_overrides),
        "expected_no_hit": expected_empty_result_reason == "no_hit",
        "expected_empty_result_reason": expected_empty_result_reason,
    }


def _empty_result_reasons(dataset: Any) -> dict[str, str]:
    coverage_scenarios = getattr(dataset, "coverage_scenarios", {}) or {}
    if not isinstance(coverage_scenarios, dict):
        return {}
    reasons: dict[str, str] = {}
    for scenario_id, reason in (
        ("no_hit", "no_hit"),
        ("authz_denied", "authz_denied"),
    ):
        raw_case_ids = coverage_scenarios.get(scenario_id) or ()
        if not isinstance(raw_case_ids, list | tuple):
            continue
        for case_id in raw_case_ids:
            normalized_case_id = str(case_id).strip()
            if normalized_case_id:
                reasons[normalized_case_id] = reason
    return reasons


def _load_case(*, root: Path, surface_key: str, case_id: str) -> RetrievalQrelsCase:
    dataset = load_retrieval_qrels_dataset(_qrels_path(root=root, surface_key=surface_key))
    for case in dataset.cases:
        if case.case_id == case_id:
            return case
    raise ValueError(f"unknown qrels case {surface_key}:{case_id}")


def _qrels_path(*, root: Path, surface_key: str) -> Path:
    return root / "packages" / "evals" / "fixtures" / SURFACE_QRELS_FIXTURES[surface_key]


__all__ = [
    "_empty_result_reasons",
    "_load_case",
    "_manifest_case",
    "_qrels_path",
    "_reject_doc_level_article_number_cases",
    "build_ragas_diagnostic_sample_manifest",
]
