from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from pathlib import Path

from campus_retrieval_core import RestrictedDocumentAccessDeniedError, build_retrieval_backend
from campus_shared import load_repo_env

from campus_evals.ragas_adapter import build_ragas_scorer
from campus_evals.ragas_adapter_projection import RagasProjection
from campus_evals.ragas_diagnostic_constants import (
    DEFAULT_RAGAS_DIAGNOSTIC_LOW_SCORE_THRESHOLD,
    DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
    DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    DEFAULT_RAGAS_DIAGNOSTIC_TOP_K,
    RAGAS_BACKED_METRIC_NAMES,
    RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION,
    RAGAS_DIAGNOSTIC_INDEXED_LOOKUP_TIMEOUT_MS,
    RAGAS_DIAGNOSTIC_REPORT_SCHEMA_VERSION,
    RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION,
)
from campus_evals.ragas_diagnostic_manifest import (
    _empty_result_reasons,
    _load_case,
    _manifest_case,
    _qrels_path,
    _reject_doc_level_article_number_cases,
    build_ragas_diagnostic_sample_manifest,
)
from campus_evals.ragas_diagnostic_projection import (
    RagasProjectionContractError,
    _build_diagnostic_retrieval_plan,
    _build_projection_with_breakdown,
    _elapsed_ms,
    _retrieval_intent_for_case,
)
from campus_evals.ragas_diagnostic_reports import (
    case_performance_breakdown,
    failed_case_result,
    identity_grounding_score,
    load_existing_metric_reports,
    metric_report_filename,
    passed_case_result,
    summarize_results,
)
from campus_evals.ragas_diagnostic_reports import (
    combine_ragas_diagnostic_reports as _combine_ragas_diagnostic_reports,
)
from campus_evals.ragas_diagnostic_runtime import (
    _normalize_qdrant_collection_overrides,
    _override_ragas_diagnostic_runtime_profiles,
    _parse_qdrant_collection_overrides,
)
from campus_evals.settings import RagasSettings


