from __future__ import annotations

from collections.abc import Iterable

from campus_ingestion_core.postgres_runtime import normalize_postgres_connection_url
from campus_ingestion_core.registry import _postgres_connection

DEFAULT_INGESTION_CONTROL_SCHEMA = "ingestion_control"


def build_ingestion_control_schema_sql(
    *,
    schema_name: str = DEFAULT_INGESTION_CONTROL_SCHEMA,
) -> str:
    schema = _qualified_identifier(schema_name)
    return "\n".join(
        (
            f"create schema if not exists {schema};",
            f"""
create table if not exists {schema}.source_handoffs (
  handoff_id text primary key,
  schema_version text not null,
  source_channel text not null,
  source_surface text not null,
  site_id text not null,
  source_run_id text not null,
  source_run_owner text not null,
  source_run_status text not null,
  source_run_terminal_at timestamptz,
  source_run_ref text not null,
  handoff_kind text not null,
  source_bucket text not null,
  status text not null,
  idempotency_key text not null unique,
  page_or_unit_changes_json jsonb not null default '[]'::jsonb,
  failure_reason_json jsonb,
  superseded_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  verified_at timestamptz
);
""".strip(),
            f"""
create table if not exists {schema}.source_handoff_objects (
  handoff_id text not null references {schema}.source_handoffs(handoff_id),
  object_role text not null,
  bucket text not null,
  object_key text not null,
  content_sha256 text not null,
  byte_size bigint not null,
  content_type text,
  required boolean not null,
  source_unit_id text,
  declared_at timestamptz not null,
  unique (handoff_id, object_role, object_key)
);
""".strip(),
            f"""
create table if not exists {schema}.source_object_verifications (
  verification_id text primary key,
  handoff_id text not null references {schema}.source_handoffs(handoff_id),
  object_role text not null,
  bucket text not null,
  object_key text not null,
  status text not null,
  expected_sha256 text not null,
  observed_sha256 text,
  expected_byte_size bigint not null,
  observed_byte_size bigint,
  checked_at timestamptz not null,
  failure_reason_json jsonb
);
""".strip(),
            f"""
create table if not exists {schema}.ingestion_executions (
  execution_id text primary key,
  handoff_id text not null references {schema}.source_handoffs(handoff_id),
  processor_profile text not null,
  requested_result_kind text not null,
  status text not null,
  result_kind text not null,
  idempotency_key text not null unique,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null,
  max_attempts integer not null,
  next_retry_after timestamptz,
  failure_reason_json jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz
);
""".strip(),
            f"""
create table if not exists {schema}.ingestion_steps (
  execution_id text not null references {schema}.ingestion_executions(execution_id),
  step_id text not null,
  step_name text not null,
  status text not null,
  attempt_count integer not null,
  input_refs_json jsonb not null default '[]'::jsonb,
  output_refs_json jsonb not null default '[]'::jsonb,
  failure_reason_json jsonb,
  retry_after timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  primary key (execution_id, step_id)
);
""".strip(),
            f"""
create table if not exists {schema}.ingestion_child_tasks (
  execution_id text not null references {schema}.ingestion_executions(execution_id),
  child_task_id text not null,
  task_kind text not null,
  source_unit_id text,
  processor_profile text not null,
  status text not null,
  reason_code text,
  attempt_count integer not null,
  input_refs_json jsonb not null default '[]'::jsonb,
  output_refs_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  primary key (execution_id, child_task_id)
);
""".strip(),
            f"""
create table if not exists {schema}.ingestion_events (
  event_id text primary key,
  handoff_id text,
  execution_id text,
  step_id text,
  child_task_id text,
  event_type text not null,
  payload_json jsonb not null,
  occurred_at timestamptz not null
);
""".strip(),
            *_index_statements(schema),
            f"""
-- claim query shape used by PostgresSourceHandoffStore:
-- select execution_id from {schema}.ingestion_executions
-- where status = 'queued' or (status = 'failed_retryable' and next_retry_after <= now())
-- order by created_at asc
-- limit 1
-- for update skip locked;
""".strip(),
        )
    )


def bootstrap_ingestion_control_schema(
    database_url: str,
    *,
    schema_name: str = DEFAULT_INGESTION_CONTROL_SCHEMA,
) -> None:
    normalized_url = normalize_postgres_connection_url(database_url)
    if not normalized_url:
        raise ValueError("ingestion control database url is required")
    statements = _split_sql_statements(build_ingestion_control_schema_sql(schema_name=schema_name))
    with _postgres_connection(normalized_url) as conn, conn.cursor() as cursor:
        for statement in statements:
            cursor.execute(statement)


def _index_statements(schema: str) -> tuple[str, ...]:
    index_specs = (
        (
            "source_handoffs_source_run_idx",
            "source_handoffs",
            "(source_channel, source_surface, site_id, source_run_id)",
        ),
        ("source_handoffs_status_idx", "source_handoffs", "(status, updated_at)"),
        ("source_handoff_objects_required_idx", "source_handoff_objects", "(handoff_id, required)"),
        (
            "source_object_verifications_status_idx",
            "source_object_verifications",
            "(handoff_id, status)",
        ),
        ("ingestion_executions_status_idx", "ingestion_executions", "(status, updated_at)"),
        (
            "ingestion_executions_retry_idx",
            "ingestion_executions",
            "(status, next_retry_after)",
        ),
        ("ingestion_steps_status_idx", "ingestion_steps", "(execution_id, status)"),
        ("ingestion_child_tasks_status_idx", "ingestion_child_tasks", "(execution_id, status)"),
        ("ingestion_events_execution_idx", "ingestion_events", "(execution_id, occurred_at)"),
    )
    return tuple(
        f"create index if not exists {name} on {schema}.{table} {columns};"
        for name, table, columns in index_specs
    )


def _qualified_identifier(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized.replace("_", "").isalnum() or normalized[0].isdigit():
        raise ValueError(f"invalid Postgres identifier: {value}")
    return normalized


def _split_sql_statements(sql: str) -> Iterable[str]:
    for statement in sql.split(";"):
        normalized = statement.strip()
        if normalized:
            yield normalized


__all__ = [
    "DEFAULT_INGESTION_CONTROL_SCHEMA",
    "bootstrap_ingestion_control_schema",
    "build_ingestion_control_schema_sql",
]
