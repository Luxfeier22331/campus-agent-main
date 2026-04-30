from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_attachment_fetch_request_manifest import (
    FETCH_REQUEST_MANIFEST_SCHEMA,
    build_authenticated_notice_attachment_fetch_request_manifest,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY,
    DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.settings import DEFAULT_BUCKET_SOURCE, ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build collector attachment fetch request manifest from authenticated notice source truth"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--output-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = dict(os.environ)
    notice_ids = tuple(str(item).strip() for item in args.notice_id if str(item).strip())
    inventory_store = build_authenticated_notice_source_truth_inventory_store_from_env(
        env,
        prefer_operator=_has_source_truth_operator_database_url(env),
    )
    inventory_entries = tuple(
        sorted(
            inventory_store.list_by_scope(
                args.corpus,
                args.collection,
                notice_ids=notice_ids,
            ),
            key=lambda entry: entry.notice_id,
        )
    )
    _validate_selected_notice_ids_exist(
        requested_notice_ids=notice_ids,
        inventory_entries=inventory_entries,
    )
    object_store = build_source_truth_object_store(env)
    attachment_refs_by_key = load_attachment_refs_by_key(
        object_store=object_store,
        bucket=_source_bucket_from_env(env),
        inventory_entries=inventory_entries,
    )
    manifest = build_combined_attachment_fetch_request_manifest(
        inventory_entries=inventory_entries,
        attachment_refs_by_key=attachment_refs_by_key,
    )
    if args.output_path:
        output_path = Path(args.output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True))


def build_combined_attachment_fetch_request_manifest(
    *,
    inventory_entries: Sequence[Any],
    attachment_refs_by_key: dict[str, tuple[dict[str, Any], ...]],
) -> dict[str, Any]:
    requests: list[dict[str, Any]] = []
    required_source_object_count = 0
    notice_ids: list[str] = []
    for entry in inventory_entries:
        notice_ids.append(str(entry.notice_id))
        notice_manifest = {
            "site_id": entry.site_id,
            "notice_id": entry.notice_id,
            "raw_asset_id": entry.raw_asset_id,
            "raw_version_id": entry.raw_version_id,
        }
        notice_manifest_payload = build_authenticated_notice_attachment_fetch_request_manifest(
            notice_manifest=notice_manifest,
            attachment_refs=attachment_refs_by_key.get(entry.attachment_refs_key, ()),
        )
        requests.extend(dict(row) for row in notice_manifest_payload["requests"])
        required_source_object_count += int(notice_manifest_payload["required_source_object_count"])
    return {
        "schema_version": FETCH_REQUEST_MANIFEST_SCHEMA,
        "notice_ids": notice_ids,
        "notice_count": len(notice_ids),
        "fetch_request_count": len(requests),
        "required_source_object_count": required_source_object_count,
        "requests": requests,
    }


def _validate_selected_notice_ids_exist(
    *,
    requested_notice_ids: Sequence[str],
    inventory_entries: Sequence[Any],
) -> None:
    requested = tuple(str(item).strip() for item in requested_notice_ids if str(item).strip())
    if not requested:
        return
    observed = {str(entry.notice_id).strip() for entry in inventory_entries}
    missing = tuple(item for item in requested if item not in observed)
    if missing:
        raise ValueError("source-truth inventory missing notice ids: " + ", ".join(sorted(missing)))


def build_source_truth_object_store(env: dict[str, str]) -> S3ObjectStoreAdmin:
    return S3ObjectStoreAdmin(ObjectStoreSettings.from_env(env))


def load_attachment_refs_by_key(
    *,
    object_store: Any,
    bucket: str,
    inventory_entries: Sequence[Any],
) -> dict[str, tuple[dict[str, Any], ...]]:
    rows_by_key: dict[str, tuple[dict[str, Any], ...]] = {}
    for entry in inventory_entries:
        attachment_refs_key = str(getattr(entry, "attachment_refs_key", "") or "").strip()
        if not attachment_refs_key or attachment_refs_key in rows_by_key:
            continue
        rows_by_key[attachment_refs_key] = _load_jsonl_rows(
            object_store.get_bytes(bucket=bucket, key=attachment_refs_key)
        )
    return rows_by_key


def _load_jsonl_rows(payload: bytes) -> tuple[dict[str, Any], ...]:
    text = payload.decode("utf-8").strip()
    if not text:
        return ()
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        normalized = line.strip()
        if normalized:
            rows.append(dict(json.loads(normalized)))
    return tuple(rows)


def _source_bucket_from_env(env: dict[str, str]) -> str:
    return (env.get("OBJECT_STORE_BUCKET_SOURCE") or DEFAULT_BUCKET_SOURCE).strip()


def _has_source_truth_operator_database_url(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
            DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
        )
    )


__all__ = [
    "build_authenticated_notice_source_truth_inventory_store_from_env",
    "build_combined_attachment_fetch_request_manifest",
    "build_parser",
    "build_source_truth_object_store",
    "load_attachment_refs_by_key",
    "main",
]


if __name__ == "__main__":
    main()
