from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from threading import RLock
from typing import Any, Protocol, Sequence

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    RAW_ASSET_REGISTRY_ENV_KEY,
    RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY,
    RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
)
from campus_ingestion_core.scope_catalog import assert_known_scope

DEFAULT_FILE_RELEASE_INVENTORY_SCHEMA = "ingestion_projection"
DEFAULT_FILE_RELEASE_INVENTORY_TABLE = (
    f"{DEFAULT_FILE_RELEASE_INVENTORY_SCHEMA}.authenticated_notice_file_release_inventory"
)
DEFAULT_FILE_RELEASE_INVENTORY_ENV_KEY = "AUTHENTICATED_NOTICE_FILE_RELEASE_INVENTORY_DATABASE_URL"
DEFAULT_FILE_RELEASE_INVENTORY_OPERATOR_ENV_KEY = (
    "AUTHENTICATED_NOTICE_FILE_RELEASE_INVENTORY_OPERATOR_DATABASE_URL"
)
DEFAULT_FILE_RELEASE_INVENTORY_MANAGEMENT_ENV_KEY = (
    "AUTHENTICATED_NOTICE_FILE_RELEASE_INVENTORY_MANAGEMENT_DATABASE_URL"
)
DEFAULT_FILE_RELEASE_INVENTORY_SCAN_PAGE_SIZE = 256
DEFAULT_FILE_RELEASE_INVENTORY_CORPUS = "campus_notices"
DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION = "file_release_capture"


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeFileReleaseInventoryEntry:
    corpus: str
    collection: str
    file_release_id: int
    site_id: str
    export_scope: str
    collector_contract_version: str
    source_home_url: str
    filename: str
    upfilename: str | None
    filecode: str | None
    filetime: str | None
    filedepartment: str | None
    explain_department: str | None
    file_type_id: int | None
    file_type_name: str | None
    resolved_download_url: str | None
    released_file_storage_provider: str | None
    released_file_bucket: str | None
    released_file_object_key: str | None
    released_file_sha256: str | None
    released_file_byte_size: int | None
    released_file_ingest_status: str | None
    released_file_provenance_status: str | None
    updated_at: str = field(default_factory=utc_now)
    record: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        assert_known_scope(self.corpus, self.collection)
        if int(self.file_release_id) <= 0:
            raise ValueError("file_release_id must be greater than zero")
        for label, value in (
            ("site_id", self.site_id),
            ("export_scope", self.export_scope),
            ("collector_contract_version", self.collector_contract_version),
            ("source_home_url", self.source_home_url),
            ("filename", self.filename),
            ("updated_at", self.updated_at),
        ):
            if not str(value).strip():
                raise ValueError(f"{label} is required")
        if not isinstance(self.record, dict):
            raise ValueError("record must be a dict")

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> AuthenticatedNoticeFileReleaseInventoryEntry:
        raw = dict(payload)
        raw["file_release_id"] = int(raw["file_release_id"])
        raw["file_type_id"] = _optional_int(raw.get("file_type_id"))
        raw["released_file_byte_size"] = _optional_int(raw.get("released_file_byte_size"))
        raw["record"] = dict(raw.get("record") or {})
        return cls(**raw)


class AuthenticatedNoticeFileReleaseInventoryStore(Protocol):
    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    ) -> None: ...

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    ) -> None: ...

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        file_release_ids: Sequence[int | str] = (),
    ) -> tuple[AuthenticatedNoticeFileReleaseInventoryEntry, ...]: ...


class InMemoryAuthenticatedNoticeFileReleaseInventoryStore:
    def __init__(self) -> None:
        self._entries: dict[tuple[str, str, int], AuthenticatedNoticeFileReleaseInventoryEntry] = {}
        self._lock = RLock()

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    ) -> None:
        with self._lock:
            for record in records:
                self._entries[(record.corpus, record.collection, record.file_release_id)] = record

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    ) -> None:
        with self._lock:
            self._entries = {
                key: value
                for key, value in self._entries.items()
                if key[:2] != (corpus, collection)
            }
            for record in records:
                self._entries[(record.corpus, record.collection, record.file_release_id)] = record

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        file_release_ids: Sequence[int | str] = (),
    ) -> tuple[AuthenticatedNoticeFileReleaseInventoryEntry, ...]:
        selected_ids = {int(str(item).strip()) for item in file_release_ids if str(item).strip()}
        with self._lock:
            return tuple(
                sorted(
                    (
                        record
                        for record in self._entries.values()
                        if record.corpus == corpus
                        and record.collection == collection
                        and (not selected_ids or record.file_release_id in selected_ids)
                    ),
                    key=lambda record: record.file_release_id,
                )
            )


