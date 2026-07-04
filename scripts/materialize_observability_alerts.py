from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ALERTS_PATH = REPO_ROOT / "configs/runtime/observability-alerts.v1.json"

AXIOM_DATASET_BY_SIGNAL = {
    "missing_trace_rate": "campus-agent-runtime-metrics",
    "projection_outbox_stale": "campus-agent-runtime-metrics",
    "request_error_rate": "campus-agent-runtime-metrics",
    "stage_latency_p95": "campus-agent-runtime-metrics",
    "telemetry_export_failure": "campus-agent-runtime-metrics",
}

METRIC_BY_SIGNAL = {
    "missing_trace_rate": "campus.app_api.trace_missing_ratio",
    "projection_outbox_stale": "campus.app_api.projection_outbox_stale",
    "request_error_rate": "campus.app_api.request_error_ratio",
    "stage_latency_p95": "campus.app_api.stage_duration_ms",
    "telemetry_export_failure": "campus.telemetry.export_failures",
}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Materialize runtime observability alert rules into Axiom monitor specs."
    )
    parser.add_argument("--alerts", default=str(DEFAULT_ALERTS_PATH))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    result = materialize_alert_file(Path(args.alerts))
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(json.dumps(result, ensure_ascii=False))


def materialize_alert_file(path: Path) -> dict[str, Any]:
    artifact = json.loads(path.read_text(encoding="utf-8"))
    return materialize_alert_artifact(artifact)


def materialize_alert_artifact(artifact: dict[str, Any]) -> dict[str, Any]:
    rules = artifact.get("rules")
    if not isinstance(rules, list):
        raise ValueError("observability alerts artifact rules must be a list")

    monitors = [
        _materialize_rule(rule)
        for rule in rules
        if isinstance(rule, dict) and rule.get("enabled") is True
    ]
    return {
        "schema_version": "axiom-monitor-materialization-v1",
        "source_alert_version": _required_str(artifact, "alert_version"),
        "monitors": monitors,
    }


def _materialize_rule(rule: dict[str, Any]) -> dict[str, Any]:
    signal = _required_str(rule, "signal")
    if signal not in METRIC_BY_SIGNAL:
        raise ValueError(f"unsupported alert signal: {signal}")
    threshold = _required_object(rule, "threshold")
    stage_field = rule.get("stage_field")
    return {
        "id": _required_str(rule, "id"),
        "dataset": AXIOM_DATASET_BY_SIGNAL[signal],
        "description": (
            f"{signal} {threshold['operator']} {threshold['value']} {threshold['unit']}"
        ),
        "evaluation_window": _required_str(rule, "window"),
        "query": _query_for_rule(signal, stage_field if isinstance(stage_field, str) else None),
        "runbook_anchor": _required_str(rule, "runbook_anchor"),
        "severity": _required_str(rule, "severity"),
        "threshold": {
            "operator": _required_str(threshold, "operator"),
            "unit": _required_str(threshold, "unit"),
            "value": _required_number(threshold, "value"),
        },
    }


def _query_for_rule(signal: str, stage_field: str | None) -> str:
    metric = METRIC_BY_SIGNAL[signal]
    if signal == "stage_latency_p95":
        if not stage_field:
            raise ValueError("stage_latency_p95 requires stage_field")
        return (
            f"['{metric}']"
            f"| where ['stage_field'] == '{stage_field}'"
            "| summarize value = percentile(['value'], 95)"
        )
    return f"['{metric}']| summarize value = max(['value'])"


def _required_object(source: dict[str, Any], key: str) -> dict[str, Any]:
    value = source.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"{key} must be an object")
    return value


def _required_str(source: dict[str, Any], key: str) -> str:
    value = source.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _required_number(source: dict[str, Any], key: str) -> int | float:
    value = source.get(key)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{key} must be a number")
    return value


if __name__ == "__main__":
    main()
