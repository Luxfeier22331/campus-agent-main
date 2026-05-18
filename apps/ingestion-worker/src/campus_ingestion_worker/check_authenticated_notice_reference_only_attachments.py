from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict
from typing import Any

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
    build_authenticated_notice_attachment_fetch_status_store_from_env,
    build_reference_only_attachment_explanation_report,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.settings import DEFAULT_BUCKET_SOURCE, ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Explain authenticated notice reference-only attachment refs"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--site-id", default="muc_internal_portal")
    parser.add_argument("--notice-id", action="append", default=[])
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
    fetch_status_store = build_authenticated_notice_attachment_fetch_status_store_from_env(
        env,
        prefer_operator=_has_fetch_status_operator_database_url(env),
    )
    inventory_entries = inventory_store.list_by_scope(
        args.corpus,
        args.collection,
        notice_ids=notice_ids,
    )
    fetch_status_records = fetch_status_store.list_by_notice_ids(
        site_id=args.site_id,
        notice_ids=notice_ids,
    )
    object_store = build_source_truth_object_store(env)
    attachment_refs_by_key = load_attachment_refs_by_key(
        object_store=object_store,
        bucket=_source_bucket_from_env(env),
        inventory_entries=inventory_entries,
    )
    report = build_reference_only_attachment_explanation_report(
        inventory_entries=inventory_entries,
        attachment_refs_by_key=attachment_refs_by_key,
        fetch_status_records=fetch_status_records,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))


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
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
        )
    )


def _has_fetch_status_operator_database_url(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
        )
    )


__all__ = [
    "build_authenticated_notice_attachment_fetch_status_store_from_env",
    "build_authenticated_notice_source_truth_inventory_store_from_env",
    "build_parser",
    "build_source_truth_object_store",
    "load_attachment_refs_by_key",
    "main",
]


if __name__ == "__main__":
    main()
