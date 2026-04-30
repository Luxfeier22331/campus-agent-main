from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from campus_contracts import KnowledgeScope

from campus_evals.benchmark_fixtures import (
    load_retrieval_qrels_dataset,
    resolve_retrieval_fixture_manifest_path,
    validate_retrieval_qrels_fixture,
)
from campus_evals.benchmark_metrics import evaluate_retrieval_run, summarize_retrieval_metrics
from campus_evals.benchmark_models import (
    RetrievalBenchmarkRun,
    RetrievalMetricSummary,
    RetrievalObservedSource,
    RetrievalQrelsDataset,
    RetrievalRunCase,
)

RETRIEVAL_TUNING_REPORT_SCHEMA_VERSION = "retrieval-tuning-report-v1"
RETRIEVAL_TUNING_CANDIDATE_RUN_SCHEMA_VERSION = "retrieval-tuning-candidate-run-v1"
TUNABLE_RETRIEVAL_PROFILE_FIELDS = (
    "retrieval_top_k",
    "dense_prefetch_limit",
    "sparse_prefetch_limit",
    "rrf_k",
    "rrf_dense_weight",
    "rrf_sparse_weight",
    "no_hit_min_top_score",
    "no_hit_min_score_gap",
)
_DEFAULT_QUERY_ENABLED_QRELS_FIXTURE_NAMES = {
    "regulations/student_rules": "student_handbook_retrieval_qrels.json",
    "regulations/institutional_rules": "institutional_rules_retrieval_qrels.json",
    "curriculum/curriculum_plan": "curriculum_plan_retrieval_qrels.json",
    "official_web/stable_reference": "official_web_stable_reference_retrieval_qrels.json",
}
_DEFAULT_QUERY_ENABLED_QRELS_COVERAGE_POLICY = {
    "regulations/student_rules": {
        "min_case_count": 15,
        "required_classes": ("positive", "no_hit", "forbidden", "version_locked"),
    },
    "regulations/institutional_rules": {
        "min_case_count": 5,
        "required_classes": (
            "positive",
            "no_hit",
            "forbidden",
            "version_locked",
            "authz",
        ),
    },
    "curriculum/curriculum_plan": {
        "min_case_count": 20,
        "required_classes": ("positive", "no_hit", "forbidden", "version_locked"),
    },
    "official_web/stable_reference": {
        "min_case_count": 10,
        "required_classes": ("positive", "no_hit", "forbidden", "version_locked"),
    },
}


@dataclass(frozen=True, slots=True)
class RetrievalTuningThresholds:
    min_hit_at_3: float = 1.0
    min_doc_recall_at_5: float = 1.0
    min_no_hit_success_rate: float = 1.0
    min_version_locked_recall_at_5: float = 1.0
    max_forbidden_hit_rate: float = 0.0


@dataclass(frozen=True, slots=True)
class RetrievalTuningCandidateRun:
    candidate_id: str
    profile: dict[str, object]
    run: RetrievalBenchmarkRun
    source_path: str | None = None

    def __post_init__(self) -> None:
        if not self.candidate_id.strip():
            raise ValueError("candidate_id must not be empty")


@dataclass(frozen=True, slots=True)
class RetrievalTuningCandidateReport:
    candidate_id: str
    profile: dict[str, object]
    metrics: RetrievalMetricSummary
    gate_status: str
    gate_reasons: tuple[str, ...]
    positive_case_count: int
    no_hit_case_count: int
    version_locked_case_count: int
    no_hit_success_rate: float
    version_locked_recall_at_5: float
    profile_cost_score: float


@dataclass(frozen=True, slots=True)
class RetrievalTuningReport:
    schema_version: str
    scope: KnowledgeScope
    case_count: int
    baseline_profile: dict[str, object]
    recommended_candidate_id: str | None
    recommended_profile_patch: dict[str, object]
    candidates: tuple[RetrievalTuningCandidateReport, ...] = field(default_factory=tuple)


def load_retrieval_tuning_candidate_run(path: str | Path) -> RetrievalTuningCandidateRun:
    source_path = Path(path)
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    candidate_id = str(payload.get("candidate_id") or source_path.stem)
    run_payload = dict(payload.get("run") or payload)
    return RetrievalTuningCandidateRun(
        candidate_id=candidate_id,
        profile=_select_tunable_profile_fields(payload.get("profile") or {}),
        run=_load_run_payload(run_payload),
        source_path=str(source_path),
    )


def default_query_enabled_retrieval_qrels_paths(
    *, repo_root: str | Path | None = None
) -> dict[str, Path]:
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    fixture_root = root / "packages" / "evals" / "fixtures"
    return {
        scope_key: fixture_root / fixture_name
        for scope_key, fixture_name in _DEFAULT_QUERY_ENABLED_QRELS_FIXTURE_NAMES.items()
    }