def run_ragas_diagnostic(
    *,
    backend: object,
    scorer: Callable[[RagasProjection], Mapping[str, float | None]],
    sample_limit_per_surface: int = DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    top_k: int = DEFAULT_RAGAS_DIAGNOSTIC_TOP_K,
    metric_names: tuple[str, ...] = DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
    case_workers: int = 1,
    repo_root: str | Path | None = None,
    qdrant_collection_overrides: Mapping[str, str] | None = None,
    case_ids: tuple[str, ...] = (),
) -> dict[str, object]:
    if case_workers <= 0:
        raise ValueError("case_workers must be greater than zero")
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    manifest = build_ragas_diagnostic_sample_manifest(
        sample_limit_per_surface=sample_limit_per_surface,
        metric_names=metric_names,
        case_ids=case_ids,
        repo_root=root,
    )
    case_specs = tuple(dict(item) for item in manifest["cases"] if isinstance(item, dict))
    normalized_overrides = _normalize_qdrant_collection_overrides(qdrant_collection_overrides or {})

    def _run_case(case_spec: dict[str, object]) -> dict[str, object]:
        surface_key = str(case_spec["surface_key"])
        case = _load_case(root=root, surface_key=surface_key, case_id=str(case_spec["case_id"]))
        started_at = time.perf_counter()
        try:
            projection, projection_breakdown = _build_projection_with_breakdown(
                case=case,
                backend=backend,
                top_k=top_k,
                expected_empty_result=_case_spec_is_expected_empty_result(case_spec),
            )
            if _case_spec_is_expected_empty_result(case_spec):
                return _empty_result_case_result(
                    case_spec=case_spec,
                    projection=projection,
                    duration_ms=_elapsed_ms(started_at),
                    performance_breakdown=case_performance_breakdown(
                        projection_breakdown=projection_breakdown,
                        scorer_ms=0,
                        duration_ms=_elapsed_ms(started_at),
                    ),
                )
            metric_applicability = _metric_applicability_for_case(
                case_spec,
                metric_names=metric_names,
            )
            projection.metadata["metric_applicability"] = dict(metric_applicability)
            scorer_started_at = time.perf_counter()
            scores = _score_projection(
                projection=projection,
                scorer=scorer,
                metric_names=metric_names,
            )
            scorer_ms = _elapsed_ms(scorer_started_at)
            duration_ms = _elapsed_ms(started_at)
            return passed_case_result(
                case_spec=case_spec,
                projection=projection,
                scores=scores,
                metric_names=metric_names,
                metric_applicability=metric_applicability,
                duration_ms=duration_ms,
                performance_breakdown=case_performance_breakdown(
                    projection_breakdown=projection_breakdown,
                    scorer_ms=scorer_ms,
                    duration_ms=duration_ms,
                ),
                low_score_threshold=DEFAULT_RAGAS_DIAGNOSTIC_LOW_SCORE_THRESHOLD,
            )
        except Exception as exc:
            if _case_spec_is_expected_authz_denied(case_spec) and isinstance(
                exc, RestrictedDocumentAccessDeniedError
            ):
                return _denied_empty_result_case_result(
                    case_spec=case_spec,
                    duration_ms=_elapsed_ms(started_at),
                )
            return failed_case_result(
                case_spec=case_spec,
                exc=exc,
                duration_ms=_elapsed_ms(started_at),
            )

    with _override_ragas_diagnostic_runtime_profiles(normalized_overrides):
        if case_workers == 1 or len(case_specs) <= 1:
            results = [_run_case(case_spec) for case_spec in case_specs]
        else:
            results_by_index: list[dict[str, object] | None] = [None] * len(case_specs)
            with ThreadPoolExecutor(max_workers=case_workers) as pool:
                futures = [
                    (index, pool.submit(copy_context().run, _run_case, case_spec))
                    for index, case_spec in enumerate(case_specs)
                ]
                for index, future in futures:
                    results_by_index[index] = future.result()
            results = [result for result in results_by_index if result is not None]

    summary = summarize_results(results, metric_names=metric_names)
    return {
        "schema_version": RAGAS_DIAGNOSTIC_REPORT_SCHEMA_VERSION,
        "report_id": "ragas_diagnostic",
        "passed": summary["failed_cases"] == 0,
        "mode": "diagnostic_non_blocking",
        "run_config": {
            "sample_limit_per_surface": sample_limit_per_surface,
            "top_k": top_k,
            "metric_names": list(metric_names),
            "case_workers": case_workers,
            "qdrant_collection_overrides": dict(normalized_overrides),
            "case_ids": list(dict.fromkeys(case_ids)),
        },
        "sample_manifest": manifest,
        "summary": summary,
        "cases": results,
    }


def combine_ragas_diagnostic_reports(
    reports: list[Mapping[str, object]],
    *,
    low_score_threshold: float = DEFAULT_RAGAS_DIAGNOSTIC_LOW_SCORE_THRESHOLD,
) -> dict[str, object]:
    return _combine_ragas_diagnostic_reports(
        reports,
        schema_version=RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION,
        low_score_threshold=low_score_threshold,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run small-sample RAGAS diagnostics for core RAG.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--sample-limit-per-surface",
        type=int,
        default=DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    )
    parser.add_argument("--top-k", type=int, default=DEFAULT_RAGAS_DIAGNOSTIC_TOP_K)
    parser.add_argument("--case-workers", type=int, default=1)
    parser.add_argument(
        "--case-id",
        action="append",
        default=[],
        help="Run only the named qrels case. May be passed more than once.",
    )
    parser.add_argument(
        "--metric-name",
        action="append",
        default=[],
        choices=DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
        help="Metric to run. Defaults to all diagnostic metrics.",
    )
    parser.add_argument(
        "--combine-existing-reports",
        action="store_true",
        help="Merge existing per-metric RAGAS diagnostic JSON reports without running retrieval.",
    )
    parser.add_argument(
        "--fake-scorer",
        action="store_true",
        help="Use deterministic fake scores for tests and dry wiring checks.",
    )
    parser.add_argument(
        "--qdrant-collection-name",
        action="append",
        default=[],
        metavar="SURFACE=COLLECTION",
        help=(
            "Override a diagnostic surface physical Qdrant collection, for example "
            "regulations/student_rules=student_rules__r20260512_preview."
        ),
    )
    args = parser.parse_args(argv)

    load_repo_env()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.combine_existing_reports:
        reports = load_existing_metric_reports(output_dir)
        combined = combine_ragas_diagnostic_reports(reports)
        _write_json(output_dir / "ragas-diagnostic.combined.json", combined)
        _write_json(output_dir / "ragas-diagnostic.summary.json", combined["summary"])
        print(json.dumps(combined["summary"], ensure_ascii=False, indent=2))
        return 0 if combined["passed"] else 1

    metric_names = tuple(args.metric_name or DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES)
    qdrant_collection_overrides = _parse_qdrant_collection_overrides(args.qdrant_collection_name)
    manifest = build_ragas_diagnostic_sample_manifest(
        sample_limit_per_surface=args.sample_limit_per_surface,
        metric_names=metric_names,
        case_ids=tuple(args.case_id),
    )
    _write_json(output_dir / "sample-manifest.json", manifest)
    backend = build_retrieval_backend()
    scorer = _fake_scorer if args.fake_scorer else _build_live_scorer(metric_names=metric_names)
    report = run_ragas_diagnostic(
        backend=backend,
        scorer=scorer,
        sample_limit_per_surface=args.sample_limit_per_surface,
        top_k=args.top_k,
        metric_names=metric_names,
        case_workers=args.case_workers,
        qdrant_collection_overrides=qdrant_collection_overrides,
        case_ids=tuple(args.case_id),
    )
    _write_json(output_dir / "ragas-diagnostic.current.json", report)
    _write_json(output_dir / metric_report_filename(metric_names), report)
    _write_json(output_dir / "ragas-diagnostic.summary.json", report["summary"])
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


