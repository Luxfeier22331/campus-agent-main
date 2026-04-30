from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now

MEDIA_EXTRACTION_CLOSEOUT_RESULT_MANIFEST_SCHEMA_VERSION = (
    "notice_media_extraction_closeout_result_manifest.v1"
)
MEDIA_EXTRACTION_CLOSEOUT_REPORT_SCHEMA_VERSION = "notice_media_extraction_closeout_report.v1"
MEDIA_EXTRACTION_CLOSEOUT_INVENTORY_SCHEMA_VERSION = (
    "notice_media_extraction_candidate_inventory.v1"
)
MEDIA_EXTRACTION_CLOSEOUT_TERMINAL_STATUSES = frozenset({"completed", "skipped", "failed_terminal"})


def apply_media_extraction_closeout_result_manifests_from_paths(
    *,
    candidate_inventory_path: Path,
    result_manifest_paths: Sequence[Path],
    generated_by: str = (
        "campus_ingestion_worker.preview_collected_notice_media_extraction_closeout"
    ),
) -> dict[str, Any]:
    return apply_media_extraction_closeout_result_manifests(
        candidate_inventory=_load_json_object(candidate_inventory_path),
        result_manifests=[_load_json_object(path) for path in result_manifest_paths],
        generated_by=generated_by,
    )


