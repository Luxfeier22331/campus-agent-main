from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Protocol

from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord, RawAssetRef


DEFAULT_DOCUMENT_REGISTRY_TABLE = "document_registry_records"
DEFAULT_RAW_ASSET_REGISTRY_TABLE = "raw_asset_registry_records"
_INITIALIZED_DOCUMENT_TABLES: set[tuple[str, str]] = set()
_INITIALIZED_RAW_ASSET_TABLES: set[tuple[str, str]] = set()


class DocumentRegistry(Protocol):
    def get(self, document_id: str, version_id: str) -> DocumentRegistryRecord | None: ...

    def upsert(self, record: DocumentRegistryRecord) -> None: ...

    def list_by_corpus(self, corpus: str) -> tuple[DocumentRegistryRecord, ...]: ...

    def latest_versions(self, document_id: str) -> tuple[DocumentRegistryRecord, ...]: ...

    def delete_by_corpus(self, corpus: str) -> None: ...


class RawAssetRegistry(Protocol):
    def get(self, raw_asset_id: str, raw_version_id: str) -> RawAssetRecord | None: ...

    def upsert(self, record: RawAssetRecord) -> None: ...

    def list_by_corpus(self, corpus: str) -> tuple[RawAssetRecord, ...]: ...

    def delete_by_corpus(self, corpus: str) -> None: ...


class FileDocumentRegistry:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def get(self, document_id: str, version_id: str) -> DocumentRegistryRecord | None:
        payload = self._load()
        raw = payload.get(self._make_key(document_id, version_id))
        if raw is None:
            return None
        return _document_record_from_dict(raw)

    def upsert(self, record: DocumentRegistryRecord) -> None:
        payload = self._load()
        payload[self._make_key(record.document_id, record.version_id)] = asdict(record)
        self._store(payload)

    def list_by_corpus(self, corpus: str) -> tuple[DocumentRegistryRecord, ...]:
        records = [
            _document_record_from_dict(raw)
            for raw in self._load().values()
            if raw.get("corpus") == corpus
        ]
        return tuple(sorted(records, key=lambda record: (record.document_id, record.version_id)))

    def latest_versions(self, document_id: str) -> tuple[DocumentRegistryRecord, ...]:
        records = [
            _document_record_from_dict(raw)
            for raw in self._load().values()
            if raw.get("document_id") == document_id
        ]
        if not records:
            return ()
        latest = max(records, key=lambda record: record.ingestion_timestamp)
        return (latest,)

    def delete_by_corpus(self, corpus: str) -> None:
        payload = {
            key: value
            for key, value in self._load().items()
            if isinstance(value, dict) and value.get("corpus") != corpus
        }
        self._store(payload)

    def _load(self) -> dict[str, dict[str, object]]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _store(self, payload: dict[str, dict[str, object]]) -> None:
        if not payload:
            if self.path.exists():
                self.path.unlink()
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=self.path.parent,
            delete=False,
        ) as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            temp_path = Path(handle.name)
        temp_path.replace(self.path)

    @staticmethod
    def _make_key(document_id: str, version_id: str) -> str:
        return f"{document_id}::{version_id}"


