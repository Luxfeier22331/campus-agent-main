from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from psycopg.types.json import Jsonb

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL_ENV_KEY,
    AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_MANAGEMENT_DATABASE_URL_ENV_KEY,
    AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL_ENV_KEY,
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _postgres_connection,
    _qualified_table_sql,
)

AUTHENTICATED_NOTICE_SMOKE_REPLAY_RUN_PLAN_SCHEMA_VERSION = (
    "authenticated_notice_smoke_replay_run_plan.v1"
)
AUTHENTICATED_NOTICE_SMOKE_REPLAY_RUN_EXECUTE_SCHEMA_VERSION = (
    "authenticated_notice_smoke_replay_run_execute.v1"
)

AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS = (
    "run_id",
    "site_id",
    "source_surface",
    "collection_mode",
    "source_home_url",
    "notice_type_ids",
    "selected_notice_ids",
    "bundle_path",
    "manifest_path",
    "bundle_object_key",
    "manifest_object_key",
    "notices_collected",
    "pages_fetched",
    "detail_fetched",
    "items_seen",
    "attachment_refs_seen",
    "attachment_uploaded",
    "attachment_terminal_unavailable",
    "attachment_transient_failed",
    "attachment_reference_only",
    "status",
    "error_count",
    "started_at",
    "finished_at",
    "record",
    "source_bucket",
    "bundle_content_sha256",
    "bundle_byte_size",
    "manifest_content_sha256",
    "manifest_byte_size",
    "verification_status",
    "required_source_object_count",
    "verified_source_object_count",
    "missing_source_object_count",
    "checksum_mismatch_count",
    "size_mismatch_count",
    "failure_reason",
)


def build_authenticated_notice_smoke_replay_run_plan(
    *,
    source_row: Mapping[str, Any],
    purpose: str,
    generated_at: str | None = None,
    synthetic_run_id: str | None = None,
    generated_by: str = "campus_ingestion_worker.create_authenticated_notice_smoke_replay_run",
) -> dict[str, Any]:
    source_run_id = _required_text(source_row.get("run_id"), "run_id")
    _require_verified_source_row(source_row)
    created_at = generated_at or _utc_now_iso()
    new_run_id = synthetic_run_id or _synthetic_run_id(source_run_id, created_at)
    synthetic_row = {column: deepcopy(source_row.get(column)) for column in AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS}
    record = deepcopy(synthetic_row.get("record"))
    if not isinstance(record, dict):
        raise ValueError("source collector run record must be a json object")
    record["run_id"] = new_run_id
    record["synthetic_replay"] = {
        "source_run_id": source_run_id,
        "purpose": _required_text(purpose, "purpose"),
        "created_by": "codex",
        "created_at": created_at,
        "object_refs_reused": True,
    }
    synthetic_row["run_id"] = new_run_id
    synthetic_row["record"] = record
    return {
        "schema_version": AUTHENTICATED_NOTICE_SMOKE_REPLAY_RUN_PLAN_SCHEMA_VERSION,
        "generated_at": created_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "source_run_id": source_run_id,
        "synthetic_run_id": new_run_id,
        "purpose": _required_text(purpose, "purpose"),
        "synthetic_row": synthetic_row,
        "counts": {
            "planned_ledger_row_count": 1,
            "inserted_count": 0,
            "existing_count": 0,
        },
    }


def execute_authenticated_notice_smoke_replay_run_plan(
    plan: Mapping[str, Any],
    *,
    database_url: str,
    table_name: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
) -> dict[str, Any]:
    synthetic_row = plan.get("synthetic_row")
    if not isinstance(synthetic_row, Mapping):
        raise ValueError("synthetic_row is required")
    columns = AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS
    table_sql = _qualified_table_sql(table_name)
    values = []
    for column in columns:
        value = deepcopy(synthetic_row.get(column))
        if column == "record":
            value = Jsonb(value)
        values.append(value)
    with _postgres_connection(database_url) as conn, conn.cursor() as cursor:
        cursor.execute(
            f"""
            insert into {table_sql} ({", ".join(columns)})
            values ({", ".join(["%s"] * len(columns))})
            on conflict (run_id) do nothing
            returning run_id
            """,
            tuple(values),
        )
        inserted = cursor.fetchone()
    counts = dict(plan.get("counts") or {})
    counts.update(
        {
            "inserted_count": 1 if inserted is not None else 0,
            "existing_count": 0 if inserted is not None else 1,
        }
    )
    return {
        **dict(plan),
        "schema_version": AUTHENTICATED_NOTICE_SMOKE_REPLAY_RUN_EXECUTE_SCHEMA_VERSION,
        "mode": "execute",
        "write_enabled": True,
        "counts": counts,
    }