def apply_media_extraction_closeout_result_manifests(
    *,
    candidate_inventory: Mapping[str, Any],
    result_manifests: Sequence[Mapping[str, Any]],
    generated_at: str | None = None,
    generated_by: str = (
        "campus_ingestion_worker.preview_collected_notice_media_extraction_closeout"
    ),
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    result_by_candidate_id = _result_by_candidate_id(result_manifests)
    updated_candidates = []
    updated_count = 0
    terminalized_count = 0
    for candidate in _mapping_rows(candidate_inventory.get("candidates")):
        candidate_id = str(candidate.get("candidate_id") or "")
        result = result_by_candidate_id.get(candidate_id)
        if result is None:
            updated_candidates.append(dict(candidate))
            continue
        updated = _apply_result_to_candidate(candidate, result)
        updated_candidates.append(updated)
        updated_count += 1
        if str(updated.get("status") or "") in MEDIA_EXTRACTION_CLOSEOUT_TERMINAL_STATUSES:
            terminalized_count += 1

    known_candidate_ids = {
        str(candidate.get("candidate_id") or "")
        for candidate in _mapping_rows(candidate_inventory.get("candidates"))
    }
    orphan_results = [
        result
        for candidate_id, result in sorted(result_by_candidate_id.items())
        if candidate_id not in known_candidate_ids
    ]
    inventory = _candidate_inventory(
        source_inventory=candidate_inventory,
        candidates=updated_candidates,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    report = _closeout_report(
        candidate_inventory=inventory,
        result_manifests=result_manifests,
        updated_candidate_count=updated_count,
        terminalized_candidate_count=terminalized_count,
        orphan_results=orphan_results,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    return {"candidate_inventory": inventory, "closeout_report": report}


def build_schedule_image_ocr_media_extraction_closeout_result_manifest(
    *,
    execution_manifest: Mapping[str, Any],
    post_run_preview: Mapping[str, Any],
    generated_at: str | None = None,
    generated_by: str = (
        "campus_ingestion_core.collected_notice_media_extraction_closeout.schedule_image_ocr"
    ),
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    gap_report = dict(post_run_preview.get("post_run_gap_report") or {})
    missing = {
        (str(row.get("source_notice_id") or ""), int(row.get("image_index") or 0))
        for row in _mapping_rows(gap_report.get("missing_ocr_outputs"))
    }
    rejected_by_key = {
        (
            str(row.get("notice_id") or row.get("source_notice_id") or ""),
            int(row.get("image_index") or 0),
        ): dict(row)
        for row in _mapping_rows(gap_report.get("rejected_ocr_items"))
    }
    results = []
    for entry in _mapping_rows(execution_manifest.get("entries")):
        key = (str(entry.get("source_notice_id") or ""), int(entry.get("image_index") or 0))
        if key in missing:
            status = "pending"
            reason_codes = ["ocr_output_missing"]
        elif key in rejected_by_key:
            status = "failed"
            reason_codes = [
                "ocr_admission_rejected",
                str(rejected_by_key[key].get("admission_reason") or "").strip(),
            ]
        else:
            status = "completed"
            reason_codes = ["ocr_output_admitted"]
        results.append(
            _result_row(
                candidate_id=str(entry.get("candidate_id") or ""),
                status=status,
                reason_codes=reason_codes,
                output_refs=dict(entry.get("normalized_output_refs") or {}),
            )
        )
    return _result_manifest(
        results=results,
        source_kind="schedule_image_ocr_post_run_preview",
        generated_at=timestamp,
        generated_by=generated_by,
    )


def build_owner_text_media_extraction_closeout_result_manifest(
    *,
    execution_report: Mapping[str, Any],
    generated_at: str | None = None,
    generated_by: str = (
        "campus_ingestion_core.collected_notice_media_extraction_closeout.owner_text"
    ),
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    results = []
    for item in _mapping_rows(execution_report.get("attempt_results")):
        status = str(item.get("status") or "")
        owner_text_status = str(item.get("owner_text_status") or "")
        if status == "succeeded" and owner_text_status == "ready":
            closeout_status = "completed"
            reason_codes = ["owner_text_ready"]
        elif status == "planned":
            closeout_status = "pending"
            reason_codes = ["attempt_not_executed"]
        else:
            closeout_status = "failed"
            reason_codes = ["owner_text_not_ready", str(item.get("error") or "").strip()]
        results.append(
            _result_row(
                candidate_id=str(item.get("candidate_id") or ""),
                status=closeout_status,
                reason_codes=reason_codes,
                output_refs=dict(item.get("written_refs") or {}),
            )
        )
    return _result_manifest(
        results=results,
        source_kind="owner_text_execution_report",
        generated_at=timestamp,
        generated_by=generated_by,
    )


def closeout_output_files(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "media-extraction-candidate-inventory.closeout.json": payload["candidate_inventory"],
        "media-extraction-closeout-report.json": payload["closeout_report"],
    }


def _result_manifest(
    *,
    results: Sequence[Mapping[str, Any]],
    source_kind: str,
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    return {
        "schema_version": MEDIA_EXTRACTION_CLOSEOUT_RESULT_MANIFEST_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "source_kind": source_kind,
        "result_count": len(results),
        "results": [dict(result) for result in results],
    }


def _result_row(
    *,
    candidate_id: str,
    status: str,
    reason_codes: Sequence[str],
    output_refs: Mapping[str, Any],
) -> dict[str, Any]:
    normalized_status = _normalize_status(status)
    return {
        "candidate_id": candidate_id,
        "status": normalized_status,
        "media_text_status": normalized_status,
        "reason_codes": _clean_reason_codes(reason_codes),
        "output_refs": dict(output_refs),
    }


def _result_by_candidate_id(
    result_manifests: Sequence[Mapping[str, Any]],
) -> dict[str, Mapping[str, Any]]:
    result: dict[str, Mapping[str, Any]] = {}
    for manifest in result_manifests:
        for row in _mapping_rows(manifest.get("results")):
            candidate_id = str(row.get("candidate_id") or "").strip()
            if candidate_id:
                result[candidate_id] = row
    return result


def _apply_result_to_candidate(
    candidate: Mapping[str, Any],
    result: Mapping[str, Any],
) -> dict[str, Any]:
    status = _normalize_status(str(result.get("status") or result.get("media_text_status") or ""))
    updated = dict(candidate)
    updated["status"] = status
    updated["media_text_status"] = str(result.get("media_text_status") or status)
    updated["target_blocking"] = (
        bool(candidate.get("target_blocking"))
        and status not in MEDIA_EXTRACTION_CLOSEOUT_TERMINAL_STATUSES
    )
    reason_codes = _clean_reason_codes(
        [
            *list(candidate.get("reason_codes") or ()),
            *list(result.get("reason_codes") or ()),
        ]
    )
    updated["reason_codes"] = reason_codes
    updated["media_text_reason_codes"] = reason_codes
    output_refs = result.get("output_refs")
    if isinstance(output_refs, Mapping) and output_refs:
        updated["completed_output_refs"] = dict(output_refs)
    updated["closeout"] = {
        "result_status": status,
        "result_schema_version": str(result.get("schema_version") or ""),
    }
    return updated


def _candidate_inventory(
    *,
    source_inventory: Mapping[str, Any],
    candidates: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    payload = dict(source_inventory)
    payload.update(
        {
            "schema_version": str(
                source_inventory.get("schema_version")
                or MEDIA_EXTRACTION_CLOSEOUT_INVENTORY_SCHEMA_VERSION
            ),
            "generated_at": generated_at,
            "generated_by": generated_by,
            "mode": "dry_run",
            "write_enabled": False,
            "candidate_count": len(candidates),
            "counts_by_status": _counter(candidates, "status"),
            "counts_by_processing_family": _counter(candidates, "processing_family"),
            "counts_by_media_kind": _counter(candidates, "media_kind"),
            "counts_by_priority": _counter(candidates, "priority"),
            "nonterminal_blocking_count": sum(
                1 for item in candidates if bool(item.get("target_blocking"))
            ),
            "candidates": [dict(item) for item in candidates],
        }
    )
    return payload


def _closeout_report(
    *,
    candidate_inventory: Mapping[str, Any],
    result_manifests: Sequence[Mapping[str, Any]],
    updated_candidate_count: int,
    terminalized_candidate_count: int,
    orphan_results: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    candidates = tuple(_mapping_rows(candidate_inventory.get("candidates")))
    return {
        "schema_version": MEDIA_EXTRACTION_CLOSEOUT_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "input_result_manifest_count": len(result_manifests),
        "candidate_count": len(candidates),
        "updated_candidate_count": updated_candidate_count,
        "terminalized_candidate_count": terminalized_candidate_count,
        "orphan_result_count": len(orphan_results),
        "nonterminal_blocking_count": sum(1 for item in candidates if item.get("target_blocking")),
        "counts_by_status": _counter(candidates, "status"),
        "orphan_results": [dict(row) for row in orphan_results],
    }


def _normalize_status(status: str) -> str:
    normalized = status.strip()
    if normalized in {"completed", "skipped", "failed", "failed_terminal", "pending"}:
        return normalized
    return "pending"


def _clean_reason_codes(values: Sequence[object]) -> list[str]:
    return list(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


def _counter(rows: Sequence[Mapping[str, Any]], key: str) -> dict[str, int]:
    return dict(Counter(str(row.get(key) or "") for row in rows))


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object expected at {path}")
    return dict(payload)


__all__ = [
    "MEDIA_EXTRACTION_CLOSEOUT_INVENTORY_SCHEMA_VERSION",
    "MEDIA_EXTRACTION_CLOSEOUT_REPORT_SCHEMA_VERSION",
    "MEDIA_EXTRACTION_CLOSEOUT_RESULT_MANIFEST_SCHEMA_VERSION",
    "MEDIA_EXTRACTION_CLOSEOUT_TERMINAL_STATUSES",
    "apply_media_extraction_closeout_result_manifests",
    "apply_media_extraction_closeout_result_manifests_from_paths",
    "build_owner_text_media_extraction_closeout_result_manifest",
    "build_schedule_image_ocr_media_extraction_closeout_result_manifest",
    "closeout_output_files",
]
