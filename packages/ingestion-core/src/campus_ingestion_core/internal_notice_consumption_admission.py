from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from typing import Protocol

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.notice_consumption_projection import normalize_notice_ids
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_ENV_KEY,
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
DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY = (
    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE = (
    "ingestion_projection.internal_notice_consumption_admission"
)
DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_EVENT_TABLE = (
    "ingestion_projection.internal_notice_consumption_admission_event"
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
    error: str = ""
    selection_source: str = ""
    selection_path: str = ""
    selection_sha256: str = ""
    command_args: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class InternalNoticeConsumptionAdmissionEventRecord:
    event_id: str
    batch_id: str
    source_corpus: str
    source_collection: str
    command: str
    selected_notice_ids: tuple[str, ...]
    status: str
    result_counts: dict[str, int]
    created_at: str
    event_created_at: str
    error: str = ""
    selection_source: str = ""
    selection_path: str = ""
    selection_sha256: str = ""
    command_args: dict[str, object] = field(default_factory=dict)


class InternalNoticeConsumptionAdmissionStore(Protocol):
    def record(self, record: InternalNoticeConsumptionAdmissionRecord) -> None: ...


class InMemoryInternalNoticeConsumptionAdmissionStore:
    def __init__(
        self,
        records: Sequence[InternalNoticeConsumptionAdmissionRecord] = (),
        events: Sequence[InternalNoticeConsumptionAdmissionEventRecord] = (),
    ) -> None:
        self._records_by_batch = {record.batch_id: record for record in records}
        self._events = list(events) or [
            build_internal_notice_consumption_admission_event_record(
                record,
                event_created_at=record.created_at,
            )
            for record in records
        ]

    def record(self, record: InternalNoticeConsumptionAdmissionRecord) -> None:
        self._records_by_batch[record.batch_id] = record
        self._events.append(build_internal_notice_consumption_admission_event_record(record))

    def list_records(
        self,
        *,
        source_corpus: str | None = None,
        source_collection: str | None = None,
        notice_ids: Sequence[str] = (),
        commands: Sequence[str] = (),
        statuses: Sequence[str] = (),
        limit: int = 100,
    ) -> tuple[InternalNoticeConsumptionAdmissionRecord, ...]:
        normalized_notice_ids = set(normalize_notice_ids(notice_ids))
        normalized_commands = {item.strip() for item in commands if item.strip()}
        normalized_statuses = {item.strip() for item in statuses if item.strip()}
        records = [
            record
            for record in self._records_by_batch.values()
            if (source_corpus is None or record.source_corpus == source_corpus)
            and (source_collection is None or record.source_collection == source_collection)
            and (
                not normalized_notice_ids
                or bool(normalized_notice_ids.intersection(record.selected_notice_ids))
            )
            and (not normalized_commands or record.command in normalized_commands)
            and (not normalized_statuses or record.status in normalized_statuses)
        ]
        return tuple(records[: max(1, int(limit))])

    def list_events(
        self,
        *,
        source_corpus: str | None = None,
        source_collection: str | None = None,
        batch_ids: Sequence[str] = (),
        notice_ids: Sequence[str] = (),
        commands: Sequence[str] = (),
        statuses: Sequence[str] = (),
        limit: int = 100,
    ) -> tuple[InternalNoticeConsumptionAdmissionEventRecord, ...]:
        normalized_batch_ids = {item.strip() for item in batch_ids if item.strip()}
        normalized_notice_ids = set(normalize_notice_ids(notice_ids))
        normalized_commands = {item.strip() for item in commands if item.strip()}
        normalized_statuses = {item.strip() for item in statuses if item.strip()}
        events = [
            event
            for event in self._events
            if (source_corpus is None or event.source_corpus == source_corpus)
            and (source_collection is None or event.source_collection == source_collection)
            and (not normalized_batch_ids or event.batch_id in normalized_batch_ids)
            and (
                not normalized_notice_ids
                or bool(normalized_notice_ids.intersection(event.selected_notice_ids))
            )
            and (not normalized_commands or event.command in normalized_commands)
            and (not normalized_statuses or event.status in normalized_statuses)
        ]
        return tuple(events[: max(1, int(limit))])


class PostgresInternalNoticeConsumptionAdmissionStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE,
        event_table_name: str = DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_EVENT_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("internal notice consumption admission database url is required")
        self.table_name = table_name
        self.event_table_name = event_table_name
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
                    error,
                    result_counts,
                    selection_source,
                    selection_path,
                    selection_sha256,
                    command_args,
                    record
                )
                values (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb,
                    %s, %s, %s, %s::jsonb, %s::jsonb
                )
                on conflict (batch_id) do update set
                    source_corpus = excluded.source_corpus,
                    source_collection = excluded.source_collection,
                    command = excluded.command,
                    selected_notice_ids = excluded.selected_notice_ids,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    error = excluded.error,
                    result_counts = excluded.result_counts,
                    selection_source = excluded.selection_source,
                    selection_path = excluded.selection_path,
                    selection_sha256 = excluded.selection_sha256,
                    command_args = excluded.command_args,
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
                    record.error,
                    json.dumps(record.result_counts, ensure_ascii=False),
                    record.selection_source,
                    record.selection_path,
                    record.selection_sha256,
                    json.dumps(record.command_args, ensure_ascii=False),
                    json.dumps(asdict(record), ensure_ascii=False),
                ),
            )
            event = build_internal_notice_consumption_admission_event_record(record)
            cursor.execute(
                self._insert_event_query(),
                (
                    event.event_id,
                    event.batch_id,
                    event.source_corpus,
                    event.source_collection,
                    event.command,
                    list(event.selected_notice_ids),
                    event.status,
                    event.created_at,
                    event.event_created_at,
                    event.error,
                    json.dumps(event.result_counts, ensure_ascii=False),
                    event.selection_source,
                    event.selection_path,
                    event.selection_sha256,
                    json.dumps(event.command_args, ensure_ascii=False),
                    json.dumps(asdict(event), ensure_ascii=False),
                ),
            )

    def list_records(
        self,
        *,
        source_corpus: str,
        source_collection: str,
        notice_ids: Sequence[str] = (),
        commands: Sequence[str] = (),
        statuses: Sequence[str] = (),
        limit: int = 100,
    ) -> tuple[InternalNoticeConsumptionAdmissionRecord, ...]:
        normalized_notice_ids = normalize_notice_ids(notice_ids)
        normalized_commands = tuple(
            dict.fromkeys(item.strip() for item in commands if item.strip())
        )
        normalized_statuses = tuple(
            dict.fromkeys(item.strip() for item in statuses if item.strip())
        )
        normalized_limit = max(1, int(limit))
        clauses = ["source_corpus = %s", "source_collection = %s"]
        params: list[object] = [source_corpus, source_collection]
        if normalized_notice_ids:
            clauses.append("selected_notice_ids && %s")
            params.append(list(normalized_notice_ids))
        if normalized_commands:
            clauses.append("command = any(%s)")
            params.append(list(normalized_commands))
        if normalized_statuses:
            clauses.append("status = any(%s)")
            params.append(list(normalized_statuses))
        params.append(normalized_limit)
        table_sql = _qualified_table_sql(self.table_name)
        query = (
            f"select record from {table_sql} where "
            + " and ".join(clauses)
            + " order by created_at asc, batch_id asc"
            + " limit %s"
        )
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()
        records: list[InternalNoticeConsumptionAdmissionRecord] = []
        for row in rows:
            payload = _coerce_json_payload(row[0])
            payload["selected_notice_ids"] = tuple(payload.get("selected_notice_ids") or ())
            payload["result_counts"] = dict(payload.get("result_counts") or {})
            payload["error"] = str(payload.get("error") or "")
            payload["selection_source"] = str(payload.get("selection_source") or "")
            payload["selection_path"] = str(payload.get("selection_path") or "")
            payload["selection_sha256"] = str(payload.get("selection_sha256") or "")
            payload["command_args"] = dict(payload.get("command_args") or {})
            records.append(InternalNoticeConsumptionAdmissionRecord(**payload))
        return tuple(records)

    def list_events(
        self,
        *,
        source_corpus: str,
        source_collection: str,
        batch_ids: Sequence[str] = (),
        notice_ids: Sequence[str] = (),
        commands: Sequence[str] = (),
        statuses: Sequence[str] = (),
        limit: int = 100,
    ) -> tuple[InternalNoticeConsumptionAdmissionEventRecord, ...]:
        normalized_batch_ids = tuple(
            dict.fromkeys(item.strip() for item in batch_ids if item.strip())
        )
        normalized_notice_ids = normalize_notice_ids(notice_ids)
        normalized_commands = tuple(
            dict.fromkeys(item.strip() for item in commands if item.strip())
        )
        normalized_statuses = tuple(
            dict.fromkeys(item.strip() for item in statuses if item.strip())
        )
        normalized_limit = max(1, int(limit))
        clauses = ["source_corpus = %s", "source_collection = %s"]
        params: list[object] = [source_corpus, source_collection]
        if normalized_batch_ids:
            clauses.append("batch_id = any(%s)")
            params.append(list(normalized_batch_ids))
        if normalized_notice_ids:
            clauses.append("selected_notice_ids && %s")
            params.append(list(normalized_notice_ids))
        if normalized_commands:
            clauses.append("command = any(%s)")
            params.append(list(normalized_commands))
        if normalized_statuses:
            clauses.append("status = any(%s)")
            params.append(list(normalized_statuses))
        params.append(normalized_limit)
        table_sql = _qualified_table_sql(self.event_table_name)
        query = (
            f"select record from {table_sql} where "
            + " and ".join(clauses)
            + " order by event_created_at asc, event_id asc"
            + " limit %s"
        )
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()
        events: list[InternalNoticeConsumptionAdmissionEventRecord] = []
        for row in rows:
            payload = _coerce_json_payload(row[0])
            payload["selected_notice_ids"] = tuple(payload.get("selected_notice_ids") or ())
            payload["result_counts"] = dict(payload.get("result_counts") or {})
            payload["error"] = str(payload.get("error") or "")
            payload["selection_source"] = str(payload.get("selection_source") or "")
            payload["selection_path"] = str(payload.get("selection_path") or "")
            payload["selection_sha256"] = str(payload.get("selection_sha256") or "")
            payload["command_args"] = dict(payload.get("command_args") or {})
            events.append(InternalNoticeConsumptionAdmissionEventRecord(**payload))
        return tuple(events)

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        event_table_sql = _qualified_table_sql(self.event_table_name)
        suffix = _table_index_suffix(self.table_name)
        event_suffix = _table_index_suffix(self.event_table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            _ensure_table_schema(cursor, table_name=self.event_table_name)
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
                    error text not null default '',
                    result_counts jsonb not null,
                    selection_source text not null default '',
                    selection_path text not null default '',
                    selection_sha256 text not null default '',
                    command_args jsonb not null default '{{}}'::jsonb,
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
            cursor.execute(
                f"alter table {table_sql} add column if not exists error text not null default ''"
            )
            cursor.execute(
                f"""
                alter table {table_sql}
                add column if not exists selection_source text not null default ''
                """
            )
            cursor.execute(
                f"""
                alter table {table_sql}
                add column if not exists selection_path text not null default ''
                """
            )
            cursor.execute(
                f"""
                alter table {table_sql}
                add column if not exists selection_sha256 text not null default ''
                """
            )
            cursor.execute(
                f"""
                alter table {table_sql}
                add column if not exists command_args jsonb not null default '{{}}'::jsonb
                """
            )
            cursor.execute(
                f"""
                create table if not exists {event_table_sql} (
                    event_id text primary key,
                    batch_id text not null,
                    source_corpus text not null,
                    source_collection text not null,
                    command text not null,
                    selected_notice_ids text[] not null,
                    status text not null,
                    created_at timestamptz not null,
                    event_created_at timestamptz not null,
                    error text not null default '',
                    result_counts jsonb not null,
                    selection_source text not null default '',
                    selection_path text not null default '',
                    selection_sha256 text not null default '',
                    command_args jsonb not null default '{{}}'::jsonb,
                    record jsonb not null
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{event_suffix}_batch
                on {event_table_sql} (source_corpus, source_collection, batch_id, event_created_at)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{event_suffix}_command
                on {event_table_sql} (source_corpus, source_collection, command, event_created_at)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{event_suffix}_notice_ids
                on {event_table_sql} using gin (selected_notice_ids)
                """
            )

    def _insert_event_query(self) -> str:
        table_sql = _qualified_table_sql(self.event_table_name)
        return f"""
            insert into {table_sql} (
                event_id,
                batch_id,
                source_corpus,
                source_collection,
                command,
                selected_notice_ids,
                status,
                created_at,
                event_created_at,
                error,
                result_counts,
                selection_source,
                selection_path,
                selection_sha256,
                command_args,
                record
            )
            values (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb,
                %s, %s, %s, %s::jsonb, %s::jsonb
            )
            on conflict (event_id) do nothing
        """


def build_internal_notice_consumption_admission_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresInternalNoticeConsumptionAdmissionStore:
    source = dict(env if env is not None else os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} is required when prefer_operator=True"
            )
        return PostgresInternalNoticeConsumptionAdmissionStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY} or "
            f"{SHARED_POSTGRES_ENV_KEY} is required"
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
    batch_id: str | None = None,
    created_at: str | None = None,
    error: str = "",
    selection_source: str = "",
    selection_path: str = "",
    selection_sha256: str = "",
    command_args: Mapping[str, object] | None = None,
    store: InternalNoticeConsumptionAdmissionStore | None = None,
) -> str:
    record = build_internal_notice_consumption_admission_record(
        source_corpus=source_corpus,
        source_collection=source_collection,
        command=command,
        notice_ids=notice_ids,
        result_counts=result_counts,
        status=status,
        batch_id=batch_id,
        created_at=created_at,
        error=error,
        selection_source=selection_source,
        selection_path=selection_path,
        selection_sha256=selection_sha256,
        command_args=command_args,
    )
    if store is not None:
        store.record(record)
    return record.batch_id


