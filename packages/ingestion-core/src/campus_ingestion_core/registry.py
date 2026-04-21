from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import datetime
from typing import Protocol

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.models import (
    DocumentRegistryRecord,
    RawAssetRecord,
    RawAssetRef,
    SourceObservation,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
    open_postgres_connection,
    validate_operator_postgres_url,
    validate_persistent_postgres_runtime_url,
)

DEFAULT_REGISTRY_SCHEMA = "ingestion_registry"
DEFAULT_DOCUMENT_REGISTRY_BASENAME = "document_registry_records"
DEFAULT_RAW_ASSET_REGISTRY_BASENAME = "raw_asset_registry_records"
DEFAULT_DOCUMENT_REGISTRY_TABLE = f"{DEFAULT_REGISTRY_SCHEMA}.{DEFAULT_DOCUMENT_REGISTRY_BASENAME}"
DEFAULT_RAW_ASSET_REGISTRY_TABLE = (
    f"{DEFAULT_REGISTRY_SCHEMA}.{DEFAULT_RAW_ASSET_REGISTRY_BASENAME}"
)
DEFAULT_DOCUMENT_REGISTRY_SCAN_PAGE_SIZE = 256
DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE = 256
_INITIALIZED_DOCUMENT_TABLES: set[tuple[str, str]] = set()
_INITIALIZED_RAW_ASSET_TABLES: set[tuple[str, str]] = set()
_SCHEMA_BOOTSTRAP_LOCK_KEY = 174901
SHARED_POSTGRES_ENV_KEY = "CAMPUS_SHARED_POSTGRES_URL"
SHARED_POSTGRES_OPERATOR_ENV_KEY = "CAMPUS_SHARED_POSTGRES_OPERATOR_URL"
SHARED_POSTGRES_MANAGEMENT_ENV_KEY = "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL"
DOCUMENT_REGISTRY_ENV_KEY = "DOCUMENT_REGISTRY_DATABASE_URL"
DOCUMENT_REGISTRY_OPERATOR_ENV_KEY = "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL"
DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY = "DOCUMENT_REGISTRY_MANAGEMENT_DATABASE_URL"
RAW_ASSET_REGISTRY_ENV_KEY = "RAW_ASSET_REGISTRY_DATABASE_URL"
RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY = "RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL"
RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY = "RAW_ASSET_REGISTRY_MANAGEMENT_DATABASE_URL"
_IDENTIFIER = "abcdefghijklmnopqrstuvwxyz_0123456789"


def _assert_identifier(label: str, value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    if normalized[0] not in "abcdefghijklmnopqrstuvwxyz_":
        raise ValueError(f"{label} must be a lowercase PostgreSQL identifier")
    if any(character not in _IDENTIFIER for character in normalized):
        raise ValueError(f"{label} must be a lowercase PostgreSQL identifier")
    return normalized


def _parse_table_name(table_name: str) -> tuple[str | None, str]:
    parts = [part.strip() for part in table_name.split(".")]
    if len(parts) == 1:
        return None, _assert_identifier("table name", parts[0])
    if len(parts) == 2:
        return (
            _assert_identifier("schema name", parts[0]),
            _assert_identifier("table name", parts[1]),
        )
    raise ValueError(f"table name must be <table> or <schema>.<table>: {table_name}")


def _qualified_table_sql(table_name: str) -> str:
    schema_name, relation_name = _parse_table_name(table_name)
    if schema_name is None:
        return f'"{relation_name}"'
    return f'"{schema_name}"."{relation_name}"'


def _table_index_suffix(table_name: str) -> str:
    _, relation_name = _parse_table_name(table_name)
    return relation_name


def _ensure_table_schema(cursor, *, table_name: str) -> None:
    schema_name, _ = _parse_table_name(table_name)
    if schema_name is None:
        return
    cursor.execute(
        "select pg_advisory_lock(%s, hashtext(%s))",
        (_SCHEMA_BOOTSTRAP_LOCK_KEY, schema_name),
    )
    try:
        cursor.execute(f'create schema if not exists "{schema_name}"')
    finally:
        cursor.execute(
            "select pg_advisory_unlock(%s, hashtext(%s))",
            (_SCHEMA_BOOTSTRAP_LOCK_KEY, schema_name),
        )


class DocumentRegistry(Protocol):
    def get(
        self,
        document_id: str,
        revision_track: str,
        version_id: str,
    ) -> DocumentRegistryRecord | None: ...

    def upsert(self, record: DocumentRegistryRecord) -> None: ...

    def upsert_many(self, records: tuple[DocumentRegistryRecord, ...]) -> None: ...

    def list_by_corpus(self, corpus: str) -> tuple[DocumentRegistryRecord, ...]: ...

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]: ...

    def latest_versions(
        self,
        document_id: str,
        revision_track: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]: ...

    def list_versions(
        self,
        document_id: str,
        revision_track: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]: ...

    def current_version(
        self,
        document_id: str,
        preferred_revision_tracks: tuple[str, ...] = (),
    ) -> DocumentRegistryRecord | None: ...

    def delete_document(self, document_id: str) -> None: ...

    def delete_by_corpus(self, corpus: str) -> None: ...

    def delete_by_scope(self, corpus: str, collection: str | None = None) -> None: ...

    def replace_scope(
        self,
        corpus: str,
        collection: str | None,
        records: tuple[DocumentRegistryRecord, ...],
    ) -> None: ...