def _build_live_scorer(
    *,
    metric_names: tuple[str, ...],
) -> Callable[[RagasProjection], Mapping[str, float | None]]:
    settings = RagasSettings.from_env()
    ragas_metric_names = _ragas_metric_names(metric_names)
    scorer = build_ragas_scorer(
        settings,
        metric_names=ragas_metric_names,
    )

    def _score(projection: RagasProjection) -> Mapping[str, float | None]:
        if not ragas_metric_names:
            return {}
        scores: dict[str, float | None] = {}
        metric_diagnostics: dict[str, dict[str, object]] = {}
        for result in scorer(projection):
            scores[result.metric_name] = result.score
            if result.score is not None:
                continue
            metric_diagnostics[result.metric_name] = {
                "verdict": result.verdict or "",
                "rationale": result.rationale,
                "metadata": dict(result.metadata),
            }
        projection.metadata["metric_diagnostics"] = metric_diagnostics
        return scores

    return _score


def _fake_scorer(projection: RagasProjection) -> Mapping[str, float]:
    del projection
    return {
        "faithfulness": 1.0,
        "answer_relevancy": 1.0,
        "identity_grounding": 1.0,
        "context_precision": 1.0,
        "context_recall": 1.0,
    }


def _score_projection(
    *,
    projection: RagasProjection,
    scorer: Callable[[RagasProjection], Mapping[str, float | None]],
    metric_names: tuple[str, ...],
) -> dict[str, float | None]:
    scores = dict(scorer(projection))
    if "identity_grounding" in metric_names:
        scores["identity_grounding"] = identity_grounding_score(projection)
    return scores


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _case_spec_is_expected_no_hit(case_spec: Mapping[str, object]) -> bool:
    return bool(case_spec.get("expected_no_hit") is True)


def _case_spec_is_expected_empty_result(case_spec: Mapping[str, object]) -> bool:
    return bool(str(case_spec.get("expected_empty_result_reason") or "").strip())


def _case_spec_is_expected_authz_denied(case_spec: Mapping[str, object]) -> bool:
    return str(case_spec.get("expected_empty_result_reason") or "").strip() == "authz_denied"


