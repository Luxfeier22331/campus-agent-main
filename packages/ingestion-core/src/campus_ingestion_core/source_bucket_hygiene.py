from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import sys
from typing import Any, Protocol, TextIO

from campus_ingestion_core.object_store import (
    DEFAULT_RAW_SOURCE_CHANNEL,
    S3ObjectStoreClientFactory,
)
from campus_ingestion_core.settings import ObjectStoreSettings


ALLOWED_SOURCE_BUCKET_ROOT_PREFIXES = (
    "authenticated_notice_portal",
    "official_web",
    DEFAULT_RAW_SOURCE_CHANNEL,
)


class SourceBucketHygieneObjectStore(Protocol):
    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]: ...

    def head_object(self, *, bucket: str, key: str) -> dict[str, Any]: ...

    def delete_object(self, *, bucket: str, key: str) -> None: ...


class SourceBucketHygieneS3ObjectStore:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._client = S3ObjectStoreClientFactory(settings).create()

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        keys: list[str] = []
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            keys.extend(str(item["Key"]) for item in response.get("Contents") or ())
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")
        return tuple(keys)

    def head_object(self, *, bucket: str, key: str) -> dict[str, Any]:
        return dict(self._client.head_object(Bucket=bucket, Key=key))

    def delete_object(self, *, bucket: str, key: str) -> None:
        self._client.delete_object(Bucket=bucket, Key=key)


@dataclass(frozen=True, slots=True)
class SourceBucketHygieneAuditRequest:
    output_dir: Path

    def __post_init__(self) -> None:
        object.__setattr__(self, "output_dir", Path(self.output_dir))


@dataclass(frozen=True, slots=True)
class SourceBucketPrefixCleanupRequest:
    prefix: str
    output_dir: Path

    def __post_init__(self) -> None:
        object.__setattr__(self, "prefix", _normalize_prefix(self.prefix))
        object.__setattr__(self, "output_dir", Path(self.output_dir))


