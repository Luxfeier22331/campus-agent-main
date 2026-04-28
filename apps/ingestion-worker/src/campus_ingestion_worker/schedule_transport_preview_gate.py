from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "schedule_transport_preview_gate.v1"

BUCKET_PREVIEW_PASSED = "preview_passed"
BUCKET_PREVIEW_FAILED = "preview_failed"
BUCKETS = (BUCKET_PREVIEW_PASSED, BUCKET_PREVIEW_FAILED)


@dataclass(frozen=True, slots=True)
class _MaterializationCounts:
    snapshot_count: int = 0
    scheduled_departure_count: int = 0
    service_exception_count: int = 0
    operational_notice_count: int = 0

    @property
    def has_materialized_output(self) -> bool:
        return (
            self.snapshot_count
            + self.scheduled_departure_count
            + self.service_exception_count
            + self.operational_notice_count
        ) > 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build selected pass/fail buckets from a no-write transport preview."
    )
    parser.add_argument("--candidate-gate-report-path", required=True)
    parser.add_argument("--projection-bundle-path", required=True)
    parser.add_argument("--validation-summary-path", required=True)
    parser.add_argument("--rejected-source-report-path", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--generated-at")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    candidate_path = Path(args.candidate_gate_report_path)
    projection_path = Path(args.projection_bundle_path)
    validation_path = Path(args.validation_summary_path)
    rejected_path = Path(args.rejected_source_report_path)
    report = build_schedule_transport_preview_gate_report(
        candidate_gate_report=_read_json(candidate_path),
        projection_bundle=_read_json(projection_path),
        validation_summary=_read_json(validation_path),
        rejected_sources=_read_json_array(rejected_path),
        run_id=str(args.run_id),
        generated_at=str(args.generated_at or _default_generated_at()),
        candidate_gate_report_path=str(candidate_path),
        projection_bundle_path=str(projection_path),
        validation_summary_path=str(validation_path),
        rejected_source_report_path=str(rejected_path),
    )
    write_schedule_transport_preview_gate_outputs(
        output_dir=Path(args.output_dir),
        report=report,
    )
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2, sort_keys=True))


def build_schedule_transport_preview_gate_report(
    *,
    candidate_gate_report: Mapping[str, Any],
    projection_bundle: Mapping[str, Any],
    validation_summary: Mapping[str, Any],
    rejected_sources: Sequence[Mapping[str, Any]],
    run_id: str,
    generated_at: str,
    candidate_gate_report_path: str = "",
    projection_bundle_path: str = "",
    validation_summary_path: str = "",
    rejected_source_report_path: str = "",
) -> dict[str, Any]:
    selected_notice_ids = _selected_notice_ids(candidate_gate_report)
    title_by_notice = _title_by_notice(candidate_gate_report)
    counts_by_notice = _materialization_counts_by_notice(projection_bundle)
    rejected_by_notice = {
        str(item.get("source_notice_id") or "").strip(): dict(item)
        for item in rejected_sources
        if str(item.get("source_notice_id") or "").strip()
    }
    validation_valid = bool(validation_summary.get("valid"))

    items: list[dict[str, Any]] = []
    buckets = {bucket: [] for bucket in BUCKETS}
    for notice_id in selected_notice_ids:
        counts = counts_by_notice.get(notice_id, _MaterializationCounts())
        reason_codes: list[str] = []
        warning_codes: list[str] = []
        rejected = rejected_by_notice.get(notice_id)
        if not validation_valid:
            bucket = BUCKET_PREVIEW_FAILED
            reason_codes.append("transport_preview_validation_failed")
        elif rejected is not None:
            bucket = BUCKET_PREVIEW_FAILED
            reason_codes.append("materialization_rejected")
        elif not counts.has_materialized_output:
            bucket = BUCKET_PREVIEW_FAILED
            reason_codes.append("no_materialized_transport_output")
        else:
            bucket = BUCKET_PREVIEW_PASSED
            if (
                counts.snapshot_count
                and not counts.scheduled_departure_count
                and not counts.service_exception_count
                and not counts.operational_notice_count
            ):
                warning_codes.append("snapshot_only_superseded_baseline")
        buckets[bucket].append(notice_id)
        items.append(
            {
                "notice_id": notice_id,
                "title": title_by_notice.get(notice_id, ""),
                "bucket": bucket,
                "reason_codes": tuple(reason_codes),
                "warning_codes": tuple(warning_codes),
                "rejected_source": rejected or {},
                "materialization_counts": {
                    "snapshots": counts.snapshot_count,
                    "scheduled_departures": counts.scheduled_departure_count,
                    "service_exceptions": counts.service_exception_count,
                    "operational_notices": counts.operational_notice_count,
                },
            }
        )

    failed_reasons = _count_reason_codes(items, "reason_codes")
    warning_counts = _count_reason_codes(items, "warning_codes")
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": str(run_id),
        "generated_at": str(generated_at),
        "remote_write_status": "not_written_pg_or_object_storage",
        "inputs": {
            "candidate_gate_report_path": candidate_gate_report_path,
            "projection_bundle_path": projection_bundle_path,
            "validation_summary_path": validation_summary_path,
            "rejected_source_report_path": rejected_source_report_path,
        },
        "validation_valid": validation_valid,
        "summary": {
            "selected_notice_count": len(selected_notice_ids),
            "preview_passed_count": len(buckets[BUCKET_PREVIEW_PASSED]),
            "preview_failed_count": len(buckets[BUCKET_PREVIEW_FAILED]),
            "failed_reason_counts": failed_reasons,
            "warning_counts": warning_counts,
        },
        "buckets": buckets,
        "items": items,
    }


