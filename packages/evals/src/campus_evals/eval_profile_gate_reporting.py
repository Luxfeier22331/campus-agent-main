from __future__ import annotations

import json
import subprocess
from collections.abc import Callable
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from campus_evals.eval_profile_gate_models import (
    DEFAULT_POLICY_ARTIFACT,
    DEFAULT_REPORT_NAME,
    DEFAULT_SCHEMA_VERSION,
    EvalProfileGateReport,
    EvalRuntimeMetrics,
)
from campus_evals.models import reject_forbidden_workflow_trace_keys


def _write_profile_report(
    *,
    output_dir: Path,
    profile_id: str,
    case_family: str,
    report_passed: bool,
    total: int,
    passed_count: int,
    failed_count: int,
    results: tuple[dict[str, object], ...],
    version_summary: dict[str, object],
    runtime_metrics: EvalRuntimeMetrics | None = None,
) -> EvalProfileGateReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / DEFAULT_REPORT_NAME
    summary: dict[str, object] = {
        "total": total,
        "passed": passed_count,
        "failed": failed_count,
        "overall_passed": report_passed,
    }
    if runtime_metrics is None:
        summary["metrics_missing"] = True
    else:
        summary.update(asdict(runtime_metrics))
    payload: dict[str, object] = {
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "profile_id": profile_id,
        "case_family": case_family,
        "passed": report_passed,
        "summary": summary,
        "version_summary": version_summary,
        "sanitized_results": list(results),
    }
    reject_forbidden_workflow_trace_keys(payload, "eval_profile_gate_artifact")
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return EvalProfileGateReport(
        profile_id=profile_id,
        output_path=output_path,
        passed=report_passed,
    )


def _version_summary(
    *,
    case_set_version: str,
    git_head_resolver: Callable[[], str | None] | None,
) -> dict[str, object]:
    resolve_git_head = git_head_resolver or _resolve_git_head
    return {
        "case_set_version": case_set_version,
        "policy_artifact": DEFAULT_POLICY_ARTIFACT,
        "runtime_version": DEFAULT_SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "git_head": resolve_git_head(),
    }


def _resolve_git_head() -> str | None:
    completed = subprocess.run(
        ("git", "rev-parse", "HEAD"),
        cwd=Path(__file__).resolve().parents[4],
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        return None
    return completed.stdout.strip() or None


__all__ = ["_version_summary", "_write_profile_report"]