def _empty_result_case_result(
    *,
    case_spec: dict[str, object],
    projection: RagasProjection,
    duration_ms: int,
    performance_breakdown: Mapping[str, int],
) -> dict[str, object]:
    return {
        **case_spec,
        "status": "completed",
        "answer_text": "",
        "answer_shape": projection.metadata.get("answer_shape") or "",
        "presentation_kind": projection.metadata.get("presentation_kind") or "",
        "presentation_path": projection.metadata.get("presentation_path") or "",
        "diagnostic_reason": _diagnostic_reason_for_empty_result_case(case_spec),
        "retrieval_intent_kind": projection.metadata.get("retrieval_intent_kind") or "",
        "retrieval_answer_kind": projection.metadata.get("retrieval_answer_kind") or "",
        "retrieved_context_count": 0,
        "retrieved_context_ids": [],
        "raw_retrieved_doc_ids": list(projection.metadata.get("retrieved_doc_ids") or ()),
        "raw_retrieved_chunk_ids": list(projection.metadata.get("retrieved_chunk_ids") or ()),
        "selected_support_doc_ids": [],
        "selected_support_chunk_ids": [],
        "answer_used_context_ids": [],
        "duration_ms": duration_ms,
        "performance_breakdown": dict(performance_breakdown),
        "failure_attribution": {"primary_stage": "passed", "metric_failures": {}},
        "scores": {},
    }


def _denied_empty_result_case_result(
    *,
    case_spec: dict[str, object],
    duration_ms: int,
) -> dict[str, object]:
    return {
        **case_spec,
        "status": "completed",
        "answer_text": "",
        "answer_shape": "",
        "presentation_kind": "",
        "presentation_path": "",
        "diagnostic_reason": "expected_authz_denied",
        "retrieval_intent_kind": "",
        "retrieval_answer_kind": "",
        "retrieved_context_count": 0,
        "retrieved_context_ids": [],
        "raw_retrieved_doc_ids": [],
        "raw_retrieved_chunk_ids": [],
        "selected_support_doc_ids": [],
        "selected_support_chunk_ids": [],
        "answer_used_context_ids": [],
        "duration_ms": duration_ms,
        "performance_breakdown": {
            "retrieval_ms": duration_ms,
            "answer_ms": 0,
            "diagnostic_ms": 0,
            "dependency_wait_ms": 0,
        },
        "failure_attribution": {"primary_stage": "passed", "metric_failures": {}},
        "scores": {},
    }


def _diagnostic_reason_for_empty_result_case(case_spec: Mapping[str, object]) -> str:
    reason = str(case_spec.get("expected_empty_result_reason") or "").strip()
    if reason == "authz_denied":
        return "expected_authz_denied"
    if reason == "no_hit":
        return "expected_no_hit"
    return f"expected_empty_result:{reason}"


def _metric_applicability_for_case(
    case_spec: Mapping[str, object],
    *,
    metric_names: tuple[str, ...] = DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
) -> dict[str, bool]:
    applicability = {
        metric_name: metric_name != "identity_grounding" for metric_name in metric_names
    }
    overrides = case_spec.get("supplemental_metric_overrides")
    if isinstance(overrides, dict):
        for metric_name, enabled in overrides.items():
            applicability[str(metric_name)] = bool(enabled)
    return applicability


def _ragas_metric_names(metric_names: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(
        metric_name for metric_name in metric_names if metric_name in RAGAS_BACKED_METRIC_NAMES
    )


__all__ = [
    "DEFAULT_RAGAS_DIAGNOSTIC_LOW_SCORE_THRESHOLD",
    "DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES",
    "DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE",
    "DEFAULT_RAGAS_DIAGNOSTIC_TOP_K",
    "RAGAS_BACKED_METRIC_NAMES",
    "RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION",
    "RAGAS_DIAGNOSTIC_INDEXED_LOOKUP_TIMEOUT_MS",
    "RAGAS_DIAGNOSTIC_REPORT_SCHEMA_VERSION",
    "RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION",
    "RagasProjectionContractError",
    "_build_diagnostic_retrieval_plan",
    "_build_projection_with_breakdown",
    "_empty_result_reasons",
    "_load_case",
    "_manifest_case",
    "_override_ragas_diagnostic_runtime_profiles",
    "_qrels_path",
    "_reject_doc_level_article_number_cases",
    "_retrieval_intent_for_case",
    "build_ragas_diagnostic_sample_manifest",
    "combine_ragas_diagnostic_reports",
    "main",
    "run_ragas_diagnostic",
]


if __name__ == "__main__":
    raise SystemExit(main())