def validate_default_query_enabled_qrels_coverage(
    qrels_paths: dict[str, Path] | None = None,
) -> tuple[str, ...]:
    paths = qrels_paths or default_query_enabled_retrieval_qrels_paths()
    issues: list[str] = []
    for scope_key, policy in _DEFAULT_QUERY_ENABLED_QRELS_COVERAGE_POLICY.items():
        qrels_path = paths.get(scope_key)
        if qrels_path is None:
            issues.append(f"{scope_key}: missing qrels fixture")
            continue
        dataset = load_retrieval_qrels_dataset(qrels_path)
        case_count = len(dataset.cases)
        min_case_count = int(policy["min_case_count"])
        if case_count < min_case_count:
            issues.append(
                f"{scope_key}: qrels case count {case_count} below minimum {min_case_count}"
            )
        coverage_classes = _qrels_coverage_classes(dataset)
        for required_class in policy["required_classes"]:
            if required_class not in coverage_classes:
                issues.append(f"{scope_key}: missing qrels coverage class {required_class}")
    return tuple(issues)


def build_retrieval_tuning_report(
    *,
    qrels_path: str | Path,
    candidate_paths: tuple[str | Path, ...] | list[str | Path],
    manifest_path: str | Path | None = None,
    runtime_profile_path: str | Path | None = None,
    thresholds: RetrievalTuningThresholds | None = None,
) -> RetrievalTuningReport:
    qrels = Path(qrels_path)
    resolved_manifest_path = (
        Path(manifest_path)
        if manifest_path is not None
        else resolve_retrieval_fixture_manifest_path(qrels)
    )
    issues = validate_retrieval_qrels_fixture(
        qrels,
        manifest_path=resolved_manifest_path,
        ambiguity_severity="error",
    )
    if issues:
        joined = "\n".join(issues)
        raise ValueError(f"retrieval qrels fixture validation failed:\n{joined}")
    dataset = load_retrieval_qrels_dataset(qrels)
    candidates = tuple(load_retrieval_tuning_candidate_run(path) for path in candidate_paths)
    if not candidates:
        raise ValueError("at least one retrieval tuning candidate is required")
    baseline_profile = (
        _load_runtime_profile_payload(runtime_profile_path)
        if runtime_profile_path is not None
        else dict(candidates[0].profile)
    )
    return evaluate_retrieval_tuning_candidates(
        dataset=dataset,
        candidates=candidates,
        baseline_profile=baseline_profile,
        thresholds=thresholds or RetrievalTuningThresholds(),
    )


def evaluate_retrieval_tuning_candidates(
    *,
    dataset: RetrievalQrelsDataset,
    candidates: tuple[RetrievalTuningCandidateRun, ...] | list[RetrievalTuningCandidateRun],
    baseline_profile: dict[str, object],
    thresholds: RetrievalTuningThresholds | None = None,
) -> RetrievalTuningReport:
    threshold_values = thresholds or RetrievalTuningThresholds()
    candidate_reports = tuple(
        _evaluate_candidate(dataset=dataset, candidate=candidate, thresholds=threshold_values)
        for candidate in candidates
    )
    recommended = _select_recommended_candidate(candidate_reports)
    recommended_profile_patch = (
        _build_profile_patch(
            baseline_profile=baseline_profile,
            candidate_profile=recommended.profile,
        )
        if recommended is not None
        else {}
    )
    return RetrievalTuningReport(
        schema_version=RETRIEVAL_TUNING_REPORT_SCHEMA_VERSION,
        scope=dataset.scope,
        case_count=len(dataset.cases),
        baseline_profile=_select_tunable_profile_fields(baseline_profile),
        recommended_candidate_id=(recommended.candidate_id if recommended is not None else None),
        recommended_profile_patch=recommended_profile_patch,
        candidates=candidate_reports,
    )


def retrieval_tuning_report_to_dict(report: RetrievalTuningReport) -> dict[str, object]:
    return {
        "schema_version": report.schema_version,
        "scope": {
            "corpus": report.scope.corpus,
            "collection": report.scope.collection,
        },
        "case_count": report.case_count,
        "baseline_profile": report.baseline_profile,
        "recommended_candidate_id": report.recommended_candidate_id,
        "recommended_profile_patch": report.recommended_profile_patch,
        "candidates": [_candidate_report_to_dict(candidate) for candidate in report.candidates],
    }


