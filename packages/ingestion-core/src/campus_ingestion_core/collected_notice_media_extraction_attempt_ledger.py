from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_media_lifecycle import (
    normalize_media_lifecycle_status,
)

MEDIA_EXTRACTION_ATTEMPT_LEDGER_SCHEMA_VERSION = "notice_media_extraction_attempt_ledger.v1"
DEFAULT_RETRY_MAX_ATTEMPTS = 3


def build_media_extraction_attempt_ledger_from_paths(
    *,
    candidate_inventory_path: Path,
    attempt_plan_path: Path,
    generated_by: str = (
        "campus_ingestion_worker.build_collected_notice_media_extraction_attempt_ledger"
    ),
) -> dict[str, Any]:
    return build_media_extraction_attempt_ledger(
        candidate_inventory=_load_json_object(candidate_inventory_path),
        attempt_plan=_load_json_object(attempt_plan_path),
        generated_by=generated_by,
    )


def build_media_extraction_attempt_ledger(
    *,
    candidate_inventory: Mapping[str, Any],
    attempt_plan: Mapping[str, Any],
    generated_at: str | None = None,
    generated_by: str = (
        "campus_ingestion_worker.build_collected_notice_media_extraction_attempt_ledger"
    ),
    max_attempts: int = DEFAULT_RETRY_MAX_ATTEMPTS,
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    candidates_by_id = {
        str(candidate.get("candidate_id") or ""): candidate
        for candidate in _mapping_rows(candidate_inventory.get("candidates"))
        if str(candidate.get("candidate_id") or "")
    }
    attempts = [
        _attempt_row(attempt, candidates_by_id=candidates_by_id, max_attempts=max_attempts)
        for attempt in _mapping_rows(attempt_plan.get("attempts"))
    ]
    return {
        "schema_version": MEDIA_EXTRACTION_ATTEMPT_LEDGER_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "attempt_count": len(attempts),
        "counts_by_status": dict(
            sorted(Counter(str(row.get("status") or "") for row in attempts).items())
        ),
        "attempts": attempts,
    }


def attempt_ledger_output_files(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {"media-extraction-attempt-ledger.json": dict(payload)}


def _attempt_row(
    attempt: Mapping[str, Any],
    *,
    candidates_by_id: Mapping[str, Mapping[str, Any]],
    max_attempts: int,
) -> dict[str, Any]:
    candidate_id = _text(attempt.get("candidate_id"))
    if not candidate_id:
        raise ValueError("attempt candidate_id is required")
    candidate = candidates_by_id.get(candidate_id, {})
    if not candidate:
        raise ValueError(f"attempt references unknown candidate_id: {candidate_id}")
    attempt_number = _positive_int(attempt.get("attempt_number"), default=1)
    status = _attempt_status(attempt)
    source_ref = _source_object_ref(attempt, candidate)
    output_refs = _output_refs(attempt, candidate)
    row = {
        "attempt_id": _text(attempt.get("attempt_id"))
        or f"{candidate_id}:attempt:{attempt_number}",
        "candidate_id": candidate_id,
        "unit_id": _text(attempt.get("unit_id")) or _text(candidate.get("unit_id")),
        "source_notice_id": _text(attempt.get("source_notice_id"))
        or _text(candidate.get("source_notice_id")),
        "media_ref_id": _text(attempt.get("media_ref_id")) or _text(candidate.get("media_ref_id")),
        "processing_family": _text(attempt.get("processing_family"))
        or _text(candidate.get("processing_family")),
        "attempt_number": attempt_number,
        "status": status,
        "retry_policy": {
            "max_attempts": max_attempts,
            "backoff": "exponential_with_jitter",
            "retryable_statuses": ["pending", "failed_retryable"],
        },
        "retry_budget_remaining": max(max_attempts - attempt_number, 0),
        "next_retry_after": _text(attempt.get("next_retry_after")),
        "terminal_reason": _text(attempt.get("terminal_reason")),
        "manual_review_reason": _text(attempt.get("manual_review_reason")),
        "source_object_ref": source_ref,
        "source_object_hash": _text(source_ref.get("sha256") or source_ref.get("content_sha256")),
        "output_refs": output_refs,
        "attempt_ledger": dict(
            attempt.get("attempt_ledger") or candidate.get("attempt_ledger") or {}
        ),
        "reason_codes": list(attempt.get("reason_codes") or candidate.get("reason_codes") or ()),
    }
    if not row["next_retry_after"] and status in {"pending", "failed_retryable"}:
        row["next_retry_after"] = _text(attempt.get("scheduled_after"))
    return row


def _attempt_status(attempt: Mapping[str, Any]) -> str:
    raw = attempt.get("status", attempt.get("state"))
    return normalize_media_lifecycle_status(raw)


def _source_object_ref(
    attempt: Mapping[str, Any],
    candidate: Mapping[str, Any],
) -> dict[str, Any]:
    for value in (attempt.get("source_object_ref"), candidate.get("source_object_ref")):
        if isinstance(value, Mapping):
            return dict(value)
    return {}


def _output_refs(
    attempt: Mapping[str, Any],
    candidate: Mapping[str, Any],
) -> dict[str, Any]:
    for key in ("output_refs", "written_refs", "normalized_output_refs"):
        value = attempt.get(key)
        if isinstance(value, Mapping) and value:
            return dict(value)
    value = candidate.get("normalized_output_refs")
    return dict(value) if isinstance(value, Mapping) else {}


def _positive_int(value: object, *, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(row for row in value if isinstance(row, Mapping))


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object expected at {path}")
    return dict(payload)


__all__ = [
    "MEDIA_EXTRACTION_ATTEMPT_LEDGER_SCHEMA_VERSION",
    "attempt_ledger_output_files",
    "build_media_extraction_attempt_ledger",
    "build_media_extraction_attempt_ledger_from_paths",
]
