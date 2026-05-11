from __future__ import annotations

import json
import os
from collections.abc import Sequence
from importlib import import_module
from typing import Protocol

from campus_ingestion_core.authenticated_notice_attachment_fetch_status_models import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY,
    DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
    DEFAULT_ATTACHMENT_FETCH_STATUS_TABLE,
    AuthenticatedNoticeAttachmentFetchStatusRecord,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
    _ensure_table_schema,
    _qualified_table_sql,
    _table_index_suffix,
)


class AuthenticatedNoticeAttachmentFetchStatusStore(Protocol):
    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
    ) -> None: ...

    def list_by_notice_ids(
        self,
        *,
        site_id: str,
        notice_ids: Sequence[str],
    ) -> tuple[AuthenticatedNoticeAttachmentFetchStatusRecord, ...]: ...


class InMemoryAuthenticatedNoticeAttachmentFetchStatusStore:
    def __init__(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord] = (),
    ) -> None:
        self._records: dict[
            tuple[str, str, str], AuthenticatedNoticeAttachmentFetchStatusRecord
        ] = {}
        self.upsert_many(records)

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
    ) -> None:
        for record in records:
            self._records[(record.site_id, record.notice_id, record.attachment_ref_id)] = record

    def list_by_notice_ids(
        self,
        *,
        site_id: str,
        notice_ids: Sequence[str],
    ) -> tuple[AuthenticatedNoticeAttachmentFetchStatusRecord, ...]:
        normalized_notice_ids = {str(item).strip() for item in notice_ids if str(item).strip()}
        rows = [
            record
            for key, record in self._records.items()
            if key[0] == site_id and (not normalized_notice_ids or key[1] in normalized_notice_ids)
        ]
        return tuple(sorted(rows, key=lambda item: (item.notice_id, item.attachment_ref_id)))


class PostgresAuthenticatedNoticeAttachmentFetchStatusStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_ATTACHMENT_FETCH_STATUS_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("attachment fetch-status database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
    ) -> None:
        rows = tuple(records)
        if not rows:
            return
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(self._bulk_upsert_query(), (jsonb_recordset(rows),))

    def list_by_notice_ids(
        self,
        *,
        site_id: str,
        notice_ids: Sequence[str],
    ) -> tuple[AuthenticatedNoticeAttachmentFetchStatusRecord, ...]:
        normalized_notice_ids = tuple(
            sorted({str(item).strip() for item in notice_ids if str(item).strip()})
        )
        table_sql = _qualified_table_sql(self.table_name)
        query = f"select record from {table_sql} where site_id = %s"
        params: list[object] = [site_id]
        if normalized_notice_ids:
            query += " and notice_id = any(%s)"
            params.append(list(normalized_notice_ids))
        query += " order by notice_id asc, attachment_ref_id asc"
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()
        return tuple(
            AuthenticatedNoticeAttachmentFetchStatusRecord.from_dict(_coerce_json_payload(row[0]))
            for row in rows
        )

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    site_id text not null,
                    notice_id text not null,
                    attachment_ref_id text not null,
                    portal_attachment_id text,
                    source_url text not null,
                    source_url_hash text not null,
                    filename text,
                    fetch_status text not null,
                    terminal_reason text,
                    last_http_status integer,
                    last_error text,
                    attempt_count integer not null default 0,
                    first_seen_at timestamptz not null,
                    last_attempted_at timestamptz,
                    next_retry_after timestamptz,
                    object_key text,
                    content_sha256 text,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (site_id, notice_id, attachment_ref_id),
                    check (fetch_status in (
                        'collected_internal',
                        'reference_only',
                        'terminal_unavailable',
                        'transient_failed'
                    )),
                    check (
                        terminal_reason is null or terminal_reason in (
                            'http_404',
                            'http_410',
                            'portal_file_missing'
                        )
                    )
                )
                """
            )
            _repair_fetch_status_check(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_terminal
                on {table_sql} (
                    site_id,
                    notice_id,
                    attachment_ref_id,
                    source_url_hash
                )
                where fetch_status = 'terminal_unavailable'
                """
            )

    def _bulk_upsert_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"""
            insert into {table_sql} (
                site_id, notice_id, attachment_ref_id, portal_attachment_id, source_url,
                source_url_hash, filename, fetch_status, terminal_reason, last_http_status,
                last_error, attempt_count, first_seen_at, last_attempted_at, next_retry_after,
                object_key, content_sha256, updated_at, record
            )
            select
                item.site_id, item.notice_id, item.attachment_ref_id, item.portal_attachment_id,
                item.source_url, item.source_url_hash, item.filename, item.fetch_status,
                item.terminal_reason, item.last_http_status, item.last_error, item.attempt_count,
                item.first_seen_at, item.last_attempted_at, item.next_retry_after,
                item.object_key, item.content_sha256, item.updated_at, item.record
            from jsonb_to_recordset(%s::jsonb) as item(
                site_id text, notice_id text, attachment_ref_id text, portal_attachment_id text,
                source_url text, source_url_hash text, filename text, fetch_status text,
                terminal_reason text, last_http_status integer, last_error text,
                attempt_count integer, first_seen_at timestamptz, last_attempted_at timestamptz,
                next_retry_after timestamptz, object_key text, content_sha256 text,
                updated_at timestamptz, record jsonb
            )
            on conflict (site_id, notice_id, attachment_ref_id) do update set
                portal_attachment_id = excluded.portal_attachment_id,
                source_url = excluded.source_url,
                source_url_hash = excluded.source_url_hash,
                filename = excluded.filename,
                fetch_status = excluded.fetch_status,
                terminal_reason = excluded.terminal_reason,
                last_http_status = excluded.last_http_status,
                last_error = excluded.last_error,
                attempt_count = {table_sql}.attempt_count + excluded.attempt_count,
                first_seen_at = least({table_sql}.first_seen_at, excluded.first_seen_at),
                last_attempted_at = excluded.last_attempted_at,
                next_retry_after = excluded.next_retry_after,
                object_key = excluded.object_key,
                content_sha256 = excluded.content_sha256,
                updated_at = excluded.updated_at,
                record = excluded.record
        """


