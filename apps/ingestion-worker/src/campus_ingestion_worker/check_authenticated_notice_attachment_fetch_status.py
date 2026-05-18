from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
    build_attachment_fetch_status_coverage_report,
    build_authenticated_notice_attachment_fetch_status_store_from_env,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.registry import SHARED_POSTGRES_OPERATOR_ENV_KEY

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check authenticated notice attachment fetch-status coverage"
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
    report = build_attachment_fetch_status_coverage_report(
        inventory_entries=inventory_entries,
        fetch_status_records=fetch_status_records,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))


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
    "main",
]


if __name__ == "__main__":
    main()
