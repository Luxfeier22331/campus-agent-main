from __future__ import annotations

import json
from dataclasses import asdict
from importlib import import_module

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry_shared import (
    _INITIALIZED_DOCUMENT_TABLES,
    DEFAULT_DOCUMENT_REGISTRY_SCAN_PAGE_SIZE,
    DEFAULT_DOCUMENT_REGISTRY_TABLE,
    _coerce_json_payload,
    _document_record_from_dict,
    _document_record_from_persisted_payload,
    _document_registry_scope_scan_key,
    _ensure_table_schema,
    _is_unsupported_authorization_projection_error,
    _parse_timestamp,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
    normalize_postgres_connection_url,
)


def _registry_facade():
    return import_module("campus_ingestion_core.registry")


def _patched_postgres_connection(*args, **kwargs):
    return _registry_facade()._postgres_connection(*args, **kwargs)


def _document_scan_page_size() -> int:
    return int(
        getattr(
            _registry_facade(),
            "DEFAULT_DOCUMENT_REGISTRY_SCAN_PAGE_SIZE",
            DEFAULT_DOCUMENT_REGISTRY_SCAN_PAGE_SIZE,
        )
    )


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
        with _patched_postgres_connection(self.database_url, autocommit=False) as conn:
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
        with _patched_postgres_connection(self.database_url) as conn:
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
        with _patched_postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)

    def _executemany(self, query: str, params_seq: tuple[tuple[object, ...], ...]) -> None:
        with _patched_postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.executemany(query, params_seq)

    def _fetchone(self, query: str, params: tuple[object, ...]) -> tuple[object, ...] | None:
        with _patched_postgres_connection(self.database_url) as conn:
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
            params.append(_document_scan_page_size())
            page_rows = self._fetchall(query, tuple(params))
            if not page_rows:
                break
            rows.extend(page_rows)
            last_key = _document_registry_scope_scan_key(page_rows[-1][0])
            if len(page_rows) < _document_scan_page_size():
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


__all__ = ["PostgresDocumentRegistry"]
