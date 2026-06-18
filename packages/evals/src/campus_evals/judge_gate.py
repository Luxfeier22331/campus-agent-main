from __future__ import annotations

import json
from pathlib import Path

from campus_evals.fixture_registry import fixture_path

ALLOWED_GATE_LEVELS = frozenset({"soft_gate", "hard_gate"})
DEFAULT_STUDENT_HANDBOOK_JUDGE_GATE_POLICY_PATH = fixture_path(
    "rag.student_rules.judge_gate_policy"
)


def build_metric_key(adapter_id: str, metric_name: str) -> str:
    return f"{adapter_id}.{metric_name}"


def load_judge_gate_policy(path: str | Path | None = None) -> dict[str, object]:
    resolved_path = (
        Path(path) if path is not None else DEFAULT_STUDENT_HANDBOOK_JUDGE_GATE_POLICY_PATH
    )
    payload = json.loads(resolved_path.read_text(encoding="utf-8"))
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("judge gate policy schema_version must be 1")
    required_runs = int(payload.get("required_runs") or 0)
    if required_runs <= 0:
        raise ValueError("judge gate policy required_runs must be greater than zero")
    metrics = payload.get("metrics")
    if not isinstance(metrics, list):
        raise ValueError("judge gate policy must define metrics")
    validated_metrics: list[dict[str, object]] = []
    for raw_metric in metrics:
        if not isinstance(raw_metric, dict):
            raise ValueError("judge gate metric policy must be an object")
        adapter_id = str(raw_metric.get("adapter_id") or "").strip()
        metric_name = str(raw_metric.get("metric_name") or "").strip()
        gate_level = str(raw_metric.get("gate_level") or "").strip()
        if not adapter_id:
            raise ValueError("judge gate metric policy adapter_id is required")
        if not metric_name:
            raise ValueError("judge gate metric policy metric_name is required")
        if gate_level not in ALLOWED_GATE_LEVELS:
            raise ValueError("judge gate metric policy gate_level must be soft_gate or hard_gate")
        validated_metrics.append(
            {
                "adapter_id": adapter_id,
                "metric_name": metric_name,
                "gate_level": gate_level,
                "min_mean_score": _read_optional_float(raw_metric.get("min_mean_score")),
                "min_run_average_score": _read_optional_float(
                    raw_metric.get("min_run_average_score")
                ),
                "max_run_average_drift": _read_optional_float(
                    raw_metric.get("max_run_average_drift")
                ),
                "min_applicable_runs": int(raw_metric["min_applicable_runs"])
                if raw_metric.get("min_applicable_runs") is not None
                else None,
                "notes": str(raw_metric.get("notes") or ""),
            }
        )
    deterministic_gate = _validate_optional_deterministic_gate(payload.get("deterministic_gate"))
    return {
        "schema_version": 1,
        "required_runs": required_runs,
        "metrics": validated_metrics,
        "deterministic_gate": deterministic_gate,
        "path": str(resolved_path),
    }


def evaluate_judge_gate(
    policy: dict[str, object],
    metric_aggregates: dict[str, dict[str, object]],
) -> dict[str, object]:
    required_runs = int(policy["required_runs"])
    metric_reports: list[dict[str, object]] = []
    overall_verdict = "pass"
    for metric_policy in policy["metrics"]:
        metric_key = build_metric_key(
            str(metric_policy["adapter_id"]),
            str(metric_policy["metric_name"]),
        )
        aggregate = metric_aggregates.get(metric_key)
        metric_report = _evaluate_metric_policy(
            metric_policy=metric_policy,
            metric_key=metric_key,
            aggregate=aggregate,
            required_runs=required_runs,
        )
        metric_reports.append(metric_report)
        if metric_report["verdict"] == "fail":
            overall_verdict = "fail"
        elif metric_report["verdict"] == "warn" and overall_verdict != "fail":
            overall_verdict = "warn"
    return {
        "schema_version": 1,
        "policy_path": policy.get("path"),
        "required_runs": required_runs,
        "overall_verdict": overall_verdict,
        "metrics": metric_reports,
    }