class FileRawAssetRegistry:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def ensure_exists(self) -> None:
        if self.path.exists():
            return
        self._store({})

    def get(self, raw_asset_id: str, raw_version_id: str) -> RawAssetRecord | None:
        payload = self._load()
        raw = payload.get(self._make_key(raw_asset_id, raw_version_id))
        if raw is None:
            return None
        return _raw_asset_record_from_dict(raw)

    def upsert(self, record: RawAssetRecord) -> None:
        payload = self._load()
        payload[self._make_key(record.raw_asset_id, record.raw_version_id)] = asdict(record)
        self._store(payload)

    def list_by_corpus(self, corpus: str) -> tuple[RawAssetRecord, ...]:
        records = [
            _raw_asset_record_from_dict(raw)
            for raw in self._load().values()
            if raw.get("corpus") == corpus
        ]
        return tuple(sorted(records, key=lambda record: (record.raw_asset_id, record.raw_version_id)))

    def delete_by_corpus(self, corpus: str) -> None:
        payload = {
            key: value
            for key, value in self._load().items()
            if isinstance(value, dict) and value.get("corpus") != corpus
        }
        self._store(payload)

    def _load(self) -> dict[str, dict[str, object]]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _store(self, payload: dict[str, dict[str, object]]) -> None:
        if not payload:
            if self.path.exists():
                self.path.unlink()
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=self.path.parent,
            delete=False,
        ) as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            temp_path = Path(handle.name)
        temp_path.replace(self.path)

    @staticmethod
    def _make_key(raw_asset_id: str, raw_version_id: str) -> str:
        return f"{raw_asset_id}::{raw_version_id}"


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

    def get(self, document_id: str, version_id: str) -> DocumentRegistryRecord | None:
        query = (
            f"select record from {self.table_name} "
            "where document_id = %s and version_id = %s"
        )
        row = self._fetchone(query, (document_id, version_id))
        if row is None:
            return None
        return _document_record_from_dict(_coerce_json_payload(row[0]))

    def upsert(self, record: DocumentRegistryRecord) -> None:
        payload = json.dumps(asdict(record), ensure_ascii=False)
        query = (
            f"insert into {self.table_name} "
            "(document_id, version_id, corpus, ingestion_timestamp, record) "
            "values (%s, %s, %s, %s, %s::jsonb) "
            "on conflict (document_id, version_id) do update set "
            "corpus = excluded.corpus, "
            "ingestion_timestamp = excluded.ingestion_timestamp, "
            "record = excluded.record"
        )
        self._execute(
            query,
            (
                record.document_id,
                record.version_id,
                record.corpus,
                _parse_timestamp(record.ingestion_timestamp),
                payload,
            ),
        )

    def list_by_corpus(self, corpus: str) -> tuple[DocumentRegistryRecord, ...]:
        query = (
            f"select record from {self.table_name} "
            "where corpus = %s order by document_id asc, version_id asc"
        )
        rows = self._fetchall(query, (corpus,))
        return tuple(_document_record_from_dict(_coerce_json_payload(row[0])) for row in rows)

    def latest_versions(self, document_id: str) -> tuple[DocumentRegistryRecord, ...]:
        query = (
            f"select record from {self.table_name} "
            "where document_id = %s order by ingestion_timestamp desc limit 1"
        )
        row = self._fetchone(query, (document_id,))
        if row is None:
            return ()
        return (_document_record_from_dict(_coerce_json_payload(row[0])),)

    def delete_by_corpus(self, corpus: str) -> None:
        query = f"delete from {self.table_name} where corpus = %s"
        self._execute(query, (corpus,))

    def _ensure_schema(self) -> None:
        cache_key = (self.database_url, self.table_name)
        if cache_key in _INITIALIZED_DOCUMENT_TABLES:
            return
        statements = (
            f"""
            create table if not exists {self.table_name} (
                document_id text not null,
                version_id text not null,
                corpus text not null,
                ingestion_timestamp timestamptz not null,
                record jsonb not null,
                primary key (document_id, version_id)
            )
            """,
            f"""
            create index if not exists idx_{self.table_name}_corpus
            on {self.table_name} (corpus, document_id, version_id)
            """,
            f"""
            create index if not exists idx_{self.table_name}_latest
            on {self.table_name} (document_id, ingestion_timestamp desc)
            """,
        )
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                for statement in statements:
                    cursor.execute(statement)
        _INITIALIZED_DOCUMENT_TABLES.add(cache_key)

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
            "(raw_asset_id, raw_version_id, corpus, ingestion_timestamp, record) "
            "values (%s, %s, %s, %s, %s::jsonb) "
            "on conflict (raw_asset_id, raw_version_id) do update set "
            "corpus = excluded.corpus, "
            "ingestion_timestamp = excluded.ingestion_timestamp, "
            "record = excluded.record"
        )
        self._execute(
            query,
            (
                record.raw_asset_id,
                record.raw_version_id,
                record.corpus,
                _parse_timestamp(record.ingestion_timestamp),
                payload,
            ),
        )

    def list_by_corpus(self, corpus: str) -> tuple[RawAssetRecord, ...]:
        query = (
            f"select record from {self.table_name} "
            "where corpus = %s order by raw_asset_id asc, raw_version_id asc"
        )
        rows = self._fetchall(query, (corpus,))
        return tuple(_raw_asset_record_from_dict(_coerce_json_payload(row[0])) for row in rows)

    def delete_by_corpus(self, corpus: str) -> None:
        query = f"delete from {self.table_name} where corpus = %s"
        self._execute(query, (corpus,))

    def _ensure_schema(self) -> None:
        cache_key = (self.database_url, self.table_name)
        if cache_key in _INITIALIZED_RAW_ASSET_TABLES:
            return
        statements = (
            f"""
            create table if not exists {self.table_name} (
                raw_asset_id text not null,
                raw_version_id text not null,
                corpus text not null,
                ingestion_timestamp timestamptz not null,
                record jsonb not null,
                primary key (raw_asset_id, raw_version_id)
            )
            """,
            f"""
            create index if not exists idx_{self.table_name}_corpus
            on {self.table_name} (corpus, raw_asset_id, raw_version_id)
            """,
        )
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                for statement in statements:
                    cursor.execute(statement)
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
    return PostgresDocumentRegistry(_required_database_url(source))


