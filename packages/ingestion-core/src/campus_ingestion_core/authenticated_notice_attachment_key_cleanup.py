from __future__ import annotations

import json
import os
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol, TextIO

from campus_ingestion_core.collected_notice_media_lifecycle import (
    is_media_lifecycle_cleanup_blocking,
)
from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.settings import ObjectStoreSettings

LEGACY_ATTACHMENT_OBJECT_KEY_RE = re.compile(r"^[0-9a-f]{2}/[0-9a-f]{64}/[^/]+$")
MEDIA_EXTRACTION_CLEANUP_TERMINAL_STATUSES = frozenset({"completed", "skipped", "failed_terminal"})


class AuthenticatedNoticeAttachmentKeyCleanupObjectStore(Protocol):
    def head_object(self, *, bucket: str, key: str) -> dict[str, Any]: ...

    def delete_object(self, *, bucket: str, key: str) -> None: ...


class AuthenticatedNoticeAttachmentKeyCleanupS3ObjectStore:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._factory = S3ObjectStoreClientFactory(settings)
        self._client = self._factory.create()

    def head_object(self, *, bucket: str, key: str) -> dict[str, Any]:
        return dict(self._client.head_object(Bucket=bucket, Key=key))

    def delete_object(self, *, bucket: str, key: str) -> None:
        self._client.delete_object(Bucket=bucket, Key=key)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentKeyCleanupRequest:
    unreferenced_inventory_path: Path
    output_dir: Path
    dry_run: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "unreferenced_inventory_path",
            Path(self.unreferenced_inventory_path),
        )
        object.__setattr__(self, "output_dir", Path(self.output_dir))


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeQuarantineAttachmentCleanupRequest:
    attachment_refs_path: Path
    output_dir: Path
    now: str
    dry_run: bool = False
    media_extraction_candidate_inventory_path: Path | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "attachment_refs_path", Path(self.attachment_refs_path))
        object.__setattr__(self, "output_dir", Path(self.output_dir))
        if self.media_extraction_candidate_inventory_path is not None:
            object.__setattr__(
                self,
                "media_extraction_candidate_inventory_path",
                Path(self.media_extraction_candidate_inventory_path),
            )


