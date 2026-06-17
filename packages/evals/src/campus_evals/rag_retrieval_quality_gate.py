from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from campus_evals.benchmark import (
    evaluate_retrieval_run,
    load_retrieval_benchmark_run,
    load_retrieval_qrels_dataset,
    summarize_retrieval_metrics,
)

RAG_RETRIEVAL_QUALITY_GATE_SCHEMA_VERSION = "rag-retrieval-quality-gate.v1"
CORE_RAG_RETRIEVAL_QUALITY_SURFACES = (
    "regulations/student_rules",
    "regulations/institutional_rules",
    "curriculum/curriculum_plan",
)
EXCLUDED_RAG_RETRIEVAL_QUALITY_SURFACES = {
    "official_web/fresh_news": "not_current_rag_consumption_surface",
}
NON_BLOCKING_RAG_RETRIEVAL_QUALITY_SURFACES = {
    "official_web/stable_reference": "not_refreshed_in_core_rag_quality_gate",
}
DEFAULT_MIN_DOC_HIT_AT_1 = 1.0
DEFAULT_MIN_DOC_RECALL_AT_5 = 1.0
DEFAULT_MAX_FORBIDDEN_HIT_RATE = 0.0


@dataclass(frozen=True, slots=True)
class RagRetrievalQualitySurface:
    surface_key: str
    qrels_fixture: str
    qrels_case_count: int
    unique_expected_doc_count: int
    live_run_path: str
    live_total_cases: int
    doc_hit_at_1: float
    doc_recall_at_5: float
    forbidden_hit_rate: float
    readiness_status: str
    readiness_blocker: str
    alias_name: str
    alias_target: str
    release_freshness_status: str
    release_metadata_guard_status: str
    alias_target_guard_status: str
    passed: bool
    gaps: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RagRetrievalQualityGateReport:
    schema_version: str
    report_id: str
    passed: bool
    surfaces: tuple[RagRetrievalQualitySurface, ...]
    gaps: tuple[str, ...]
    excluded_surfaces: dict[str, str]
    non_blocking_surfaces: dict[str, str]


def default_retrieval_quality_evidence_root(*, repo_root: str | Path | None = None) -> Path:
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    return root / "var" / "evals" / "retrieval-quality"


def build_rag_retrieval_quality_gate_report(
    *,
    repo_root: str | Path | None = None,
    evidence_root: str | Path | None = None,
) -> RagRetrievalQualityGateReport:
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    evidence = (
        Path(evidence_root)
        if evidence_root is not None
        else default_retrieval_quality_evidence_root(repo_root=root)
    )
    readiness_path = evidence / "runtime-readiness.current.json"
    if not readiness_path.exists():
        return RagRetrievalQualityGateReport(
            schema_version=RAG_RETRIEVAL_QUALITY_GATE_SCHEMA_VERSION,
            report_id="rag_retrieval_quality_gate",
            passed=False,
            surfaces=(),
            gaps=("missing_evidence_artifact:runtime-readiness.current.json",),
            excluded_surfaces=dict(EXCLUDED_RAG_RETRIEVAL_QUALITY_SURFACES),
            non_blocking_surfaces=dict(NON_BLOCKING_RAG_RETRIEVAL_QUALITY_SURFACES),
        )
    readiness_payload = _load_json_object(readiness_path)
    readiness_by_scope = {
        str(surface.get("scope") or ""): surface
        for surface in readiness_payload.get("surfaces") or ()
        if isinstance(surface, dict)
    }

    surfaces: list[RagRetrievalQualitySurface] = []
    gaps: list[str] = []
    for surface_key in CORE_RAG_RETRIEVAL_QUALITY_SURFACES:
        surface = _build_surface_quality(
            surface_key=surface_key,
            root=root,
            evidence_root=evidence,
            readiness_by_scope=readiness_by_scope,
        )
        surfaces.append(surface)
        gaps.extend(f"{surface.surface_key}:{gap}" for gap in surface.gaps)

    return RagRetrievalQualityGateReport(
        schema_version=RAG_RETRIEVAL_QUALITY_GATE_SCHEMA_VERSION,
        report_id="rag_retrieval_quality_gate",
        passed=not gaps,
        surfaces=tuple(surfaces),
        gaps=tuple(gaps),
        excluded_surfaces=dict(EXCLUDED_RAG_RETRIEVAL_QUALITY_SURFACES),
        non_blocking_surfaces=dict(NON_BLOCKING_RAG_RETRIEVAL_QUALITY_SURFACES),
    )


def rag_retrieval_quality_gate_report_to_dict(
    report: RagRetrievalQualityGateReport,
) -> dict[str, object]:
    return {
        "schema_version": report.schema_version,
        "report_id": report.report_id,
        "passed": report.passed,
        "surfaces": [asdict(surface) for surface in report.surfaces],
        "gaps": list(report.gaps),
        "excluded_surfaces": dict(report.excluded_surfaces),
        "non_blocking_surfaces": dict(report.non_blocking_surfaces),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build a RAG retrieval quality gate report from current evidence artifacts."
    )
    parser.add_argument("--output", required=True, help="Path to write quality gate JSON.")
    parser.add_argument(
        "--evidence-root",
        help="Evidence root. Defaults to var/evals/retrieval-quality.",
    )
    parser.add_argument("--json", action="store_true", help="Print the JSON report to stdout.")
    args = parser.parse_args(argv)

    report = build_rag_retrieval_quality_gate_report(
        evidence_root=Path(args.evidence_root) if args.evidence_root else None,
    )
    payload = rag_retrieval_quality_gate_report_to_dict(report)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    output_path.write_text(output_text, encoding="utf-8")
    if args.json:
        print(output_text.strip())
    return 0 if report.passed else 1


