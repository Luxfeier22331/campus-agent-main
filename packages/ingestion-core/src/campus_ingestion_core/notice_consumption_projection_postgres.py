from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict
from importlib import import_module

from campus_ingestion_core.notice_consumption_projection_shared import (
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_TABLE,
    NoticeConsumptionProjectionEntry,
    normalize_notice_ids,
)
from campus_ingestion_core.postgres_runtime import normalize_postgres_connection_url
from campus_ingestion_core.registry import (
    _coerce_json_payload,
    _ensure_table_schema,
    _qualified_table_sql,
    _table_index_suffix,
)


def _projection_facade():
    return import_module("campus_ingestion_core.notice_consumption_projection")


def _patched_postgres_connection(*args, **kwargs):
    return _projection_facade()._postgres_connection(*args, **kwargs)


class PostgresNoticeConsumptionProjectionStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_NOTICE_CONSUMPTION_PROJECTION_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("notice consumption projection database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def upsert_many(self, records: Sequence[NoticeConsumptionProjectionEntry]) -> None:
        rows = tuple(records)
        if not rows:
            return
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(self._bulk_upsert_query(), (self._recordset_payload(rows),))

    def replace_scope(
        self,
        source_corpus: str,
        source_collection: str,
        records: Sequence[NoticeConsumptionProjectionEntry],
    ) -> None:
        with (
            _patched_postgres_connection(self.database_url, autocommit=False) as conn,
            conn.cursor() as cursor,
        ):
            cursor.execute(
                f"delete from {self.table_name} where source_corpus = %s and source_collection = %s",
                (source_corpus, source_collection),
            )
            rows = tuple(records)
            if rows:
                cursor.execute(self._bulk_upsert_query(), (self._recordset_payload(rows),))

    def replace_notices(
        self,
        source_corpus: str,
        source_collection: str,
        notice_ids: Sequence[str],
        records: Sequence[NoticeConsumptionProjectionEntry],
    ) -> None:
        normalized_notice_ids = normalize_notice_ids(notice_ids)
        if not normalized_notice_ids:
            return
        with (
            _patched_postgres_connection(self.database_url, autocommit=False) as conn,
            conn.cursor() as cursor,
        ):
            cursor.execute(
                f"""
                delete from {self.table_name}
                where source_corpus = %s
                  and source_collection = %s
                  and source_notice_id = any(%s)
                """,
                (source_corpus, source_collection, list(normalized_notice_ids)),
            )
            rows = tuple(records)
            if rows:
                cursor.execute(self._bulk_upsert_query(), (self._recordset_payload(rows),))

    def list_by_scope(
        self,
        source_corpus: str,
        source_collection: str,
        *,
        notice_ids: Sequence[str] = (),
    ) -> tuple[NoticeConsumptionProjectionEntry, ...]:
        normalized_notice_ids = normalize_notice_ids(notice_ids)
        if normalized_notice_ids:
            query = (
                f"select record from {self.table_name} "
                "where source_corpus = %s and source_collection = %s and source_notice_id = any(%s) "
                "order by source_notice_id asc, unit_id asc"
            )
            params: tuple[object, ...] = (
                source_corpus,
                source_collection,
                list(normalized_notice_ids),
            )
        else:
            query = (
                f"select record from {self.table_name} "
                "where source_corpus = %s and source_collection = %s "
                "order by source_notice_id asc, unit_id asc"
            )
            params = (source_corpus, source_collection)
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        return tuple(
            NoticeConsumptionProjectionEntry.from_dict(_coerce_json_payload(row[0])) for row in rows
        )

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    source_corpus text not null,
                    source_collection text not null,
                    source_notice_id text not null,
                    unit_id text not null,
                    primary_role text not null,
                    target_surface text not null,
                    consumption_status text not null,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (source_corpus, source_collection, unit_id)
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_notice
                on {table_sql} (source_corpus, source_collection, source_notice_id, unit_id)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_target
                on {table_sql} (source_corpus, source_collection, target_surface, consumption_status)
                """
            )

    def _bulk_upsert_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"""
            with rows as (
                select
                    item.source_corpus,
                    item.source_collection,
                    item.source_notice_id,
                    item.unit_id,
                    item.primary_role,
                    item.target_surface,
                    item.consumption_status,
                    item.updated_at,
                    item.record
                from jsonb_to_recordset(%s::jsonb) as item(
                    source_corpus text,
                    source_collection text,
                    source_notice_id text,
                    unit_id text,
                    primary_role text,
                    target_surface text,
                    consumption_status text,
                    updated_at timestamptz,
                    record jsonb
                )
            )
            insert into {table_sql} (
                source_corpus,
                source_collection,
                source_notice_id,
                unit_id,
                primary_role,
                target_surface,
                consumption_status,
                updated_at,
                record
            )
            select
                source_corpus,
                source_collection,
                source_notice_id,
                unit_id,
                primary_role,
                target_surface,
                consumption_status,
                updated_at,
                record
            from rows
            on conflict (source_corpus, source_collection, unit_id) do update set
                source_notice_id = excluded.source_notice_id,
                primary_role = excluded.primary_role,
                target_surface = excluded.target_surface,
                consumption_status = excluded.consumption_status,
                updated_at = excluded.updated_at,
                record = excluded.record
        """

    @staticmethod
    def _recordset_payload(records: Sequence[NoticeConsumptionProjectionEntry]) -> str:
        payload = []
        for record in records:
            row = {
                "source_corpus": record.source_corpus,
                "source_collection": record.source_collection,
                "source_notice_id": record.source_notice_id,
                "unit_id": record.unit_id,
                "primary_role": record.primary_role,
                "target_surface": record.target_surface,
                "consumption_status": record.consumption_status,
                "updated_at": record.updated_at,
                "record": asdict(record),
            }
            payload.append(row)
        return json.dumps(payload, ensure_ascii=False)