def cleanup_authenticated_notice_source_attachment_keys(
    *,
    request: AuthenticatedNoticeAttachmentKeyCleanupRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeAttachmentKeyCleanupObjectStore | None = None,
    stderr: TextIO | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or AuthenticatedNoticeAttachmentKeyCleanupS3ObjectStore(
        settings
    )
    log_output = stderr if stderr is not None else sys.stderr
    candidates, inventory_row_count = _load_candidates(request.unreferenced_inventory_path)

    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    deleted_path = output_dir / "deleted-objects.jsonl"
    already_absent_path = output_dir / "already-absent-objects.jsonl"
    dry_run_path = output_dir / "dry-run-objects.jsonl"
    summary_path = output_dir / "summary.json"

    deleted_rows: list[dict[str, Any]] = []
    already_absent_rows: list[dict[str, Any]] = []
    dry_run_rows: list[dict[str, Any]] = []
    total = len(candidates)
    for completed, legacy_object_key in enumerate(candidates, start=1):
        if request.dry_run:
            result = {
                "status": "dry_run",
                "bucket": settings.bucket_source,
                "legacy_object_key": legacy_object_key,
            }
        else:
            result = _cleanup_candidate(
                bucket=settings.bucket_source,
                legacy_object_key=legacy_object_key,
                object_store=runtime_object_store,
            )
        if result["status"] == "deleted":
            deleted_rows.append(result)
        elif result["status"] == "already_absent":
            already_absent_rows.append(result)
        elif result["status"] == "dry_run":
            dry_run_rows.append(result)
        else:  # pragma: no cover
            raise ValueError(f"unsupported cleanup result status: {result['status']}")
        if completed == total or completed % 100 == 0:
            print(
                (
                    "[authenticated-notice-attachment-key-cleanup] "
                    f"completed={completed}/{total} deleted={len(deleted_rows)} "
                    f"already_absent={len(already_absent_rows)}"
                ),
                file=log_output,
            )

    deleted_rows_sorted = sorted(
        deleted_rows,
        key=lambda row: str(row["legacy_object_key"]),
    )
    already_absent_rows_sorted = sorted(
        already_absent_rows,
        key=lambda row: str(row["legacy_object_key"]),
    )
    dry_run_rows_sorted = sorted(
        dry_run_rows,
        key=lambda row: str(row["legacy_object_key"]),
    )
    _write_jsonl(deleted_path, deleted_rows_sorted)
    _write_jsonl(already_absent_path, already_absent_rows_sorted)
    _write_jsonl(dry_run_path, dry_run_rows_sorted)
    summary = {
        "unreferenced_inventory_path": str(request.unreferenced_inventory_path),
        "output_dir": str(output_dir),
        "dry_run": request.dry_run,
        "inventory_row_count": inventory_row_count,
        "candidate_count": len(candidates),
        "deleted_count": len(deleted_rows_sorted),
        "already_absent_count": len(already_absent_rows_sorted),
        "dry_run_count": len(dry_run_rows_sorted),
        "deleted_inventory_path": str(deleted_path),
        "already_absent_inventory_path": str(already_absent_path),
        "dry_run_inventory_path": str(dry_run_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def cleanup_authenticated_notice_quarantine_attachment_keys(
    *,
    request: AuthenticatedNoticeQuarantineAttachmentCleanupRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeAttachmentKeyCleanupObjectStore | None = None,
    stderr: TextIO | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or AuthenticatedNoticeAttachmentKeyCleanupS3ObjectStore(
        settings
    )
    log_output = stderr if stderr is not None else sys.stderr
    rows = _load_jsonl_rows(request.attachment_refs_path)
    blockers = _load_media_extraction_cleanup_blockers(
        request.media_extraction_candidate_inventory_path,
        default_bucket=settings.bucket_source,
    )
    candidates, blocked_rows = _load_quarantine_cleanup_candidates(
        rows,
        now=request.now,
        default_bucket=settings.bucket_source,
        media_extraction_blockers=blockers,
    )

    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    deleted_path = output_dir / "deleted-quarantine-objects.jsonl"
    already_absent_path = output_dir / "already-absent-quarantine-objects.jsonl"
    dry_run_path = output_dir / "dry-run-quarantine-objects.jsonl"
    blocked_path = output_dir / "blocked-quarantine-objects.jsonl"
    summary_path = output_dir / "quarantine-summary.json"

    deleted_rows: list[dict[str, Any]] = []
    already_absent_rows: list[dict[str, Any]] = []
    dry_run_rows: list[dict[str, Any]] = []
    total = len(candidates)
    for completed, candidate in enumerate(candidates, start=1):
        bucket = _normalize_optional_text(candidate.get("bucket")) or settings.bucket_source
        object_key = _required_text(candidate.get("object_key"), label="object_key")
        if request.dry_run:
            result = {
                **candidate,
                "bucket": bucket,
                "status": "dry_run",
            }
        else:
            result = _cleanup_quarantine_candidate(
                bucket=bucket,
                candidate=candidate,
                object_key=object_key,
                object_store=runtime_object_store,
            )
        if result["status"] == "deleted":
            deleted_rows.append(result)
        elif result["status"] == "already_absent":
            already_absent_rows.append(result)
        elif result["status"] == "dry_run":
            dry_run_rows.append(result)
        else:  # pragma: no cover
            raise ValueError(f"unsupported quarantine cleanup status: {result['status']}")
        if completed == total or completed % 100 == 0:
            print(
                (
                    "[authenticated-notice-quarantine-attachment-cleanup] "
                    f"completed={completed}/{total} deleted={len(deleted_rows)} "
                    f"already_absent={len(already_absent_rows)}"
                ),
                file=log_output,
            )

    deleted_rows_sorted = sorted(deleted_rows, key=lambda row: str(row["object_key"]))
    already_absent_rows_sorted = sorted(
        already_absent_rows,
        key=lambda row: str(row["object_key"]),
    )
    dry_run_rows_sorted = sorted(dry_run_rows, key=lambda row: str(row["object_key"]))
    _write_jsonl(deleted_path, deleted_rows_sorted)
    _write_jsonl(already_absent_path, already_absent_rows_sorted)
    _write_jsonl(dry_run_path, dry_run_rows_sorted)
    _write_jsonl(blocked_path, blocked_rows)
    summary = {
        "attachment_refs_path": str(request.attachment_refs_path),
        "media_extraction_candidate_inventory_path": (
            str(request.media_extraction_candidate_inventory_path)
            if request.media_extraction_candidate_inventory_path
            else ""
        ),
        "output_dir": str(output_dir),
        "now": request.now,
        "dry_run": request.dry_run,
        "input_row_count": len(rows),
        "candidate_count": len(candidates),
        "blocked_by_media_extraction_count": len(blocked_rows),
        "deleted_count": len(deleted_rows_sorted),
        "already_absent_count": len(already_absent_rows_sorted),
        "dry_run_count": len(dry_run_rows_sorted),
        "deleted_inventory_path": str(deleted_path),
        "already_absent_inventory_path": str(already_absent_path),
        "dry_run_inventory_path": str(dry_run_path),
        "blocked_quarantine_inventory_path": str(blocked_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def _load_candidates(path: Path) -> tuple[tuple[str, ...], int]:
    rows = _load_jsonl_rows(path)
    inventory_row_count = len(rows)
    candidates: list[str] = []
    seen: set[str] = set()
    for row in rows:
        legacy_object_key = _required_text(
            row.get("legacy_object_key"),
            label="legacy_object_key",
        )
        if not _is_legacy_attachment_object_key(legacy_object_key):
            raise ValueError(f"{legacy_object_key} must be a legacy attachment object key")
        if legacy_object_key in seen:
            continue
        seen.add(legacy_object_key)
        candidates.append(legacy_object_key)
    return tuple(sorted(candidates)), inventory_row_count


def _load_quarantine_cleanup_candidates(
    rows: tuple[dict[str, Any], ...],
    *,
    now: str,
    default_bucket: str,
    media_extraction_blockers: Mapping[tuple[str, str], tuple[dict[str, str], ...]],
) -> tuple[tuple[dict[str, Any], ...], tuple[dict[str, Any], ...]]:
    now_dt = _parse_timestamp(now, label="now")
    candidates: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    seen: set[tuple[str | None, str]] = set()
    for row in rows:
        if _normalize_optional_text(row.get("retention_class")) != "quarantine_candidate":
            continue
        if bool(row.get("required_source_object")):
            continue
        promotion_state = _normalize_optional_text(row.get("attachment_promotion_state"))
        if promotion_state == "promoted":
            continue
        object_key = _normalize_optional_text(row.get("object_key"))
        if object_key is None:
            continue
        expires_at = _normalize_optional_text(row.get("retention_expires_at"))
        if expires_at is None:
            continue
        if _parse_timestamp(expires_at, label="retention_expires_at") > now_dt:
            continue
        bucket = _normalize_optional_text(row.get("bucket"))
        effective_bucket = bucket or default_bucket
        dedupe_key = (bucket, object_key)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        candidate = {
            "attachment_ref_id": _normalize_optional_text(row.get("attachment_ref_id")),
            "bucket": bucket,
            "object_key": object_key,
            "content_sha256": _normalize_optional_text(
                row.get("content_sha256") or row.get("sha256")
            ),
            "retention_expires_at": expires_at,
            "attachment_promotion_state": promotion_state,
        }
        blocking_candidates = media_extraction_blockers.get((effective_bucket, object_key), ())
        if blocking_candidates:
            blocked.append(
                {
                    **candidate,
                    "bucket": effective_bucket,
                    "blocked_by": "media_extraction_candidate",
                    "blocking_media_candidate_ids": [
                        str(item["candidate_id"]) for item in blocking_candidates
                    ],
                    "blocking_media_candidate_statuses": [
                        str(item["status"]) for item in blocking_candidates
                    ],
                }
            )
            continue
        candidates.append(candidate)
    return (
        tuple(sorted(candidates, key=lambda item: str(item["object_key"]))),
        tuple(sorted(blocked, key=lambda item: str(item["object_key"]))),
    )


def _load_media_extraction_cleanup_blockers(
    path: Path | None,
    *,
    default_bucket: str,
) -> dict[tuple[str, str], tuple[dict[str, str], ...]]:
    if path is None:
        return {}
    payload = _load_json_object(path)
    blockers: dict[tuple[str, str], list[dict[str, str]]] = {}
    for candidate in _mapping_rows(payload.get("candidates")):
        if not bool(candidate.get("target_blocking")):
            continue
        status = str(candidate.get("status") or "").strip()
        if not is_media_lifecycle_cleanup_blocking(status):
            continue
        source_ref = candidate.get("source_object_ref")
        if not isinstance(source_ref, Mapping):
            continue
        object_key = _normalize_optional_text(source_ref.get("key"))
        if object_key is None:
            continue
        bucket = _normalize_optional_text(source_ref.get("bucket")) or default_bucket
        blockers.setdefault((bucket, object_key), []).append(
            {
                "candidate_id": _normalize_optional_text(candidate.get("candidate_id")) or "",
                "status": status,
            }
        )
    return {
        key: tuple(sorted(value, key=lambda item: str(item["candidate_id"])))
        for key, value in blockers.items()
    }


def _cleanup_candidate(
    *,
    bucket: str,
    legacy_object_key: str,
    object_store: AuthenticatedNoticeAttachmentKeyCleanupObjectStore,
) -> dict[str, Any]:
    try:
        metadata = object_store.head_object(bucket=bucket, key=legacy_object_key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            return {
                "legacy_object_key": legacy_object_key,
                "status": "already_absent",
            }
        raise
    byte_size = _coerce_content_length(metadata, label=legacy_object_key)
    etag = _normalize_optional_text(_read_head_field(metadata, "ETag", "etag"))
    object_store.delete_object(bucket=bucket, key=legacy_object_key)
    try:
        object_store.head_object(bucket=bucket, key=legacy_object_key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            return {
                "legacy_object_key": legacy_object_key,
                "byte_size": byte_size,
                "etag": etag,
                "status": "deleted",
            }
        raise
    raise ValueError(f"{legacy_object_key} still exists after delete")


def _cleanup_quarantine_candidate(
    *,
    bucket: str,
    candidate: dict[str, Any],
    object_key: str,
    object_store: AuthenticatedNoticeAttachmentKeyCleanupObjectStore,
) -> dict[str, Any]:
    try:
        metadata = object_store.head_object(bucket=bucket, key=object_key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            return {
                **candidate,
                "bucket": bucket,
                "status": "already_absent",
            }
        raise
    byte_size = _coerce_content_length(metadata, label=object_key)
    etag = _normalize_optional_text(_read_head_field(metadata, "ETag", "etag"))
    object_store.delete_object(bucket=bucket, key=object_key)
    try:
        object_store.head_object(bucket=bucket, key=object_key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            return {
                **candidate,
                "bucket": bucket,
                "byte_size": byte_size,
                "etag": etag,
                "status": "deleted",
            }
        raise
    raise ValueError(f"{object_key} still exists after delete")


def _load_jsonl_rows(path: Path) -> tuple[dict[str, Any], ...]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return ()
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        payload = json.loads(normalized)
        if not isinstance(payload, dict):
            raise ValueError(f"inventory row must be an object: {normalized}")
        rows.append(dict(payload))
    return tuple(rows)


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object expected at {path}")
    return dict(payload)


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


def _write_jsonl(path: Path, rows: list[dict[str, Any]] | tuple[dict[str, Any], ...]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _required_text(value: object, *, label: str) -> str:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        raise ValueError(f"{label} is required")
    return normalized


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _is_legacy_attachment_object_key(value: str) -> bool:
    return bool(LEGACY_ATTACHMENT_OBJECT_KEY_RE.fullmatch(str(value or "").strip()))


def _read_head_field(metadata: dict[str, Any], *names: str) -> object | None:
    for name in names:
        if name in metadata:
            return metadata[name]
    return None


def _coerce_content_length(metadata: dict[str, Any], *, label: str) -> int:
    value = _read_head_field(metadata, "ContentLength", "content_length")
    if value is None:
        raise ValueError(f"{label} missing content length in head_object response")
    return int(value)


def _parse_timestamp(value: str, *, label: str) -> datetime:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO timestamp") from exc


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
    "LEGACY_ATTACHMENT_OBJECT_KEY_RE",
    "MEDIA_EXTRACTION_CLEANUP_TERMINAL_STATUSES",
    "AuthenticatedNoticeAttachmentKeyCleanupRequest",
    "AuthenticatedNoticeAttachmentKeyCleanupS3ObjectStore",
    "AuthenticatedNoticeQuarantineAttachmentCleanupRequest",
    "cleanup_authenticated_notice_quarantine_attachment_keys",
    "cleanup_authenticated_notice_source_attachment_keys",
]
