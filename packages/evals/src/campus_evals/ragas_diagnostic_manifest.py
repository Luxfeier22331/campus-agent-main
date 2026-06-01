from __future__ import annotations

from pathlib import Path
from typing import Any

from campus_evals.benchmark import (
    RetrievalQrelsCase,
    load_retrieval_hybrid_query_dataset,
    load_retrieval_qrels_dataset,
)
from campus_evals.ragas_diagnostic_constants import (
    DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
    DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION,
)
from campus_evals.ragas_diagnostic_fixtures import (
    PREFERRED_RAGAS_DIAGNOSTIC_CASE_IDS,
    RAGAS_DIAGNOSTIC_CASE_METRIC_OVERRIDES,
    SURFACE_HYBRID_QUERY_FIXTURES,
    SURFACE_QRELS_FIXTURES,
)

RAGAS_DIAGNOSTIC_CASE_SELECTIONS = ("preferred", "full-denominator")


def build_ragas_diagnostic_sample_manifest(
    *,
    sample_limit_per_surface: int = DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    metric_names: tuple[str, ...] = DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
    case_ids: tuple[str, ...] = (),
    case_selection: str = "preferred",
    repo_root: str | Path | None = None,
) -> dict[str, object]:
    if case_selection not in RAGAS_DIAGNOSTIC_CASE_SELECTIONS:
        raise ValueError("case_selection must be one of preferred, full-denominator")
    if case_selection == "preferred" and sample_limit_per_surface <= 0:
        raise ValueError("sample_limit_per_surface must be greater than zero")
    if case_selection == "full-denominator" and case_ids:
        raise ValueError("case_ids cannot be combined with full-denominator case selection")
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    cases: list[dict[str, object]] = []
    excluded_cases: list[dict[str, object]] = []
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
        elif case_selection == "full-denominator":
            selected = list(dataset.cases)
        else:
            selected = [
                by_case_id[case_id]
                for case_id in PREFERRED_RAGAS_DIAGNOSTIC_CASE_IDS[surface_key]
                if case_id in by_case_id
            ][:sample_limit_per_surface]
        empty_result_reasons = _empty_result_reasons(
            qrels_dataset=dataset,
            hybrid_dataset=_load_hybrid_dataset(root=root, surface_key=surface_key),
        )
        answer_ready_cases = selected
        if requested_case_ids:
            _reject_doc_level_article_number_cases(
                selected,
                surface_key=surface_key,
                coverage_scenarios=getattr(dataset, "coverage_scenarios", {}) or {},
            )
        elif case_selection == "full-denominator":
            answer_ready_cases, skipped_cases = _partition_answer_ready_cases(
                selected,
                surface_key=surface_key,
                coverage_scenarios=getattr(dataset, "coverage_scenarios", {}) or {},
                empty_result_reasons=empty_result_reasons,
            )
            excluded_cases.extend(skipped_cases)
        cases.extend(
            _manifest_case(
                surface_key=surface_key,
                case=case,
                expected_empty_result_reason=empty_result_reasons.get(case.case_id, ""),
            )
            for case in answer_ready_cases
        )
    if missing_case_ids:
        raise ValueError(f"unknown RAGAS diagnostic case_id: {sorted(missing_case_ids)[0]}")
    return {
        "schema_version": RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION,
        "case_selection": case_selection,
        "sample_limit_per_surface": (
            None if case_selection == "full-denominator" else sample_limit_per_surface
        ),
        "metric_names": list(metric_names),
        "case_ids": list(requested_case_ids),
        "cases": cases,
        "excluded_cases": excluded_cases,
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


def _partition_answer_ready_cases(
    cases: list[RetrievalQrelsCase],
    *,
    surface_key: str,
    coverage_scenarios: object,
    empty_result_reasons: dict[str, str],
) -> tuple[list[RetrievalQrelsCase], list[dict[str, object]]]:
    answer_ready: list[RetrievalQrelsCase] = []
    excluded: list[dict[str, object]] = []
    for case in cases:
        reason = _ragas_exclusion_reason(
            case,
            coverage_scenarios=coverage_scenarios,
            empty_result_reasons=empty_result_reasons,
        )
        if reason:
            excluded.append(
                {
                    "case_id": case.case_id,
                    "surface_key": surface_key,
                    "reason": reason,
                    "query": case.query,
                }
            )
            continue
        answer_ready.append(case)
    return answer_ready, excluded


def _ragas_exclusion_reason(
    case: RetrievalQrelsCase,
    *,
    coverage_scenarios: object,
    empty_result_reasons: dict[str, str],
) -> str:
    empty_reason = empty_result_reasons.get(case.case_id, "")
    if empty_reason:
        return f"expected_empty_result:{empty_reason}"
    if _is_doc_level_article_number_case(case, coverage_scenarios=coverage_scenarios):
        return "article_number_doc_level_not_answer_ready"
    return ""


def _is_doc_level_article_number_case(
    case: RetrievalQrelsCase,
    *,
    coverage_scenarios: object,
) -> bool:
    article_case_ids: set[str] = set()
    if str(case.case_id).startswith("article-number-"):
        article_case_ids.add(case.case_id)
    if not isinstance(coverage_scenarios, dict):
        return bool(article_case_ids) and not any(
            source.chunk_id or source.version_id for source in case.expected_sources
        )
    article_case_ids.update(
        str(case_id).strip()
        for case_id in coverage_scenarios.get("article_number_exact_match") or ()
        if str(case_id).strip()
    )
    if case.case_id not in article_case_ids:
        return False
    return not any(source.chunk_id or source.version_id for source in case.expected_sources)


def _ragas_exclusion_error(
    *,
    surface_key: str,
    case: RetrievalQrelsCase,
    reason: str,
) -> str:
    if reason == "article_number_doc_level_not_answer_ready":
        return (
            f"{surface_key}:{case.case_id} doc-level article-number qrels case is not "
            "answer-ready for RAGAS; keep it in retrieval or release gates until "
            "clause-level expected sources exist"
        )
    return f"{surface_key}:{case.case_id} is not answer-ready for RAGAS: {reason}"


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


def _empty_result_reasons(
    qrels_dataset: Any,
    *,
    hybrid_dataset: Any | None = None,
) -> dict[str, str]:
    coverage_scenarios = getattr(qrels_dataset, "coverage_scenarios", {}) or {}
    if not isinstance(coverage_scenarios, dict):
        coverage_scenarios = {}
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
    if hybrid_dataset is not None:
        for case in getattr(hybrid_dataset, "cases", ()) or ():
            if getattr(case, "expected_status", "") != "no_answer":
                continue
            case_id = str(getattr(case, "case_id", "")).strip()
            if case_id:
                reasons.setdefault(case_id, "unsupported_by_evidence")
    return reasons


def _load_case(*, root: Path, surface_key: str, case_id: str) -> RetrievalQrelsCase:
    dataset = load_retrieval_qrels_dataset(_qrels_path(root=root, surface_key=surface_key))
    for case in dataset.cases:
        if case.case_id == case_id:
            return case
    raise ValueError(f"unknown qrels case {surface_key}:{case_id}")


def _qrels_path(*, root: Path, surface_key: str) -> Path:
    return root / "packages" / "evals" / "fixtures" / SURFACE_QRELS_FIXTURES[surface_key]


def _load_hybrid_dataset(*, root: Path, surface_key: str) -> Any | None:
    fixture_name = SURFACE_HYBRID_QUERY_FIXTURES.get(surface_key)
    if not fixture_name:
        return None
    return load_retrieval_hybrid_query_dataset(
        root / "packages" / "evals" / "fixtures" / fixture_name
    )


__all__ = [
    "RAGAS_DIAGNOSTIC_CASE_SELECTIONS",
    "_empty_result_reasons",
    "_is_doc_level_article_number_case",
    "_load_case",
    "_manifest_case",
    "_partition_answer_ready_cases",
    "_qrels_path",
    "_ragas_exclusion_reason",
    "_reject_doc_level_article_number_cases",
    "build_ragas_diagnostic_sample_manifest",
]