def audit_source_bucket_hygiene(
    *,
    request: SourceBucketHygieneAuditRequest,
    env: dict[str, str] | None = None,
    object_store: SourceBucketHygieneObjectStore | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or SourceBucketHygieneS3ObjectStore(settings)
    keys = tuple(sorted(runtime_object_store.list_keys(bucket=settings.bucket_source, prefix="")))
    root_counts: dict[str, int] = {}
    unexpected_rows: list[dict[str, Any]] = []
    for key in keys:
        root_prefix = _root_prefix(key)
        root_counts[root_prefix] = root_counts.get(root_prefix, 0) + 1
        if root_prefix not in ALLOWED_SOURCE_BUCKET_ROOT_PREFIXES:
            unexpected_rows.append({"root_prefix": root_prefix, "object_key": key})

    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    all_root_prefixes_path = output_dir / "all-root-prefixes.jsonl"
    unexpected_root_prefixes_path = output_dir / "unexpected-root-prefixes.jsonl"
    unexpected_keys_path = output_dir / "unexpected-keys.jsonl"
    summary_path = output_dir / "summary.json"

    all_root_prefix_rows = [
        {"root_prefix": root_prefix, "key_count": count}
        for root_prefix, count in sorted(root_counts.items())
    ]
    unexpected_root_prefix_rows = [
        {"root_prefix": root_prefix, "key_count": count}
        for root_prefix, count in sorted(root_counts.items())
        if root_prefix not in ALLOWED_SOURCE_BUCKET_ROOT_PREFIXES
    ]
    _write_jsonl(all_root_prefixes_path, all_root_prefix_rows)
    _write_jsonl(unexpected_root_prefixes_path, unexpected_root_prefix_rows)
    _write_jsonl(unexpected_keys_path, sorted(unexpected_rows, key=_unexpected_key_sort_key))

    summary = {
        "source_key_count": len(keys),
        "root_prefix_count": len(root_counts),
        "allowed_root_prefixes": list(ALLOWED_SOURCE_BUCKET_ROOT_PREFIXES),
        "unexpected_root_prefix_count": len(unexpected_root_prefix_rows),
        "unexpected_key_count": len(unexpected_rows),
        "output_dir": str(output_dir),
        "all_root_prefixes_inventory_path": str(all_root_prefixes_path),
        "unexpected_root_prefixes_inventory_path": str(unexpected_root_prefixes_path),
        "unexpected_keys_inventory_path": str(unexpected_keys_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def cleanup_source_bucket_prefix(
    *,
    request: SourceBucketPrefixCleanupRequest,
    env: dict[str, str] | None = None,
    object_store: SourceBucketHygieneObjectStore | None = None,
    stderr: TextIO | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or SourceBucketHygieneS3ObjectStore(settings)
    log_output = stderr if stderr is not None else sys.stderr
    root_prefix = _root_prefix(request.prefix)
    if root_prefix in ALLOWED_SOURCE_BUCKET_ROOT_PREFIXES:
        raise ValueError(f"{request.prefix} targets allowed source root prefix {root_prefix}")

    candidate_keys = tuple(
        sorted(runtime_object_store.list_keys(bucket=settings.bucket_source, prefix=request.prefix))
    )
    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    deleted_path = output_dir / "deleted-objects.jsonl"
    already_absent_path = output_dir / "already-absent-objects.jsonl"
    summary_path = output_dir / "summary.json"

    deleted_rows: list[dict[str, Any]] = []
    already_absent_rows: list[dict[str, Any]] = []
    total = len(candidate_keys)
    for completed, object_key in enumerate(candidate_keys, start=1):
        result = _cleanup_object_key(
            bucket=settings.bucket_source,
            object_key=object_key,
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
                    "[source-bucket-prefix-cleanup] "
                    f"prefix={request.prefix} completed={completed}/{total} "
                    f"deleted={len(deleted_rows)} already_absent={len(already_absent_rows)}"
                ),
                file=log_output,
            )

    remaining_keys = runtime_object_store.list_keys(bucket=settings.bucket_source, prefix=request.prefix)
    if remaining_keys:
        raise ValueError(
            f"{request.prefix} still has {len(remaining_keys)} objects after cleanup"
        )

    deleted_rows_sorted = sorted(deleted_rows, key=lambda row: str(row["object_key"]))
    already_absent_rows_sorted = sorted(
        already_absent_rows,
        key=lambda row: str(row["object_key"]),
    )
    _write_jsonl(deleted_path, deleted_rows_sorted)
    _write_jsonl(already_absent_path, already_absent_rows_sorted)
    summary = {
        "prefix": request.prefix,
        "root_prefix": root_prefix,
        "allowed_root_prefixes": list(ALLOWED_SOURCE_BUCKET_ROOT_PREFIXES),
        "candidate_count": len(candidate_keys),
        "deleted_count": len(deleted_rows_sorted),
        "already_absent_count": len(already_absent_rows_sorted),
        "deleted_inventory_path": str(deleted_path),
        "already_absent_inventory_path": str(already_absent_path),
        "output_dir": str(output_dir),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def _cleanup_object_key(
    *,
    bucket: str,
    object_key: str,
    object_store: SourceBucketHygieneObjectStore,
) -> dict[str, Any]:
    try:
        metadata = object_store.head_object(bucket=bucket, key=object_key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            return {"object_key": object_key, "status": "already_absent"}
        raise
    byte_size = _coerce_content_length(metadata, label=object_key)
    etag = _normalize_optional_text(_read_head_field(metadata, "ETag", "etag"))
    object_store.delete_object(bucket=bucket, key=object_key)
    try:
        object_store.head_object(bucket=bucket, key=object_key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            return {
                "object_key": object_key,
                "byte_size": byte_size,
                "etag": etag,
                "status": "deleted",
            }
        raise
    raise ValueError(f"{object_key} still exists after delete")


def _root_prefix(key: str) -> str:
    normalized = str(key or "").strip().lstrip("/")
    if not normalized:
        raise ValueError("object key must not be empty")
    return normalized.split("/", 1)[0]


def _normalize_prefix(prefix: str) -> str:
    normalized = str(prefix or "").strip().lstrip("/")
    if not normalized:
        raise ValueError("prefix is required")
    return normalized if normalized.endswith("/") else f"{normalized}/"


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _unexpected_key_sort_key(row: dict[str, Any]) -> tuple[str, str]:
    return (str(row["root_prefix"]), str(row["object_key"]))


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


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


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
    "ALLOWED_SOURCE_BUCKET_ROOT_PREFIXES",
    "SourceBucketHygieneAuditRequest",
    "SourceBucketPrefixCleanupRequest",
    "audit_source_bucket_hygiene",
    "cleanup_source_bucket_prefix",
]
