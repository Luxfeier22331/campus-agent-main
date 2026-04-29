from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now

ACCEPTANCE_SCHEMA_VERSION = "collected_notice_replay_closeout_acceptance.v1"
TRACE_SCHEMA_VERSION = "collected_notice_replay_closeout_trace.v1"
PHASE_07_ID = "phase-07-acceptance-and-closeout"
_PASSED_WITH_DEFERRED = "passed_with_deferred_items"
_ALLOWED_SERVICE_STATUS_DEFER_REASONS = {
    "missing_effective_window_or_status_signal",
    "multimodal_not_ready",
    "not_current_effective_at_generated_time",
}


@dataclass(frozen=True, slots=True)
class CollectedNoticeReplayCloseoutReport:
    acceptance_report: dict[str, Any]
    source_to_downstream_trace: dict[str, Any]


def build_closeout_acceptance_report_from_root(
    *,
    workstream_root: Path,
    generated_at: str | None = None,
    generated_by: str = "campus_ingestion_worker.generate_collected_notice_replay_closeout_acceptance",
) -> CollectedNoticeReplayCloseoutReport:
    root = Path(workstream_root)
    timestamp = generated_at or utc_now()
    evidence = _load_evidence(root)
    checks = [
        _searchable_coverage_check(evidence),
        _queue_contract_check(evidence),
        _regulation_check(evidence),
        _transport_check(evidence),
        _service_status_check(evidence),
    ]
    trace = _trace_report(
        evidence=evidence,
        checks=checks,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    acceptance = {
        "schema_version": ACCEPTANCE_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_07_ID,
        "verdict": _overall_verdict(checks),
        "acceptance_checks": checks,
        "counts": _acceptance_counts(evidence),
        "notes": [
            "Phase 7 validates replay evidence only; it does not promote current releases.",
            "Deferred service_status candidates remain searchable and require OCR or policy review before target readiness.",
        ],
    }
    return CollectedNoticeReplayCloseoutReport(
        acceptance_report=acceptance,
        source_to_downstream_trace=trace,
    )


def closeout_to_output_files(
    report: CollectedNoticeReplayCloseoutReport,
) -> dict[str, dict[str, Any]]:
    return {
        "acceptance-summary.json": report.acceptance_report,
        "source-to-queue-to-search-to-downstream-trace.json": (report.source_to_downstream_trace),
    }


def _load_evidence(root: Path) -> dict[str, dict[str, Any]]:
    evidence_root = root / "evidence"
    return {
        "searchable_coverage": _load_json(
            evidence_root / "phase-04-dry-run-reimport-and-universal-search-preview/"
            "searchable-coverage-report.json"
        ),
        "enqueue_coverage": _load_json(
            evidence_root / "phase-04-7-historical-captured-inventory-synthetic-enqueue/"
            "enqueue-coverage-report.json"
        ),
        "queue_consume": _load_json(
            evidence_root / "phase-04-8-queue-consumer-reimport-path/queue-consume.dry-run.json"
        ),
        "queue_searchable_coverage": _load_json(
            evidence_root / "phase-04-8-queue-consumer-reimport-path/"
            "searchable-coverage-after-queue-consume.json"
        ),
        "regulation_consistency": _load_json(
            evidence_root / "phase-06-r3-regulation-normalization-quality-gate/"
            "regulation-normalization-consistency-report.json"
        ),
        "transport_consistency": _load_json(
            evidence_root / "phase-06-batched-downstream-replay/batch-transport-schedule/"
            "consistency-report.json"
        ),
        "official_transport_baseline_consistency": _load_json(
            evidence_root
            / "phase-06-2-official-transport-baseline-ingest-and-overlay-reclassification/"
            "official-baseline-consistency-report.json"
        ),
        "official_transport_baseline_preview": _load_json(
            evidence_root
            / "phase-06-2-official-transport-baseline-ingest-and-overlay-reclassification/"
            "official-baseline-canonical-preview.json"
        ),
        "transport_ocr_consistency": _load_json(
            evidence_root / "phase-06-3-schedule-image-ocr-mini-batch/post-run-preview/"
            "transport-ocr-consistency-report.json"
        ),
        "transport_ocr_gap": _load_json(
            evidence_root / "phase-06-3-schedule-image-ocr-mini-batch/post-run-preview/"
            "schedule-image-ocr-post-run-gap-report.json"
        ),
        "service_status_consistency": _load_json(
            evidence_root / "phase-06-batched-downstream-replay/batch-service-status/"
            "consistency-report.json"
        ),
        "service_status_rejected": _load_json(
            evidence_root / "phase-06-batched-downstream-replay/batch-service-status/"
            "rejected-deferred-source-report.json"
        ),
    }


def _searchable_coverage_check(evidence: dict[str, dict[str, Any]]) -> dict[str, Any]:
    coverage = evidence["searchable_coverage"]
    queue_coverage = evidence["queue_searchable_coverage"]
    passed = (
        coverage.get("verdict") == "passed"
        and int(coverage.get("missing_searchable_unit_count") or 0) == 0
        and queue_coverage.get("verdict") == "passed"
        and int(queue_coverage.get("missing_searchable_unit_count") or 0) == 0
    )
    return _check(
        check_id="all_valid_captured_notices_searchable",
        verdict="passed" if passed else "failed",
        summary=(
            "All valid captured notices have searchable preview rows."
            if passed
            else "Searchable coverage evidence has missing rows."
        ),
        evidence={
            "phase4_valid_captured_notice_count": coverage.get("valid_captured_notice_count"),
            "phase4_searchable_unit_count": coverage.get("searchable_unit_count"),
            "queue_searchable_unit_count": queue_coverage.get("searchable_unit_count"),
        },
    )


def _queue_contract_check(evidence: dict[str, dict[str, Any]]) -> dict[str, Any]:
    enqueue = evidence["enqueue_coverage"]
    queue = evidence["queue_consume"]
    counts = dict(queue.get("counts") or {})
    passed = (
        enqueue.get("verdict") == "passed"
        and enqueue.get("write_enabled") is False
        and queue.get("write_enabled") is False
        and int(counts.get("failed_count") or 0) == 0
        and int(counts.get("projected_count") or 0) == int(enqueue.get("planned_job_count") or 0)
    )
    return _check(
        check_id="historical_and_live_queue_contract",
        verdict="passed" if passed else "failed",
        summary=(
            "Historical inventory replay uses the same notice_ingest object-ref queue contract."
            if passed
            else "Queue contract evidence is incomplete or inconsistent."
        ),
        evidence={
            "planned_job_count": enqueue.get("planned_job_count"),
            "projected_count": counts.get("projected_count"),
            "failed_count": counts.get("failed_count"),
            "write_enabled": queue.get("write_enabled"),
        },
    )


def _regulation_check(evidence: dict[str, dict[str, Any]]) -> dict[str, Any]:
    report = evidence["regulation_consistency"]
    counts = dict(report.get("counts") or {})
    passed = report.get("verdict") == "passed" and report.get("write_enabled") is False
    return _check(
        check_id="regulation_offline_preparation_only",
        verdict="passed" if passed else "failed",
        summary=(
            "Regulation replay stops at no-write offline preparation."
            if passed
            else "Regulation replay evidence did not preserve offline-only stop point."
        ),
        evidence={
            "downstream_admitted": counts.get("downstream_admitted"),
            "institutional_rules_document_count": counts.get("institutional_rules_document_count"),
            "scoped_rules_document_count": counts.get("scoped_rules_document_count"),
            "write_enabled": report.get("write_enabled"),
        },
    )


def _transport_check(evidence: dict[str, dict[str, Any]]) -> dict[str, Any]:
    batch = evidence["transport_consistency"]
    baseline = evidence["official_transport_baseline_consistency"]
    baseline_preview = evidence["official_transport_baseline_preview"]
    ocr = evidence["transport_ocr_consistency"]
    ocr_gap = evidence["transport_ocr_gap"]
    baseline_counts = dict(baseline_preview.get("counts") or {})
    passed = (
        batch.get("verdict") == "passed"
        and batch.get("current_promotion_enabled") is False
        and baseline.get("verdict") == "passed"
        and int(baseline_counts.get("canonical_row_count") or 0) > 0
        and ocr.get("verdict") == "passed"
        and ocr_gap.get("write_enabled") is False
        and int(ocr_gap.get("missing_ocr_output_count") or 0) == 0
    )
    return _check(
        check_id="transport_schedule_baseline_and_ocr_gate",
        verdict="passed" if passed else "failed",
        summary=(
            "Transport replay respects official baseline and OCR review gates."
            if passed
            else "Transport baseline or OCR evidence is incomplete."
        ),
        evidence={
            "candidate_source_notice_ids": batch.get("source_notice_ids"),
            "batch_stage_candidate_count": batch.get("stage_candidate_count"),
            "official_baseline_row_count": baseline_counts.get("canonical_row_count"),
            "ocr_stage_candidate_count": ocr.get("stage_candidate_count"),
            "ocr_rejected_item_count": ocr_gap.get("rejected_ocr_item_count"),
            "ocr_gap_verdict": ocr_gap.get("verdict"),
        },
    )


def _service_status_check(evidence: dict[str, dict[str, Any]]) -> dict[str, Any]:
    consistency = evidence["service_status_consistency"]
    rejected = evidence["service_status_rejected"]
    entries = [dict(item) for item in rejected.get("entries") or () if isinstance(item, dict)]
    reason_codes = {
        str(reason)
        for entry in entries
        for reason in entry.get("reason_codes") or ()
        if str(reason).strip()
    }
    has_only_expected_defers = reason_codes <= _ALLOWED_SERVICE_STATUS_DEFER_REASONS
    if consistency.get("verdict") == "passed":
        verdict = "passed"
    elif (
        consistency.get("verdict") == "blocked"
        and consistency.get("current_promotion_enabled") is False
        and has_only_expected_defers
        and int(rejected.get("entry_count") or 0)
        == int(consistency.get("blocked_source_count") or 0)
    ):
        verdict = _PASSED_WITH_DEFERRED
    else:
        verdict = "failed"
    return _check(
        check_id="service_status_downstream_replay",
        verdict=verdict,
        summary=(
            "Service-status replay is explicit; blocked rows remain searchable and reasoned."
            if verdict != "failed"
            else "Service-status replay has unclassified blockers."
        ),
        evidence={
            "source_notice_ids": consistency.get("source_notice_ids"),
            "admitted_source_count": consistency.get("admitted_source_count"),
            "blocked_source_count": consistency.get("blocked_source_count"),
            "stage_candidate_count": consistency.get("stage_candidate_count"),
            "current_promotion_enabled": consistency.get("current_promotion_enabled"),
            "rejected_reason_codes": sorted(reason_codes),
        },
    )


def _trace_report(
    *,
    evidence: dict[str, dict[str, Any]],
    checks: list[dict[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    queue_counts = dict(evidence["queue_consume"].get("counts") or {})
    regulation_counts = dict(evidence["regulation_consistency"].get("counts") or {})
    service_status = evidence["service_status_consistency"]
    return {
        "schema_version": TRACE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_07_ID,
        "overall_verdict": _overall_verdict(checks),
        "source": {
            "captured_notice_count": evidence["searchable_coverage"].get(
                "valid_captured_notice_count"
            ),
        },
        "queue": {
            "planned_job_count": evidence["enqueue_coverage"].get("planned_job_count"),
            "projected_count": queue_counts.get("projected_count"),
            "failed_count": queue_counts.get("failed_count"),
        },
        "searchable": {
            "searchable_unit_count": evidence["searchable_coverage"].get("searchable_unit_count"),
            "missing_searchable_unit_count": evidence["searchable_coverage"].get(
                "missing_searchable_unit_count"
            ),
        },
        "regulation": {
            "downstream_admitted": regulation_counts.get("downstream_admitted"),
            "write_enabled": evidence["regulation_consistency"].get("write_enabled"),
        },
        "transport_schedule": {
            "source_notice_ids": evidence["transport_consistency"].get("source_notice_ids"),
            "admitted_source_count": evidence["transport_consistency"].get("admitted_source_count"),
            "stage_candidate_count": evidence["transport_consistency"].get("stage_candidate_count"),
            "ocr_stage_candidate_count": evidence["transport_ocr_consistency"].get(
                "stage_candidate_count"
            ),
        },
        "service_status": {
            "source_notice_ids": service_status.get("source_notice_ids"),
            "admitted_source_count": service_status.get("admitted_source_count"),
            "blocked_source_notice_ids": service_status.get("source_notice_ids"),
            "stage_candidate_count": service_status.get("stage_candidate_count"),
        },
    }


def _acceptance_counts(evidence: dict[str, dict[str, Any]]) -> dict[str, Any]:
    queue_counts = dict(evidence["queue_consume"].get("counts") or {})
    regulation_counts = dict(evidence["regulation_consistency"].get("counts") or {})
    service_status = evidence["service_status_consistency"]
    transport = evidence["transport_consistency"]
    return {
        "captured_notice_count": evidence["searchable_coverage"].get("valid_captured_notice_count"),
        "searchable_unit_count": evidence["searchable_coverage"].get("searchable_unit_count"),
        "queue_projected_count": queue_counts.get("projected_count"),
        "regulation_downstream_admitted": regulation_counts.get("downstream_admitted"),
        "transport_stage_candidate_count": transport.get("stage_candidate_count"),
        "transport_ocr_stage_candidate_count": evidence["transport_ocr_consistency"].get(
            "stage_candidate_count"
        ),
        "service_status_stage_candidate_count": service_status.get("stage_candidate_count"),
        "service_status_blocked_source_count": service_status.get("blocked_source_count"),
    }


def _overall_verdict(checks: list[dict[str, Any]]) -> str:
    verdicts = {str(check.get("verdict") or "") for check in checks}
    if "failed" in verdicts:
        return "failed"
    if _PASSED_WITH_DEFERRED in verdicts:
        return _PASSED_WITH_DEFERRED
    return "passed"


def _check(
    *,
    check_id: str,
    verdict: str,
    summary: str,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    return {
        "check_id": check_id,
        "verdict": verdict,
        "summary": summary,
        "evidence": evidence,
    }


def _load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


__all__ = [
    "ACCEPTANCE_SCHEMA_VERSION",
    "PHASE_07_ID",
    "TRACE_SCHEMA_VERSION",
    "CollectedNoticeReplayCloseoutReport",
    "build_closeout_acceptance_report_from_root",
    "closeout_to_output_files",
]
