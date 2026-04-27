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


@dataclass(frozen=True, slots=True)
class StructuredProjectionReleaseRecord:
    release_id: str
    corpus: str
    collection: str
    schema_version: str
    artifact_object_key: str
    artifact_checksum: str
    generated_at: str
    published_at: str
    validation_status: str
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class _TypedColumn:
    name: str
    kind: str
    ddl: str

    @property
    def recordset_sql(self) -> str:
        if self.kind in {"text", "timestamptz"}:
            return f"{self.name} text"
        if self.kind == "integer":
            return f"{self.name} integer"
        if self.kind == "boolean":
            return f"{self.name} boolean"
        if self.kind in {"text_array", "jsonb"}:
            return f"{self.name} jsonb"
        raise ValueError(f"unsupported typed column kind: {self.kind}")

    @property
    def select_sql(self) -> str:
        if self.kind == "text":
            return f"coalesce(item.{self.name}, '') as {self.name}"
        if self.kind == "timestamptz":
            return f"nullif(item.{self.name}, '')::timestamptz as {self.name}"
        if self.kind == "integer":
            return f"coalesce(item.{self.name}, 0) as {self.name}"
        if self.kind == "boolean":
            return f"coalesce(item.{self.name}, false) as {self.name}"
        if self.kind == "jsonb":
            return f"coalesce(item.{self.name}, '[]'::jsonb) as {self.name}"
        if self.kind == "text_array":
            alias = f"{self.name}_values"
            return (
                "coalesce(("
                f"select array_agg(value) from jsonb_array_elements_text("
                f"coalesce(item.{self.name}, '[]'::jsonb)) as {alias}(value)"
                "), '{}'::text[])"
                f" as {self.name}"
            )
        raise ValueError(f"unsupported typed column kind: {self.kind}")


_COMMON_SEARCH_COLUMN = _TypedColumn("search_text", "text", "text not null default ''")