class RawAssetRegistry(Protocol):
    def get(self, raw_asset_id: str, raw_version_id: str) -> RawAssetRecord | None: ...

    def upsert(self, record: RawAssetRecord) -> None: ...

    def upsert_many(self, records: tuple[RawAssetRecord, ...]) -> None: ...

    def list_by_corpus(self, corpus: str) -> tuple[RawAssetRecord, ...]: ...

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[RawAssetRecord, ...]: ...

    def delete_by_corpus(self, corpus: str) -> None: ...

    def delete_by_scope(self, corpus: str, collection: str | None = None) -> None: ...

    def replace_scope(
        self,
        corpus: str,
        collection: str | None,
        records: tuple[RawAssetRecord, ...],
    ) -> None: ...


class PostgresDocumentRegistry:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_DOCUMENT_REGISTRY_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        self.table_name = table_name
        if not self.database_url:
            raise ValueError("DOCUMENT_REGISTRY_DATABASE_URL is required")
        self._ensure_schema()

    def get(
        self,
        document_id: str,
        revision_track: str,
        version_id: str,
    ) -> DocumentRegistryRecord | None:
        query = (
            f"select record from {self.table_name} "
            "where document_id = %s and revision_track = %s and version_id = %s"
        )
        row = self._fetchone(query, (document_id, revision_track, version_id))
        if row is None:
            return None
        return _document_record_from_persisted_payload(_coerce_json_payload(row[0]))

    def upsert(self, record: DocumentRegistryRecord) -> None:
        self.upsert_many((record,))

    def upsert_many(self, records: tuple[DocumentRegistryRecord, ...]) -> None:
        if not records:
            return
        self._executemany(
            self._upsert_query(),
            tuple(self._record_upsert_params(record) for record in records),
        )

    def list_by_corpus(self, corpus: str) -> tuple[DocumentRegistryRecord, ...]:
        return self.list_by_scope(corpus)

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        rows = self._scan_scope_record_rows(corpus=corpus, collection=collection)
        return tuple(
            _document_record_from_persisted_payload(_coerce_json_payload(row[0])) for row in rows
        )

    def list_processed_object_keys_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[str, ...]:
        rows = self._scan_scope_record_rows(corpus=corpus, collection=collection)
        keys: list[str] = []
        for row in rows:
            raw = _coerce_json_payload(row[0])
            keys.extend(str(item) for item in list(raw.get("processed_object_keys") or []) if item)
        return tuple(keys)

    def list_importable_scope_records_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        rows = self._scan_scope_record_rows(corpus=corpus, collection=collection)
        records: list[DocumentRegistryRecord] = []
        for row in rows:
            raw = _coerce_json_payload(row[0])
            try:
                records.append(_document_record_from_dict(raw))
            except ValueError as exc:
                if _is_unsupported_authorization_projection_error(exc):
                    continue
                raise
        return tuple(records)

    def latest_versions(
        self,
        document_id: str,
        revision_track: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        if revision_track is None:
            query = (
                f"select record from {self.table_name} "
                "where document_id = %s order by ingestion_timestamp desc limit 1"
            )
            params = (document_id,)
        else:
            query = (
                f"select record from {self.table_name} "
                "where document_id = %s and revision_track = %s "
                "order by ingestion_timestamp desc limit 1"
            )
            params = (document_id, revision_track)
        row = self._fetchone(query, params)
        if row is None:
            return ()
        return (_document_record_from_persisted_payload(_coerce_json_payload(row[0])),)

    def list_versions(
        self,
        document_id: str,
        revision_track: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        if revision_track is None:
            query = (
                f"select record from {self.table_name} "
                "where document_id = %s order by ingestion_timestamp desc"
            )
            params = (document_id,)
        else:
            query = (
                f"select record from {self.table_name} "
                "where document_id = %s and revision_track = %s "
                "order by ingestion_timestamp desc"
            )
            params = (document_id, revision_track)
        rows = self._fetchall(query, params)
        return tuple(
            _document_record_from_persisted_payload(_coerce_json_payload(row[0])) for row in rows
        )

    def current_version(
        self,
        document_id: str,
        preferred_revision_tracks: tuple[str, ...] = (),
    ) -> DocumentRegistryRecord | None:
        for revision_track in preferred_revision_tracks:
            row = self._fetchone(
                (
                    f"select record from {self.table_name} "
                    "where document_id = %s and revision_track = %s and (record->>'is_current')::boolean = true "
                    "order by ingestion_timestamp desc limit 1"
                ),
                (document_id, revision_track),
            )
            if row is not None:
                return _document_record_from_persisted_payload(_coerce_json_payload(row[0]))
        row = self._fetchone(
            (
                f"select record from {self.table_name} "
                "where document_id = %s and (record->>'is_current')::boolean = true "
                "order by ingestion_timestamp desc limit 1"
            ),
            (document_id,),
        )
        if row is not None:
            return _document_record_from_persisted_payload(_coerce_json_payload(row[0]))
        return None

    def delete_document(self, document_id: str) -> None:
        query = f"delete from {self.table_name} where document_id = %s"
        self._execute(query, (document_id,))

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
        records: tuple[DocumentRegistryRecord, ...],
    ) -> None:
        if collection is None:
            delete_query = f"delete from {self.table_name} where corpus = %s"
            delete_params: tuple[object, ...] = (corpus,)
        else:
            delete_query = f"delete from {self.table_name} where corpus = %s and collection = %s"
            delete_params = (corpus, collection)
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
                cursor.execute(delete_query, delete_params)
                if records:
                    cursor.execute(
                        self._bulk_upsert_query(),
                        (self._recordset_payload(records),),
                    )

    def _ensure_schema(self) -> None:
        cache_key = (self.database_url, self.table_name)
        if cache_key in _INITIALIZED_DOCUMENT_TABLES:
            return
        table_sql = _qualified_table_sql(self.table_name)
        table_index_suffix = _table_index_suffix(self.table_name)
        create_table_statement = f"""
            create table if not exists {table_sql} (
                document_id text not null,
                revision_track text not null,
                version_id text not null,
                corpus text not null,
                collection text not null,
                ingestion_timestamp timestamptz not null,
                record jsonb not null,
                primary key (document_id, revision_track, version_id)
            )
            """
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                _ensure_table_schema(cursor, table_name=self.table_name)
                cursor.execute(create_table_statement)
                cursor.execute(
                    f"""
                    create index if not exists idx_{table_index_suffix}_corpus
                    on {table_sql} (corpus, collection, document_id, revision_track, version_id)
                    """
                )
                cursor.execute(
                    f"""
                    create index if not exists idx_{table_index_suffix}_latest
                    on {table_sql} (document_id, revision_track, ingestion_timestamp desc)
                    """
                )
                cursor.execute(
                    f"""
                    create index if not exists idx_{table_index_suffix}_current
                    on {table_sql} (document_id, ingestion_timestamp desc)
                    where (record->>'is_current')::boolean = true
                    """
                )
        _INITIALIZED_DOCUMENT_TABLES.add(cache_key)

    def _execute(self, query: str, params: tuple[object, ...]) -> None:
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)

    def _executemany(self, query: str, params_seq: tuple[tuple[object, ...], ...]) -> None:
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.executemany(query, params_seq)

    def _fetchone(self, query: str, params: tuple[object, ...]) -> tuple[object, ...] | None:
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                row = cursor.fetchone()
        return tuple(row) if row is not None else None

    def _fetchall(self, query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
        last_key: tuple[str, str, str] | None = None
        while True:
            query = f"select record from {self.table_name} where corpus = %s "
            params: list[object] = [corpus]
            if collection is not None:
                query += "and collection = %s "
                params.append(collection)
            if last_key is not None:
                query += "and (document_id, revision_track, version_id) > (%s, %s, %s) "
                params.extend(last_key)
            query += "order by document_id asc, revision_track asc, version_id asc limit %s"
            params.append(DEFAULT_DOCUMENT_REGISTRY_SCAN_PAGE_SIZE)
            page_rows = self._fetchall(query, tuple(params))
            if not page_rows:
                break
            rows.extend(page_rows)
            last_key = _document_registry_scope_scan_key(page_rows[-1][0])
            if len(page_rows) < DEFAULT_DOCUMENT_REGISTRY_SCAN_PAGE_SIZE:
                break
        return tuple(rows)

    def _upsert_query(self) -> str:
        return (
            f"insert into {self.table_name} "
            "(document_id, revision_track, version_id, corpus, collection, ingestion_timestamp, record) "
            "values (%s, %s, %s, %s, %s, %s, %s::jsonb) "
            "on conflict (document_id, revision_track, version_id) do update set "
            "corpus = excluded.corpus, "
            "collection = excluded.collection, "
            "ingestion_timestamp = excluded.ingestion_timestamp, "
            "record = excluded.record"
        )

    @staticmethod
    def _record_upsert_params(record: DocumentRegistryRecord) -> tuple[object, ...]:
        return (
            record.document_id,
            record.revision_track,
            record.version_id,
            record.corpus,
            record.collection,
            _parse_timestamp(record.ingestion_timestamp),
            json.dumps(asdict(record), ensure_ascii=False),
        )

    def _bulk_upsert_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"""
            with rows as (
                select
                    item.document_id,
                    item.revision_track,
                    item.version_id,
                    item.corpus,
                    item.collection,
                    item.ingestion_timestamp,
                    item.record
                from jsonb_to_recordset(%s::jsonb) as item(
                    document_id text,
                    revision_track text,
                    version_id text,
                    corpus text,
                    collection text,
                    ingestion_timestamp timestamptz,
                    record jsonb
                )
            )
            insert into {table_sql} (
                document_id,
                revision_track,
                version_id,
                corpus,
                collection,
                ingestion_timestamp,
                record
            )
            select
                document_id,
                revision_track,
                version_id,
                corpus,
                collection,
                ingestion_timestamp,
                record
            from rows
            on conflict (document_id, revision_track, version_id) do update set
                corpus = excluded.corpus,
                collection = excluded.collection,
                ingestion_timestamp = excluded.ingestion_timestamp,
                record = excluded.record
        """

    @staticmethod
    def _recordset_payload(records: tuple[DocumentRegistryRecord, ...]) -> str:
        payload = [
            {
                "document_id": record.document_id,
                "revision_track": record.revision_track,
                "version_id": record.version_id,
                "corpus": record.corpus,
                "collection": record.collection,
                "ingestion_timestamp": record.ingestion_timestamp,
                "record": asdict(record),
            }
            for record in records
        ]
        return json.dumps(payload, ensure_ascii=False)


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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)

    def _fetchone(self, query: str, params: tuple[object, ...]) -> tuple[object, ...] | None:
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                row = cursor.fetchone()
        return tuple(row) if row is not None else None

    def _fetchall(self, query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
            params.append(DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE)
            page_rows = self._fetchall(query, tuple(params))
            if not page_rows:
                break
            rows.extend(page_rows)
            last_key = _raw_asset_registry_scope_scan_key(page_rows[-1][0])
            if len(page_rows) < DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE:
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


def build_document_registry_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> DocumentRegistry:
    source = env if env is not None else os.environ
    if prefer_operator:
        return PostgresDocumentRegistry(
            build_operator_postgres_connection_url(
                _required_document_registry_operator_database_url(source)
            )
        )
    return PostgresDocumentRegistry(_required_document_registry_database_url(source))


def build_raw_asset_registry_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> RawAssetRegistry:
    source = env if env is not None else os.environ
    if prefer_operator:
        return PostgresRawAssetRegistry(
            build_operator_postgres_connection_url(
                _required_raw_asset_registry_operator_database_url(source)
            )
        )
    return PostgresRawAssetRegistry(_required_raw_asset_registry_database_url(source))


def _required_document_registry_database_url(source: dict[str, str]) -> str:
    database_url = (source.get(DOCUMENT_REGISTRY_ENV_KEY) or "").strip() or (
        source.get(SHARED_POSTGRES_ENV_KEY) or ""
    ).strip()
    if not database_url:
        raise ValueError(f"{DOCUMENT_REGISTRY_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required")
    return validate_persistent_postgres_runtime_url(database_url)


def _required_raw_asset_registry_database_url(source: dict[str, str]) -> str:
    database_url = (
        (source.get(RAW_ASSET_REGISTRY_ENV_KEY) or "").strip()
        or (source.get(DOCUMENT_REGISTRY_ENV_KEY) or "").strip()
        or (source.get(SHARED_POSTGRES_ENV_KEY) or "").strip()
    )
    if not database_url:
        raise ValueError(
            f"{RAW_ASSET_REGISTRY_ENV_KEY} or {DOCUMENT_REGISTRY_ENV_KEY} or "
            f"{SHARED_POSTGRES_ENV_KEY} is required"
        )
    return validate_persistent_postgres_runtime_url(database_url)


def _optional_document_registry_operator_database_url(source: dict[str, str]) -> str:
    database_url = (
        (source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY) or "").strip()
        or (source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY) or "").strip()
        or (source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY) or "").strip()
        or (source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY) or "").strip()
    )
    if not database_url:
        return ""
    return validate_operator_postgres_url(database_url)


