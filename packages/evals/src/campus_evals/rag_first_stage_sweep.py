from __future__ import annotations

import json
import math
from collections.abc import Mapping
from pathlib import Path

from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset
from campus_evals.langfuse_score_report import write_langfuse_score_report

CANDIDATE_SCHEMA_VERSION = "rag_first_stage_candidate_result.v1"
SWEEP_SCHEMA_VERSION = "rag_first_stage_parameter_sweep.v1"
SCORE_NAMES = (
    "retrieval.doc_hit_at_1",
    "retrieval.doc_hit_at_3",
    "retrieval.doc_recall_at_k",
    "retrieval.forbidden_hit_rate",
    "retrieval.no_hit_false_positive_rate",
    "retrieval.wrong_version_hit_rate",
    "retrieval.p95_latency_ms",
    "retrieval.pass",
)


def validate_rag_first_stage_candidate_result(payload: Mapping[str, object]) -> dict[str, object]:
    _require_equal(payload.get("schema_version"), CANDIDATE_SCHEMA_VERSION, "schema_version")
    surface_key = _required_string(payload.get("surface_key"), "surface_key")
    variant_id = _required_string(payload.get("variant_id"), "variant_id")
    for field in (
        "retrieval_top_k",
        "dense_prefetch_limit",
        "sparse_prefetch_limit",
        "rrf_k",
    ):
        _required_positive_int(payload.get(field), field)
    for field in ("rrf_dense_weight", "rrf_sparse_weight"):
        _required_number(payload.get(field), field)
    if not isinstance(payload.get("reranker_enabled"), bool):
        raise ValueError("reranker_enabled must be a boolean")
    cases = _mapping_list(payload.get("cases"), "cases")
    if not cases:
        raise ValueError("cases must be non-empty")
    for index, case in enumerate(cases):
        prefix = f"cases[{index}]"
        _required_string(case.get("case_id"), f"{prefix}.case_id")
        _required_string(case.get("status"), f"{prefix}.status")
        _required_number(case.get("latency_ms"), f"{prefix}.latency_ms")
        _validate_sources(case.get("prefetch_sources"), f"{prefix}.prefetch_sources")
        _validate_sources(case.get("final_sources"), f"{prefix}.final_sources")
    return {
        "surface_key": surface_key,
        "variant_id": variant_id,
        "case_count": len(cases),
    }


