from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict
from typing import Any

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY,
    DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
    build_authenticated_notice_attachment_fetch_status_store_from_env,
    build_authenticated_notice_control_plane_status_report,
    build_authenticated_notice_live_historical_reconcile_report,
    build_reference_only_attachment_explanation_report,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY,
    DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
    _postgres_connection,
    _qualified_table_sql,
)
from campus_ingestion_core.settings import DEFAULT_BUCKET_SOURCE

from campus_ingestion_worker.check_authenticated_notice_reference_only_attachments import (
    build_source_truth_object_store,
    load_attachment_refs_by_key,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_COLLECTOR_RUN_LEDGER_TABLE = "ingestion_projection.authenticated_notice_collector_run"
COLLECTOR_RUN_LEDGER_ENV_KEY = "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL"
COLLECTOR_RUN_LEDGER_OPERATOR_ENV_KEY = (
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL"
)
COLLECTOR_RUN_LEDGER_MANAGEMENT_ENV_KEY = (
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_MANAGEMENT_DATABASE_URL"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Show bounded authenticated notice control-plane status"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--site-id", default="muc_internal_portal")
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--collector-run-ledger-table", default=DEFAULT_COLLECTOR_RUN_LEDGER_TABLE)
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
    reference_only_report = build_reference_only_attachment_explanation_report(
        inventory_entries=inventory_entries,
        attachment_refs_by_key=attachment_refs_by_key,
        fetch_status_records=fetch_status_records,
    )
    reconcile_report = build_authenticated_notice_live_historical_reconcile_report(
        inventory_entries=inventory_entries,
        fetch_status_records=fetch_status_records,
    )
    latest_collector_run = load_latest_authenticated_notice_collector_run_from_env(
        env,
        site_id=args.site_id,
        table_name=args.collector_run_ledger_table,
    )
    status_report = build_authenticated_notice_control_plane_status_report(
        inventory_entries=inventory_entries,
        reconcile_report=reconcile_report,
        reference_only_report=reference_only_report,
        latest_collector_run=latest_collector_run,
    )
    print(json.dumps(asdict(status_report), ensure_ascii=False, indent=2, sort_keys=True))


def load_latest_authenticated_notice_collector_run_from_env(
    env: dict[str, str],
    *,
    site_id: str,
    table_name: str = DEFAULT_COLLECTOR_RUN_LEDGER_TABLE,
) -> dict[str, Any] | None:
    database_url = _collector_run_ledger_database_url(env)
    if database_url is None:
        return None
    table_sql = _qualified_table_sql(table_name)
    with _postgres_connection(database_url) as conn, conn.cursor() as cursor:
        cursor.execute(
            f"""
            select record
            from {table_sql}
            where site_id = %s and source_surface = 'notice'
            order by finished_at desc, run_id desc
            limit 1
            """,
            (site_id,),
        )
        row = cursor.fetchone()
    if row is None:
        return None
    return dict(_coerce_json_payload(row[0]))


def _collector_run_ledger_database_url(env: dict[str, str]) -> str | None:
    direct = (env.get(COLLECTOR_RUN_LEDGER_ENV_KEY) or "").strip()
    if direct:
        normalized = normalize_postgres_connection_url(direct)
        return normalized or None
    operator = (
        env.get(COLLECTOR_RUN_LEDGER_OPERATOR_ENV_KEY)
        or env.get(COLLECTOR_RUN_LEDGER_MANAGEMENT_ENV_KEY)
        or env.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
        or env.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
        or ""
    ).strip()
    if not operator:
        return None
    normalized = normalize_postgres_connection_url(operator)
    return build_operator_postgres_connection_url(normalized) if normalized else None


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


def _has_fetch_status_operator_database_url(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
            DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
        )
    )


__all__ = [
    "build_authenticated_notice_attachment_fetch_status_store_from_env",
    "build_authenticated_notice_control_plane_status_report",
    "build_authenticated_notice_live_historical_reconcile_report",
    "build_authenticated_notice_source_truth_inventory_store_from_env",
    "build_parser",
    "build_source_truth_object_store",
    "load_attachment_refs_by_key",
    "load_latest_authenticated_notice_collector_run_from_env",
    "main",
]


if __name__ == "__main__":
    main()
