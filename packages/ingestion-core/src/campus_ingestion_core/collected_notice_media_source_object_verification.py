from __future__ import annotations

import base64
import hashlib
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Protocol

from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.settings import ObjectStoreSettings

MEDIA_SOURCE_OBJECT_VERIFICATION_REPORT_SCHEMA_VERSION = (
    "notice_media_source_object_verification_report.v1"
)


class CollectedNoticeMediaSourceObjectVerifier(Protocol):
    def head_object(self, *, bucket: str, key: str) -> Mapping[str, Any]: ...

    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class CollectedNoticeMediaSourceObjectS3Verifier:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._client = S3ObjectStoreClientFactory(settings).create()

    def head_object(self, *, bucket: str, key: str) -> Mapping[str, Any]:
        response = self._client.head_object(Bucket=bucket, Key=key, ChecksumMode="ENABLED")
        return {
            "content_length": int(response.get("ContentLength") or 0),
            "metadata": dict(response.get("Metadata") or {}),
            "etag": response.get("ETag"),
            "checksum_sha256": response.get("ChecksumSHA256"),
            "ChecksumSHA256": response.get("ChecksumSHA256"),
        }

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()


def build_collected_notice_media_source_object_verification_report(
    *,
    candidate_inventory: Mapping[str, Any],
    object_store: CollectedNoticeMediaSourceObjectVerifier,
    checked_at: str | None = None,
    allow_get_hash: bool = True,
) -> dict[str, Any]:
    live_checked_at = checked_at or datetime.now(UTC).isoformat()
    rows = [
        _verify_candidate_source_object(
            candidate=candidate,
            object_store=object_store,
            checked_at=live_checked_at,
            allow_get_hash=allow_get_hash,
        )
        for candidate in _unique_source_object_candidates(candidate_inventory)
    ]
    status_counts: dict[str, int] = {}
    for row in rows:
        status = str(row.get("status") or "")
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "schema_version": MEDIA_SOURCE_OBJECT_VERIFICATION_REPORT_SCHEMA_VERSION,
        "generated_at": live_checked_at,
        "candidate_count": len(_mapping_rows(candidate_inventory.get("candidates"))),
        "row_count": len(rows),
        "verified_count": status_counts.get("verified", 0),
        "status_counts": dict(sorted(status_counts.items())),
        "rows": rows,
    }