def render_retrieval_tuning_report_text(report: RetrievalTuningReport) -> str:
    lines = [
        "Retrieval Tuning Report",
        f"scope: {report.scope.corpus}/{report.scope.collection}",
        f"case_count: {report.case_count}",
        f"recommended_candidate_id: {report.recommended_candidate_id or 'none'}",
        f"recommended_profile_patch: {json.dumps(report.recommended_profile_patch, ensure_ascii=False)}",
        "candidates:",
    ]
    for candidate in report.candidates:
        lines.append(
            "  "
            f"{candidate.candidate_id}: {candidate.gate_status}, "
            f"hit@3={candidate.metrics.hit_at_3:.3f}, "
            f"doc_recall@5={candidate.metrics.doc_recall_at_5:.3f}, "
            f"no_hit_success={candidate.no_hit_success_rate:.3f}, "
            f"version_recall@5={candidate.version_locked_recall_at_5:.3f}, "
            f"forbidden_hit_rate={candidate.metrics.forbidden_hit_rate:.3f}"
        )
        if candidate.gate_reasons:
            lines.append(f"    reasons: {', '.join(candidate.gate_reasons)}")
    return "\n".join(lines)


def _evaluate_candidate(
    *,
    dataset: RetrievalQrelsDataset,
    candidate: RetrievalTuningCandidateRun,
    thresholds: RetrievalTuningThresholds,
) -> RetrievalTuningCandidateReport:
    metrics = evaluate_retrieval_run(dataset, candidate.run)
    summary = summarize_retrieval_metrics(metrics)
    metrics_by_case_id = {item.case_id: item for item in metrics}
    positive_cases = tuple(case for case in dataset.cases if case.expected_sources)
    no_hit_cases = tuple(case for case in dataset.cases if not case.expected_sources)
    version_locked_cases = tuple(
        case
        for case in positive_cases
        if any(source.version_id is not None for source in case.expected_sources)
    )
    positive_hit_at_3 = _average(
        metrics_by_case_id[case.case_id].hit_at_3 for case in positive_cases
    )
    positive_doc_recall_at_5 = _average(
        metrics_by_case_id[case.case_id].doc_recall_at_5 for case in positive_cases
    )
    no_hit_success_rate = (
        _average(metrics_by_case_id[case.case_id].hit_at_1 for case in no_hit_cases)
        if no_hit_cases
        else 1.0
    )
    version_locked_recall_at_5 = (
        _average(metrics_by_case_id[case.case_id].recall_at_5 for case in version_locked_cases)
        if version_locked_cases
        else 1.0
    )
    gate_reasons = _candidate_gate_reasons(
        positive_case_count=len(positive_cases),
        positive_hit_at_3=positive_hit_at_3,
        positive_doc_recall_at_5=positive_doc_recall_at_5,
        no_hit_success_rate=no_hit_success_rate,
        version_locked_recall_at_5=version_locked_recall_at_5,
        forbidden_hit_rate=summary.forbidden_hit_rate,
        thresholds=thresholds,
    )
    return RetrievalTuningCandidateReport(
        candidate_id=candidate.candidate_id,
        profile=dict(candidate.profile),
        metrics=summary,
        gate_status="fail" if gate_reasons else "pass",
        gate_reasons=gate_reasons,
        positive_case_count=len(positive_cases),
        no_hit_case_count=len(no_hit_cases),
        version_locked_case_count=len(version_locked_cases),
        no_hit_success_rate=no_hit_success_rate,
        version_locked_recall_at_5=version_locked_recall_at_5,
        profile_cost_score=_profile_cost_score(candidate.profile),
    )


def _candidate_gate_reasons(
    *,
    positive_case_count: int,
    positive_hit_at_3: float,
    positive_doc_recall_at_5: float,
    no_hit_success_rate: float,
    version_locked_recall_at_5: float,
    forbidden_hit_rate: float,
    thresholds: RetrievalTuningThresholds,
) -> tuple[str, ...]:
    reasons: list[str] = []
    if positive_case_count == 0:
        reasons.append("no_positive_cases")
    if positive_hit_at_3 < thresholds.min_hit_at_3:
        reasons.append("hit_at_3_below_threshold")
    if positive_doc_recall_at_5 < thresholds.min_doc_recall_at_5:
        reasons.append("doc_recall_at_5_below_threshold")
    if no_hit_success_rate < thresholds.min_no_hit_success_rate:
        reasons.append("no_hit_success_rate_below_threshold")
    if version_locked_recall_at_5 < thresholds.min_version_locked_recall_at_5:
        reasons.append("version_locked_recall_at_5_below_threshold")
    if forbidden_hit_rate > thresholds.max_forbidden_hit_rate:
        reasons.append("forbidden_hit_rate_above_threshold")
    return tuple(reasons)


