from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict
from importlib import import_module

from campus_ingestion_core.internal_notice_read_model_shared import (
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_TABLE,
    InternalNoticeReadModelEntry,
    normalize_notice_ids,
)
from campus_ingestion_core.postgres_runtime import normalize_postgres_connection_url
from campus_ingestion_core.registry import (
    _coerce_json_payload,
    _ensure_table_schema,
    _qualified_table_sql,
    _table_index_suffix,
)


def _read_model_facade():
    return import_module("campus_ingestion_core.internal_notice_read_model")


def _patched_postgres_connection(*args, **kwargs):
    return _read_model_facade()._postgres_connection(*args, **kwargs)


class PostgresInternalNoticeReadModelStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_INTERNAL_NOTICE_READ_MODEL_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("internal notice read model database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def upsert_many(self, records: Sequence[InternalNoticeReadModelEntry]) -> None:
        rows = tuple(records)
        if not rows:
            return
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(self._bulk_upsert_query(), (self._recordset_payload(rows),))

    def replace_scope(
        self,
        source_corpus: str,
        source_collection: str,
        records: Sequence[InternalNoticeReadModelEntry],
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
        records: Sequence[InternalNoticeReadModelEntry],
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
    ) -> tuple[InternalNoticeReadModelEntry, ...]:
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
        return self._fetch_entries(query, params)

    def search(
        self,
        *,
        source_families: Sequence[str],
        query_text: str,
        max_results: int,
    ) -> tuple[InternalNoticeReadModelEntry, ...]:
        allowed_source_families = [
            str(item).strip() for item in source_families if str(item).strip()
        ]
        normalized_query = query_text.strip()
        params: list[object] = [allowed_source_families]
        filters = ["queryable = true", "source_family = any(%s)"]
        if normalized_query:
            params.extend(
                [
                    normalized_query,
                    f"%{normalized_query}%",
                    f"%{normalized_query}%",
                ]
            )
            filters.append(
                "("
                "search_vector @@ plainto_tsquery('simple', %s) "
                "or title ilike %s "
                "or search_text ilike %s"
                ")"
            )
        params.append(max_results)
        query = (
            f"select record from {self.table_name} "
            f"where {' and '.join(filters)} "
            "order by published_at desc nulls last, source_notice_id desc, unit_id asc "
            "limit %s"
        )
        return self._fetch_entries(query, tuple(params))

    def get_by_notice_id(
        self,
        *,
        notice_id: str,
        source_family: str = "",
    ) -> InternalNoticeReadModelEntry | None:
        filters = ["queryable = true", "source_notice_id = %s"]
        params: list[object] = [notice_id]
        if source_family.strip():
            filters.append("source_family = %s")
            params.append(source_family.strip())
        query = (
            f"select record from {self.table_name} "
            f"where {' and '.join(filters)} "
            "order by published_at desc nulls last, unit_id asc limit 1"
        )
        rows = self._fetch_entries(query, tuple(params))
        return rows[0] if rows else None

    def _fetch_entries(
        self,
        query: str,
        params: tuple[object, ...],
    ) -> tuple[InternalNoticeReadModelEntry, ...]:
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        return tuple(
            InternalNoticeReadModelEntry.from_dict(_coerce_json_payload(row[0])) for row in rows
        )

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    source_family text not null,
                    source_corpus text not null,
                    source_collection text not null,
                    source_notice_id text not null,
                    unit_id text not null,
                    primary_role text not null,
                    target_surface text not null,
                    consumption_status text not null,
                    queryable boolean not null,
                    title text not null,
                    published_at text not null,
                    canonical_document_id text not null,
                    canonical_markdown_object_key text not null,
                    body_excerpt text not null,
                    search_text text not null,
                    search_vector tsvector not null,
                    projection_updated_at timestamptz not null,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (source_corpus, source_collection, unit_id)
                )
                """
            )
            cursor.execute(
                f"""
                alter table {table_sql}
                add column if not exists body_excerpt text not null default ''
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_query
                on {table_sql} (
                    source_family,
                    queryable,
                    target_surface,
                    published_at desc
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_notice
                on {table_sql} (source_notice_id)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_role
                on {table_sql} (primary_role, queryable)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_search
                on {table_sql} using gin (search_vector)
                """
            )

    def _bulk_upsert_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"""
            with rows as (
                select
                    item.source_family,
                    item.source_corpus,
                    item.source_collection,
                    item.source_notice_id,
                    item.unit_id,
                    item.primary_role,
                    item.target_surface,
                    item.consumption_status,
                    item.queryable,
                    item.title,
                    item.published_at,
                    item.canonical_document_id,
                    item.canonical_markdown_object_key,
                    item.body_excerpt,
                    item.search_text,
                    to_tsvector('simple', coalesce(item.search_text, '')) as search_vector,
                    item.projection_updated_at,
                    item.updated_at,
                    item.record
                from jsonb_to_recordset(%s::jsonb) as item(
                    source_family text,
                    source_corpus text,
                    source_collection text,
                    source_notice_id text,
                    unit_id text,
                    primary_role text,
                    target_surface text,
                    consumption_status text,
                    queryable boolean,
                    title text,
                    published_at text,
                    canonical_document_id text,
                    canonical_markdown_object_key text,
                    body_excerpt text,
                    search_text text,
                    projection_updated_at timestamptz,
                    updated_at timestamptz,
                    record jsonb
                )
            )
            insert into {table_sql} (
                source_family,
                source_corpus,
                source_collection,
                source_notice_id,
                unit_id,
                primary_role,
                target_surface,
                consumption_status,
                queryable,
                title,
                published_at,
                canonical_document_id,
                canonical_markdown_object_key,
                body_excerpt,
                search_text,
                search_vector,
                projection_updated_at,
                updated_at,
                record
            )
            select
                source_family,
                source_corpus,
                source_collection,
                source_notice_id,
                unit_id,
                primary_role,
                target_surface,
                consumption_status,
                queryable,
                title,
                published_at,
                canonical_document_id,
                canonical_markdown_object_key,
                body_excerpt,
                search_text,
                search_vector,
                projection_updated_at,
                updated_at,
                record
            from rows
            on conflict (source_corpus, source_collection, unit_id) do update set
                source_family = excluded.source_family,
                source_notice_id = excluded.source_notice_id,
                primary_role = excluded.primary_role,
                target_surface = excluded.target_surface,
                consumption_status = excluded.consumption_status,
                queryable = excluded.queryable,
                title = excluded.title,
                published_at = excluded.published_at,
                canonical_document_id = excluded.canonical_document_id,
                canonical_markdown_object_key = excluded.canonical_markdown_object_key,
                body_excerpt = excluded.body_excerpt,
                search_text = excluded.search_text,
                search_vector = excluded.search_vector,
                projection_updated_at = excluded.projection_updated_at,
                updated_at = excluded.updated_at,
                record = excluded.record
        """

    @staticmethod
    def _recordset_payload(records: Sequence[InternalNoticeReadModelEntry]) -> str:
        payload = []
        for record in records:
            row = {
                "source_family": record.source_family,
                "source_corpus": record.source_corpus,
                "source_collection": record.source_collection,
                "source_notice_id": record.source_notice_id,
                "unit_id": record.unit_id,
                "primary_role": record.primary_role,
                "target_surface": record.target_surface,
                "consumption_status": record.consumption_status,
                "queryable": record.queryable,
                "title": record.title,
                "published_at": record.published_at,
                "canonical_document_id": record.canonical_document_id,
                "canonical_markdown_object_key": record.canonical_markdown_object_key,
                "body_excerpt": record.body_excerpt,
                "search_text": record.search_text,
                "projection_updated_at": record.projection_updated_at,
                "updated_at": record.updated_at,
                "record": asdict(record),
            }
            payload.append(row)
        return json.dumps(payload, ensure_ascii=False)
