from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import sys
from typing import Any, Protocol, TextIO

from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.settings import ObjectStoreSettings


LEGACY_ATTACHMENT_OBJECT_KEY_RE = re.compile(r"^[0-9a-f]{2}/[0-9a-f]{64}/[^/]+$")


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

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "unreferenced_inventory_path",
            Path(self.unreferenced_inventory_path),
        )
        object.__setattr__(self, "output_dir", Path(self.output_dir))


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
    summary_path = output_dir / "summary.json"

    deleted_rows: list[dict[str, Any]] = []
    already_absent_rows: list[dict[str, Any]] = []
    total = len(candidates)
    for completed, legacy_object_key in enumerate(candidates, start=1):
        result = _cleanup_candidate(
            bucket=settings.bucket_source,
            legacy_object_key=legacy_object_key,
            object_store=runtime_object_store,
        )
        if result["status"] == "deleted":
            deleted_rows.append(result)
        elif result["status"] == "already_absent":
            already_absent_rows.append(result)
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
    _write_jsonl(deleted_path, deleted_rows_sorted)
    _write_jsonl(already_absent_path, already_absent_rows_sorted)
    summary = {
        "unreferenced_inventory_path": str(request.unreferenced_inventory_path),
        "output_dir": str(output_dir),
        "inventory_row_count": inventory_row_count,
        "candidate_count": len(candidates),
        "deleted_count": len(deleted_rows_sorted),
        "already_absent_count": len(already_absent_rows_sorted),
        "deleted_inventory_path": str(deleted_path),
        "already_absent_inventory_path": str(already_absent_path),
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
            raise ValueError(
                f"{legacy_object_key} must be a legacy attachment object key"
            )
        if legacy_object_key in seen:
            continue
        seen.add(legacy_object_key)
        candidates.append(legacy_object_key)
    return tuple(sorted(candidates)), inventory_row_count


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
    "AuthenticatedNoticeAttachmentKeyCleanupRequest",
    "AuthenticatedNoticeAttachmentKeyCleanupS3ObjectStore",
    "LEGACY_ATTACHMENT_OBJECT_KEY_RE",
    "cleanup_authenticated_notice_source_attachment_keys",
]