def write_schedule_transport_preview_gate_outputs(
    *, output_dir: Path, report: Mapping[str, Any]
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_json(output_dir / "schedule-transport-preview-gate.json", report)
    _write_json(
        output_dir / "preview-passed-selection.json",
        {
            "selected_notice_ids": list(
                dict(report.get("buckets") or {}).get("preview_passed") or []
            )
        },
    )
    _write_json(
        output_dir / "preview-failed-selection.json",
        {
            "selected_notice_ids": list(
                dict(report.get("buckets") or {}).get("preview_failed") or []
            )
        },
    )
    (output_dir / "README.md").write_text(
        render_schedule_transport_preview_gate_markdown(report),
        encoding="utf-8",
    )


def render_schedule_transport_preview_gate_markdown(report: Mapping[str, Any]) -> str:
    summary = dict(report.get("summary") or {})
    lines = [
        "---",
        "doc_type: operator-report",
        "status: generated",
        f"created: {report.get('generated_at') or ''!s}",
        "---",
        "",
        "# Schedule Transport Preview Gate",
        "",
        f"- Run id: `{report.get('run_id') or ''!s}`",
        f"- Remote write status: `{report.get('remote_write_status') or ''!s}`",
        f"- Validation valid: `{bool(report.get('validation_valid'))}`",
        f"- Selected notices: `{int(summary.get('selected_notice_count') or 0)}`",
        f"- Preview passed: `{int(summary.get('preview_passed_count') or 0)}`",
        f"- Preview failed: `{int(summary.get('preview_failed_count') or 0)}`",
        "",
        "## Items",
        "",
        "<!-- markdownlint-disable MD013 -->",
        "",
        "|Notice id|Bucket|Counts|Reasons|Warnings|",
        "|---|---|---|---|---|",
    ]
    for raw_item in list(report.get("items") or ()):
        item = dict(raw_item)
        counts = dict(item.get("materialization_counts") or {})
        count_text = (
            f"snapshots={int(counts.get('snapshots') or 0)}, "
            f"departures={int(counts.get('scheduled_departures') or 0)}, "
            f"exceptions={int(counts.get('service_exceptions') or 0)}, "
            f"operational={int(counts.get('operational_notices') or 0)}"
        )
        reasons = ", ".join(str(code) for code in item.get("reason_codes") or ())
        warnings = ", ".join(str(code) for code in item.get("warning_codes") or ())
        lines.append(
            "|"
            f"`{item.get('notice_id') or ''!s}`|"
            f"`{item.get('bucket') or ''!s}`|"
            f"{count_text}|"
            f"{reasons}|"
            f"{warnings}|"
        )
    lines.extend(["", "<!-- markdownlint-enable MD013 -->"])
    return "\n".join(lines) + "\n"


def _selected_notice_ids(candidate_gate_report: Mapping[str, Any]) -> tuple[str, ...]:
    buckets = dict(candidate_gate_report.get("buckets") or {})
    return tuple(
        dict.fromkeys(
            str(item).strip()
            for item in buckets.get("auto_stage_candidate") or ()
            if str(item).strip()
        )
    )


def _title_by_notice(candidate_gate_report: Mapping[str, Any]) -> dict[str, str]:
    titles: dict[str, str] = {}
    for item in _list_of_mappings(candidate_gate_report.get("items")):
        notice_id = str(item.get("notice_id") or "").strip()
        if notice_id:
            titles[notice_id] = str(item.get("title") or "").strip()
    return titles


def _materialization_counts_by_notice(
    projection_bundle: Mapping[str, Any],
) -> dict[str, _MaterializationCounts]:
    mutable: dict[str, dict[str, int]] = {}

    def ensure(notice_id: str) -> dict[str, int]:
        return mutable.setdefault(
            notice_id,
            {
                "snapshot_count": 0,
                "scheduled_departure_count": 0,
                "service_exception_count": 0,
                "operational_notice_count": 0,
            },
        )

    for snapshot in _list_of_mappings(projection_bundle.get("transport_schedule_snapshots")):
        for notice_id in _notice_ids_from_refs((snapshot.get("source_ref"),)):
            ensure(notice_id)["snapshot_count"] += 1
    for departure in _list_of_mappings(projection_bundle.get("scheduled_departures")):
        for notice_id in _notice_ids_from_refs(departure.get("related_notice_refs") or ()):
            ensure(notice_id)["scheduled_departure_count"] += 1
    for exception in _list_of_mappings(projection_bundle.get("transport_service_exceptions")):
        for notice_id in _notice_ids_from_refs(exception.get("related_notice_refs") or ()):
            ensure(notice_id)["service_exception_count"] += 1
    for notice in _list_of_mappings(projection_bundle.get("transport_operational_notices")):
        for notice_id in _notice_ids_from_refs((notice.get("source_ref"),)):
            ensure(notice_id)["operational_notice_count"] += 1
    return {
        notice_id: _MaterializationCounts(**counts) for notice_id, counts in sorted(mutable.items())
    }


def _notice_ids_from_refs(refs: object) -> tuple[str, ...]:
    if isinstance(refs, str):
        candidates: Sequence[object] = (refs,)
    elif isinstance(refs, Sequence):
        candidates = refs
    else:
        candidates = ()
    values: list[str] = []
    for ref in candidates:
        parts = str(ref or "").split(":")
        if len(parts) >= 3 and parts[0] == "notice":
            values.append(parts[-1])
    return tuple(dict.fromkeys(values))


def _count_reason_codes(items: Sequence[Mapping[str, Any]], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        for code in item.get(field) or ():
            key = str(code)
            if key:
                counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def _list_of_mappings(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(dict(item) for item in value if isinstance(item, Mapping))


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


def _read_json_array(path: Path) -> tuple[Mapping[str, Any], ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, Sequence) or isinstance(payload, (str, bytes)):
        raise ValueError(f"{path} must contain a JSON array")
    return tuple(dict(item) for item in payload if isinstance(item, Mapping))


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _default_generated_at() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


__all__ = [
    "BUCKET_PREVIEW_FAILED",
    "BUCKET_PREVIEW_PASSED",
    "SCHEMA_VERSION",
    "build_parser",
    "build_schedule_transport_preview_gate_report",
    "main",
    "render_schedule_transport_preview_gate_markdown",
    "write_schedule_transport_preview_gate_outputs",
]


if __name__ == "__main__":
    main()
