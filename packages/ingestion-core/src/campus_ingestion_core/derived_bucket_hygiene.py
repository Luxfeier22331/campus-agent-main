from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

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


@dataclass(frozen=True, slots=True)
class DerivedBucketHygieneAuditRequest:
    output_dir: Path

    def __post_init__(self) -> None:
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


__all__ = [
    "ALLOWED_DERIVED_BUCKET_FAMILIES",
    "DerivedBucketHygieneAuditRequest",
    "audit_derived_bucket_hygiene",
]