def _select_recommended_candidate(
    candidates: tuple[RetrievalTuningCandidateReport, ...],
) -> RetrievalTuningCandidateReport | None:
    passing = tuple(candidate for candidate in candidates if candidate.gate_status == "pass")
    if not passing:
        return None
    return sorted(
        passing,
        key=lambda candidate: (
            -candidate.metrics.doc_mrr_at_5,
            -candidate.metrics.mrr_at_5,
            -candidate.metrics.doc_hit_at_3,
            -candidate.metrics.hit_at_3,
            -candidate.no_hit_success_rate,
            candidate.profile_cost_score,
            candidate.candidate_id,
        ),
    )[0]


def _candidate_report_to_dict(candidate: RetrievalTuningCandidateReport) -> dict[str, object]:
    return {
        "candidate_id": candidate.candidate_id,
        "profile": candidate.profile,
        "gate_status": candidate.gate_status,
        "gate_reasons": list(candidate.gate_reasons),
        "positive_case_count": candidate.positive_case_count,
        "no_hit_case_count": candidate.no_hit_case_count,
        "version_locked_case_count": candidate.version_locked_case_count,
        "no_hit_success_rate": candidate.no_hit_success_rate,
        "version_locked_recall_at_5": candidate.version_locked_recall_at_5,
        "profile_cost_score": candidate.profile_cost_score,
        "metrics": _summary_to_dict(candidate.metrics),
    }


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
        "by_split": {name: _summary_to_dict(item) for name, item in summary.by_split.items()},
    }


def _load_run_payload(payload: dict[str, object]) -> RetrievalBenchmarkRun:
    schema_version = payload.get("schema_version")
    return RetrievalBenchmarkRun(
        schema_version=schema_version if isinstance(schema_version, int) else 1,
        cases=tuple(_load_run_case(item) for item in payload.get("cases") or ()),
    )


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
        version_id=_optional_text(payload.get("version_id")),
        chunk_id=_optional_text(payload.get("chunk_id")),
        score=float(payload["score"]) if payload.get("score") is not None else None,
    )


def _load_runtime_profile_payload(path: str | Path) -> dict[str, object]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return _select_tunable_profile_fields(payload)


def _select_tunable_profile_fields(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise ValueError("retrieval tuning profile must be a JSON object")
    return {key: payload[key] for key in TUNABLE_RETRIEVAL_PROFILE_FIELDS if key in payload}


def _qrels_coverage_classes(dataset: RetrievalQrelsDataset) -> set[str]:
    coverage: set[str] = set()
    for case in dataset.cases:
        if case.expected_sources:
            coverage.add("positive")
        else:
            coverage.add("no_hit")
        if case.forbidden_sources:
            coverage.add("forbidden")
        if any(source.version_id for source in case.expected_sources):
            coverage.add("version_locked")
        if case.request_overrides:
            coverage.add("authz")
    return coverage


def _build_profile_patch(
    *,
    baseline_profile: dict[str, object],
    candidate_profile: dict[str, object],
) -> dict[str, object]:
    baseline = _select_tunable_profile_fields(baseline_profile)
    candidate = _select_tunable_profile_fields(candidate_profile)
    return {
        key: candidate[key]
        for key in TUNABLE_RETRIEVAL_PROFILE_FIELDS
        if key in candidate and candidate.get(key) != baseline.get(key)
    }


def _profile_cost_score(profile: dict[str, object]) -> float:
    dense = _optional_number(profile.get("dense_prefetch_limit")) or 0.0
    sparse = _optional_number(profile.get("sparse_prefetch_limit")) or 0.0
    top_k = _optional_number(profile.get("retrieval_top_k")) or 0.0
    return dense + sparse + top_k


def _optional_number(value: object) -> float | None:
    if value is None:
        return None
    return float(value)


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _average(values) -> float:
    collected = tuple(values)
    if not collected:
        return 0.0
    return sum(collected) / len(collected)


__all__ = [
    "RETRIEVAL_TUNING_CANDIDATE_RUN_SCHEMA_VERSION",
    "RETRIEVAL_TUNING_REPORT_SCHEMA_VERSION",
    "TUNABLE_RETRIEVAL_PROFILE_FIELDS",
    "RetrievalTuningCandidateReport",
    "RetrievalTuningCandidateRun",
    "RetrievalTuningReport",
    "RetrievalTuningThresholds",
    "build_retrieval_tuning_report",
    "default_query_enabled_retrieval_qrels_paths",
    "evaluate_retrieval_tuning_candidates",
    "load_retrieval_tuning_candidate_run",
    "render_retrieval_tuning_report_text",
    "retrieval_tuning_report_to_dict",
    "validate_default_query_enabled_qrels_coverage",
]