def fetch_authenticated_notice_collector_run_row(
    *,
    database_url: str,
    run_id: str,
    table_name: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
) -> dict[str, Any]:
    table_sql = _qualified_table_sql(table_name)
    columns_sql = ", ".join(AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS)
    with _postgres_connection(database_url) as conn, conn.cursor() as cursor:
        cursor.execute(
            f"select {columns_sql} from {table_sql} where run_id = %s limit 1",
            (_required_text(run_id, "run_id"),),
        )
        row = cursor.fetchone()
    if row is None:
        raise ValueError(f"collector run ledger row not found for run_id: {run_id}")
    return dict(zip(AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS, row, strict=True))


def collector_run_ledger_database_url_from_env(env: Mapping[str, str]) -> str:
    direct = (
        env.get(AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL_ENV_KEY) or ""
    ).strip()
    if direct:
        return normalize_postgres_connection_url(direct)
    operator = (
        env.get(AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL_ENV_KEY)
        or env.get(AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_MANAGEMENT_DATABASE_URL_ENV_KEY)
        or env.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
        or env.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
        or ""
    ).strip()
    if not operator:
        raise ValueError(
            f"{AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL_ENV_KEY} or "
            f"{AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL_ENV_KEY} or "
            f"{AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_MANAGEMENT_DATABASE_URL_ENV_KEY} or "
            f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or {SHARED_POSTGRES_MANAGEMENT_ENV_KEY} "
            "is required"
        )
    return build_operator_postgres_connection_url(normalize_postgres_connection_url(operator))


def authenticated_notice_smoke_replay_run_to_output_files(
    payload: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    mode = str(payload.get("mode") or "dry_run")
    filename = (
        "authenticated-notice-smoke-replay-run.execute.json"
        if mode == "execute"
        else "authenticated-notice-smoke-replay-run.dry-run.json"
    )
    return {filename: dict(payload)}


def _require_verified_source_row(source_row: Mapping[str, Any]) -> None:
    source_run_id = _required_text(source_row.get("run_id"), "run_id")
    status = _required_text(source_row.get("status"), "status")
    if status != "success":
        raise ValueError(f"source collector run {source_run_id} must have status=success")
    verification_status = _required_text(
        source_row.get("verification_status"),
        "verification_status",
    )
    if verification_status != "verified":
        raise ValueError(
            f"source collector run {source_run_id} must have verification_status=verified"
        )


def _synthetic_run_id(source_run_id: str, generated_at: str) -> str:
    timestamp = generated_at.replace("-", "").replace(":", "").replace(".", "")
    timestamp = timestamp.replace("+0000", "Z").replace("+00:00", "Z")
    timestamp = "".join(character for character in timestamp if character.isalnum())
    return f"{source_run_id}:smoke:{timestamp}"


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _required_text(value: object, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


__all__ = [
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS",
    "AUTHENTICATED_NOTICE_SMOKE_REPLAY_RUN_EXECUTE_SCHEMA_VERSION",
    "AUTHENTICATED_NOTICE_SMOKE_REPLAY_RUN_PLAN_SCHEMA_VERSION",
    "authenticated_notice_smoke_replay_run_to_output_files",
    "build_authenticated_notice_smoke_replay_run_plan",
    "collector_run_ledger_database_url_from_env",
    "execute_authenticated_notice_smoke_replay_run_plan",
    "fetch_authenticated_notice_collector_run_row",
]
