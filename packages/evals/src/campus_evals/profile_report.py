from __future__ import annotations

import json
import subprocess
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from campus_evals.models import reject_forbidden_workflow_trace_keys

DEFAULT_PROFILE_REPORT_SCHEMA_VERSION = "eval_profile_gate.v1"
DEFAULT_PROFILE_REPORT_NAME = "profile-report.json"
DEFAULT_POLICY_ARTIFACT = "eval_operations_profile_policy.v1"


@dataclass(frozen=True, slots=True)
class EvalProfileReport:
    profile_id: str
    output_path: Path
    passed: bool


@dataclass(frozen=True, slots=True)
class EvalProfileRuntimeMetrics:
    started_at: str
    finished_at: str
    runtime_seconds: int
    retry_count: int
    provider_calls: int
    collector_version: str
    runtime_profile: str
    metrics_missing: bool = False


def missing_runtime_metrics(profile_id: str = "offline_observations") -> EvalProfileRuntimeMetrics:
    return EvalProfileRuntimeMetrics(
        started_at="",
        finished_at="",
        runtime_seconds=0,
        retry_count=0,
        provider_calls=0,
        collector_version=DEFAULT_PROFILE_REPORT_SCHEMA_VERSION,
        runtime_profile=profile_id,
        metrics_missing=True,
    )


def measured_runtime_metrics(
    *,
    profile_id: str,
    started_at: datetime,
    monotonic_started: float,
    provider_calls: int,
) -> EvalProfileRuntimeMetrics:
    finished_at = datetime.now(UTC)
    runtime_seconds = max(1, int(time.monotonic() - monotonic_started + 0.999))
    return EvalProfileRuntimeMetrics(
        started_at=started_at.isoformat(),
        finished_at=finished_at.isoformat(),
        runtime_seconds=runtime_seconds,
        retry_count=0,
        provider_calls=provider_calls,
        collector_version=DEFAULT_PROFILE_REPORT_SCHEMA_VERSION,
        runtime_profile=profile_id,
    )


def write_profile_report(
    *,
    output_dir: Path,
    profile_id: str,
    case_family: str,
    report_passed: bool,
    total: int,
    passed_count: int,
    failed_count: int,
    results: Iterable[Mapping[str, object]],
    version_summary: Mapping[str, object],
    runtime_metrics: EvalProfileRuntimeMetrics | None = None,
) -> EvalProfileReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / DEFAULT_PROFILE_REPORT_NAME
    summary: dict[str, object] = {
        "total": total,
        "passed": passed_count,
        "failed": failed_count,
        "overall_passed": report_passed,
    }
    summary.update(asdict(runtime_metrics or missing_runtime_metrics(profile_id)))
    payload: dict[str, object] = {
        "schema_version": DEFAULT_PROFILE_REPORT_SCHEMA_VERSION,
        "profile_id": profile_id,
        "case_family": case_family,
        "passed": report_passed,
        "summary": summary,
        "version_summary": dict(version_summary),
        "sanitized_results": [dict(item) for item in results],
    }
    reject_forbidden_workflow_trace_keys(payload, "eval_profile_report")
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return EvalProfileReport(profile_id=profile_id, output_path=output_path, passed=report_passed)


def version_summary(
    *,
    case_set_version: str,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> dict[str, object]:
    return {
        "case_set_version": case_set_version,
        "policy_artifact": DEFAULT_POLICY_ARTIFACT,
        "runtime_version": DEFAULT_PROFILE_REPORT_SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "git_head": (git_head_resolver or resolve_git_head)(),
    }


def resolve_git_head() -> str | None:
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


def load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def load_observation_mapping(path: Path | None) -> dict[str, dict[str, object]]:
    if path is None:
        return {}
    payload = load_json_object(path)
    raw_observations = payload.get("observations")
    if isinstance(raw_observations, dict):
        return {
            str(case_id): dict(item)
            for case_id, item in raw_observations.items()
            if isinstance(item, dict)
        }
    if isinstance(raw_observations, list):
        observations: dict[str, dict[str, object]] = {}
        for raw_item in raw_observations:
            if not isinstance(raw_item, dict):
                raise ValueError("observations entries must be objects")
            case_id = required_string(raw_item.get("case_id"), "observations[].case_id")
            observations[case_id] = dict(raw_item)
        return observations
    return {str(case_id): dict(item) for case_id, item in payload.items() if isinstance(item, dict)}


def required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(str(item) for item in value if str(item).strip())


def mapping(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}
