from __future__ import annotations

import json
from dataclasses import asdict
from importlib import import_module

from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.registry_shared import (
    _INITIALIZED_RAW_ASSET_TABLES,
    DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE,
    DEFAULT_RAW_ASSET_REGISTRY_TABLE,
    _coerce_json_payload,
    _ensure_table_schema,
    _parse_timestamp,
    _postgres_connection,
    _qualified_table_sql,
    _raw_asset_record_from_dict,
    _raw_asset_registry_scope_scan_key,
    _table_index_suffix,
    normalize_postgres_connection_url,
)


def _registry_facade():
    return import_module("campus_ingestion_core.registry")


def _patched_postgres_connection(*args, **kwargs):
    return _registry_facade()._postgres_connection(*args, **kwargs)


def _raw_asset_scan_page_size() -> int:
    return int(
        getattr(
            _registry_facade(),
            "DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE",
            DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE,
        )
    )


class PostgresRawAssetRegistry:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_RAW_ASSET_REGISTRY_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        self.table_name = table_name
        if not self.database_url:
            raise ValueError("DOCUMENT_REGISTRY_DATABASE_URL is required")
        self._ensure_schema()

    def get(self, raw_asset_id: str, raw_version_id: str) -> RawAssetRecord | None:
        query = (
            f"select record from {self.table_name} where raw_asset_id = %s and raw_version_id = %s"
        )
        row = self._fetchone(query, (raw_asset_id, raw_version_id))
        if row is None:
            return None
        return _raw_asset_record_from_dict(_coerce_json_payload(row[0]))

    def upsert(self, record: RawAssetRecord) -> None:
        self.upsert_many((record,))

    def upsert_many(self, records: tuple[RawAssetRecord, ...]) -> None:
        if not records:
            return
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                self._bulk_upsert_query(),
                (self._recordset_payload(records),),
            )

    def list_by_corpus(self, corpus: str) -> tuple[RawAssetRecord, ...]:
        return self.list_by_scope(corpus)

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[RawAssetRecord, ...]:
        rows = self._scan_scope_record_rows(corpus=corpus, collection=collection)
        return tuple(_raw_asset_record_from_dict(_coerce_json_payload(row[0])) for row in rows)

    def delete_by_corpus(self, corpus: str) -> None:
        self.delete_by_scope(corpus)

    def delete_by_scope(self, corpus: str, collection: str | None = None) -> None:
        if collection is None:
            query = f"delete from {self.table_name} where corpus = %s"
            params: tuple[object, ...] = (corpus,)
        else:
            query = f"delete from {self.table_name} where corpus = %s and collection = %s"
            params = (corpus, collection)
        self._execute(query, params)

    def replace_scope(
        self,
        corpus: str,
        collection: str | None,
        records: tuple[RawAssetRecord, ...],
    ) -> None:
        if collection is None:
            delete_query = f"delete from {self.table_name} where corpus = %s"
            delete_params: tuple[object, ...] = (corpus,)
        else:
            delete_query = f"delete from {self.table_name} where corpus = %s and collection = %s"
            delete_params = (corpus, collection)
        upsert_query = (
            f"insert into {self.table_name} "
            "(raw_asset_id, raw_version_id, corpus, collection, ingestion_timestamp, record) "
            "values (%s, %s, %s, %s, %s, %s::jsonb) "
            "on conflict (raw_asset_id, raw_version_id) do update set "
            "corpus = excluded.corpus, "
            "collection = excluded.collection, "
            "ingestion_timestamp = excluded.ingestion_timestamp, "
            "record = excluded.record"
        )
        with (
            _patched_postgres_connection(self.database_url, autocommit=False) as conn,
            conn.cursor() as cursor,
        ):
            cursor.execute(delete_query, delete_params)
            if records:
                cursor.executemany(
                    upsert_query,
                    tuple(
                        (
                            record.raw_asset_id,
                            record.raw_version_id,
                            record.corpus,
                            record.collection,
                            _parse_timestamp(record.ingestion_timestamp),
                            json.dumps(asdict(record), ensure_ascii=False),
                        )
                        for record in records
                    ),
                )

    def _ensure_schema(self) -> None:
        cache_key = (self.database_url, self.table_name)
        if cache_key in _INITIALIZED_RAW_ASSET_TABLES:
            return
        table_sql = _qualified_table_sql(self.table_name)
        table_index_suffix = _table_index_suffix(self.table_name)
        create_table_statement = f"""
            create table if not exists {table_sql} (
                raw_asset_id text not null,
                raw_version_id text not null,
                corpus text not null,
                collection text not null,
                ingestion_timestamp timestamptz not null,
                record jsonb not null,
                primary key (raw_asset_id, raw_version_id)
            )
            """
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(create_table_statement)
            cursor.execute(
                f"""
                create index if not exists idx_{table_index_suffix}_corpus
                on {table_sql} (corpus, collection, raw_asset_id, raw_version_id)
                """
            )
        _INITIALIZED_RAW_ASSET_TABLES.add(cache_key)

    def _execute(self, query: str, params: tuple[object, ...]) -> None:
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, params)

    def _fetchone(self, query: str, params: tuple[object, ...]) -> tuple[object, ...] | None:
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, params)
            row = cursor.fetchone()
        return tuple(row) if row is not None else None

    def _fetchall(self, query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        return tuple(tuple(row) for row in rows)

    def _scan_scope_record_rows(
        self,
        *,
        corpus: str,
        collection: str | None,
    ) -> tuple[tuple[object, ...], ...]:
        rows: list[tuple[object, ...]] = []
        last_key: tuple[str, str] | None = None
        while True:
            query = f"select record from {self.table_name} where corpus = %s "
            params: list[object] = [corpus]
            if collection is not None:
                query += "and collection = %s "
                params.append(collection)
            if last_key is not None:
                query += "and (raw_asset_id, raw_version_id) > (%s, %s) "
                params.extend(last_key)
            query += "order by raw_asset_id asc, raw_version_id asc limit %s"
            params.append(_raw_asset_scan_page_size())
            page_rows = self._fetchall(query, tuple(params))
            if not page_rows:
                break
            rows.extend(page_rows)
            last_key = _raw_asset_registry_scope_scan_key(page_rows[-1][0])
            if len(page_rows) < _raw_asset_scan_page_size():
                break
        return tuple(rows)

    def _bulk_upsert_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"""
            with rows as (
                select
                    item.raw_asset_id,
                    item.raw_version_id,
                    item.corpus,
                    item.collection,
                    item.ingestion_timestamp,
                    item.record
                from jsonb_to_recordset(%s::jsonb) as item(
                    raw_asset_id text,
                    raw_version_id text,
                    corpus text,
                    collection text,
                    ingestion_timestamp timestamptz,
                    record jsonb
                )
            )
            insert into {table_sql} (
                raw_asset_id,
                raw_version_id,
                corpus,
                collection,
                ingestion_timestamp,
                record
            )
            select
                raw_asset_id,
                raw_version_id,
                corpus,
                collection,
                ingestion_timestamp,
                record
            from rows
            on conflict (raw_asset_id, raw_version_id) do update set
                corpus = excluded.corpus,
                collection = excluded.collection,
                ingestion_timestamp = excluded.ingestion_timestamp,
                record = excluded.record
        """

    @staticmethod
    def _recordset_payload(records: tuple[RawAssetRecord, ...]) -> str:
        payload = [
            {
                "raw_asset_id": record.raw_asset_id,
                "raw_version_id": record.raw_version_id,
                "corpus": record.corpus,
                "collection": record.collection,
                "ingestion_timestamp": record.ingestion_timestamp,
                "record": asdict(record),
            }
            for record in records
        ]
        return json.dumps(payload, ensure_ascii=False)


__all__ = ["PostgresRawAssetRegistry"]