def _repair_fetch_status_check(cursor, *, table_name: str) -> None:
    table_sql = _qualified_table_sql(table_name)
    relation_name = _table_index_suffix(table_name)
    check_names = _fetch_status_check_constraint_names(cursor, table_name=table_name)
    if not check_names:
        check_names = (f"{relation_name}_fetch_status_check",)
    for constraint_name in check_names:
        cursor.execute(f'alter table {table_sql} drop constraint if exists "{constraint_name}"')
    cursor.execute(
        f"""
        alter table {table_sql}
        add constraint "{relation_name}_fetch_status_check"
        check (fetch_status in (
            'collected_internal',
            'reference_only',
            'terminal_unavailable',
            'transient_failed'
        ))
        """
    )


def _fetch_status_check_constraint_names(cursor, *, table_name: str) -> tuple[str, ...]:
    schema_name, relation_name = _parse_table_name(table_name)
    if schema_name is None:
        cursor.execute(
            """
            select con.conname
            from pg_constraint con
            join pg_class rel on rel.oid = con.conrelid
            join pg_namespace nsp on nsp.oid = rel.relnamespace
            where rel.relname = %s
              and con.contype = 'c'
              and pg_get_constraintdef(con.oid) like 'CHECK ((fetch_status = ANY%%'
            """,
            (relation_name,),
        )
    else:
        cursor.execute(
            """
            select con.conname
            from pg_constraint con
            join pg_class rel on rel.oid = con.conrelid
            join pg_namespace nsp on nsp.oid = rel.relnamespace
            where nsp.nspname = %s
              and rel.relname = %s
              and con.contype = 'c'
              and pg_get_constraintdef(con.oid) like 'CHECK ((fetch_status = ANY%%'
            """,
            (schema_name, relation_name),
        )
    return tuple(str(row[0]) for row in cursor.fetchall())


def _parse_table_name(table_name: str) -> tuple[str | None, str]:
    parts = [part.strip() for part in table_name.split(".")]
    if len(parts) == 1:
        return None, parts[0]
    if len(parts) == 2:
        return parts[0], parts[1]
    raise ValueError(f"table name must be <table> or <schema>.<table>: {table_name}")


def build_authenticated_notice_attachment_fetch_status_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresAuthenticatedNoticeAttachmentFetchStatusStore:
    source = env if env is not None else dict(os.environ)
    if prefer_operator:
        database_url = (
            source.get(DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or ""
        ).strip()
        if not database_url:
            raise ValueError(
                f"{DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} is required when prefer_operator=True"
            )
        return PostgresAuthenticatedNoticeAttachmentFetchStatusStore(
            build_operator_postgres_connection_url(database_url)
        )
    database_url = (
        source.get(DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresAuthenticatedNoticeAttachmentFetchStatusStore(database_url)


def jsonb_recordset(
    records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
) -> str:
    return json.dumps(
        [{**record.to_dict(), "record": record.to_dict()} for record in records],
        ensure_ascii=False,
    )


def _inventory_facade():
    return import_module("campus_ingestion_core.authenticated_notice_attachment_fetch_status")


def _patched_postgres_connection(*args, **kwargs):
    return _inventory_facade()._postgres_connection(*args, **kwargs)


__all__ = [
    "AuthenticatedNoticeAttachmentFetchStatusStore",
    "InMemoryAuthenticatedNoticeAttachmentFetchStatusStore",
    "PostgresAuthenticatedNoticeAttachmentFetchStatusStore",
    "build_authenticated_notice_attachment_fetch_status_store_from_env",
    "jsonb_recordset",
]