def _evaluate_metric_policy(
    *,
    metric_policy: dict[str, object],
    metric_key: str,
    aggregate: dict[str, object] | None,
    required_runs: int,
) -> dict[str, object]:
    gate_level = str(metric_policy["gate_level"])
    reasons: list[str] = []
    if aggregate is None:
        reasons.append("missing_metric_aggregate")
        verdict = _verdict_for_gate_level(gate_level)
        return {
            "metric_key": metric_key,
            "gate_level": gate_level,
            "verdict": verdict,
            "thresholds": _policy_thresholds(metric_policy),
            "observed": None,
            "reasons": reasons,
        }

    run_count = int(aggregate.get("run_count") or 0)
    applicable_runs = int(aggregate.get("applicable_runs") or 0)
    overall_bucket = dict(aggregate.get("overall") or {})
    runtime_status = str(overall_bucket.get("runtime_status") or "").strip()
    min_applicable_runs = int(metric_policy["min_applicable_runs"] or required_runs)
    if run_count < required_runs:
        reasons.append("insufficient_total_runs")
    if applicable_runs < min_applicable_runs:
        reasons.append("insufficient_applicable_runs")
        if applicable_runs == 0 and runtime_status == "unavailable":
            reasons.append("runtime_unavailable")

    mean_average_score = _read_optional_float(aggregate.get("mean_average_score"))
    min_run_average_score = _read_optional_float(aggregate.get("min_run_average_score"))
    run_average_drift = _read_optional_float(aggregate.get("run_average_drift"))

    expected_min_mean = _read_optional_float(metric_policy.get("min_mean_score"))
    if (
        expected_min_mean is not None
        and mean_average_score is not None
        and mean_average_score < expected_min_mean
    ):
        reasons.append("mean_average_score_below_threshold")
    expected_min_run = _read_optional_float(metric_policy.get("min_run_average_score"))
    if (
        expected_min_run is not None
        and min_run_average_score is not None
        and min_run_average_score < expected_min_run
    ):
        reasons.append("min_run_average_score_below_threshold")
    expected_max_drift = _read_optional_float(metric_policy.get("max_run_average_drift"))
    if (
        expected_max_drift is not None
        and run_average_drift is not None
        and run_average_drift > expected_max_drift
    ):
        reasons.append("run_average_drift_above_threshold")

    verdict = "pass" if not reasons else _verdict_for_gate_level(gate_level)
    return {
        "metric_key": metric_key,
        "gate_level": gate_level,
        "verdict": verdict,
        "thresholds": _policy_thresholds(metric_policy),
        "observed": {
            "run_count": run_count,
            "applicable_runs": applicable_runs,
            "run_average_scores": list(aggregate.get("run_average_scores") or ()),
            "mean_average_score": mean_average_score,
            "min_run_average_score": min_run_average_score,
            "max_run_average_score": _read_optional_float(aggregate.get("max_run_average_score")),
            "run_average_drift": run_average_drift,
        },
        "reasons": reasons,
    }


def _policy_thresholds(metric_policy: dict[str, object]) -> dict[str, object]:
    return {
        "min_mean_score": _read_optional_float(metric_policy.get("min_mean_score")),
        "min_run_average_score": _read_optional_float(metric_policy.get("min_run_average_score")),
        "max_run_average_drift": _read_optional_float(metric_policy.get("max_run_average_drift")),
        "min_applicable_runs": metric_policy.get("min_applicable_runs"),
    }


def _verdict_for_gate_level(gate_level: str) -> str:
    return "fail" if gate_level == "hard_gate" else "warn"


def _validate_optional_deterministic_gate(value: object) -> dict[str, object] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("judge gate deterministic_gate must be an object")
    gate_level = str(value.get("gate_level") or "").strip()
    if gate_level not in ALLOWED_GATE_LEVELS:
        raise ValueError("judge gate deterministic_gate gate_level must be soft_gate or hard_gate")
    return {
        "gate_level": gate_level,
        "min_mean_pass_rate": _read_optional_ratio(value.get("min_mean_pass_rate")),
        "min_run_pass_rate": _read_optional_ratio(value.get("min_run_pass_rate")),
        "require_stable_across_runs": bool(value.get("require_stable_across_runs") or False),
        "notes": str(value.get("notes") or ""),
    }


def _read_optional_float(value: object) -> float | None:
    if value is None:
        return None
    return float(value)


def _read_optional_ratio(value: object) -> float | None:
    ratio = _read_optional_float(value)
    if ratio is None:
        return None
    if ratio < 0.0 or ratio > 1.0:
        raise ValueError("judge gate deterministic_gate ratios must be between 0.0 and 1.0")
    return ratio
