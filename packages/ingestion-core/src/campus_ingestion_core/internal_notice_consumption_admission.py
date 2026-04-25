from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Protocol

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.notice_consumption_projection import (
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY,
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_MANAGEMENT_ENV_KEY,
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY,
    normalize_notice_ids,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
)

DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY = (
    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_MANAGEMENT_ENV_KEY = (
    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_MANAGEMENT_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY = (
    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE = (
    "ingestion_projection.internal_notice_consumption_admission"
)


@dataclass(frozen=True, slots=True)
class InternalNoticeConsumptionAdmissionRecord:
    batch_id: str
    source_corpus: str
    source_collection: str
    command: str
    selected_notice_ids: tuple[str, ...]
    status: str
    result_counts: dict[str, int]
    created_at: str


class InternalNoticeConsumptionAdmissionStore(Protocol):
    def record(self, record: InternalNoticeConsumptionAdmissionRecord) -> None: ...


class InMemoryInternalNoticeConsumptionAdmissionStore:
    def __init__(
        self,
        records: Sequence[InternalNoticeConsumptionAdmissionRecord] = (),
    ) -> None:
        self._records = list(records)

    def record(self, record: InternalNoticeConsumptionAdmissionRecord) -> None:
        self._records.append(record)

    def list_records(self) -> tuple[InternalNoticeConsumptionAdmissionRecord, ...]:
        return tuple(self._records)


class PostgresInternalNoticeConsumptionAdmissionStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("internal notice consumption admission database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def record(self, record: InternalNoticeConsumptionAdmissionRecord) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                insert into {table_sql} (
                    batch_id,
                    source_corpus,
                    source_collection,
                    command,
                    selected_notice_ids,
                    status,
                    created_at,
                    result_counts,
                    record
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
                on conflict (batch_id) do update set
                    source_corpus = excluded.source_corpus,
                    source_collection = excluded.source_collection,
                    command = excluded.command,
                    selected_notice_ids = excluded.selected_notice_ids,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    result_counts = excluded.result_counts,
                    record = excluded.record
                """,
                (
                    record.batch_id,
                    record.source_corpus,
                    record.source_collection,
                    record.command,
                    list(record.selected_notice_ids),
                    record.status,
                    record.created_at,
                    json.dumps(record.result_counts, ensure_ascii=False),
                    json.dumps(asdict(record), ensure_ascii=False),
                ),
            )

    def list_records(
        self,
        *,
        source_corpus: str,
        source_collection: str,
        notice_ids: Sequence[str] = (),
        commands: Sequence[str] = (),
    ) -> tuple[InternalNoticeConsumptionAdmissionRecord, ...]:
        normalized_notice_ids = normalize_notice_ids(notice_ids)
        normalized_commands = tuple(
            dict.fromkeys(item.strip() for item in commands if item.strip())
        )
        clauses = ["source_corpus = %s", "source_collection = %s"]
        params: list[object] = [source_corpus, source_collection]
        if normalized_notice_ids:
            clauses.append("selected_notice_ids && %s")
            params.append(list(normalized_notice_ids))
        if normalized_commands:
            clauses.append("command = any(%s)")
            params.append(list(normalized_commands))
        table_sql = _qualified_table_sql(self.table_name)
        query = (
            f"select record from {table_sql} where "
            + " and ".join(clauses)
            + " order by created_at asc, batch_id asc"
        )
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()
        records: list[InternalNoticeConsumptionAdmissionRecord] = []
        for row in rows:
            payload = _coerce_json_payload(row[0])
            payload["selected_notice_ids"] = tuple(payload.get("selected_notice_ids") or ())
            records.append(InternalNoticeConsumptionAdmissionRecord(**payload))
        return tuple(records)

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    batch_id text primary key,
                    source_corpus text not null,
                    source_collection text not null,
                    command text not null,
                    selected_notice_ids text[] not null,
                    status text not null,
                    created_at timestamptz not null,
                    result_counts jsonb not null,
                    record jsonb not null
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_scope
                on {table_sql} (source_corpus, source_collection, created_at)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_command
                on {table_sql} (source_corpus, source_collection, command, created_at)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_notice_ids
                on {table_sql} using gin (selected_notice_ids)
                """
            )


def build_internal_notice_consumption_admission_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresInternalNoticeConsumptionAdmissionStore:
    source = dict(env if env is not None else os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_MANAGEMENT_ENV_KEY)
            or source.get(DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_NOTICE_CONSUMPTION_PROJECTION_MANAGEMENT_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_MANAGEMENT_ENV_KEY} or "
                f"{DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_NOTICE_CONSUMPTION_PROJECTION_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when prefer_operator=True"
            )
        return PostgresInternalNoticeConsumptionAdmissionStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY)
        or source.get(DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY} or "
            f"{DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresInternalNoticeConsumptionAdmissionStore(database_url=database_url)


def record_internal_notice_consumption_admission(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    command: str,
    notice_ids: Sequence[str],
    result_counts: Mapping[str, int] | None = None,
    status: str = "completed",
    store: InternalNoticeConsumptionAdmissionStore | None = None,
) -> str:
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    created_at = utc_now()
    batch_id = _build_batch_id(
        source_corpus=source_corpus,
        source_collection=source_collection,
        command=command,
        notice_ids=normalized_notice_ids,
        created_at=created_at,
    )
    record = InternalNoticeConsumptionAdmissionRecord(
        batch_id=batch_id,
        source_corpus=source_corpus,
        source_collection=source_collection,
        command=command,
        selected_notice_ids=normalized_notice_ids,
        status=status,
        result_counts=dict(result_counts or {}),
        created_at=created_at,
    )
    if store is not None:
        store.record(record)
    return batch_id


def _build_batch_id(
    *,
    source_corpus: str,
    source_collection: str,
    command: str,
    notice_ids: Sequence[str],
    created_at: str,
) -> str:
    digest = hashlib.sha256(
        "|".join(
            (source_corpus, source_collection, command, ",".join(notice_ids), created_at)
        ).encode("utf-8")
    ).hexdigest()[:16]
    return f"internal_notice_consumption:{command}:{digest}"


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_MANAGEMENT_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE",
    "InMemoryInternalNoticeConsumptionAdmissionStore",
    "InternalNoticeConsumptionAdmissionRecord",
    "InternalNoticeConsumptionAdmissionStore",
    "PostgresInternalNoticeConsumptionAdmissionStore",
    "build_internal_notice_consumption_admission_store_from_env",
    "record_internal_notice_consumption_admission",
]
