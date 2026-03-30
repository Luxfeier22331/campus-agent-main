from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
import json
import os
from typing import Protocol

from campus_ingestion_core.artifacts import (
    CANONICAL_MARKDOWN_FILENAME,
    DOCUMENT_UNITS_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord, RawAssetRef, SourceObservation


DEFAULT_DOCUMENT_REGISTRY_TABLE = "document_registry_records"
DEFAULT_RAW_ASSET_REGISTRY_TABLE = "raw_asset_registry_records"
_INITIALIZED_DOCUMENT_TABLES: set[tuple[str, str]] = set()
_INITIALIZED_RAW_ASSET_TABLES: set[tuple[str, str]] = set()
SHARED_POSTGRES_ENV_KEY = "CAMPUS_SHARED_POSTGRES_URL"
DOCUMENT_REGISTRY_ENV_KEY = "DOCUMENT_REGISTRY_DATABASE_URL"
RAW_ASSET_REGISTRY_ENV_KEY = "RAW_ASSET_REGISTRY_DATABASE_URL"


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

    def list_by_corpus(self, corpus: str) -> tuple[RawAssetRecord, ...]: ...

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[RawAssetRecord, ...]: ...

    def delete_by_corpus(self, corpus: str) -> None: ...

    def delete_by_scope(self, corpus: str, collection: str | None = None) -> None: ...


class PostgresDocumentRegistry:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_DOCUMENT_REGISTRY_TABLE,
    ) -> None:
        self.database_url = database_url.strip()
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
        return _document_record_from_dict(_coerce_json_payload(row[0]))

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
        if collection is None:
            query = (
                f"select record from {self.table_name} "
                "where corpus = %s order by document_id asc, revision_track asc, version_id asc"
            )
            params: tuple[object, ...] = (corpus,)
        else:
            query = (
                f"select record from {self.table_name} "
                "where corpus = %s and collection = %s order by document_id asc, revision_track asc, version_id asc"
            )
            params = (corpus, collection)
        rows = self._fetchall(query, params)
        return tuple(_document_record_from_dict(_coerce_json_payload(row[0])) for row in rows)

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
        return (_document_record_from_dict(_coerce_json_payload(row[0])),)

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
                return _document_record_from_dict(_coerce_json_payload(row[0]))
        row = self._fetchone(
            (
                f"select record from {self.table_name} "
                "where document_id = %s and (record->>'is_current')::boolean = true "
                "order by ingestion_timestamp desc limit 1"
            ),
            (document_id,),
        )
        if row is not None:
            return _document_record_from_dict(_coerce_json_payload(row[0]))
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
                    cursor.executemany(
                        self._upsert_query(),
                        tuple(self._record_upsert_params(record) for record in records),
                    )

    def _ensure_schema(self) -> None:
        cache_key = (self.database_url, self.table_name)
        if cache_key in _INITIALIZED_DOCUMENT_TABLES:
            return
        create_table_statement = f"""
            create table if not exists {self.table_name} (
                document_id text not null,
                revision_track text not null,
                version_id text not null,
                corpus text not null,
                collection text not null default '',
                ingestion_timestamp timestamptz not null,
                record jsonb not null,
                primary key (document_id, revision_track, version_id)
            )
            """
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(create_table_statement)
                cursor.execute(f"alter table {self.table_name} add column if not exists revision_track text")
                cursor.execute(f"alter table {self.table_name} add column if not exists collection text")
                cursor.execute(
                    f"update {self.table_name} set revision_track = 'source-faithful' "
                    "where revision_track is null or revision_track = ''"
                )
                cursor.execute(
                    f"update {self.table_name} set collection = coalesce(nullif(record->>'collection', ''), collection, '')"
                )
                _require_explicit_collection_column(cursor=cursor, table_name=self.table_name)
                cursor.execute(f"alter table {self.table_name} alter column revision_track set not null")
                cursor.execute(f"alter table {self.table_name} alter column collection set not null")
                cursor.execute(
                    f"""
                    do $$
                    declare
                        constraint_name text;
                    begin
                        select conname into constraint_name
                        from pg_constraint
                        where conrelid = '{self.table_name}'::regclass
                          and contype = 'p';
                        if constraint_name is not null then
                            execute format('alter table {self.table_name} drop constraint %I', constraint_name);
                        end if;
                        execute 'alter table {self.table_name} add primary key (document_id, revision_track, version_id)';
                    exception
                        when duplicate_object then
                            null;
                    end $$;
                    """
                )
                cursor.execute(
                    f"""
                    create index if not exists idx_{self.table_name}_corpus
                    on {self.table_name} (corpus, collection, document_id, revision_track, version_id)
                    """
                )
                cursor.execute(
                    f"""
                    create index if not exists idx_{self.table_name}_latest
                    on {self.table_name} (document_id, revision_track, ingestion_timestamp desc)
                    """
                )
                cursor.execute(
                    f"""
                    create index if not exists idx_{self.table_name}_current
                    on {self.table_name} (document_id, ingestion_timestamp desc)
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


class PostgresRawAssetRegistry:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_RAW_ASSET_REGISTRY_TABLE,
    ) -> None:
        self.database_url = database_url.strip()
        self.table_name = table_name
        if not self.database_url:
            raise ValueError("DOCUMENT_REGISTRY_DATABASE_URL is required")
        self._ensure_schema()

    def get(self, raw_asset_id: str, raw_version_id: str) -> RawAssetRecord | None:
        query = (
            f"select record from {self.table_name} "
            "where raw_asset_id = %s and raw_version_id = %s"
        )
        row = self._fetchone(query, (raw_asset_id, raw_version_id))
        if row is None:
            return None
        return _raw_asset_record_from_dict(_coerce_json_payload(row[0]))

    def upsert(self, record: RawAssetRecord) -> None:
        payload = json.dumps(asdict(record), ensure_ascii=False)
        query = (
            f"insert into {self.table_name} "
            "(raw_asset_id, raw_version_id, corpus, collection, ingestion_timestamp, record) "
            "values (%s, %s, %s, %s, %s, %s::jsonb) "
            "on conflict (raw_asset_id, raw_version_id) do update set "
            "corpus = excluded.corpus, "
            "collection = excluded.collection, "
            "ingestion_timestamp = excluded.ingestion_timestamp, "
            "record = excluded.record"
        )
        self._execute(
            query,
            (
                record.raw_asset_id,
                record.raw_version_id,
                record.corpus,
                record.collection,
                _parse_timestamp(record.ingestion_timestamp),
                payload,
            ),
        )

    def list_by_corpus(self, corpus: str) -> tuple[RawAssetRecord, ...]:
        return self.list_by_scope(corpus)

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[RawAssetRecord, ...]:
        if collection is None:
            query = (
                f"select record from {self.table_name} "
                "where corpus = %s order by raw_asset_id asc, raw_version_id asc"
            )
            params: tuple[object, ...] = (corpus,)
        else:
            query = (
                f"select record from {self.table_name} "
                "where corpus = %s and collection = %s order by raw_asset_id asc, raw_version_id asc"
            )
            params = (corpus, collection)
        rows = self._fetchall(query, params)
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

    def _ensure_schema(self) -> None:
        cache_key = (self.database_url, self.table_name)
        if cache_key in _INITIALIZED_RAW_ASSET_TABLES:
            return
        create_table_statement = f"""
            create table if not exists {self.table_name} (
                raw_asset_id text not null,
                raw_version_id text not null,
                corpus text not null,
                collection text not null default '',
                ingestion_timestamp timestamptz not null,
                record jsonb not null,
                primary key (raw_asset_id, raw_version_id)
            )
            """
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(create_table_statement)
                cursor.execute(f"alter table {self.table_name} add column if not exists collection text")
                cursor.execute(
                    f"update {self.table_name} set collection = coalesce(nullif(record->>'collection', ''), collection, '')"
                )
                _require_explicit_collection_column(cursor=cursor, table_name=self.table_name)
                cursor.execute(f"alter table {self.table_name} alter column collection set not null")
                cursor.execute(
                    f"""
                    create index if not exists idx_{self.table_name}_corpus
                    on {self.table_name} (corpus, collection, raw_asset_id, raw_version_id)
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


def build_document_registry_from_env(env: dict[str, str] | None = None) -> DocumentRegistry:
    source = env if env is not None else os.environ
    return PostgresDocumentRegistry(_required_document_registry_database_url(source))


def build_raw_asset_registry_from_env(env: dict[str, str] | None = None) -> RawAssetRegistry:
    source = env if env is not None else os.environ
    return PostgresRawAssetRegistry(_required_raw_asset_registry_database_url(source))


def _required_document_registry_database_url(source: dict[str, str]) -> str:
    database_url = (
        (source.get(DOCUMENT_REGISTRY_ENV_KEY) or "").strip()
        or (source.get(SHARED_POSTGRES_ENV_KEY) or "").strip()
    )
    if not database_url:
        raise ValueError(
            f"{DOCUMENT_REGISTRY_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return database_url


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
    return database_url


def _postgres_connection(database_url: str, *, autocommit: bool = True):
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "psycopg is required to use the Postgres document registry"
        ) from exc
    return psycopg.connect(database_url, autocommit=autocommit)


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _coerce_json_payload(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        return json.loads(value)
    raise TypeError(f"unexpected registry payload type: {type(value)!r}")


def _require_explicit_collection_column(*, cursor, table_name: str) -> None:
    cursor.execute(
        f"select count(*) from {table_name} where collection is null or btrim(collection) = ''"
    )
    row = cursor.fetchone()
    missing_count = int(row[0]) if row is not None else 0
    if missing_count > 0:
        raise RuntimeError(
            f"{table_name} contains {missing_count} legacy rows without explicit collection; "
            "migrate registry records to canonical corpus + collection before startup"
        )


def _document_record_from_dict(raw: dict[str, object]) -> DocumentRegistryRecord:
    revision_track = str(raw.get("revision_track") or "source-faithful")
    processed_object_keys = tuple(str(item) for item in list(raw.get("processed_object_keys") or []))
    provider_response_object_key = (
        str(raw["provider_response_object_key"])
        if raw.get("provider_response_object_key") is not None
        else _find_processed_artifact(processed_object_keys, PROVIDER_RESPONSE_FILENAME)
    )
    document_units_object_key = (
        str(raw["document_units_object_key"])
        if raw.get("document_units_object_key") is not None
        else _find_processed_artifact(processed_object_keys, DOCUMENT_UNITS_FILENAME)
    )
    canonical_markdown_object_key = (
        str(raw["canonical_markdown_object_key"])
        if raw.get("canonical_markdown_object_key") is not None
        else _find_processed_artifact(processed_object_keys, CANONICAL_MARKDOWN_FILENAME)
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
        revision_track=revision_track,
        version_id=str(raw["version_id"]),
        source_uri=source_uri,
        content_hash=str(raw["content_hash"]),
        corpus=_required_registry_text(raw, "corpus"),
        collection=_required_registry_text(raw, "collection"),
        cleaning_policy_version=str(raw.get("cleaning_policy_version") or ""),
        entitlement_groups=tuple(str(item) for item in list(raw.get("entitlement_groups") or [])),
        visibility_scope=str(raw["visibility_scope"]) if raw.get("visibility_scope") is not None else None,
        visibility_level=str(raw.get("visibility_level") or ""),
        policy_projection_version=str(raw.get("policy_projection_version") or ""),
        acl_groups=tuple(str(item) for item in list(raw.get("acl_groups") or [])),
        campus_scope=str(raw["campus_scope"]) if raw.get("campus_scope") is not None else None,
        status=str(raw["status"]),
        ingestion_timestamp=str(raw["ingestion_timestamp"]),
        parser_version=str(raw["parser_version"]),
        embedding_model=str(raw.get("embedding_model") or ""),
        source_channel=source_channel,
        is_current=bool(raw.get("is_current", False)),
        effective_date=str(raw["effective_date"]) if raw.get("effective_date") is not None else None,
        published_date=str(raw["published_date"]) if raw.get("published_date") is not None else None,
        supersedes_version_id=(
            str(raw["supersedes_version_id"]) if raw.get("supersedes_version_id") is not None else None
        ),
        provenance_status=str(raw.get("provenance_status") or ""),
        raw_asset=raw_asset,
        source_observations=source_observations,
        document_units_object_key=document_units_object_key,
        provider_response_object_key=provider_response_object_key,
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
        ingestion_timestamp=str(raw["ingestion_timestamp"]),
        import_source=str(raw["import_source"]),
    )


def _find_processed_artifact(processed_object_keys: tuple[str, ...], filename: str) -> str | None:
    for key in processed_object_keys:
        if key.endswith(f"/{filename}"):
            return key
    return None


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


def _required_registry_text(raw: dict[str, object], field_name: str) -> str:
    value = raw.get(field_name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"registry payload is missing required {field_name}")
    return value.strip()
