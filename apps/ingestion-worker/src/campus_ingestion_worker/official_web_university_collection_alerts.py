from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from campus_ingestion_worker.official_web_university_collection_constants import (
    UNIVERSITY_COLLECTION_ALERT_SCHEMA_VERSION,
)
from campus_ingestion_worker.official_web_university_collection_io import (
    _normalize_text,
    _utc_now_iso,
)


def build_official_web_university_collection_alert_summary(
    *,
    run_report: Mapping[str, Any],
    compare_report: Mapping[str, Any] | None = None,
    drop_threshold_ratio: float = 0.7,
) -> dict[str, Any]:
    alerts: list[dict[str, Any]] = []
    _append_run_status_alerts(alerts=alerts, run_report=run_report)
    step_map = _step_map(run_report)
    _append_required_step_alerts(alerts=alerts, step_map=step_map)
    _append_validate_alerts(alerts=alerts, step_map=step_map)
    _append_qc_alerts(alerts=alerts, step_map=step_map)
    _append_projection_alerts(alerts=alerts, step_map=step_map)
    _append_chunk_alerts(alerts=alerts, step_map=step_map)
    _append_compare_alerts(
        alerts=alerts,
        compare_report=compare_report,
        drop_threshold_ratio=drop_threshold_ratio,
    )

    return {
        "schema_version": UNIVERSITY_COLLECTION_ALERT_SCHEMA_VERSION,
        "status": "alert" if alerts else "ok",
        "generated_at": _utc_now_iso(),
        "run_id": _normalize_text(run_report.get("run_id")),
        "lane_id": _normalize_text(run_report.get("lane_id")),
        "alerts": alerts,
    }


def _append_run_status_alerts(
    *,
    alerts: list[dict[str, Any]],
    run_report: Mapping[str, Any],
) -> None:
    if _normalize_text(run_report.get("status")) != "succeeded":
        alerts.append(
            {
                "code": "run_failed",
                "severity": "error",
                "message": f"run status={_normalize_text(run_report.get('status')) or 'unknown'}",
            }
        )


def _step_map(run_report: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    steps = run_report.get("steps")
    return {
        _normalize_text(step.get("name")): step
        for step in (steps if isinstance(steps, list) else [])
        if isinstance(step, dict) and _normalize_text(step.get("name"))
    }


def _append_required_step_alerts(
    *,
    alerts: list[dict[str, Any]],
    step_map: Mapping[str, Mapping[str, Any]],
) -> None:
    for required in (
        "crawl",
        "validate",
        "qc_report",
        "projection_replay",
        "projection_validate",
        "chunk_audit",
    ):
        step = step_map.get(required)
        if not step:
            alerts.append(
                {
                    "code": f"missing_step:{required}",
                    "severity": "error",
                    "message": f"missing required step report: {required}",
                }
            )
            continue
        if _normalize_text(step.get("status")) != "succeeded":
            alerts.append(
                {
                    "code": f"step_failed:{required}",
                    "severity": "error",
                    "message": f"{required} failed",
                }
            )


def _append_validate_alerts(
    *,
    alerts: list[dict[str, Any]],
    step_map: Mapping[str, Mapping[str, Any]],
) -> None:
    validate_output = dict(step_map.get("validate") or {}).get("output_json")
    if isinstance(validate_output, dict):
        errors = int((validate_output.get("counts") or {}).get("errors") or 0)
        if errors > 0:
            alerts.append(
                {
                    "code": "source_validation_errors",
                    "severity": "error",
                    "message": f"source-truth validation errors={errors}",
                }
            )


def _append_qc_alerts(
    *,
    alerts: list[dict[str, Any]],
    step_map: Mapping[str, Mapping[str, Any]],
) -> None:
    qc_output = dict(step_map.get("qc_report") or {}).get("output_json")
    if not isinstance(qc_output, dict):
        return
    totals = qc_output.get("totals")
    if not isinstance(totals, dict):
        return
    fail_pages = int(totals.get("failPages") or 0)
    unexpected_review_pages = int(totals.get("unexpectedReviewPages") or 0)
    if fail_pages > 0:
        alerts.append(
            {
                "code": "qc_fail_pages",
                "severity": "error",
                "message": f"qc fail pages={fail_pages}",
            }
        )
    if unexpected_review_pages > 0:
        alerts.append(
            {
                "code": "qc_unexpected_review_pages",
                "severity": "warn",
                "message": f"qc unexpected review pages={unexpected_review_pages}",
            }
        )


def _append_projection_alerts(
    *,
    alerts: list[dict[str, Any]],
    step_map: Mapping[str, Mapping[str, Any]],
) -> None:
    projection_replay_output = dict(step_map.get("projection_replay") or {}).get("output_json")
    if isinstance(projection_replay_output, dict):
        emitted = int((projection_replay_output.get("counts") or {}).get("emitted_documents") or 0)
        if emitted == 0:
            alerts.append(
                {
                    "code": "projection_zero_documents",
                    "severity": "error",
                    "message": "projection emitted zero documents",
                }
            )

    projection_validate_output = dict(step_map.get("projection_validate") or {}).get("output_json")
    if isinstance(projection_validate_output, dict):
        errors = int((projection_validate_output.get("counts") or {}).get("errors") or 0)
        if errors > 0:
            alerts.append(
                {
                    "code": "projection_validation_errors",
                    "severity": "error",
                    "message": f"projection validation errors={errors}",
                }
            )


def _append_chunk_alerts(
    *,
    alerts: list[dict[str, Any]],
    step_map: Mapping[str, Mapping[str, Any]],
) -> None:
    chunk_audit_output = dict(step_map.get("chunk_audit") or {}).get("output_json")
    if isinstance(chunk_audit_output, dict) and not bool(chunk_audit_output.get("passed")):
        alerts.append(
            {
                "code": "chunk_audit_failed",
                "severity": "error",
                "message": "chunk audit did not pass",
            }
        )


def _append_compare_alerts(
    *,
    alerts: list[dict[str, Any]],
    compare_report: Mapping[str, Any] | None,
    drop_threshold_ratio: float,
) -> None:
    if not isinstance(compare_report, Mapping):
        return
    compare_status = _normalize_text(compare_report.get("status"))
    if compare_status and compare_status != "succeeded":
        alerts.append(
            {
                "code": "repeated_run_compare_failed",
                "severity": "error",
                "message": f"compare status={compare_status}",
            }
        )
    drop_ratio = compare_report.get("drop_ratio")
    if isinstance(drop_ratio, (int, float)) and float(drop_ratio) < float(drop_threshold_ratio):
        alerts.append(
            {
                "code": "baseline_document_drop",
                "severity": "error",
                "message": (
                    f"document drop ratio={drop_ratio:.4f} below threshold="
                    f"{float(drop_threshold_ratio):.4f}"
                ),
            }
        )