def _build_surface_quality(
    *,
    surface_key: str,
    root: Path,
    evidence_root: Path,
    readiness_by_scope: dict[str, dict[str, object]],
) -> RagRetrievalQualitySurface:
    qrels_path = _qrels_path(surface_key=surface_key, root=root)
    live_run_path = _live_run_path(surface_key=surface_key, evidence_root=evidence_root)
    qrels_dataset = load_retrieval_qrels_dataset(qrels_path)
    run = load_retrieval_benchmark_run(live_run_path)
    summary = summarize_retrieval_metrics(evaluate_retrieval_run(qrels_dataset, run))
    readiness = readiness_by_scope.get(surface_key, {})
    gaps: list[str] = []

    if summary.total_cases != len(qrels_dataset.cases):
        gaps.append("live_case_count_mismatch")
    if summary.doc_hit_at_1 < DEFAULT_MIN_DOC_HIT_AT_1:
        gaps.append("doc_hit_at_1_below_threshold")
    if summary.doc_recall_at_5 < DEFAULT_MIN_DOC_RECALL_AT_5:
        gaps.append("doc_recall_at_5_below_threshold")
    if summary.forbidden_hit_rate > DEFAULT_MAX_FORBIDDEN_HIT_RATE:
        gaps.append("forbidden_hit_rate_above_threshold")
    if not readiness:
        gaps.append("missing_runtime_readiness")
    elif str(readiness.get("readiness_status") or "") != "ready":
        gaps.append("runtime_readiness_not_ready")
    if readiness and str(readiness.get("release_freshness_status") or "") != "current":
        gaps.append("release_freshness_not_current")
    if readiness and str(readiness.get("release_metadata_guard_status") or "") != "passed":
        gaps.append("release_metadata_guard_not_passed")
    if readiness and str(readiness.get("alias_target_guard_status") or "") != "passed":
        gaps.append("alias_target_guard_not_passed")

    return RagRetrievalQualitySurface(
        surface_key=surface_key,
        qrels_fixture=_repo_relative(qrels_path, root),
        qrels_case_count=len(qrels_dataset.cases),
        unique_expected_doc_count=len(
            {source.doc_id for case in qrels_dataset.cases for source in case.expected_sources}
        ),
        live_run_path=_repo_relative(live_run_path, root),
        live_total_cases=summary.total_cases,
        doc_hit_at_1=summary.doc_hit_at_1,
        doc_recall_at_5=summary.doc_recall_at_5,
        forbidden_hit_rate=summary.forbidden_hit_rate,
        readiness_status=str(readiness.get("readiness_status") or ""),
        readiness_blocker=str(readiness.get("readiness_blocker") or ""),
        alias_name=str(readiness.get("alias_name") or ""),
        alias_target=str(readiness.get("alias_target") or ""),
        release_freshness_status=str(readiness.get("release_freshness_status") or ""),
        release_metadata_guard_status=str(readiness.get("release_metadata_guard_status") or ""),
        alias_target_guard_status=str(readiness.get("alias_target_guard_status") or ""),
        passed=not gaps,
        gaps=tuple(gaps),
    )


def _qrels_path(*, surface_key: str, root: Path) -> Path:
    fixture_root = root / "packages" / "evals" / "fixtures"
    return (
        fixture_root
        / {
            "regulations/student_rules": "student_handbook_retrieval_qrels.json",
            "regulations/institutional_rules": "institutional_rules_retrieval_qrels.json",
            "curriculum/curriculum_plan": "curriculum_plan_retrieval_qrels.json",
        }[surface_key]
    )


def _live_run_path(*, surface_key: str, evidence_root: Path) -> Path:
    return (
        evidence_root
        / "live-qrels"
        / {
            "regulations/student_rules": "student-rules.current.json",
            "regulations/institutional_rules": "institutional-rules.current.json",
            "curriculum/curriculum_plan": "curriculum-plan.current.json",
        }[surface_key]
    )


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _repo_relative(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


__all__ = [
    "CORE_RAG_RETRIEVAL_QUALITY_SURFACES",
    "EXCLUDED_RAG_RETRIEVAL_QUALITY_SURFACES",
    "NON_BLOCKING_RAG_RETRIEVAL_QUALITY_SURFACES",
    "RAG_RETRIEVAL_QUALITY_GATE_SCHEMA_VERSION",
    "RagRetrievalQualityGateReport",
    "RagRetrievalQualitySurface",
    "build_rag_retrieval_quality_gate_report",
    "default_retrieval_quality_evidence_root",
    "main",
    "rag_retrieval_quality_gate_report_to_dict",
]


if __name__ == "__main__":
    raise SystemExit(main())