def _unique_source_object_candidates(
    candidate_inventory: Mapping[str, Any],
) -> tuple[Mapping[str, Any], ...]:
    selected: list[Mapping[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for candidate in _mapping_rows(candidate_inventory.get("candidates")):
        source_ref = candidate.get("source_object_ref")
        if not isinstance(source_ref, Mapping):
            selected.append(candidate)
            continue
        bucket = str(source_ref.get("bucket") or "").strip()
        key = str(source_ref.get("key") or "").strip()
        identity = (bucket, key)
        if bucket and key and identity in seen:
            continue
        if bucket and key:
            seen.add(identity)
        selected.append(candidate)
    return tuple(selected)


def _verify_candidate_source_object(
    *,
    candidate: Mapping[str, Any],
    object_store: CollectedNoticeMediaSourceObjectVerifier,
    checked_at: str,
    allow_get_hash: bool,
) -> dict[str, Any]:
    source_ref = candidate.get("source_object_ref")
    if not isinstance(source_ref, Mapping):
        return _base_row(candidate, {}, checked_at) | {
            "status": "missing_source_object_ref",
            "check_method": "not_checked",
            "error": "source_object_ref is required",
        }
    bucket = str(source_ref.get("bucket") or "").strip()
    key = str(source_ref.get("key") or "").strip()
    row = _base_row(candidate, source_ref, checked_at)
    if not bucket or not key:
        return row | {
            "status": "missing_source_object_ref",
            "check_method": "not_checked",
            "error": "source_object_ref bucket and key are required",
        }
    try:
        head = dict(object_store.head_object(bucket=bucket, key=key))
    except Exception as exc:
        return row | {
            "status": "missing" if _is_missing_object_error(exc) else "head_failed",
            "check_method": "head",
            "error": str(exc),
        }
    head_size = _head_content_length(head)
    head_hash = _extract_head_sha256(head)
    if head_hash:
        actual_hash = head_hash
        actual_size = head_size
        check_method = "head_checksum"
    elif allow_get_hash:
        data = object_store.get_bytes(bucket=bucket, key=key)
        actual_hash = hashlib.sha256(data).hexdigest()
        actual_size = len(data)
        check_method = "get_hash"
    else:
        actual_hash = ""
        actual_size = head_size
        check_method = "head"
    expected_hash = str(row.get("expected_sha256") or "")
    expected_size = int(row.get("expected_byte_size") or 0)
    status = "verified"
    if expected_hash and actual_hash and expected_hash != actual_hash:
        status = "hash_mismatch"
    if expected_size > 0 and actual_size > 0 and expected_size != actual_size:
        status = "size_mismatch"
    if not actual_hash:
        status = "missing_hash"
    if actual_size <= 0:
        status = "missing_size"
    return row | {
        "status": status,
        "sha256": actual_hash,
        "byte_size": actual_size,
        "check_method": check_method,
        "etag": _optional_text(head.get("etag") or head.get("ETag")),
    }


def _base_row(
    candidate: Mapping[str, Any],
    source_ref: Mapping[str, Any],
    checked_at: str,
) -> dict[str, Any]:
    return {
        "candidate_id": str(candidate.get("candidate_id") or ""),
        "unit_id": str(candidate.get("unit_id") or ""),
        "source_notice_id": str(candidate.get("source_notice_id") or ""),
        "media_ref_id": str(candidate.get("media_ref_id") or ""),
        "bucket": str(source_ref.get("bucket") or "").strip(),
        "object_key": str(source_ref.get("key") or "").strip(),
        "expected_sha256": _source_hash(source_ref, candidate),
        "expected_byte_size": _source_size(source_ref, candidate),
        "storage_provider": _storage_provider(source_ref, candidate),
        "reference_only": _reference_only(source_ref, candidate),
        "live_checked_at": checked_at,
    }


def _extract_head_sha256(head: Mapping[str, Any]) -> str:
    direct = _optional_text(
        head.get("sha256")
        or head.get("content_sha256")
        or head.get("checksum_sha256_hex")
        or head.get("ChecksumSHA256Hex")
    )
    if direct and _looks_like_sha256_hex(direct):
        return direct.lower()
    metadata = head.get("metadata") or head.get("Metadata") or {}
    if isinstance(metadata, Mapping):
        metadata_hash = _optional_text(
            metadata.get("sha256")
            or metadata.get("content_sha256")
            or metadata.get("content-sha256")
        )
        if metadata_hash and _looks_like_sha256_hex(metadata_hash):
            return metadata_hash.lower()
    checksum = _optional_text(head.get("checksum_sha256") or head.get("ChecksumSHA256"))
    if checksum:
        if _looks_like_sha256_hex(checksum):
            return checksum.lower()
        try:
            return base64.b64decode(checksum).hex()
        except Exception:
            return ""
    return ""


def _head_content_length(head: Mapping[str, Any]) -> int:
    return _int(head.get("content_length") or head.get("ContentLength"))


def _source_hash(source_ref: Mapping[str, Any], candidate: Mapping[str, Any]) -> str:
    return str(
        source_ref.get("sha256")
        or source_ref.get("content_sha256")
        or candidate.get("source_object_hash")
        or candidate.get("sha256")
        or candidate.get("content_sha256")
        or ""
    ).strip()


def _source_size(source_ref: Mapping[str, Any], candidate: Mapping[str, Any]) -> int:
    size = _int(source_ref.get("byte_size") or source_ref.get("size"))
    if size > 0:
        return size
    return _int(candidate.get("byte_size") or candidate.get("size"))


def _storage_provider(source_ref: Mapping[str, Any], candidate: Mapping[str, Any]) -> str:
    explicit = str(
        source_ref.get("storage_provider") or candidate.get("storage_provider") or ""
    ).strip()
    if explicit:
        return explicit
    if str(source_ref.get("bucket") or "").strip() and str(source_ref.get("key") or "").strip():
        return "object_store"
    return ""


def _reference_only(source_ref: Mapping[str, Any], candidate: Mapping[str, Any]) -> bool:
    if isinstance(source_ref.get("reference_only"), bool):
        return bool(source_ref.get("reference_only"))
    return bool(candidate.get("reference_only"))


def _optional_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _looks_like_sha256_hex(value: str) -> bool:
    normalized = str(value or "").strip().lower()
    return len(normalized) == 64 and all(char in "0123456789abcdef" for char in normalized)


def _int(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(row for row in value if isinstance(row, Mapping))


def _is_missing_object_error(exc: Exception) -> bool:
    if isinstance(exc, KeyError):
        return True
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    error = response.get("Error")
    if not isinstance(error, dict):
        return False
    code = str(error.get("Code") or "").strip()
    return code in {"404", "NoSuchKey", "NotFound"}


__all__ = [
    "MEDIA_SOURCE_OBJECT_VERIFICATION_REPORT_SCHEMA_VERSION",
    "CollectedNoticeMediaSourceObjectS3Verifier",
    "CollectedNoticeMediaSourceObjectVerifier",
    "build_collected_notice_media_source_object_verification_report",
]
