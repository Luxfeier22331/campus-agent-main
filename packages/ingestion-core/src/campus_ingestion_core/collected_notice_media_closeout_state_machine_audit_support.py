from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_media_lifecycle import (
    MEDIA_LIFECYCLE_COMPLETED,
    normalize_media_lifecycle_status,
)

FINDING_HIGH = "high"
FINDING_MEDIUM = "medium"
FINDING_LOW = "low"


def cleanup_selected_rows(cleanup_report: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    rows: list[Mapping[str, Any]] = []
    for key in (
        "dry_run_objects",
        "deleted_objects",
        "dry_run_rows",
        "deleted_rows",
        "candidates",
    ):
        rows.extend(mapping_rows(cleanup_report.get(key)))
    return tuple(rows)


def cleanup_protected_refs(cleanup_report: Mapping[str, Any]) -> set[tuple[str, str]]:
    rows: list[Mapping[str, Any]] = []
    for key in (
        "blocked_quarantine_objects",
        "protected_objects",
        "retained_objects",
        "skipped_active_objects",
    ):
        rows.extend(mapping_rows(cleanup_report.get(key)))
    return {ref for row in rows if (ref := cleanup_object_identity(row))}


def cleanup_object_identity(row: Mapping[str, Any]) -> tuple[str, str] | None:
    bucket = str(row.get("bucket") or "").strip()
    key = cleanup_object_key(row)
    if not bucket or not key:
        return None
    return (bucket, key)


def object_key(row: Mapping[str, Any]) -> str:
    source_ref = row.get("source_object_ref")
    if not isinstance(source_ref, Mapping):
        return ""
    return str(source_ref.get("key") or "").strip()


def object_ref_identity(row: Mapping[str, Any]) -> tuple[str, str] | None:
    bucket = object_bucket(row)
    key = object_key(row) or str(row.get("object_key") or row.get("key") or "").strip()
    if not bucket or not key:
        return None
    return (bucket, key)


def source_hash(row: Mapping[str, Any]) -> str:
    source_ref = row.get("source_object_ref")
    if isinstance(source_ref, Mapping):
        value = source_ref.get("sha256") or source_ref.get("content_sha256")
        if value:
            return str(value).strip()
    return str(
        row.get("source_object_hash")
        or row.get("sha256")
        or row.get("content_sha256")
        or row.get("expected_sha256")
        or ""
    ).strip()


def byte_size(row: Mapping[str, Any]) -> int:
    source_ref = row.get("source_object_ref")
    if isinstance(source_ref, Mapping):
        size = int_value(source_ref.get("byte_size") or source_ref.get("size"))
        if size > 0:
            return size
    return int_value(row.get("byte_size") or row.get("size") or row.get("expected_byte_size"))


def storage_provider(row: Mapping[str, Any]) -> str:
    source_ref = row.get("source_object_ref")
    if isinstance(source_ref, Mapping):
        value = source_ref.get("storage_provider")
        if value:
            return str(value).strip()
    return str(row.get("storage_provider") or "").strip()


def is_reference_only_object(row: Mapping[str, Any]) -> bool:
    source_ref = row.get("source_object_ref")
    if isinstance(source_ref, Mapping) and isinstance(source_ref.get("reference_only"), bool):
        return bool(source_ref.get("reference_only"))
    return bool(row.get("reference_only"))


def has_output_refs(row: Mapping[str, Any]) -> bool:
    for key in ("completed_output_refs", "output_refs", "written_refs"):
        value = row.get(key)
        if isinstance(value, Mapping) and value:
            return True
    return False


def closeout_attempt_provenance(row: Mapping[str, Any]) -> bool:
    closeout = row.get("closeout")
    if isinstance(closeout, Mapping) and (
        str(closeout.get("attempt_id") or "").strip()
        or str(closeout.get("attempt_number") or "").strip()
    ):
        return True
    return bool(
        str(row.get("attempt_id") or "").strip() or str(row.get("attempt_number") or "").strip()
    )


def closeout_attempt_provenance_matches(
    row: Mapping[str, Any],
    attempts: Sequence[Mapping[str, Any]],
) -> bool:
    attempt_id, attempt_number = closeout_attempt_identity(row)
    for attempt in attempts:
        if status(attempt) != MEDIA_LIFECYCLE_COMPLETED:
            continue
        if attempt_id and attempt_id == str(attempt.get("attempt_id") or "").strip():
            return True
        if attempt_number is not None and attempt_number == int_value(
            attempt.get("attempt_number")
        ):
            return True
    return False


def candidate_targets(candidate: Mapping[str, Any]) -> set[str]:
    values = {
        str(value).strip() for value in candidate.get("target_hints") or () if str(value).strip()
    }
    value = str(candidate.get("target") or "").strip()
    if value:
        values.add(value)
    return values or {"unknown"}


def canonical_candidate(row: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(row)
    payload["status"] = status(payload)
    return payload


def canonical_attempt(row: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(row)
    payload["status"] = status(payload)
    return payload


def status(row: Mapping[str, Any]) -> str:
    return normalize_media_lifecycle_status(row.get("status") or row.get("media_text_status"))


def attempts_by_candidate(
    attempts: Sequence[Mapping[str, Any]],
) -> dict[str, tuple[Mapping[str, Any], ...]]:
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for attempt in attempts:
        grouped[str(attempt.get("candidate_id") or "")].append(attempt)
    return {key: tuple(value) for key, value in grouped.items()}


def int_value(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def finding(
    severity: str,
    code: str,
    row: Mapping[str, Any],
    detail: str,
) -> dict[str, Any]:
    return {
        "severity": severity,
        "code": code,
        "candidate_id": str(row.get("candidate_id") or ""),
        "unit_id": str(row.get("unit_id") or ""),
        "source_notice_id": str(row.get("source_notice_id") or ""),
        "media_ref_id": str(row.get("media_ref_id") or ""),
        "source_object_key": object_key(row),
        "detail": detail,
    }


def system_finding(severity: str, code: str, detail: str) -> dict[str, Any]:
    return {
        "severity": severity,
        "code": code,
        "candidate_id": "",
        "unit_id": "",
        "source_notice_id": "",
        "media_ref_id": "",
        "source_object_key": "",
        "detail": detail,
    }


def object_verification_findings(
    *,
    candidates: Sequence[Mapping[str, Any]],
    object_verification_report: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    if object_verification_report is None:
        return []
    verified_rows = {
        object_ref_identity(row): row
        for row in mapping_rows(object_verification_report.get("rows"))
        if object_ref_identity(row)
    }
    findings: list[dict[str, Any]] = []
    for candidate in candidates:
        identity = object_ref_identity(candidate)
        if not identity:
            continue
        verified = verified_rows.get(identity)
        if verified is None or str(verified.get("status") or "").strip() != "verified":
            findings.append(
                finding(
                    FINDING_HIGH,
                    "candidate_source_object_not_verified",
                    candidate,
                    "candidate source_object_ref must be verified before live execution gate",
                )
            )
            continue
        if is_reference_only_object(verified):
            findings.append(
                finding(
                    FINDING_HIGH,
                    "candidate_source_object_verified_as_reference_only",
                    candidate,
                    "candidate source object verification must not be reference_only",
                )
            )
        if storage_provider(verified) in {"", "reference_only"}:
            findings.append(
                finding(
                    FINDING_HIGH,
                    "candidate_source_object_invalid_storage_provider",
                    candidate,
                    "candidate source object verification must carry object-backed storage provider",
                )
            )
        check_method = str(verified.get("check_method") or "").strip()
        if check_method not in {"head_checksum", "get_hash"}:
            findings.append(
                finding(
                    FINDING_HIGH,
                    "candidate_source_object_verification_not_live_checked",
                    candidate,
                    "candidate source object verification must be backed by live HEAD checksum or GET hash",
                )
            )
        if not str(verified.get("live_checked_at") or "").strip():
            findings.append(
                finding(
                    FINDING_HIGH,
                    "candidate_source_object_verification_missing_live_checked_at",
                    candidate,
                    "candidate source object verification must record live_checked_at",
                )
            )
        candidate_hash = source_hash(candidate)
        verified_hash = source_hash(verified)
        if not candidate_hash or not verified_hash:
            findings.append(
                finding(
                    FINDING_HIGH,
                    "candidate_source_object_verification_missing_hash",
                    candidate,
                    "candidate source object verification must carry candidate and verified hash",
                )
            )
        elif candidate_hash != verified_hash:
            findings.append(
                finding(
                    FINDING_HIGH,
                    "candidate_source_object_hash_mismatch",
                    candidate,
                    "candidate source object verification hash must match candidate source hash",
                )
            )
        candidate_size = byte_size(candidate)
        verified_size = byte_size(verified)
        if candidate_size <= 0 or verified_size <= 0:
            findings.append(
                finding(
                    FINDING_HIGH,
                    "candidate_source_object_verification_missing_size",
                    candidate,
                    "candidate source object verification must carry candidate and verified byte size",
                )
            )
        elif candidate_size != verified_size:
            findings.append(
                finding(
                    FINDING_HIGH,
                    "candidate_source_object_size_mismatch",
                    candidate,
                    "candidate source object verification byte size must match candidate source byte size",
                )
            )
    return findings


def has_medium_or_high(findings: Sequence[Mapping[str, Any]]) -> bool:
    return any(str(row.get("severity") or "") in {FINDING_HIGH, FINDING_MEDIUM} for row in findings)


def severity_rank(value: str) -> int:
    return {FINDING_HIGH: 0, FINDING_MEDIUM: 1, FINDING_LOW: 2}.get(value, 99)


def mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(row for row in value if isinstance(row, Mapping))


def load_json_object(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object expected at {path}")
    return dict(payload)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cleanup_object_key(row: Mapping[str, Any]) -> str:
    return str(row.get("object_key") or row.get("key") or "").strip()


def object_bucket(row: Mapping[str, Any]) -> str:
    source_ref = row.get("source_object_ref")
    if isinstance(source_ref, Mapping):
        return str(source_ref.get("bucket") or "").strip()
    return str(row.get("bucket") or "").strip()


def closeout_attempt_identity(row: Mapping[str, Any]) -> tuple[str, int | None]:
    closeout = row.get("closeout")
    if isinstance(closeout, Mapping):
        attempt_id = str(closeout.get("attempt_id") or "").strip()
        attempt_number = positive_int_or_none(closeout.get("attempt_number"))
        if attempt_id or attempt_number is not None:
            return attempt_id, attempt_number
    return (
        str(row.get("attempt_id") or "").strip(),
        positive_int_or_none(row.get("attempt_number")),
    )


def positive_int_or_none(value: object) -> int | None:
    parsed = int_value(value)
    return parsed if parsed > 0 else None


__all__ = [
    "attempts_by_candidate",
    "byte_size",
    "candidate_targets",
    "canonical_attempt",
    "canonical_candidate",
    "cleanup_object_identity",
    "cleanup_protected_refs",
    "cleanup_selected_rows",
    "closeout_attempt_provenance",
    "closeout_attempt_provenance_matches",
    "finding",
    "has_medium_or_high",
    "has_output_refs",
    "int_value",
    "is_reference_only_object",
    "load_json_object",
    "mapping_rows",
    "object_ref_identity",
    "severity_rank",
    "sha256_file",
    "source_hash",
    "status",
    "storage_provider",
    "system_finding",
]