def build_raw_asset_registry_from_env(env: dict[str, str] | None = None) -> RawAssetRegistry:
    source = env if env is not None else os.environ
    return PostgresRawAssetRegistry(_required_database_url(source))


def _required_database_url(source: dict[str, str]) -> str:
    database_url = (source.get("DOCUMENT_REGISTRY_DATABASE_URL") or "").strip()
    if not database_url:
        raise ValueError("DOCUMENT_REGISTRY_DATABASE_URL is required")
    return database_url


def _postgres_connection(database_url: str):
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "psycopg is required to use the Postgres document registry"
        ) from exc
    return psycopg.connect(database_url, autocommit=True)


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _coerce_json_payload(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        return json.loads(value)
    raise TypeError(f"unexpected registry payload type: {type(value)!r}")


def _document_record_from_dict(raw: dict[str, object]) -> DocumentRegistryRecord:
    processed_object_keys = tuple(str(item) for item in list(raw.get("processed_object_keys") or []))
    provider_result_object_key = (
        str(raw["provider_result_object_key"])
        if raw.get("provider_result_object_key") is not None
        else _find_processed_artifact(processed_object_keys, "provider-result.jsonl")
    )
    structured_object_key = (
        str(raw["structured_object_key"])
        if raw.get("structured_object_key") is not None
        else _find_processed_artifact(processed_object_keys, "structured.jsonl")
    )
    raw_asset_payload = raw.get("raw_asset")
    raw_asset = None
    if isinstance(raw_asset_payload, dict):
        raw_asset = RawAssetRef(
            raw_asset_id=str(raw_asset_payload["raw_asset_id"]),
            raw_version_id=str(raw_asset_payload["raw_version_id"]),
            page_start=(
                int(raw_asset_payload["page_start"])
                if raw_asset_payload.get("page_start") is not None
                else None
            ),
            page_end=(
                int(raw_asset_payload["page_end"])
                if raw_asset_payload.get("page_end") is not None
                else None
            ),
        )
    return DocumentRegistryRecord(
        document_id=str(raw["document_id"]),
        version_id=str(raw["version_id"]),
        source_uri=str(raw["source_uri"]),
        content_hash=str(raw["content_hash"]),
        corpus=str(raw["corpus"]),
        acl_groups=tuple(str(item) for item in list(raw.get("acl_groups") or [])),
        campus_scope=str(raw["campus_scope"]) if raw.get("campus_scope") is not None else None,
        status=str(raw["status"]),
        ingestion_timestamp=str(raw["ingestion_timestamp"]),
        parser_version=str(raw["parser_version"]),
        embedding_model=str(raw.get("embedding_model") or ""),
        raw_asset=raw_asset,
        structured_object_key=structured_object_key,
        provider_result_object_key=provider_result_object_key,
        processed_object_keys=processed_object_keys,
        import_source=str(raw["import_source"]),
    )


def _raw_asset_record_from_dict(raw: dict[str, object]) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=str(raw["raw_asset_id"]),
        raw_version_id=str(raw["raw_version_id"]),
        corpus=str(raw["corpus"]),
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