def _required_document_registry_operator_database_url(source: dict[str, str]) -> str:
    database_url = _optional_document_registry_operator_database_url(source)
    if not database_url:
        raise ValueError(
            f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or "
            f"{DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY} or "
            f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
            f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when prefer_operator=True"
        )
    return database_url


def _optional_raw_asset_registry_operator_database_url(source: dict[str, str]) -> str:
    database_url = (
        (source.get(RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY) or "").strip()
        or (source.get(RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY) or "").strip()
        or (source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY) or "").strip()
        or (source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY) or "").strip()
        or (source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY) or "").strip()
        or (source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY) or "").strip()
    )
    if not database_url:
        return ""
    return validate_operator_postgres_url(database_url)


def _required_raw_asset_registry_operator_database_url(source: dict[str, str]) -> str:
    database_url = _optional_raw_asset_registry_operator_database_url(source)
    if not database_url:
        raise ValueError(
            f"{RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY} or "
            f"{RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY} or "
            f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or "
            f"{DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY} or "
            f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
            f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when prefer_operator=True"
        )
    return database_url


def _postgres_connection(database_url: str, *, autocommit: bool = True):
    return open_postgres_connection(database_url, autocommit=autocommit)


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _coerce_json_payload(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        return json.loads(value)
    raise TypeError(f"unexpected registry payload type: {type(value)!r}")


def _document_record_from_persisted_payload(raw: dict[str, object]) -> DocumentRegistryRecord:
    return _document_record_from_dict(_canonicalize_persisted_authorization_projection_payload(raw))


def _document_registry_scope_scan_key(payload: object) -> tuple[str, str, str]:
    raw = _coerce_json_payload(payload)
    return (
        str(raw.get("document_id") or ""),
        str(raw.get("revision_track") or ""),
        str(raw.get("version_id") or ""),
    )


def _canonicalize_persisted_authorization_projection_payload(
    raw: dict[str, object],
) -> dict[str, object]:
    legacy_keys_present = tuple(
        key for key in ("acl_groups", "campus_scope", "acl_level") if raw.get(key) is not None
    )
    if not legacy_keys_present:
        return raw
    normalized = dict(raw)
    if normalized.get("entitlement_groups") is None and normalized.get("acl_groups") is not None:
        normalized["entitlement_groups"] = normalized["acl_groups"]
    if normalized.get("visibility_scope") is None and normalized.get("campus_scope") is not None:
        normalized["visibility_scope"] = normalized["campus_scope"]
    if (
        not str(normalized.get("visibility_level") or "").strip()
        and normalized.get("acl_level") is not None
    ):
        normalized["visibility_level"] = normalized["acl_level"]
    if not str(normalized.get("policy_projection_version") or "").strip():
        normalized["policy_projection_version"] = DEFAULT_POLICY_PROJECTION_VERSION
    normalized.pop("acl_groups", None)
    normalized.pop("campus_scope", None)
    normalized.pop("acl_level", None)
    return normalized


def _document_record_from_dict(raw: dict[str, object]) -> DocumentRegistryRecord:
    _assert_canonical_authorization_projection_payload(raw)
    processed_object_keys = tuple(
        str(item) for item in list(raw.get("processed_object_keys") or [])
    )
    provider_response_object_key = (
        str(raw["provider_response_object_key"])
        if raw.get("provider_response_object_key") is not None
        else None
    )
    layout_elements_object_key = (
        str(raw["layout_elements_object_key"])
        if raw.get("layout_elements_object_key") is not None
        else None
    )
    document_units_object_key = (
        str(raw["document_units_object_key"])
        if raw.get("document_units_object_key") is not None
        else None
    )
    canonical_markdown_object_key = (
        str(raw["canonical_markdown_object_key"])
        if raw.get("canonical_markdown_object_key") is not None
        else None
    )
    raw_asset_payload = raw.get("raw_asset")
    raw_asset = None
    if isinstance(raw_asset_payload, dict):
        raw_asset = _raw_asset_ref_from_dict(raw_asset_payload)
    source_channel = _required_registry_text(raw, "source_channel")
    source_uri = str(raw["source_uri"])
    source_observations = _source_observations_from_raw(
        raw=raw,
        source_channel=source_channel,
        source_uri=source_uri,
        raw_asset=raw_asset,
        import_source=str(raw["import_source"]),
    )
    return DocumentRegistryRecord(
        document_id=str(raw["document_id"]),
        revision_track=str(raw["revision_track"]),
        version_id=str(raw["version_id"]),
        source_uri=source_uri,
        content_hash=str(raw["content_hash"]),
        corpus=_required_registry_text(raw, "corpus"),
        collection=_required_registry_text(raw, "collection"),
        cleaning_policy_version=str(raw.get("cleaning_policy_version") or ""),
        entitlement_groups=_resolved_record_entitlement_groups(raw),
        visibility_scope=_resolved_record_visibility_scope(raw),
        visibility_level=str(raw.get("visibility_level") or ""),
        policy_projection_version=str(raw.get("policy_projection_version") or ""),
        status=str(raw["status"]),
        ingestion_timestamp=str(raw["ingestion_timestamp"]),
        parser_version=str(raw["parser_version"]),
        embedding_model=str(raw.get("embedding_model") or ""),
        source_channel=source_channel,
        is_current=bool(raw.get("is_current", False)),
        effective_date=str(raw["effective_date"])
        if raw.get("effective_date") is not None
        else None,
        published_date=str(raw["published_date"])
        if raw.get("published_date") is not None
        else None,
        supersedes_version_id=(
            str(raw["supersedes_version_id"])
            if raw.get("supersedes_version_id") is not None
            else None
        ),
        provenance_status=str(raw.get("provenance_status") or ""),
        raw_asset=raw_asset,
        source_observations=source_observations,
        document_units_object_key=document_units_object_key,
        provider_response_object_key=provider_response_object_key,
        layout_elements_object_key=layout_elements_object_key,
        canonical_markdown_object_key=canonical_markdown_object_key,
        processed_object_keys=processed_object_keys,
        import_source=str(raw["import_source"]),
    )


def _raw_asset_record_from_dict(raw: dict[str, object]) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=str(raw["raw_asset_id"]),
        raw_version_id=str(raw["raw_version_id"]),
        corpus=_required_registry_text(raw, "corpus"),
        collection=_required_registry_text(raw, "collection"),
        raw_source_uri=str(raw["raw_source_uri"]),
        content_hash=str(raw["content_hash"]),
        source_filename=str(raw["source_filename"]),
        object_key=str(raw["object_key"]),
        content_type=_optional_registry_text(raw, "content_type"),
        file_extension=str(raw.get("file_extension") or ""),
        byte_size=_optional_registry_int(raw, "byte_size"),
        page_count=_optional_registry_int(raw, "page_count"),
        image_width=_optional_registry_int(raw, "image_width"),
        image_height=_optional_registry_int(raw, "image_height"),
        asset_kind=str(raw.get("asset_kind") or ""),
        asset_subkind=str(raw.get("asset_subkind") or ""),
        classification_confidence=_optional_registry_float(raw, "classification_confidence"),
        ingestion_timestamp=str(raw["ingestion_timestamp"]),
        import_source=str(raw["import_source"]),
    )


