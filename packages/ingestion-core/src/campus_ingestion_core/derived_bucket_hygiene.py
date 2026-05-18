from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, TextIO

from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.scope_catalog import list_corpora
from campus_ingestion_core.settings import ObjectStoreSettings

ALLOWED_DERIVED_BUCKET_FAMILIES = (
    "documents",
    "releases",
    "backups",
    "operations",
)


class DerivedBucketHygieneObjectStore(Protocol):
    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]: ...

    def head_object(self, *, bucket: str, key: str) -> dict[str, Any]: ...

    def delete_object(self, *, bucket: str, key: str) -> None: ...


class DerivedBucketHygieneS3ObjectStore:
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
class DerivedBucketHygieneAuditRequest:
    output_dir: Path

    def __post_init__(self) -> None:
        object.__setattr__(self, "output_dir", Path(self.output_dir))


@dataclass(frozen=True, slots=True)
class DerivedBucketUnexpectedKeyCleanupRequest:
    candidate_inventory_path: Path
    output_dir: Path
    dry_run: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "candidate_inventory_path", Path(self.candidate_inventory_path))
        object.__setattr__(self, "output_dir", Path(self.output_dir))


def audit_derived_bucket_hygiene(
    *,
    request: DerivedBucketHygieneAuditRequest,
    env: dict[str, str] | None = None,
    object_store: DerivedBucketHygieneObjectStore | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or DerivedBucketHygieneS3ObjectStore(settings)
    allowed_root_prefixes = list_corpora()
    keys = tuple(sorted(runtime_object_store.list_keys(bucket=settings.bucket_derived, prefix="")))

    root_counts: dict[str, int] = {}
    family_counts: dict[tuple[str, str], int] = {}
    unexpected_root_rows: list[dict[str, Any]] = []
    unexpected_key_rows: list[dict[str, Any]] = []

    for key in keys:
        root_prefix, family = _parse_derived_key(key)
        root_counts[root_prefix] = root_counts.get(root_prefix, 0) + 1
        if family is not None:
            family_counts[(root_prefix, family)] = family_counts.get((root_prefix, family), 0) + 1

        if root_prefix not in allowed_root_prefixes:
            unexpected_root_rows.append(
                {
                    "bucket": settings.bucket_derived,
                    "root_prefix": root_prefix,
                    "family": family,
                    "reason": "unexpected_root_prefix",
                    "object_key": key,
                }
            )
            continue
        if family is None:
            unexpected_key_rows.append(
                {
                    "bucket": settings.bucket_derived,
                    "root_prefix": root_prefix,
                    "family": None,
                    "reason": "missing_family",
                    "object_key": key,
                }
            )
            continue
        if family not in ALLOWED_DERIVED_BUCKET_FAMILIES:
            unexpected_key_rows.append(
                {
                    "bucket": settings.bucket_derived,
                    "root_prefix": root_prefix,
                    "family": family,
                    "reason": "unexpected_family",
                    "object_key": key,
                }
            )

    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    all_root_prefixes_path = output_dir / "all-root-prefixes.jsonl"
    all_root_families_path = output_dir / "all-root-families.jsonl"
    unexpected_root_prefixes_path = output_dir / "unexpected-root-prefixes.jsonl"
    unexpected_families_path = output_dir / "unexpected-families.jsonl"
    unexpected_keys_path = output_dir / "unexpected-keys.jsonl"
    summary_path = output_dir / "summary.json"

    all_root_prefix_rows = [
        {"root_prefix": root_prefix, "key_count": count}
        for root_prefix, count in sorted(root_counts.items())
    ]
    all_root_family_rows = [
        {"root_prefix": root_prefix, "family": family, "key_count": count}
        for (root_prefix, family), count in sorted(family_counts.items())
    ]
    unexpected_root_prefix_rows = [
        {"root_prefix": root_prefix, "key_count": count}
        for root_prefix, count in sorted(root_counts.items())
        if root_prefix not in allowed_root_prefixes
    ]
    unexpected_family_counts: dict[tuple[str, str | None], int] = {}
    for row in unexpected_key_rows:
        family = row["family"]
        unexpected_family_counts[
            (str(row["root_prefix"]), None if family is None else str(family))
        ] = (
            unexpected_family_counts.get(
                (str(row["root_prefix"]), None if family is None else str(family)),
                0,
            )
            + 1
        )
    unexpected_family_rows = [
        {"root_prefix": root_prefix, "family": family, "key_count": count}
        for (root_prefix, family), count in sorted(unexpected_family_counts.items())
    ]

    _write_jsonl(all_root_prefixes_path, all_root_prefix_rows)
    _write_jsonl(all_root_families_path, all_root_family_rows)
    _write_jsonl(unexpected_root_prefixes_path, unexpected_root_prefix_rows)
    _write_jsonl(unexpected_families_path, unexpected_family_rows)
    _write_jsonl(
        unexpected_keys_path,
        sorted(
            [*unexpected_root_rows, *unexpected_key_rows],
            key=_unexpected_key_sort_key,
        ),
    )

    summary = {
        "derived_key_count": len(keys),
        "root_prefix_count": len(root_counts),
        "root_family_count": len(family_counts),
        "allowed_root_prefixes": list(allowed_root_prefixes),
        "allowed_families": list(ALLOWED_DERIVED_BUCKET_FAMILIES),
        "unexpected_root_prefix_count": len(unexpected_root_prefix_rows),
        "unexpected_family_count": len(unexpected_family_rows),
        "unexpected_key_count": len(unexpected_root_rows) + len(unexpected_key_rows),
        "output_dir": str(output_dir),
        "all_root_prefixes_inventory_path": str(all_root_prefixes_path),
        "all_root_families_inventory_path": str(all_root_families_path),
        "unexpected_root_prefixes_inventory_path": str(unexpected_root_prefixes_path),
        "unexpected_families_inventory_path": str(unexpected_families_path),
        "unexpected_keys_inventory_path": str(unexpected_keys_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def cleanup_derived_bucket_unexpected_keys(
    *,
    request: DerivedBucketUnexpectedKeyCleanupRequest,
    env: dict[str, str] | None = None,
    object_store: DerivedBucketHygieneObjectStore | None = None,
    stderr: TextIO | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or DerivedBucketHygieneS3ObjectStore(settings)
    log_output = stderr if stderr is not None else sys.stderr
    candidates = _load_unexpected_key_rows(
        request.candidate_inventory_path,
        expected_bucket=settings.bucket_derived,
    )
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
    for completed, candidate in enumerate(candidates, start=1):
        object_key = str(candidate["object_key"])
        if request.dry_run:
            result = {**candidate, "status": "dry_run"}
        else:
            result = _delete_candidate_object(
                bucket=settings.bucket_derived,
                object_key=object_key,
                object_store=runtime_object_store,
                candidate=candidate,
            )
        if result["status"] == "deleted":
            deleted_rows.append(result)
        elif result["status"] == "already_absent":
            already_absent_rows.append(result)
        elif result["status"] == "dry_run":
            dry_run_rows.append(result)
        else:  # pragma: no cover
            raise ValueError(f"unsupported cleanup status: {result['status']}")
        if completed == total or completed % 100 == 0:
            print(
                (
                    "[derived-bucket-unexpected-key-cleanup] "
                    f"completed={completed}/{total} deleted={len(deleted_rows)} "
                    f"already_absent={len(already_absent_rows)}"
                ),
                file=log_output,
            )

    _write_jsonl(deleted_path, sorted(deleted_rows, key=lambda row: str(row["object_key"])))
    _write_jsonl(
        already_absent_path,
        sorted(already_absent_rows, key=lambda row: str(row["object_key"])),
    )
    _write_jsonl(dry_run_path, sorted(dry_run_rows, key=lambda row: str(row["object_key"])))
    summary = {
        "already_absent_count": len(already_absent_rows),
        "already_absent_inventory_path": str(already_absent_path),
        "bucket": settings.bucket_derived,
        "candidate_count": len(candidates),
        "candidate_inventory_path": str(request.candidate_inventory_path),
        "deleted_count": len(deleted_rows),
        "deleted_inventory_path": str(deleted_path),
        "dry_run": request.dry_run,
        "dry_run_count": len(dry_run_rows),
        "dry_run_inventory_path": str(dry_run_path),
        "output_dir": str(output_dir),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary


def _parse_derived_key(key: str) -> tuple[str, str | None]:
    normalized = str(key or "").strip().lstrip("/")
    if not normalized:
        raise ValueError("object key must not be empty")
    parts = normalized.split("/")
    root_prefix = parts[0]
    family = parts[1] if len(parts) >= 2 else None
    return root_prefix, family


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _unexpected_key_sort_key(row: dict[str, Any]) -> tuple[str, str, str]:
    family = row.get("family")
    return (
        str(row["root_prefix"]),
        "" if family is None else str(family),
        str(row["object_key"]),
    )


def _load_unexpected_key_rows(
    path: Path,
    *,
    expected_bucket: str,
) -> tuple[dict[str, Any], ...]:
    rows = _load_jsonl_rows(path)
    candidates: list[dict[str, Any]] = []
    allowed_root_prefixes = set(list_corpora())
    for index, row in enumerate(rows, start=1):
        bucket = _required_text(row.get("bucket"), label=f"{path}:{index}:bucket")
        object_key = _required_text(row.get("object_key"), label=f"{path}:{index}:object_key")
        root_prefix = _required_text(row.get("root_prefix"), label=f"{path}:{index}:root_prefix")
        reason = _required_text(row.get("reason"), label=f"{path}:{index}:reason")
        parsed_root_prefix, parsed_family = _parse_derived_key(object_key)
        if bucket != expected_bucket:
            raise ValueError(f"{path}:{index} targets bucket {bucket}, expected {expected_bucket}")
        if root_prefix != parsed_root_prefix:
            raise ValueError(f"{path}:{index} root_prefix does not match object_key")
        if reason == "unexpected_root_prefix":
            if root_prefix in allowed_root_prefixes:
                raise ValueError(f"{path}:{index} root_prefix is allowed: {root_prefix}")
        elif reason == "missing_family":
            if parsed_family is not None:
                raise ValueError(f"{path}:{index} object_key is not missing a family")
        elif reason == "unexpected_family":
            family = _required_text(row.get("family"), label=f"{path}:{index}:family")
            if parsed_family != family:
                raise ValueError(f"{path}:{index} family does not match object_key")
            if parsed_family in ALLOWED_DERIVED_BUCKET_FAMILIES:
                raise ValueError(f"{path}:{index} family is allowed: {parsed_family}")
        else:
            raise ValueError(f"{path}:{index} has unsupported cleanup reason: {reason}")
        candidates.append(dict(row))
    return tuple(sorted(candidates, key=lambda row: str(row["object_key"])))


def _delete_candidate_object(
    *,
    bucket: str,
    object_key: str,
    object_store: DerivedBucketHygieneObjectStore,
    candidate: dict[str, Any],
) -> dict[str, Any]:
    try:
        metadata = object_store.head_object(bucket=bucket, key=object_key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            return {**candidate, "status": "already_absent"}
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
                "deleted_byte_size": byte_size,
                "etag": etag,
                "status": "deleted",
            }
        raise
    raise ValueError(f"{object_key} still exists after delete")


def _load_jsonl_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise ValueError(f"inventory does not exist: {path}")
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise ValueError(f"{path}:{line_number} must be a JSON object")
        rows.append(payload)
    return rows


def _required_text(value: object, *, label: str) -> str:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        raise ValueError(f"{label} is required")
    return normalized


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
    "ALLOWED_DERIVED_BUCKET_FAMILIES",
    "DerivedBucketHygieneAuditRequest",
    "DerivedBucketUnexpectedKeyCleanupRequest",
    "audit_derived_bucket_hygiene",
    "cleanup_derived_bucket_unexpected_keys",
]