class PostgresAuthenticatedNoticeFileReleaseInventoryStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_FILE_RELEASE_INVENTORY_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("file-release inventory database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    ) -> None:
        rows = tuple(records)
        if not rows:
            return
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(self._bulk_upsert_query(), (self._recordset_payload(rows),))

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    ) -> None:
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"delete from {self.table_name} where corpus = %s and collection = %s",
                    (corpus, collection),
                )
                rows = tuple(records)
                if rows:
                    cursor.execute(self._bulk_upsert_query(), (self._recordset_payload(rows),))

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        file_release_ids: Sequence[int | str] = (),
    ) -> tuple[AuthenticatedNoticeFileReleaseInventoryEntry, ...]:
        normalized_ids = tuple(
            sorted({int(str(item).strip()) for item in file_release_ids if str(item).strip()})
        )
        if normalized_ids:
            rows = self._fetchall(
                (
                    f"select {self._select_persisted_payload_sql()} from {self.table_name} "
                    "where corpus = %s and collection = %s and file_release_id = any(%s) "
                    "order by file_release_id asc"
                ),
                (corpus, collection, list(normalized_ids)),
            )
            return tuple(
                AuthenticatedNoticeFileReleaseInventoryEntry.from_dict(_coerce_json_payload(row[0]))
                for row in rows
            )
        records: list[AuthenticatedNoticeFileReleaseInventoryEntry] = []
        last_file_release_id: int | None = None
        while True:
            query = (
                f"select {self._select_persisted_payload_sql()} from {self.table_name} "
                "where corpus = %s and collection = %s "
            )
            params: list[object] = [corpus, collection]
            if last_file_release_id is not None:
                query += "and file_release_id > %s "
                params.append(last_file_release_id)
            query += "order by file_release_id asc limit %s"
            params.append(DEFAULT_FILE_RELEASE_INVENTORY_SCAN_PAGE_SIZE)
            rows = self._fetchall(query, tuple(params))
            if not rows:
                break
            page_records = tuple(
                AuthenticatedNoticeFileReleaseInventoryEntry.from_dict(_coerce_json_payload(row[0]))
                for row in rows
            )
            records.extend(page_records)
            last_file_release_id = page_records[-1].file_release_id
            if len(page_records) < DEFAULT_FILE_RELEASE_INVENTORY_SCAN_PAGE_SIZE:
                break
        return tuple(records)

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                _ensure_table_schema(cursor, table_name=self.table_name)
                cursor.execute(
                    f"""
                    create table if not exists {table_sql} (
                        corpus text not null,
                        collection text not null,
                        file_release_id bigint not null,
                        site_id text not null,
                        export_scope text not null,
                        collector_contract_version text not null,
                        source_home_url text not null,
                        filename text not null,
                        upfilename text,
                        filecode text,
                        filetime text,
                        filedepartment text,
                        explain_department text,
                        file_type_id bigint,
                        file_type_name text,
                        resolved_download_url text,
                        released_file_storage_provider text,
                        released_file_bucket text,
                        released_file_object_key text,
                        released_file_sha256 text,
                        released_file_byte_size bigint,
                        released_file_ingest_status text,
                        released_file_provenance_status text,
                        updated_at timestamptz not null,
                        record jsonb not null,
                        primary key (corpus, collection, file_release_id)
                    )
                    """
                )
                cursor.execute(
                    f"""
                    create index if not exists idx_{suffix}_sha
                    on {table_sql} (corpus, collection, released_file_sha256, file_release_id)
                    """
                )

    def _fetchall(self, query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                rows = cursor.fetchall()
        return tuple(tuple(row) for row in rows)

    @staticmethod
    def _select_persisted_payload_sql() -> str:
        return """
            jsonb_build_object(
                'corpus', corpus,
                'collection', collection,
                'file_release_id', file_release_id,
                'site_id', site_id,
                'export_scope', export_scope,
                'collector_contract_version', collector_contract_version,
                'source_home_url', source_home_url,
                'filename', filename,
                'upfilename', upfilename,
                'filecode', filecode,
                'filetime', filetime,
                'filedepartment', filedepartment,
                'explain_department', explain_department,
                'file_type_id', file_type_id,
                'file_type_name', file_type_name,
                'resolved_download_url', resolved_download_url,
                'released_file_storage_provider', released_file_storage_provider,
                'released_file_bucket', released_file_bucket,
                'released_file_object_key', released_file_object_key,
                'released_file_sha256', released_file_sha256,
                'released_file_byte_size', released_file_byte_size,
                'released_file_ingest_status', released_file_ingest_status,
                'released_file_provenance_status', released_file_provenance_status,
                'updated_at', updated_at,
                'record', record
            )
        """

    def _bulk_upsert_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"""
            with rows as (
                select
                    item.corpus,
                    item.collection,
                    item.file_release_id,
                    item.site_id,
                    item.export_scope,
                    item.collector_contract_version,
                    item.source_home_url,
                    item.filename,
                    item.upfilename,
                    item.filecode,
                    item.filetime,
                    item.filedepartment,
                    item.explain_department,
                    item.file_type_id,
                    item.file_type_name,
                    item.resolved_download_url,
                    item.released_file_storage_provider,
                    item.released_file_bucket,
                    item.released_file_object_key,
                    item.released_file_sha256,
                    item.released_file_byte_size,
                    item.released_file_ingest_status,
                    item.released_file_provenance_status,
                    item.updated_at,
                    item.record
                from jsonb_to_recordset(%s::jsonb) as item(
                    corpus text,
                    collection text,
                    file_release_id bigint,
                    site_id text,
                    export_scope text,
                    collector_contract_version text,
                    source_home_url text,
                    filename text,
                    upfilename text,
                    filecode text,
                    filetime text,
                    filedepartment text,
                    explain_department text,
                    file_type_id bigint,
                    file_type_name text,
                    resolved_download_url text,
                    released_file_storage_provider text,
                    released_file_bucket text,
                    released_file_object_key text,
                    released_file_sha256 text,
                    released_file_byte_size bigint,
                    released_file_ingest_status text,
                    released_file_provenance_status text,
                    updated_at timestamptz,
                    record jsonb
                )
            )
            insert into {table_sql} (
                corpus,
                collection,
                file_release_id,
                site_id,
                export_scope,
                collector_contract_version,
                source_home_url,
                filename,
                upfilename,
                filecode,
                filetime,
                filedepartment,
                explain_department,
                file_type_id,
                file_type_name,
                resolved_download_url,
                released_file_storage_provider,
                released_file_bucket,
                released_file_object_key,
                released_file_sha256,
                released_file_byte_size,
                released_file_ingest_status,
                released_file_provenance_status,
                updated_at,
                record
            )
            select
                corpus,
                collection,
                file_release_id,
                site_id,
                export_scope,
                collector_contract_version,
                source_home_url,
                filename,
                upfilename,
                filecode,
                filetime,
                filedepartment,
                explain_department,
                file_type_id,
                file_type_name,
                resolved_download_url,
                released_file_storage_provider,
                released_file_bucket,
                released_file_object_key,
                released_file_sha256,
                released_file_byte_size,
                released_file_ingest_status,
                released_file_provenance_status,
                updated_at,
                record
            from rows
            on conflict (corpus, collection, file_release_id) do update set
                site_id = excluded.site_id,
                export_scope = excluded.export_scope,
                collector_contract_version = excluded.collector_contract_version,
                source_home_url = excluded.source_home_url,
                filename = excluded.filename,
                upfilename = excluded.upfilename,
                filecode = excluded.filecode,
                filetime = excluded.filetime,
                filedepartment = excluded.filedepartment,
                explain_department = excluded.explain_department,
                file_type_id = excluded.file_type_id,
                file_type_name = excluded.file_type_name,
                resolved_download_url = excluded.resolved_download_url,
                released_file_storage_provider = excluded.released_file_storage_provider,
                released_file_bucket = excluded.released_file_bucket,
                released_file_object_key = excluded.released_file_object_key,
                released_file_sha256 = excluded.released_file_sha256,
                released_file_byte_size = excluded.released_file_byte_size,
                released_file_ingest_status = excluded.released_file_ingest_status,
                released_file_provenance_status = excluded.released_file_provenance_status,
                updated_at = excluded.updated_at,
                record = excluded.record
        """

    @staticmethod
    def _recordset_payload(rows: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry]) -> str:
        return json.dumps(
            [asdict(row) for row in rows],
            ensure_ascii=False,
        )