def _raw_asset_registry_scope_scan_key(payload: object) -> tuple[str, str]:
    raw = _coerce_json_payload(payload)
    return (
        str(raw.get("raw_asset_id") or ""),
        str(raw.get("raw_version_id") or ""),
    )


def _raw_asset_ref_from_dict(raw: dict[str, object]) -> RawAssetRef:
    return RawAssetRef(
        raw_asset_id=str(raw["raw_asset_id"]),
        raw_version_id=str(raw["raw_version_id"]),
        page_start=int(raw["page_start"]) if raw.get("page_start") is not None else None,
        page_end=int(raw["page_end"]) if raw.get("page_end") is not None else None,
    )


def _source_observations_from_raw(
    *,
    raw: dict[str, object],
    source_channel: str,
    source_uri: str,
    raw_asset: RawAssetRef | None,
    import_source: str,
) -> tuple[SourceObservation, ...]:
    if "source_observations" not in raw:
        return (
            SourceObservation(
                source_channel=source_channel,
                source_uri=source_uri,
                raw_asset=raw_asset,
                is_primary=True,
                import_source=import_source,
            ),
        )
    observations_payload = raw.get("source_observations") or []
    observations: list[SourceObservation] = []
    for item in list(observations_payload):
        if not isinstance(item, dict):
            continue
        observation_raw_asset = item.get("raw_asset")
        observations.append(
            SourceObservation(
                source_channel=str(item.get("source_channel") or source_channel),
                source_uri=str(item.get("source_uri") or source_uri),
                raw_asset=(
                    _raw_asset_ref_from_dict(observation_raw_asset)
                    if isinstance(observation_raw_asset, dict)
                    else None
                ),
                is_primary=bool(item.get("is_primary", False)),
                import_source=str(item.get("import_source") or ""),
            )
        )
    return tuple(observations)


