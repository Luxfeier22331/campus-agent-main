from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.postgres_runtime import (
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
)
from campus_ingestion_core.structured_projection_postgres_models import (
    StructuredProjectionReleaseRecord,
)
from campus_ingestion_core.structured_projection_postgres_records import (
    _bootstrap_read_model_table_names,
    _bootstrap_table_names,
    _collection_table_names,
    _has_typed_column,
    _normalize_bootstrap_collections,
    _normalize_identifier,
    _projection_counts,
    _release_record_from_row,
    _required_text,
    _source_notice_ids,
    _typed_columns,
    _typed_recordsets,
)

DEFAULT_INGESTION_PROJECTION_SCHEMA = "ingestion_projection"
DEFAULT_STRUCTURED_PROJECTION_DATABASE_ENV_KEY = "CAMPUS_SHARED_POSTGRES_URL"


@dataclass(frozen=True, slots=True)
class StructuredProjectionPublishReport:
    corpus: str
    collection: str
    release_id: str
    schema_version: str
    current: bool
    counts: dict[str, int]


class PostgresStructuredProjectionPublisher:
    def __init__(
        self,
        database_url: str,
        *,
        schema: str = DEFAULT_INGESTION_PROJECTION_SCHEMA,
        bootstrap_collections: Sequence[str] | None = None,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("structured projection database url is required")
        self.schema = _normalize_identifier(schema or DEFAULT_INGESTION_PROJECTION_SCHEMA, "schema")
        self.bootstrap_collections = _normalize_bootstrap_collections(bootstrap_collections)
        self._ensure_schema()

    def publish_release(
        self,
        *,
        corpus: str,
        collection: str,
        release_id: str,
        generated_at: str,
        schema_version: str,
        artifact_object_key: str,
        artifact_checksum: str,
        bundle: Mapping[str, Any],
        validation_status: str,
        promote_current: bool = True,
    ) -> StructuredProjectionPublishReport:
        normalized_corpus = _required_text(corpus, "corpus")
        normalized_collection = _required_text(collection, "collection")
        normalized_release_id = _required_text(release_id, "release_id")
        normalized_schema_version = _required_text(schema_version, "schema_version")
        normalized_generated_at = _required_text(generated_at, "generated_at")
        normalized_artifact_key = _required_text(artifact_object_key, "artifact_object_key")
        normalized_checksum = _required_text(artifact_checksum, "artifact_checksum")
        normalized_validation = _required_text(validation_status, "validation_status")
        runtime_bundle = dict(bundle)
        recordsets = _typed_recordsets(
            collection=normalized_collection,
            release_id=normalized_release_id,
            bundle=runtime_bundle,
        )
        counts = _projection_counts(normalized_collection, runtime_bundle)
        source_notice_ids = _source_notice_ids(runtime_bundle)
        with (
            _postgres_connection(self.database_url, autocommit=False) as conn,
            conn.cursor() as cursor,
        ):
            self._ensure_schema(cursor)
            for table_name in _collection_table_names(normalized_collection):
                cursor.execute(
                    f"delete from {self._table_sql(table_name)} where release_id = %s",
                    (normalized_release_id,),
                )
            for table_name, rows in recordsets:
                if rows:
                    cursor.execute(
                        self._recordset_insert_query(table_name, self._table_sql(table_name)),
                        (json.dumps(rows, ensure_ascii=False),),
                    )
            cursor.execute(
                self._release_upsert_query(),
                (
                    normalized_release_id,
                    normalized_corpus,
                    normalized_collection,
                    normalized_schema_version,
                    normalized_artifact_key,
                    normalized_checksum,
                    normalized_generated_at,
                    source_notice_ids,
                    json.dumps(counts, ensure_ascii=False),
                    normalized_validation,
                ),
            )
            if promote_current:
                cursor.execute(
                    self._current_pointer_upsert_query(),
                    (
                        normalized_corpus,
                        normalized_collection,
                        normalized_release_id,
                    ),
                )
        return StructuredProjectionPublishReport(
            corpus=normalized_corpus,
            collection=normalized_collection,
            release_id=normalized_release_id,
            schema_version=normalized_schema_version,
            current=bool(promote_current),
            counts=counts,
        )

    def get_current_release(self, *, corpus: str, collection: str) -> str | None:
        normalized_corpus = _required_text(corpus, "corpus")
        normalized_collection = _required_text(collection, "collection")
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            self._ensure_schema(cursor)
            cursor.execute(
                f"""
                select release_id
                from {self._table_sql("structured_projection_current")}
                where corpus = %s and collection = %s
                """,
                (normalized_corpus, normalized_collection),
            )
            row = cursor.fetchone()
        if row is None:
            return None
        return str(row[0])

    def list_releases(
        self,
        *,
        corpus: str,
        collection: str,
        limit: int = 20,
    ) -> list[StructuredProjectionReleaseRecord]:
        normalized_corpus = _required_text(corpus, "corpus")
        normalized_collection = _required_text(collection, "collection")
        normalized_limit = max(1, min(int(limit), 100))
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            self._ensure_schema(cursor)
            cursor.execute(
                f"""
                select
                    release_id,
                    corpus,
                    collection,
                    schema_version,
                    artifact_object_key,
                    artifact_checksum,
                    generated_at::text,
                    published_at::text,
                    validation_status,
                    counts
                from {self._table_sql("structured_projection_releases")}
                where corpus = %s and collection = %s
                order by generated_at desc, published_at desc
                limit %s
                """,
                (normalized_corpus, normalized_collection, normalized_limit),
            )
            rows = cursor.fetchall()
        return [_release_record_from_row(row) for row in rows]

    def promote_release(self, *, corpus: str, collection: str, release_id: str) -> str:
        normalized_corpus = _required_text(corpus, "corpus")
        normalized_collection = _required_text(collection, "collection")
        normalized_release_id = _required_text(release_id, "release_id")
        with (
            _postgres_connection(self.database_url, autocommit=False) as conn,
            conn.cursor() as cursor,
        ):
            self._ensure_schema(cursor)
            cursor.execute(
                f"""
                select release_id
                from {self._table_sql("structured_projection_releases")}
                where corpus = %s and collection = %s and release_id = %s
                """,
                (normalized_corpus, normalized_collection, normalized_release_id),
            )
            row = cursor.fetchone()
            if row is None:
                raise ValueError(
                    "structured projection release does not exist for "
                    f"{normalized_corpus}/{normalized_collection}: {normalized_release_id}"
                )
            cursor.execute(
                self._current_pointer_upsert_query(),
                (
                    normalized_corpus,
                    normalized_collection,
                    normalized_release_id,
                ),
            )
        return normalized_release_id

    def _ensure_schema(self, cursor: object | None = None) -> None:
        if cursor is None:
            with _postgres_connection(self.database_url) as conn, conn.cursor() as runtime_cursor:
                self._ensure_schema(runtime_cursor)
            return
        bootstrap_collections = getattr(self, "bootstrap_collections", None)
        for table_name in _bootstrap_table_names(bootstrap_collections):
            _ensure_table_schema(cursor, table_name=f"{self.schema}.{table_name}")
        cursor.execute(
            f"""
            create table if not exists {self._table_sql("structured_projection_releases")} (
                release_id text primary key,
                corpus text not null,
                collection text not null,
                schema_version text not null,
                artifact_object_key text not null,
                artifact_checksum text not null,
                generated_at timestamptz not null,
                published_at timestamptz not null default now(),
                source_notice_ids text[] not null default '{{}}',
                counts jsonb not null,
                validation_status text not null
            )
            """
        )
        cursor.execute(
            f"""
            create table if not exists {self._table_sql("structured_projection_current")} (
                corpus text not null,
                collection text not null,
                release_id text not null,
                updated_at timestamptz not null default now(),
                primary key (corpus, collection)
            )
            """
        )
        for table_name in _bootstrap_read_model_table_names(bootstrap_collections):
            self._ensure_read_model_table(cursor, table_name)

    def _table_sql(self, table_name: str) -> str:
        return _qualified_table_sql(f"{self.schema}.{table_name}")

    def _ensure_read_model_table(self, cursor: object, table_name: str) -> None:
        cursor.execute(
            f"""
            create table if not exists {self._table_sql(table_name)} (
                release_id text not null,
                record_id text not null,
                source_ref text not null default '',
                record jsonb not null,
                updated_at timestamptz not null default now(),
                primary key (release_id, record_id)
            )
            """
        )
        for column in _typed_columns(table_name):
            cursor.execute(
                f"""
                alter table {self._table_sql(table_name)}
                add column if not exists {column.name} {column.ddl}
                """
            )
        cursor.execute(
            f"""
            create index if not exists idx_{self.schema}_{table_name}_source_ref
            on {self._table_sql(table_name)} (source_ref)
            """
        )
        if _has_typed_column(table_name, "search_text"):
            cursor.execute(
                f"""
                create index if not exists idx_{self.schema}_{table_name}_search_text
                on {self._table_sql(table_name)} using gin (to_tsvector('simple', search_text))
                """
            )

    @staticmethod
    def _recordset_insert_query(table_name: str, table_sql: str) -> str:
        typed_columns = _typed_columns(table_name)
        item_columns = ",\n                    ".join(
            [
                "release_id text",
                "record_id text",
                "source_ref text",
                "record jsonb",
                *[column.recordset_sql for column in typed_columns],
            ]
        )
        insert_columns = [
            "release_id",
            "record_id",
            "source_ref",
            *[column.name for column in typed_columns],
            "record",
        ]
        cte_typed_select_columns = [column.select_sql for column in typed_columns]
        select_columns = [
            "release_id",
            "record_id",
            "source_ref",
            *[column.name for column in typed_columns],
            "record",
        ]
        update_columns = [
            "source_ref = excluded.source_ref",
            *[f"{column.name} = excluded.{column.name}" for column in typed_columns],
            "record = excluded.record",
            "updated_at = now()",
        ]
        return f"""
            with rows as (
                select
                    item.release_id,
                    item.record_id,
                    coalesce(item.source_ref, '') as source_ref,
                    item.record,
                    {", ".join(cte_typed_select_columns) if typed_columns else "null as _unused"}
                from jsonb_to_recordset(%s::jsonb) as item(
                    {item_columns}
                )
            )
            insert into {table_sql} (
                {", ".join(insert_columns)}
            )
            select
                {", ".join(select_columns)}
            from rows
            on conflict (release_id, record_id) do update set
                {", ".join(update_columns)}
        """

    def _release_upsert_query(self) -> str:
        return f"""
            insert into {self._table_sql("structured_projection_releases")} (
                release_id,
                corpus,
                collection,
                schema_version,
                artifact_object_key,
                artifact_checksum,
                generated_at,
                source_notice_ids,
                counts,
                validation_status
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
            on conflict (release_id) do update set
                corpus = excluded.corpus,
                collection = excluded.collection,
                schema_version = excluded.schema_version,
                artifact_object_key = excluded.artifact_object_key,
                artifact_checksum = excluded.artifact_checksum,
                generated_at = excluded.generated_at,
                source_notice_ids = excluded.source_notice_ids,
                counts = excluded.counts,
                validation_status = excluded.validation_status,
                published_at = now()
        """

    def _current_pointer_upsert_query(self) -> str:
        return f"""
            insert into {self._table_sql("structured_projection_current")} (
                corpus,
                collection,
                release_id
            ) values (%s, %s, %s)
            on conflict (corpus, collection) do update set
                release_id = excluded.release_id,
                updated_at = now()
        """


def build_structured_projection_publisher_from_env(
    env: Mapping[str, str] | None = None,
    *,
    bootstrap_collections: Sequence[str] | None = None,
) -> PostgresStructuredProjectionPublisher | None:
    source = dict(env if env is not None else os.environ)
    database_url = (source.get(DEFAULT_STRUCTURED_PROJECTION_DATABASE_ENV_KEY) or "").strip()
    if not database_url:
        return None
    return PostgresStructuredProjectionPublisher(
        database_url,
        schema=DEFAULT_INGESTION_PROJECTION_SCHEMA,
        bootstrap_collections=bootstrap_collections,
    )


def projection_artifact_checksum(payload: Mapping[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return "sha256:" + hashlib.sha256(encoded).hexdigest()
