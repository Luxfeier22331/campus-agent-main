from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from statistics import fmean
from typing import Any

from campus_evals.rag_eval_coverage import (
    CURRENT_RAG_CONSUMPTION_SURFACES,
    EXCLUDED_RAG_DENOMINATOR_SURFACES,
    RAG_EVAL_COVERAGE_REPORT_SCHEMA_VERSION,
    RagEvalSurfaceCoverage,
    build_rag_eval_coverage_report,
)

EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION = "eval_coverage_snapshot.v1"
EVAL_COVERAGE_GATE_ARTIFACTS_SCHEMA_VERSION = "eval-coverage-gate-artifacts.v1"
RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION = "ragas-diagnostic-combined-report.v1"
RAGAS_DIAGNOSTIC_FAILURE_STAGES = (
    "retrieval",
    "rerank",
    "selection",
    "evidence_selection",
    "synthesis",
    "grounding",
    "diagnostic",
)

_ALLOWED_GATE_ARTIFACT_KINDS = frozenset(
    {
        "composite_gate_report",
        "formal_final_summary",
        "formal_gate_report",
        "profile_report",
    }
)


def build_eval_coverage_snapshot(
    *,
    gate_artifacts_path: str | Path,
    generated_at: str | None = None,
    ragas_diagnostic_path: str | Path | None = None,
    repo_root: str | Path | None = None,
    source_git_head: str | None = None,
) -> dict[str, Any]:
    normalized_git_head = (source_git_head or "").strip()
    if not normalized_git_head:
        raise ValueError("source_git_head is required")

    report = build_rag_eval_coverage_report(repo_root=repo_root)
    if report.schema_version != RAG_EVAL_COVERAGE_REPORT_SCHEMA_VERSION:
        raise ValueError("unsupported RAG eval coverage report schema_version")
    if (
        tuple(surface.surface_key for surface in report.surfaces)
        != CURRENT_RAG_CONSUMPTION_SURFACES
    ):
        raise ValueError("RAG eval coverage report denominator drifted")
    if not report.passed:
        raise ValueError("RAG eval coverage report has gaps")
    if not report.maturity_passed:
        raise ValueError("RAG eval coverage report has maturity gaps")

    gate_artifacts = _load_gate_artifacts(Path(gate_artifacts_path))
    ragas_by_surface = (
        _load_ragas_diagnostic_by_surface(Path(ragas_diagnostic_path))
        if ragas_diagnostic_path is not None
        else {}
    )
    surfaces = [
        _surface_snapshot(
            surface,
            last_gate=gate_artifacts[surface.surface_key],
            ragas_diagnostic=ragas_by_surface.get(surface.surface_key),
            ragas_provided=ragas_diagnostic_path is not None,
        )
        for surface in report.surfaces
    ]
    resolved_generated_at = _normalize_timestamp(generated_at or datetime.now(UTC).isoformat())
    snapshot_id = f"eval_coverage:{resolved_generated_at.replace(':', '').replace('+', 'Z')}"
    return {
        "schemaVersion": EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION,
        "snapshotId": snapshot_id,
        "generatedAt": resolved_generated_at,
        "sourceGitHead": normalized_git_head,
        "sourceReportSchema": RAG_EVAL_COVERAGE_REPORT_SCHEMA_VERSION,
        "denominatorSurfaces": list(CURRENT_RAG_CONSUMPTION_SURFACES),
        "surfaces": surfaces,
        "excludedSurfaces": [
            {"surfaceKey": surface_key, "reason": reason}
            for surface_key, reason in sorted(EXCLUDED_RAG_DENOMINATOR_SURFACES.items())
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the operator eval coverage snapshot.")
    parser.add_argument("--gate-artifacts", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--generated-at")
    parser.add_argument("--ragas-diagnostic")
    parser.add_argument("--source-git-head")
    args = parser.parse_args(argv)

    snapshot = build_eval_coverage_snapshot(
        gate_artifacts_path=args.gate_artifacts,
        generated_at=args.generated_at,
        ragas_diagnostic_path=args.ragas_diagnostic,
        source_git_head=args.source_git_head,
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


def _surface_snapshot(
    surface: RagEvalSurfaceCoverage,
    *,
    last_gate: dict[str, Any],
    ragas_diagnostic: dict[str, Any] | None,
    ragas_provided: bool,
) -> dict[str, Any]:
    ragas = ragas_diagnostic or {
        "caseCount": 0,
        "completedCaseCount": 0,
        "failedCaseCount": 0,
        "lowScoreCases": [],
        "metrics": [],
        "stageDistribution": [],
        "status": "artifact_missing" if not ragas_provided else "missing_for_surface",
    }
    deterministic_blockers = [
        *surface.gaps,
        *surface.maturity_gaps,
        *(last_gate["reasons"] if last_gate["status"] != "passed" else []),
    ]
    readiness_status = "ready" if not deterministic_blockers else "blocked"
    if readiness_status == "ready" and ragas["status"] == "diagnostic_attention":
        readiness_status = "diagnostic_attention"
    return {
        "surfaceKey": surface.surface_key,
        "profileId": surface.profile_id,
        "profileArtifactKind": surface.profile_artifact_kind,
        "qrelsCaseCount": surface.qrels_case_count,
        "uniqueExpectedDocCount": surface.unique_expected_doc_count,
        "releaseAcceptanceCaseCount": surface.release_acceptance_case_count,
        "answerQualityCaseCount": surface.answer_quality_case_count,
        "goldenQrelsCaseCount": surface.golden_qrels_case_count,
        "knownGapCaseCount": surface.known_gap_case_count,
        "maturityStatus": surface.maturity_status,
        "coverageGaps": list(surface.gaps),
        "maturityGaps": list(surface.maturity_gaps),
        "ragasDiagnostic": ragas,
        "lastGate": last_gate,
        "readiness": {
            "status": readiness_status,
            "reasons": deterministic_blockers,
        },
    }


def _load_gate_artifacts(path: Path) -> dict[str, dict[str, Any]]:
    payload = _load_json_object(path)
    if payload.get("schema_version") != EVAL_COVERAGE_GATE_ARTIFACTS_SCHEMA_VERSION:
        raise ValueError("unsupported eval coverage gate artifacts schema_version")
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, list):
        raise ValueError("gate artifacts manifest must contain artifacts")
    by_surface: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(artifacts):
        if not isinstance(item, dict):
            raise ValueError(f"artifacts[{index}] must be an object")
        surface_key = _required_string(item, "surface_key", f"artifacts[{index}]")
        if surface_key not in CURRENT_RAG_CONSUMPTION_SURFACES:
            raise ValueError(f"unsupported gate artifact surface: {surface_key}")
        if surface_key in by_surface:
            raise ValueError(f"duplicate gate artifact surface: {surface_key}")
        by_surface[surface_key] = _load_gate_artifact(item, f"artifacts[{index}]")
    missing = set(CURRENT_RAG_CONSUMPTION_SURFACES) - set(by_surface)
    if missing:
        raise ValueError("missing gate artifacts for surfaces: " + ", ".join(sorted(missing)))
    return by_surface


def _load_gate_artifact(item: dict[str, Any], prefix: str) -> dict[str, Any]:
    artifact_id = _required_string(item, "artifact_id", prefix)
    artifact_kind = _required_string(item, "artifact_kind", prefix)
    if artifact_kind not in _ALLOWED_GATE_ARTIFACT_KINDS:
        raise ValueError(f"{prefix}.artifact_kind is unsupported")
    profile_id = _required_string(item, "profile_id", prefix)
    surface_key = _required_string(item, "surface_key", prefix)
    artifact_payload = _load_json_object(Path(_required_string(item, "path", prefix)))
    parsed = _parse_gate_payload(artifact_kind, artifact_payload)
    return {
        "artifactId": artifact_id,
        "artifactKind": artifact_kind,
        "profileId": profile_id,
        "surfaceKey": surface_key,
        **parsed,
    }


def _parse_gate_payload(artifact_kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    if artifact_kind == "profile_report":
        summary = _mapping(payload.get("summary"), "summary")
        version = (
            payload.get("version_summary")
            if isinstance(payload.get("version_summary"), dict)
            else {}
        )
        status = (
            "passed"
            if bool(payload.get("passed")) and bool(summary.get("overall_passed"))
            else "failed"
        )
        return {
            "caseCount": int(summary.get("total") or 0),
            "failedCount": int(summary.get("failed") or 0),
            "gitHead": str(version.get("git_head") or ""),
            "passedCount": int(summary.get("passed") or 0),
            "reasons": [] if status == "passed" else ["profile_report_failed"],
            "status": status,
        }
    if artifact_kind == "formal_final_summary":
        gate = _mapping(payload.get("gate_report"), "gate_report")
        deterministic = _mapping(payload.get("deterministic"), "deterministic")
        status = "passed" if str(gate.get("overall_verdict") or "") == "pass" else "failed"
        failed_counts = [int(value) for value in deterministic.get("run_failed_counts") or ()]
        pass_counts = [int(value) for value in deterministic.get("run_pass_counts") or ()]
        provenance = (
            payload.get("provenance") if isinstance(payload.get("provenance"), dict) else {}
        )
        return {
            "caseCount": max(pass_counts + failed_counts) if pass_counts or failed_counts else 0,
            "failedCount": max(failed_counts) if failed_counts else 0,
            "gitHead": str(provenance.get("git_head") or ""),
            "passedCount": max(pass_counts) if pass_counts else 0,
            "reasons": [] if status == "passed" else ["formal_gate_failed"],
            "status": status,
        }
    if artifact_kind in {"formal_gate_report", "composite_gate_report"}:
        verdict = str(payload.get("overall_verdict") or payload.get("verdict") or "")
        passed = bool(payload.get("passed")) if "passed" in payload else verdict == "pass"
        status = "passed" if passed or verdict == "pass" else "failed"
        return {
            "caseCount": int(payload.get("total") or payload.get("case_count") or 0),
            "failedCount": int(payload.get("failed") or payload.get("failed_count") or 0),
            "gitHead": str(payload.get("git_head") or ""),
            "passedCount": int(payload.get("passed_count") or 0),
            "reasons": [] if status == "passed" else ["gate_report_failed"],
            "status": status,
        }
    raise ValueError(f"unsupported gate artifact kind: {artifact_kind}")


def _load_ragas_diagnostic_by_surface(path: Path) -> dict[str, dict[str, Any]]:
    payload = _load_json_object(path)
    if payload.get("schema_version") != RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION:
        raise ValueError("unsupported RAGAS diagnostic schema_version")
    cases = payload.get("cases")
    if not isinstance(cases, list):
        raise ValueError("RAGAS diagnostic must contain cases")
    by_surface: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in cases:
        if not isinstance(item, dict):
            raise ValueError("RAGAS diagnostic cases must be objects")
        surface_key = str(item.get("surface_key") or "")
        if surface_key:
            by_surface[surface_key].append(item)
    return {surface_key: _summarize_ragas_cases(items) for surface_key, items in by_surface.items()}


def _summarize_ragas_cases(items: list[dict[str, Any]]) -> dict[str, Any]:
    metrics: dict[str, list[float]] = defaultdict(list)
    low_score_cases: list[dict[str, Any]] = []
    stage_counts: dict[str, int] = defaultdict(int)
    failed = 0
    for item in items:
        if item.get("status") != "completed":
            failed += 1
        scores = item.get("scores")
        if not isinstance(scores, dict):
            continue
        for metric_name, score in scores.items():
            if isinstance(score, int | float):
                value = float(score)
                metrics[str(metric_name)].append(value)
                if value < 0.8:
                    failure_stage = _required_ragas_metric_failure_stage(
                        item,
                        metric_name=str(metric_name),
                    )
                    stage_counts[failure_stage] += 1
                    low_score_cases.append(
                        {
                            "caseId": str(item.get("case_id") or ""),
                            "failureStage": failure_stage,
                            "metricName": str(metric_name),
                            "score": value,
                        }
                    )
    status = "diagnostic_attention" if failed or low_score_cases else "present"
    return {
        "caseCount": len(items),
        "completedCaseCount": len(items) - failed,
        "failedCaseCount": failed,
        "lowScoreCases": low_score_cases,
        "metrics": [
            {
                "count": len(values),
                "max": max(values),
                "mean": fmean(values),
                "min": min(values),
                "name": metric_name,
            }
            for metric_name, values in sorted(metrics.items())
        ],
        "stageDistribution": [
            {"caseCount": count, "stage": stage}
            for stage, count in sorted(
                stage_counts.items(),
                key=lambda item: (RAGAS_DIAGNOSTIC_FAILURE_STAGES.index(item[0]), item[0]),
            )
        ],
        "status": status,
    }


def _required_ragas_metric_failure_stage(item: dict[str, Any], *, metric_name: str) -> str:
    case_id = str(item.get("case_id") or "")
    field_prefix = f"RAGAS diagnostic case {case_id or '<missing case_id>'}"
    attribution = item.get("failure_attribution")
    metric_failures = (
        attribution.get("metric_failures")
        if isinstance(attribution, dict) and isinstance(attribution.get("metric_failures"), dict)
        else None
    )
    if metric_failures is None or not isinstance(metric_failures.get(metric_name), str):
        raise ValueError(
            f"{field_prefix}.failure_attribution.metric_failures.{metric_name} is required"
        )
    stage = str(metric_failures[metric_name]).strip()
    if stage not in RAGAS_DIAGNOSTIC_FAILURE_STAGES:
        raise ValueError(
            f"{field_prefix}.failure_attribution.metric_failures.{metric_name} is unsupported"
        )
    return stage


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _mapping(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _required_string(item: dict[str, Any], key: str, prefix: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{prefix}.{key} is required")
    return value.strip()


def _normalize_timestamp(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(UTC).isoformat()


__all__ = [
    "EVAL_COVERAGE_GATE_ARTIFACTS_SCHEMA_VERSION",
    "EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION",
    "RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION",
    "RAGAS_DIAGNOSTIC_FAILURE_STAGES",
    "build_eval_coverage_snapshot",
    "main",
]


if __name__ == "__main__":
    raise SystemExit(main())