def _assert_canonical_authorization_projection_payload(raw: dict[str, object]) -> None:
    unsupported_keys = tuple(
        key
        for key in raw
        if _looks_like_authorization_projection_key(key)
        and key not in _SUPPORTED_AUTHORIZATION_PROJECTION_KEYS
    )
    if unsupported_keys:
        joined = ", ".join(unsupported_keys)
        raise ValueError(
            f"registry payload contains unsupported authorization projection keys: {joined}"
        )


def _is_unsupported_authorization_projection_error(exc: ValueError) -> bool:
    return "registry payload contains unsupported authorization projection keys" in str(exc)


_SUPPORTED_AUTHORIZATION_PROJECTION_KEYS = frozenset(
    {
        "entitlement_groups",
        "visibility_scope",
        "visibility_level",
        "policy_projection_version",
    }
)


def _looks_like_authorization_projection_key(key: str) -> bool:
    return (
        key.startswith("entitlement_")
        or key.startswith("visibility_")
        or key.startswith("policy_projection_")
        or key.endswith("_groups")
        or key.endswith("_scope")
        or key.endswith("_level")
    )


def _required_registry_text(raw: dict[str, object], field_name: str) -> str:
    value = raw.get(field_name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"registry payload is missing required {field_name}")
    return value.strip()


def _optional_registry_text(raw: dict[str, object], field_name: str) -> str | None:
    value = raw.get(field_name)
    if value is None:
        return None
    if not isinstance(value, str):
        return str(value)
    normalized = value.strip()
    return normalized or None


def _optional_registry_int(raw: dict[str, object], field_name: str) -> int | None:
    value = raw.get(field_name)
    if value is None or value == "":
        return None
    return int(value)


def _optional_registry_float(raw: dict[str, object], field_name: str) -> float | None:
    value = raw.get(field_name)
    if value is None or value == "":
        return None
    return float(value)


def _resolved_record_entitlement_groups(raw: dict[str, object]) -> tuple[str, ...]:
    return tuple(str(item) for item in list(raw.get("entitlement_groups") or []))


def _resolved_record_visibility_scope(raw: dict[str, object]) -> str | None:
    if raw.get("visibility_scope") is not None:
        return str(raw["visibility_scope"])
    return None