_TYPED_TABLE_COLUMNS: dict[str, tuple[_TypedColumn, ...]] = {
    "service_status_read_model": (
        _TypedColumn("subject_id", "text", "text not null default ''"),
        _TypedColumn("display_name", "text", "text not null default ''"),
        _TypedColumn("aliases", "text_array", "text[] not null default '{}'"),
        _TypedColumn("campus_scope", "text", "text not null default ''"),
        _TypedColumn("observed_status", "text", "text not null default ''"),
        _TypedColumn("effective_from", "timestamptz", "timestamptz"),
        _TypedColumn("effective_until", "timestamptz", "timestamptz"),
        _TypedColumn("override_source_refs", "text_array", "text[] not null default '{}'"),
        _TypedColumn("related_notice_refs", "text_array", "text[] not null default '{}'"),
        _COMMON_SEARCH_COLUMN,
    ),
    "service_guide_read_model": (
        _TypedColumn("service_id", "text", "text not null default ''"),
        _TypedColumn("display_name", "text", "text not null default ''"),
        _TypedColumn("aliases", "text_array", "text[] not null default '{}'"),
        _TypedColumn("category", "text", "text not null default ''"),
        _TypedColumn("campus_scope", "text", "text not null default ''"),
        _TypedColumn("audience", "text_array", "text[] not null default '{}'"),
        _TypedColumn("effective_from", "timestamptz", "timestamptz"),
        _TypedColumn("effective_until", "timestamptz", "timestamptz"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
        _TypedColumn("extraction_status", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "service_guide_conflicts": (
        _TypedColumn("service_id", "text", "text not null default ''"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
    ),
    "service_guide_manual_review_sources": (
        _TypedColumn("service_id", "text", "text not null default ''"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
    ),
    "contact_directory_read_model": (
        _TypedColumn("contact_id", "text", "text not null default ''"),
        _TypedColumn("display_name", "text", "text not null default ''"),
        _TypedColumn("aliases", "text_array", "text[] not null default '{}'"),
        _TypedColumn("contact_group", "text", "text not null default ''"),
        _TypedColumn("department", "text", "text not null default ''"),
        _TypedColumn("phones", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("emails", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("location_refs", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
        _TypedColumn("extraction_status", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "contact_directory_conflicts": (
        _TypedColumn("contact_id", "text", "text not null default ''"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
        _TypedColumn("reason", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "contact_directory_manual_review_sources": (
        _TypedColumn("reason", "text", "text not null default ''"),
        _TypedColumn("line", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "transport_schedule_snapshots": (
        _TypedColumn("snapshot_id", "text", "text not null default ''"),
        _TypedColumn("published_at", "timestamptz", "timestamptz"),
        _TypedColumn("effective_from", "timestamptz", "timestamptz"),
        _TypedColumn("effective_until", "timestamptz", "timestamptz"),
        _TypedColumn("is_current", "boolean", "boolean not null default false"),
        _TypedColumn("schedule_scope", "text", "text not null default ''"),
        _TypedColumn("precedence", "integer", "integer not null default 0"),
    ),
    "transport_routes": (
        _TypedColumn("route_id", "text", "text not null default ''"),
        _TypedColumn("display_name", "text", "text not null default ''"),
        _TypedColumn("service_family", "text", "text not null default ''"),
        _TypedColumn("aliases", "text_array", "text[] not null default '{}'"),
        _TypedColumn("origin_campus", "text", "text not null default ''"),
        _TypedColumn("destination_campus", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "transport_scheduled_departures": (
        _TypedColumn("snapshot_id", "text", "text not null default ''"),
        _TypedColumn("route_id", "text", "text not null default ''"),
        _TypedColumn("service_dates", "text_array", "text[] not null default '{}'"),
        _TypedColumn("departure_time", "text", "text not null default ''"),
        _TypedColumn("arrival_time", "text", "text not null default ''"),
        _TypedColumn("origin_stop_id", "text", "text not null default ''"),
        _TypedColumn("destination_stop_id", "text", "text not null default ''"),
        _TypedColumn("related_notice_refs", "text_array", "text[] not null default '{}'"),
    ),
    "transport_service_exceptions": (
        _TypedColumn("snapshot_id", "text", "text not null default ''"),
        _TypedColumn("route_id", "text", "text not null default ''"),
        _TypedColumn("service_date", "text", "text not null default ''"),
        _TypedColumn("service_status", "text", "text not null default ''"),
        _TypedColumn("related_notice_refs", "text_array", "text[] not null default '{}'"),
    ),
    "transport_operational_notices": (
        _TypedColumn("notice_id", "text", "text not null default ''"),
        _TypedColumn("notice_kind", "text", "text not null default ''"),
        _TypedColumn("route_ids", "text_array", "text[] not null default '{}'"),
        _TypedColumn("effective_from", "timestamptz", "timestamptz"),
        _TypedColumn("effective_until", "timestamptz", "timestamptz"),
        _TypedColumn("operational_comment", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "transport_rejected_sources": (
        _TypedColumn("source_notice_id", "text", "text not null default ''"),
        _TypedColumn("reason", "text", "text not null default ''"),
        _TypedColumn("candidate_kind", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "transport_release_notices": (
        _TypedColumn("source_notice_id", "text", "text not null default ''"),
    ),
}


class PostgresStructuredProjectionPublisher:
    def __init__(
        self,
        database_url: str,
        *,
        schema: str = DEFAULT_INGESTION_PROJECTION_SCHEMA,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("structured projection database url is required")
        self.schema = _normalize_identifier(schema or DEFAULT_INGESTION_PROJECTION_SCHEMA, "schema")
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
            current=True,
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
        for table_name in (
            "structured_projection_releases",
            "structured_projection_current",
            "transport_routes",
            "transport_schedule_snapshots",
            "transport_scheduled_departures",
            "transport_service_exceptions",
            "transport_operational_notices",
            "transport_rejected_sources",
            "transport_release_notices",
            "service_status_read_model",
            "service_guide_read_model",
            "service_guide_conflicts",
            "service_guide_manual_review_sources",
            "contact_directory_read_model",
            "contact_directory_conflicts",
            "contact_directory_manual_review_sources",
        ):
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
        for table_name in _read_model_table_names():
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
) -> PostgresStructuredProjectionPublisher | None:
    source = dict(env if env is not None else os.environ)
    database_url = (source.get(DEFAULT_STRUCTURED_PROJECTION_DATABASE_ENV_KEY) or "").strip()
    if not database_url:
        return None
    return PostgresStructuredProjectionPublisher(
        database_url,
        schema=DEFAULT_INGESTION_PROJECTION_SCHEMA,
    )


def projection_artifact_checksum(payload: Mapping[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _typed_recordsets(
    *,
    collection: str,
    release_id: str,
    bundle: Mapping[str, Any],
) -> tuple[tuple[str, list[dict[str, Any]]], ...]:
    if collection == "service_status":
        return (
            (
                "service_status_read_model",
                _records(
                    release_id,
                    bundle.get("service_status_records"),
                    id_fields=("subject_id",),
                    source_ref_field="related_notice_refs",
                    table_name="service_status_read_model",
                ),
            ),
        )
    if collection == "transport_schedule":
        return (
            (
                "transport_schedule_snapshots",
                _records(
                    release_id,
                    bundle.get("transport_schedule_snapshots"),
                    id_fields=("snapshot_id",),
                    source_ref_field="source_ref",
                    table_name="transport_schedule_snapshots",
                ),
            ),
            (
                "transport_routes",
                _records(
                    release_id,
                    bundle.get("transport_routes"),
                    id_fields=("route_id",),
                    table_name="transport_routes",
                ),
            ),
            (
                "transport_scheduled_departures",
                _records(
                    release_id,
                    bundle.get("scheduled_departures"),
                    id_fields=("snapshot_id", "route_id", "departure_time", "service_dates"),
                    source_ref_field="related_notice_refs",
                    table_name="transport_scheduled_departures",
                ),
            ),
            (
                "transport_service_exceptions",
                _records(
                    release_id,
                    bundle.get("transport_service_exceptions"),
                    id_fields=("snapshot_id", "route_id", "service_date"),
                    source_ref_field="related_notice_refs",
                    table_name="transport_service_exceptions",
                ),
            ),
            (
                "transport_operational_notices",
                _records(
                    release_id,
                    bundle.get("transport_operational_notices"),
                    id_fields=("notice_id", "notice_kind", "route_ids"),
                    source_ref_field="source_ref",
                    table_name="transport_operational_notices",
                ),
            ),
            (
                "transport_rejected_sources",
                _records(
                    release_id,
                    bundle.get("transport_rejected_sources"),
                    id_fields=("source_notice_id", "reason"),
                    source_ref_field="source_ref",
                    table_name="transport_rejected_sources",
                ),
            ),
            (
                "transport_release_notices",
                [
                    {
                        "release_id": release_id,
                        "record_id": notice_id,
                        "source_ref": notice_id,
                        "source_notice_id": notice_id,
                        "record": {"source_notice_id": notice_id},
                    }
                    for notice_id in _source_notice_ids(bundle)
                ],
            ),
        )
    if collection == "service_guide":
        return (
            (
                "service_guide_read_model",
                _records(
                    release_id,
                    bundle.get("service_guide_records"),
                    id_fields=("service_id",),
                    source_ref_field="source_refs",
                    table_name="service_guide_read_model",
                ),
            ),
            (
                "service_guide_conflicts",
                _records(
                    release_id,
                    bundle.get("conflict_records"),
                    id_fields=("service_id",),
                    source_ref_field="source_refs",
                    table_name="service_guide_conflicts",
                ),
            ),
            (
                "service_guide_manual_review_sources",
                _records(
                    release_id,
                    bundle.get("manual_review_sources"),
                    id_fields=("service_id",),
                    source_ref_field="source_refs",
                    table_name="service_guide_manual_review_sources",
                ),
            ),
        )
    if collection == "contact_directory":
        return (
            (
                "contact_directory_read_model",
                _records(
                    release_id,
                    bundle.get("contact_records"),
                    id_fields=("contact_id",),
                    source_ref_field="source_refs",
                    table_name="contact_directory_read_model",
                ),
            ),
            (
                "contact_directory_conflicts",
                _records(
                    release_id,
                    bundle.get("conflict_records"),
                    id_fields=("contact_id", "reason"),
                    source_ref_field="source_refs",
                    table_name="contact_directory_conflicts",
                ),
            ),
            (
                "contact_directory_manual_review_sources",
                _records(
                    release_id,
                    bundle.get("manual_review_sources"),
                    id_fields=("source_ref", "reason", "line"),
                    source_ref_field="source_ref",
                    table_name="contact_directory_manual_review_sources",
                ),
            ),
        )
    raise ValueError(f"unsupported structured projection collection: {collection}")


def _records(
    release_id: str,
    raw_rows: object,
    *,
    id_fields: Sequence[str],
    source_ref_field: str = "",
    table_name: str,
) -> list[dict[str, Any]]:
    rows = raw_rows if isinstance(raw_rows, list) else []
    records: list[dict[str, Any]] = []
    for index, raw_row in enumerate(rows):
        if not isinstance(raw_row, Mapping):
            continue
        row = dict(raw_row)
        record_id = _record_id(row, id_fields=id_fields, fallback_index=index)
        records.append(_record_payload(release_id, record_id, row, source_ref_field, table_name))
    return records


def _record_payload(
    release_id: str,
    record_id: str,
    row: Mapping[str, Any],
    source_ref_field: str,
    table_name: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "release_id": release_id,
        "record_id": record_id,
        "source_ref": _source_ref(row, source_ref_field),
        "record": dict(row),
    }
    for column in _typed_columns(table_name):
        if column.name == "search_text":
            payload[column.name] = _search_text(row)
        else:
            payload[column.name] = row.get(column.name)
    return payload


def _record_id(row: Mapping[str, Any], *, id_fields: Sequence[str], fallback_index: int) -> str:
    parts: list[str] = []
    for field in id_fields:
        value = row.get(field)
        if isinstance(value, list):
            parts.append(",".join(str(item) for item in value))
        else:
            parts.append(str(value or ""))
    normalized = "|".join(part for part in parts if part)
    return normalized or f"record-{fallback_index}"


def _source_ref(row: Mapping[str, Any], field: str) -> str:
    if not field:
        return ""
    value = row.get(field)
    if isinstance(value, str):
        return value
    if isinstance(value, Sequence):
        for item in value:
            text = str(item).strip()
            if text:
                return text
    return ""


def _projection_counts(collection: str, bundle: Mapping[str, Any]) -> dict[str, int]:
    if collection == "service_status":
        return {
            "service_status_records": len(_list(bundle.get("service_status_records"))),
        }
    if collection == "transport_schedule":
        return {
            "snapshots": len(_list(bundle.get("transport_schedule_snapshots"))),
            "routes": len(_list(bundle.get("transport_routes"))),
            "scheduled_departures": len(_list(bundle.get("scheduled_departures"))),
            "service_exceptions": len(_list(bundle.get("transport_service_exceptions"))),
            "operational_notices": len(_list(bundle.get("transport_operational_notices"))),
            "rejected_sources": len(_list(bundle.get("transport_rejected_sources"))),
        }
    if collection == "service_guide":
        return {
            "service_guide_records": len(_list(bundle.get("service_guide_records"))),
            "conflict_records": len(_list(bundle.get("conflict_records"))),
            "manual_review_sources": len(_list(bundle.get("manual_review_sources"))),
        }
    if collection == "contact_directory":
        return {
            "contact_records": len(_list(bundle.get("contact_records"))),
            "conflict_records": len(_list(bundle.get("conflict_records"))),
            "manual_review_sources": len(_list(bundle.get("manual_review_sources"))),
        }
    raise ValueError(f"unsupported structured projection collection: {collection}")


def _collection_table_names(collection: str) -> tuple[str, ...]:
    if collection == "service_status":
        return ("service_status_read_model",)
    if collection == "transport_schedule":
        return (
            "transport_schedule_snapshots",
            "transport_routes",
            "transport_scheduled_departures",
            "transport_service_exceptions",
            "transport_operational_notices",
            "transport_rejected_sources",
            "transport_release_notices",
        )
    if collection == "service_guide":
        return (
            "service_guide_read_model",
            "service_guide_conflicts",
            "service_guide_manual_review_sources",
        )
    if collection == "contact_directory":
        return (
            "contact_directory_read_model",
            "contact_directory_conflicts",
            "contact_directory_manual_review_sources",
        )
    raise ValueError(f"unsupported structured projection collection: {collection}")


def _source_notice_ids(bundle: Mapping[str, Any]) -> list[str]:
    values: set[str] = set()
    for row_group in (
        bundle.get("service_status_records"),
        bundle.get("transport_schedule_snapshots"),
        bundle.get("scheduled_departures"),
        bundle.get("transport_service_exceptions"),
        bundle.get("transport_operational_notices"),
        bundle.get("transport_rejected_sources"),
        bundle.get("service_guide_records"),
    ):
        for row in _list(row_group):
            if not isinstance(row, Mapping):
                continue
            for field in (
                "source_ref",
                "source_refs",
                "related_notice_refs",
                "source_notice_id",
                "notice_id",
            ):
                value = row.get(field)
                refs: Sequence[object]
                if isinstance(value, str):
                    refs = (value,)
                elif isinstance(value, Sequence):
                    refs = value
                else:
                    refs = ()
                for ref in refs:
                    text = str(ref).strip()
                    if text.startswith("notice:"):
                        values.add(text)
                    elif field in {"source_notice_id", "notice_id"} and text:
                        values.add(f"notice:muc_internal_portal:{text}")
    return sorted(values)


def _read_model_table_names() -> tuple[str, ...]:
    return tuple(_TYPED_TABLE_COLUMNS)


def _typed_columns(table_name: str) -> tuple[_TypedColumn, ...]:
    return _TYPED_TABLE_COLUMNS.get(table_name, ())


def _has_typed_column(table_name: str, column_name: str) -> bool:
    return any(column.name == column_name for column in _typed_columns(table_name))


def _search_text(row: Mapping[str, Any]) -> str:
    values: list[str] = []
    for value in row.values():
        _append_search_text(values, value)
    return " ".join(value for value in values if value)


def _append_search_text(values: list[str], value: object) -> None:
    if isinstance(value, str):
        text = value.strip()
        if text:
            values.append(text)
    elif isinstance(value, Sequence) and not isinstance(value, bytes | bytearray):
        for item in value:
            _append_search_text(values, item)
    elif isinstance(value, Mapping):
        for item in value.values():
            _append_search_text(values, item)


def _list(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def _required_text(value: object, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} is required")
    return text


def _release_record_from_row(row: Sequence[object]) -> StructuredProjectionReleaseRecord:
    counts = row[9] if len(row) > 9 else {}
    if isinstance(counts, str):
        parsed_counts = json.loads(counts)
    elif isinstance(counts, Mapping):
        parsed_counts = dict(counts)
    else:
        parsed_counts = {}
    return StructuredProjectionReleaseRecord(
        release_id=str(row[0]),
        corpus=str(row[1]),
        collection=str(row[2]),
        schema_version=str(row[3]),
        artifact_object_key=str(row[4]),
        artifact_checksum=str(row[5]),
        generated_at=str(row[6]),
        published_at=str(row[7]),
        validation_status=str(row[8]),
        counts={str(key): int(value) for key, value in parsed_counts.items()},
    )


def _normalize_identifier(value: str, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized.replace("_", "a").isalnum() or normalized[0].isdigit():
        raise ValueError(f"{field_name} must be a SQL identifier")
    return normalized


__all__ = [
    "DEFAULT_INGESTION_PROJECTION_SCHEMA",
    "DEFAULT_STRUCTURED_PROJECTION_DATABASE_ENV_KEY",
    "PostgresStructuredProjectionPublisher",
    "StructuredProjectionPublishReport",
    "StructuredProjectionReleaseRecord",
    "build_structured_projection_publisher_from_env",
    "projection_artifact_checksum",
]