def build_rag_first_stage_parameter_sweep(
    *,
    qrels_paths: tuple[Path, ...],
    candidate_paths: tuple[Path, ...],
    output_dir: Path,
    environment: str,
    release: str,
    source_git_head: str,
    dataset_run_id: str,
) -> dict[str, object]:
    datasets = {
        f"{dataset.scope.corpus}/{dataset.scope.collection}": dataset
        for dataset in (load_retrieval_qrels_dataset(path) for path in qrels_paths)
    }
    candidates = [_load_candidate(path) for path in candidate_paths]
    surface_reports: list[dict[str, object]] = []
    score_items: list[dict[str, object]] = []
    for surface_key in sorted({candidate["surface_key"] for candidate in candidates}):
        dataset = datasets.get(surface_key)
        if dataset is None:
            raise ValueError(f"missing qrels for candidate surface {surface_key}")
        candidate_reports = []
        surface_candidates = [
            candidate for candidate in candidates if candidate["surface_key"] == surface_key
        ]
        for candidate in surface_candidates:
            candidate_report = _candidate_report(dataset, candidate)
            candidate_reports.append(candidate_report)
        recommended_variant = _recommended_variant(candidate_reports)
        for candidate_report in candidate_reports:
            candidate_report["recommended"] = (
                candidate_report["variant_id"] == recommended_variant
                if recommended_variant is not None
                else False
            )
            _write_candidate_copy(output_dir, surface_key, candidate_report)
            score_items.extend(
                _candidate_score_items(
                    candidate_report=candidate_report,
                    eval_run_id=_eval_run_id(release, dataset_run_id),
                    dataset_run_id=dataset_run_id,
                    release=release,
                    source_git_head=source_git_head,
                )
            )
        surface_reports.append(
            {
                "surface_key": surface_key,
                "case_count": len(dataset.cases),
                "recommended_variant_id": recommended_variant,
                "candidates": candidate_reports,
            }
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    sweep_path = output_dir / "rag-first-stage-parameter-sweep.json"
    report: dict[str, object] = {
        "schema_version": SWEEP_SCHEMA_VERSION,
        "eval_run_id": _eval_run_id(release, dataset_run_id),
        "environment": _required_string(environment, "environment"),
        "release": _required_string(release, "release"),
        "source_git_head": _required_string(source_git_head, "source_git_head"),
        "dataset_run_id": _required_string(dataset_run_id, "dataset_run_id"),
        "surfaces": surface_reports,
    }
    _write_json(sweep_path, report)
    score_report = {
        "schema_version": "langfuse_score_report.v1",
        "eval_kind": "rag_first_stage_parameter_sweep",
        "eval_run_id": _eval_run_id(release, dataset_run_id),
        "profile_id": "rag-first-stage-parameter-sweep",
        "surface_key": "multi-surface"
        if len(surface_reports) > 1
        else surface_reports[0]["surface_key"],
        "variant_id": "sweep",
        "environment": _required_string(environment, "environment"),
        "release": _required_string(release, "release"),
        "source_git_head": _required_string(source_git_head, "source_git_head"),
        "source_artifact_path": str(sweep_path),
        "source_result_denominator": len(score_items),
        "expected_publish_denominator": len(score_items),
        "score_items": score_items,
        "omitted_items": [],
    }
    write_langfuse_score_report(output_dir / "langfuse-score-report.json", score_report)
    return report


def _candidate_report(dataset: object, candidate: dict[str, object]) -> dict[str, object]:
    cases = _mapping_list(candidate.get("cases"), "cases")
    cases_by_id = {str(case["case_id"]): case for case in cases}
    positive_cases = tuple(case for case in dataset.cases if case.expected_sources)
    no_hit_cases = tuple(case for case in dataset.cases if not case.expected_sources)
    version_locked_cases = tuple(
        case
        for case in positive_cases
        if any(source.version_id is not None for source in case.expected_sources)
    )
    top_k = _required_positive_int(candidate.get("retrieval_top_k"), "retrieval_top_k")
    metrics = {
        "retrieval.doc_hit_at_1": _average(
            _doc_hit(cases_by_id.get(case.case_id), case.expected_sources, 1)
            for case in positive_cases
        ),
        "retrieval.doc_hit_at_3": _average(
            _doc_hit(cases_by_id.get(case.case_id), case.expected_sources, 3)
            for case in positive_cases
        ),
        "retrieval.doc_recall_at_k": _average(
            _doc_recall(cases_by_id.get(case.case_id), case.expected_sources, top_k)
            for case in positive_cases
        ),
        "retrieval.forbidden_hit_rate": _average(
            _forbidden_hit(cases_by_id.get(case.case_id), case.forbidden_sources)
            for case in dataset.cases
        ),
        "retrieval.no_hit_false_positive_rate": _average(
            _has_final_sources(cases_by_id.get(case.case_id)) for case in no_hit_cases
        ),
        "retrieval.wrong_version_hit_rate": _wrong_version_hit_rate(
            cases_by_id,
            version_locked_cases,
            top_k,
        ),
        "retrieval.p95_latency_ms": _p95(
            _required_number(case.get("latency_ms"), "latency_ms") for case in cases
        ),
    }
    pass_value = _candidate_pass(metrics)
    metrics["retrieval.pass"] = 1 if pass_value else 0
    rejected_reasons = _rejected_reasons(metrics)
    return {
        "schema_version": CANDIDATE_SCHEMA_VERSION,
        "surface_key": candidate["surface_key"],
        "variant_id": candidate["variant_id"],
        "retrieval_top_k": candidate["retrieval_top_k"],
        "dense_prefetch_limit": candidate["dense_prefetch_limit"],
        "sparse_prefetch_limit": candidate["sparse_prefetch_limit"],
        "rrf_k": candidate["rrf_k"],
        "rrf_dense_weight": candidate["rrf_dense_weight"],
        "rrf_sparse_weight": candidate["rrf_sparse_weight"],
        "reranker_enabled": candidate["reranker_enabled"],
        "case_count": len(cases),
        "metrics": metrics,
        "failed_case_ids": [
            str(case["case_id"]) for case in cases if str(case.get("status")) != "completed"
        ],
        "recommended": False,
        "rejected_reasons": rejected_reasons,
        "cases": cases,
    }


def _candidate_score_items(
    *,
    candidate_report: Mapping[str, object],
    eval_run_id: str,
    dataset_run_id: str,
    release: str,
    source_git_head: str,
) -> list[dict[str, object]]:
    metrics = dict(candidate_report["metrics"])  # type: ignore[index]
    items: list[dict[str, object]] = []
    for score_name in SCORE_NAMES:
        value = metrics[score_name]
        data_type = "BOOLEAN" if score_name == "retrieval.pass" else "NUMERIC"
        if score_name == "retrieval.pass":
            value = 1 if bool(value) else 0
        case_id = _slug(
            f"{candidate_report['surface_key']}:{candidate_report['variant_id']}:{score_name}"
        )
        items.append(
            {
                "idempotency_key": _stable_score_id(eval_run_id, case_id, score_name),
                "name": score_name,
                "data_type": data_type,
                "value": value,
                "case_id": case_id,
                "trace_id": None,
                "observation_id": None,
                "session_id": None,
                "dataset_run_id": dataset_run_id,
                "dataset_item_id": _slug(f"campus:{case_id}"),
                "metadata": {
                    "candidate_id": candidate_report["variant_id"],
                    "case_id": case_id,
                    "dataset_item_id": _slug(f"campus:{case_id}"),
                    "eval_kind": "rag_first_stage_parameter_sweep",
                    "metric_key": score_name,
                    "release": release,
                    "schema_version": SWEEP_SCHEMA_VERSION,
                    "source_git_head": source_git_head,
                    "surface_key": candidate_report["surface_key"],
                    "top_k": candidate_report["retrieval_top_k"],
                    "variant_id": candidate_report["variant_id"],
                },
                "comment": f"{candidate_report['variant_id']} {score_name}",
            }
        )
    return items


def _load_candidate(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("candidate result must be an object")
    validate_rag_first_stage_candidate_result(payload)
    return payload


def _validate_sources(value: object, field: str) -> None:
    for index, source in enumerate(_mapping_list(value, field)):
        prefix = f"{field}[{index}]"
        _required_positive_int(source.get("rank"), f"{prefix}.rank")
        stage = _required_string(source.get("stage"), f"{prefix}.stage")
        if stage not in {"dense_prefetch", "sparse_prefetch", "rrf_final", "rerank_final"}:
            raise ValueError(f"{prefix}.stage is unsupported")
        _required_string(source.get("doc_id"), f"{prefix}.doc_id")
        if source.get("score") is not None:
            _required_number(source.get("score"), f"{prefix}.score")


def _doc_hit(case: Mapping[str, object] | None, expected_sources: object, limit: int) -> float:
    expected_doc_ids = {source.doc_id for source in expected_sources}
    return (
        1.0 if any(source["doc_id"] in expected_doc_ids for source in _final(case)[:limit]) else 0.0
    )


def _doc_recall(case: Mapping[str, object] | None, expected_sources: object, limit: int) -> float:
    expected_doc_ids = {source.doc_id for source in expected_sources}
    if not expected_doc_ids:
        return 0.0
    hit_doc_ids = {
        source["doc_id"] for source in _final(case)[:limit] if source["doc_id"] in expected_doc_ids
    }
    return len(hit_doc_ids) / len(expected_doc_ids)


def _forbidden_hit(case: Mapping[str, object] | None, forbidden_sources: object) -> float:
    forbidden_doc_ids = {source.doc_id for source in forbidden_sources}
    if not forbidden_doc_ids:
        return 0.0
    return 1.0 if any(source["doc_id"] in forbidden_doc_ids for source in _final(case)) else 0.0


def _has_final_sources(case: Mapping[str, object] | None) -> float:
    return 1.0 if _final(case) else 0.0


def _wrong_version_hit(
    case: Mapping[str, object] | None,
    expected_sources: object,
    limit: int,
) -> float:
    versioned = [source for source in expected_sources if source.version_id is not None]
    if not versioned:
        return 0.0
    final_sources = _final(case)[:limit]
    for expected in versioned:
        correct = any(
            source["doc_id"] == expected.doc_id and source.get("version_id") == expected.version_id
            for source in final_sources
        )
        wrong = any(
            source["doc_id"] == expected.doc_id and source.get("version_id") != expected.version_id
            for source in final_sources
        )
        if wrong and not correct:
            return 1.0
    return 0.0


def _wrong_version_hit_rate(
    cases_by_id: Mapping[str, Mapping[str, object]],
    version_locked_cases: object,
    limit: int,
) -> float:
    denominator = 0
    wrong = 0.0
    for expected_case in version_locked_cases:
        case = cases_by_id.get(expected_case.case_id)
        final_sources = _final(case)[:limit]
        versioned = [
            source for source in expected_case.expected_sources if source.version_id is not None
        ]
        if not versioned:
            continue
        expected_doc_ids = {source.doc_id for source in versioned}
        if not any(source["doc_id"] in expected_doc_ids for source in final_sources):
            continue
        denominator += 1
        wrong += _wrong_version_hit(case, expected_case.expected_sources, limit)
    if denominator == 0:
        return 0.0
    return wrong / denominator


def _final(case: Mapping[str, object] | None) -> list[dict[str, object]]:
    if case is None:
        return []
    return sorted(
        _mapping_list(case.get("final_sources"), "final_sources"),
        key=lambda item: int(item["rank"]),
    )


def _candidate_pass(metrics: Mapping[str, float]) -> bool:
    return (
        metrics["retrieval.doc_hit_at_1"] >= 1.0
        and metrics["retrieval.doc_hit_at_3"] >= 1.0
        and metrics["retrieval.doc_recall_at_k"] >= 1.0
        and metrics["retrieval.forbidden_hit_rate"] <= 0.0
        and metrics["retrieval.no_hit_false_positive_rate"] <= 0.0
        and metrics["retrieval.wrong_version_hit_rate"] <= 0.0
    )


def _rejected_reasons(metrics: Mapping[str, float]) -> list[str]:
    reasons: list[str] = []
    if metrics["retrieval.doc_hit_at_1"] < 1.0:
        reasons.append("doc_hit_at_1_below_threshold")
    if metrics["retrieval.doc_hit_at_3"] < 1.0:
        reasons.append("doc_hit_at_3_below_threshold")
    if metrics["retrieval.doc_recall_at_k"] < 1.0:
        reasons.append("doc_recall_at_k_below_threshold")
    if metrics["retrieval.forbidden_hit_rate"] > 0.0:
        reasons.append("forbidden_hit_rate_above_threshold")
    if metrics["retrieval.no_hit_false_positive_rate"] > 0.0:
        reasons.append("no_hit_false_positive_rate_above_threshold")
    if metrics["retrieval.wrong_version_hit_rate"] > 0.0:
        reasons.append("wrong_version_hit_rate_above_threshold")
    return reasons


def _recommended_variant(candidate_reports: list[dict[str, object]]) -> str | None:
    passing = [
        report
        for report in candidate_reports
        if int(dict(report["metrics"])["retrieval.pass"]) == 1
    ]
    if not passing:
        return None
    return str(
        sorted(
            passing,
            key=lambda item: (
                int(item["retrieval_top_k"]),
                int(item["dense_prefetch_limit"]) + int(item["sparse_prefetch_limit"]),
                str(item["variant_id"]),
            ),
        )[0]["variant_id"]
    )


def _p95(values: object) -> float:
    collected = sorted(float(value) for value in values)
    if not collected:
        raise ValueError("latency_ms is required")
    index = max(0, math.ceil(len(collected) * 0.95) - 1)
    value = collected[index]
    return int(value) if value.is_integer() else value


def _average(values: object) -> float:
    collected = tuple(float(value) for value in values)
    if not collected:
        return 0.0
    return sum(collected) / len(collected)


def _write_candidate_copy(
    output_dir: Path,
    surface_key: str,
    candidate_report: Mapping[str, object],
) -> None:
    path = output_dir / _slug(surface_key) / f"{_slug(str(candidate_report['variant_id']))}.json"
    _write_json(path, candidate_report)


def _write_json(path: Path, payload: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _mapping_list(value: object, field: str) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    result: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, Mapping):
            raise ValueError(f"{field} items must be objects")
        result.append(dict(item))
    return result


def _required_string(value: object, field: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field} is required")
    return normalized


def _required_positive_int(value: object, field: str) -> int:
    if not isinstance(value, int) or value <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return value


def _required_number(value: object, field: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{field} must be a number")
    return float(value)


def _require_equal(actual: object, expected: object, field: str) -> None:
    if actual != expected:
        raise ValueError(f"{field} must be {expected}")


def _eval_run_id(release: str, dataset_run_id: str) -> str:
    return _slug(f"rag-first-stage:{release}:{dataset_run_id}")


def _stable_score_id(eval_run_id: str, case_id: str, score_name: str) -> str:
    return f"lfscore:{_slug(eval_run_id)}:{_slug(case_id)}:{_slug(score_name)}"


def _slug(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")


__all__ = [
    "build_rag_first_stage_parameter_sweep",
    "validate_rag_first_stage_candidate_result",
]
