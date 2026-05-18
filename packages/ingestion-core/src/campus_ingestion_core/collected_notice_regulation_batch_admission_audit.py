from __future__ import annotations

import html
import json
import re
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_regulation_admission import (
    build_collected_notice_regulation_admission_preview,
)


@dataclass(frozen=True, slots=True)
class RegulationAdmissionExpectation:
    notice_id: str
    regulation_admission_class: str
    consumption_class: str


def audit_collected_notice_regulation_admission_batch(
    *,
    selection_json: Path,
    bundle_json: Path,
    output_dir: Path,
    generated_at: str,
    expectations: tuple[RegulationAdmissionExpectation, ...] = (),
    allow_missing: bool = False,
) -> dict[str, Any]:
    selected_notice_ids = _selected_notice_ids(_load_json(selection_json))
    records_by_id = _records_by_notice_id(_load_json(bundle_json))
    missing_from_bundle = [
        notice_id for notice_id in selected_notice_ids if notice_id not in records_by_id
    ]
    if missing_from_bundle and not allow_missing:
        raise ValueError(f"missing selected notices: {', '.join(missing_from_bundle)}")
    units = [
        _unit_from_bundle_record(records_by_id[notice_id])
        for notice_id in selected_notice_ids
        if notice_id in records_by_id
    ]
    preview = build_collected_notice_regulation_admission_preview(
        searchable_notice_preview={"units": units},
        multimodal_candidate_inventory={"candidates": []},
        generated_at=generated_at,
    )
    entries = list(preview.admission_manifest["entries"])
    by_notice = [_summary_row(entry) for entry in entries]
    entries_by_notice = {str(entry["source_notice_id"]): entry for entry in entries}
    expectation_failures = _expectation_failures(
        entries_by_notice=entries_by_notice,
        expectations=expectations,
    )
    summary = {
        "schema_version": "collected_notice_regulation_admission_batch_audit.v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "admission_generated_at": generated_at,
        "coverage": {
            "selected_notice_count": len(selected_notice_ids),
            "scanned_notice_count": len(entries),
            "missing_from_bundle": missing_from_bundle,
            "allow_missing": allow_missing,
        },
        "preview_counts": _preview_counts(entries),
        "historical_annual_cycle_holds": [
            row["source_notice_id"]
            for row in by_notice
            if row["regulation_admission_class"] == "historical_annual_cycle_rule_hold"
        ],
        "historical_time_window_holds": [
            row["source_notice_id"]
            for row in by_notice
            if row["regulation_admission_class"] == "historical_time_window_rule_hold"
        ],
        "downstream_admitted": [
            row["source_notice_id"]
            for row in by_notice
            if row["consumption_class"] == "downstream_admitted"
        ],
        "expectation_failures": expectation_failures,
        "by_notice": by_notice,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_json(output_dir / "summary.json", summary)
    _write_json(output_dir / "admission-manifest.json", preview.admission_manifest)
    _write_json(output_dir / "coverage.json", summary["coverage"])
    if expectation_failures:
        raise ValueError(
            "expectation failures: " + json.dumps(expectation_failures, ensure_ascii=False)
        )
    return summary


def _load_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    Path(path).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _selected_notice_ids(payload: Any) -> tuple[str, ...]:
    if isinstance(payload, dict):
        raw_values = payload.get("selected_notice_ids") or payload.get("notice_ids") or ()
    elif isinstance(payload, list):
        raw_values = payload
    else:
        raw_values = ()
    return tuple(str(value).strip() for value in raw_values if str(value).strip())


def _records_by_notice_id(payload: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(payload, list):
        raise ValueError("bundle json must be a list")
    records: dict[str, dict[str, Any]] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        notice_id = str(item.get("notice_id") or "").strip()
        if notice_id:
            records[notice_id] = item
    return records


def _unit_from_bundle_record(record: dict[str, Any]) -> dict[str, Any]:
    notice = record.get("notice") if isinstance(record.get("notice"), dict) else {}
    notice_id = str(record.get("notice_id") or notice.get("notice_id") or "").strip()
    title = str(notice.get("notice_title") or "").strip()
    published_at = str(
        notice.get("notice_release_time") or notice.get("notice_first_time") or ""
    ).strip()
    body_text = _html_to_text(str(notice.get("notice_content") or ""))
    year = published_at[:4] if published_at[:4].isdigit() else "unknown-year"
    return {
        "schema_version": "collected_notice_searchable_unit.v1",
        "unit_id": f"searchable:notice:muc_internal_portal:{notice_id}",
        "source_channel": "authenticated_notice_portal",
        "source_surface": "notice",
        "source_corpus": "campus_notices",
        "source_collection": "internal_notice",
        "site_id": "muc_internal_portal",
        "source_notice_id": notice_id,
        "source_document_id": f"notice:muc_internal_portal:{notice_id}",
        "title": title,
        "published_at": published_at,
        "source_url": str(notice.get("notice_browser_url") or notice.get("portal_print_url") or ""),
        "source_home_url": "https://my.muc.edu.cn",
        "source_object_refs": [
            {
                "bucket": "campus-rag-source",
                "key": f"authenticated_notice_portal/{notice_id}/{year}/source-truth/notice-manifest.json",
                "role": "source-truth/notice-manifest.json",
            }
        ],
        "run_provenance": {"run_id": "collected-notice-regulation-batch-admission-audit"},
        "body_text": body_text,
        "body_excerpt": body_text[:120],
        "attachment_refs": [],
        "multimodal_status": "not_required",
        "search_text": f"{title}\n{body_text}",
        "visibility_level": "restricted",
        "entitlement_groups": ["campus_members"],
        "admission_batch_id": "collected-notice-regulation-batch-admission-audit",
        "normalized_markdown_object_key": f"campus_notices/internal_notice/{notice_id}/canonical.md",
        "target_hints": {
            "candidate_targets": ["regulation"],
            "policy": "collected-notice-regulation-batch-admission-audit.v1",
        },
        "defer_reason_codes": [],
        "invalid_reason_codes": [],
        "reason_codes": [],
        "created_at": "2026-05-01T00:00:00+00:00",
        "updated_at": "2026-05-01T00:00:00+00:00",
    }


def _html_to_text(value: str) -> str:
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", value)
    text = re.sub(r"(?i)</\s*p\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text).replace("\xa0", " ")
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _preview_counts(entries: list[dict[str, Any]]) -> dict[str, Any]:
    class_counts = Counter(
        str(entry.get("regulation_admission_class") or "none") for entry in entries
    )
    target_counts = Counter(str(entry.get("target_collection") or "none") for entry in entries)
    return {
        "entry_count": len(entries),
        "by_regulation_admission_class": dict(sorted(class_counts.items())),
        "by_target_collection": dict(sorted(target_counts.items())),
        "downstream_admitted": sum(
            1 for entry in entries if entry.get("consumption_class") == "downstream_admitted"
        ),
        "search_only": sum(
            1 for entry in entries if entry.get("consumption_class") == "search_only"
        ),
        "defer": sum(1 for entry in entries if entry.get("consumption_class") == "defer"),
    }


def _summary_row(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_notice_id": str(entry.get("source_notice_id") or ""),
        "title": entry.get("title"),
        "published_at": entry.get("published_at"),
        "regulation_admission_class": entry.get("regulation_admission_class"),
        "consumption_class": entry.get("consumption_class"),
        "target_collection": entry.get("target_collection"),
        "target_surface": entry.get("target_surface"),
        "fact_readiness_state": entry.get("fact_readiness_state"),
        "target_admission_state": entry.get("target_admission_state"),
        "applicability_status": entry.get("applicability_status"),
        "promotion_disposition": entry.get("promotion_disposition"),
        "cycle_year": entry.get("cycle_year"),
        "reason_codes": entry.get("reason_codes") or [],
    }


def _expectation_failures(
    *,
    entries_by_notice: dict[str, dict[str, Any]],
    expectations: tuple[RegulationAdmissionExpectation, ...],
) -> list[dict[str, Any]]:
    failures: list[dict[str, Any]] = []
    for expectation in expectations:
        entry = entries_by_notice.get(expectation.notice_id)
        if entry is None:
            failures.append({"notice_id": expectation.notice_id, "reason": "not_scanned"})
            continue
        actual_class = str(entry.get("regulation_admission_class") or "")
        actual_consumption = str(entry.get("consumption_class") or "")
        if (
            actual_class != expectation.regulation_admission_class
            or actual_consumption != expectation.consumption_class
        ):
            failures.append(
                {
                    "notice_id": expectation.notice_id,
                    "expected": {
                        "regulation_admission_class": expectation.regulation_admission_class,
                        "consumption_class": expectation.consumption_class,
                    },
                    "actual": {
                        "regulation_admission_class": actual_class,
                        "consumption_class": actual_consumption,
                    },
                }
            )
    return failures


__all__ = [
    "RegulationAdmissionExpectation",
    "audit_collected_notice_regulation_admission_batch",
]
