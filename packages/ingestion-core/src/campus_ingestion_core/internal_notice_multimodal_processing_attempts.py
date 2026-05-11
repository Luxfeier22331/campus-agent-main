from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import asdict

from campus_ingestion_core.internal_notice_consumption_admission import (
    DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.internal_notice_multimodal_processing_models import (
    InMemoryInternalNoticeMultimodalAttemptStore,
    InternalNoticeMultimodalAttempt,
)
from campus_ingestion_core.notice_consumption_projection import (
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY,
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
)

DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY = (
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY = (
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE = (
    "ingestion_projection.internal_notice_multimodal_attempt"
)


class PostgresInternalNoticeMultimodalAttemptStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("internal notice multimodal attempt database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def record(self, attempt: InternalNoticeMultimodalAttempt) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                insert into {table_sql} (
                    source_corpus,
                    source_collection,
                    source_notice_id,
                    unit_id,
                    attempt_number,
                    admission_batch_id,
                    model,
                    decision_action,
                    status,
                    reasons,
                    error,
                    created_at,
                    record
                )
                values (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb
                )
                on conflict (source_corpus, source_collection, unit_id, attempt_number)
                do update set
                    source_notice_id = excluded.source_notice_id,
                    admission_batch_id = excluded.admission_batch_id,
                    model = excluded.model,
                    decision_action = excluded.decision_action,
                    status = excluded.status,
                    reasons = excluded.reasons,
                    error = excluded.error,
                    created_at = excluded.created_at,
                    record = excluded.record
                """,
                (
                    attempt.source_corpus,
                    attempt.source_collection,
                    attempt.source_notice_id,
                    attempt.unit_id,
                    attempt.attempt_number,
                    attempt.admission_batch_id,
                    attempt.model,
                    attempt.decision_action,
                    attempt.status,
                    json.dumps(attempt.reasons, ensure_ascii=False),
                    attempt.error,
                    attempt.created_at,
                    json.dumps(asdict(attempt), ensure_ascii=False),
                ),
            )

    def list_by_unit(self, unit_id: str) -> tuple[InternalNoticeMultimodalAttempt, ...]:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                select record from {table_sql}
                where unit_id = %s
                order by attempt_number asc
                """,
                (unit_id,),
            )
            rows = cursor.fetchall()
        attempts: list[InternalNoticeMultimodalAttempt] = []
        for row in rows:
            payload = _coerce_json_payload(row[0])
            payload["reasons"] = tuple(payload.get("reasons") or ())
            payload["source_corpus"] = str(payload.get("source_corpus") or "campus_notices")
            payload["source_collection"] = str(
                payload.get("source_collection") or "internal_notice"
            )
            payload["admission_batch_id"] = str(payload.get("admission_batch_id") or "")
            attempts.append(InternalNoticeMultimodalAttempt(**payload))
        return tuple(attempts)

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    source_corpus text not null,
                    source_collection text not null,
                    source_notice_id text not null,
                    unit_id text not null,
                    attempt_number integer not null,
                    admission_batch_id text not null default '',
                    model text not null,
                    decision_action text not null,
                    status text not null,
                    reasons jsonb not null,
                    error text,
                    created_at timestamptz not null,
                    record jsonb not null,
                    primary key (source_corpus, source_collection, unit_id, attempt_number)
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_notice
                on {table_sql} (source_corpus, source_collection, source_notice_id)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_admission
                on {table_sql} (source_corpus, source_collection, admission_batch_id)
                """
            )
            cursor.execute(
                f"""
                alter table {table_sql}
                add column if not exists admission_batch_id text not null default ''
                """
            )


def build_internal_notice_multimodal_attempt_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresInternalNoticeMultimodalAttemptStore:
    source = dict(env if env is not None else os.environ)
    if prefer_operator:
        operator_database_url = _operator_database_url(source)
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} is required when prefer_operator=True"
            )
        return PostgresInternalNoticeMultimodalAttemptStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = _runtime_database_url(source)
    if not database_url:
        raise ValueError(
            f"{DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY} or "
            f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY} or "
            f"{DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} "
            "is required"
        )
    return PostgresInternalNoticeMultimodalAttemptStore(database_url=database_url)


def _operator_database_url(source: Mapping[str, str]) -> str:
    return (
        source.get(DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY)
        or source.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY)
        or source.get(DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
        or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
        or ""
    ).strip()


def _runtime_database_url(source: Mapping[str, str]) -> str:
    return (
        source.get(DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY)
        or source.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY)
        or source.get(DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or ""
    ).strip()


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE",
    "InMemoryInternalNoticeMultimodalAttemptStore",
    "PostgresInternalNoticeMultimodalAttemptStore",
    "build_internal_notice_multimodal_attempt_store_from_env",
]