def build_authenticated_notice_file_release_inventory_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresAuthenticatedNoticeFileReleaseInventoryStore:
    source = env if env is not None else dict(os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_FILE_RELEASE_INVENTORY_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_FILE_RELEASE_INVENTORY_MANAGEMENT_ENV_KEY)
            or source.get(RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_FILE_RELEASE_INVENTORY_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_FILE_RELEASE_INVENTORY_MANAGEMENT_ENV_KEY} or "
                f"{RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY} or "
                f"{RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when "
                "prefer_operator=True"
            )
        return PostgresAuthenticatedNoticeFileReleaseInventoryStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_FILE_RELEASE_INVENTORY_ENV_KEY)
        or source.get(RAW_ASSET_REGISTRY_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_FILE_RELEASE_INVENTORY_ENV_KEY} or {RAW_ASSET_REGISTRY_ENV_KEY} or "
            f"{DOCUMENT_REGISTRY_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresAuthenticatedNoticeFileReleaseInventoryStore(database_url=database_url)


def _optional_int(value: object) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


__all__ = [
    "AuthenticatedNoticeFileReleaseInventoryEntry",
    "AuthenticatedNoticeFileReleaseInventoryStore",
    "DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION",
    "DEFAULT_FILE_RELEASE_INVENTORY_CORPUS",
    "DEFAULT_FILE_RELEASE_INVENTORY_ENV_KEY",
    "DEFAULT_FILE_RELEASE_INVENTORY_MANAGEMENT_ENV_KEY",
    "DEFAULT_FILE_RELEASE_INVENTORY_OPERATOR_ENV_KEY",
    "DEFAULT_FILE_RELEASE_INVENTORY_SCAN_PAGE_SIZE",
    "DEFAULT_FILE_RELEASE_INVENTORY_SCHEMA",
    "DEFAULT_FILE_RELEASE_INVENTORY_TABLE",
    "InMemoryAuthenticatedNoticeFileReleaseInventoryStore",
    "PostgresAuthenticatedNoticeFileReleaseInventoryStore",
    "build_authenticated_notice_file_release_inventory_store_from_env",
]