def build_internal_notice_consumption_admission_record(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    command: str,
    notice_ids: Sequence[str],
    result_counts: Mapping[str, int] | None = None,
    status: str = "completed",
    batch_id: str | None = None,
    created_at: str | None = None,
    error: str = "",
    selection_source: str = "",
    selection_path: str = "",
    selection_sha256: str = "",
    command_args: Mapping[str, object] | None = None,
) -> InternalNoticeConsumptionAdmissionRecord:
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    normalized_created_at = created_at or utc_now()
    normalized_batch_id = batch_id or _build_batch_id(
        source_corpus=source_corpus,
        source_collection=source_collection,
        command=command,
        notice_ids=normalized_notice_ids,
        created_at=normalized_created_at,
    )
    return InternalNoticeConsumptionAdmissionRecord(
        batch_id=normalized_batch_id,
        source_corpus=source_corpus,
        source_collection=source_collection,
        command=command,
        selected_notice_ids=normalized_notice_ids,
        status=status,
        result_counts=dict(result_counts or {}),
        created_at=normalized_created_at,
        error=error,
        selection_source=str(selection_source or ""),
        selection_path=str(selection_path or ""),
        selection_sha256=str(selection_sha256 or ""),
        command_args=dict(command_args or {}),
    )


def build_internal_notice_consumption_admission_event_record(
    record: InternalNoticeConsumptionAdmissionRecord,
    *,
    event_created_at: str | None = None,
) -> InternalNoticeConsumptionAdmissionEventRecord:
    normalized_event_created_at = event_created_at or utc_now()
    event_payload = {
        "batch_id": record.batch_id,
        "source_corpus": record.source_corpus,
        "source_collection": record.source_collection,
        "command": record.command,
        "selected_notice_ids": list(record.selected_notice_ids),
        "status": record.status,
        "result_counts": record.result_counts,
        "created_at": record.created_at,
        "event_created_at": normalized_event_created_at,
        "error": record.error,
        "selection_source": record.selection_source,
        "selection_path": record.selection_path,
        "selection_sha256": record.selection_sha256,
        "command_args": record.command_args,
    }
    digest = hashlib.sha256(
        json.dumps(event_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    return InternalNoticeConsumptionAdmissionEventRecord(
        event_id=f"{record.batch_id}:event:{digest}",
        batch_id=record.batch_id,
        source_corpus=record.source_corpus,
        source_collection=record.source_collection,
        command=record.command,
        selected_notice_ids=record.selected_notice_ids,
        status=record.status,
        result_counts=dict(record.result_counts),
        created_at=record.created_at,
        event_created_at=normalized_event_created_at,
        error=record.error,
        selection_source=record.selection_source,
        selection_path=record.selection_path,
        selection_sha256=record.selection_sha256,
        command_args=dict(record.command_args),
    )


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
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_EVENT_TABLE",
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE",
    "InMemoryInternalNoticeConsumptionAdmissionStore",
    "InternalNoticeConsumptionAdmissionEventRecord",
    "InternalNoticeConsumptionAdmissionRecord",
    "InternalNoticeConsumptionAdmissionStore",
    "PostgresInternalNoticeConsumptionAdmissionStore",
    "build_internal_notice_consumption_admission_event_record",
    "build_internal_notice_consumption_admission_record",
    "build_internal_notice_consumption_admission_store_from_env",
    "record_internal_notice_consumption_admission",
]
