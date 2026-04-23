from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict
from importlib import import_module

from campus_ingestion_core.authenticated_notice_source_truth_inventory_shared import (
    DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE,
    DEFAULT_SOURCE_TRUTH_INVENTORY_TABLE,
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.postgres_runtime import normalize_postgres_connection_url
from campus_ingestion_core.registry import (
    DEFAULT_DOCUMENT_REGISTRY_TABLE,
    DEFAULT_RAW_ASSET_REGISTRY_TABLE,
    DocumentRegistry,
    PostgresDocumentRegistry,
    PostgresRawAssetRegistry,
    RawAssetRegistry,
    _coerce_json_payload,
    _document_record_from_dict,
    _ensure_table_schema,
    _qualified_table_sql,
    _raw_asset_record_from_dict,
    _table_index_suffix,
)


def _inventory_facade():
    return import_module("campus_ingestion_core.authenticated_notice_source_truth_inventory")


def _patched_postgres_connection(*args, **kwargs):
    return _inventory_facade()._postgres_connection(*args, **kwargs)


def _inventory_scan_page_size() -> int:
    return int(
        getattr(
            _inventory_facade(),
            "DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE",
            DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE,
        )
    )


class PostgresAuthenticatedNoticeSourceTruthInventoryStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_SOURCE_TRUTH_INVENTORY_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("source-truth inventory database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> None:
        rows = tuple(records)
        if not rows:
            return
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                self._bulk_upsert_query(),
                (self._recordset_payload(rows),),
            )

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> None:
        with _patched_postgres_connection(self.database_url, autocommit=False) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"delete from {self.table_name} where corpus = %s and collection = %s",
                (corpus, collection),
            )
            rows = tuple(records)
            if rows:
                cursor.execute(
                    self._bulk_upsert_query(),
                    (self._recordset_payload(rows),),
                )

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        notice_ids: Sequence[str] = (),
    ) -> tuple[AuthenticatedNoticeSourceTruthInventoryEntry, ...]:
        normalized_notice_ids = tuple(
            sorted({str(item).strip() for item in notice_ids if str(item).strip()})
        )
        if normalized_notice_ids:
            query = (
                f"select record from {self.table_name} "
                "where corpus = %s and collection = %s and notice_id = any(%s) "
                "order by notice_id asc"
            )
            rows = self._fetchall(query, (corpus, collection, list(normalized_notice_ids)))
            return tuple(
                AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(_coerce_json_payload(row[0]))
                for row in rows
            )
        records: list[AuthenticatedNoticeSourceTruthInventoryEntry] = []
        last_notice_id: str | None = None
        page_size = _inventory_scan_page_size()
        while True:
            query = f"select record from {self.table_name} where corpus = %s and collection = %s "
            params: list[object] = [corpus, collection]
            if last_notice_id is not None:
                query += "and notice_id > %s "
                params.append(last_notice_id)
            query += "order by notice_id asc limit %s"
            params.append(page_size)
            rows = self._fetchall(query, tuple(params))
            if not rows:
                break
            page_records = tuple(
                AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(_coerce_json_payload(row[0]))
                for row in rows
            )
            records.extend(page_records)
            last_notice_id = page_records[-1].notice_id
            if len(page_records) < page_size:
                break
        return tuple(records)

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    corpus text not null,
                    collection text not null,
                    notice_id text not null,
                    site_id text not null,
                    document_id text not null,
                    revision_track text not null,
                    version_id text not null,
                    raw_asset_id text not null,
                    raw_version_id text not null,
                    source_home_url text not null,
                    embedding_model text not null,
                    notice_manifest_key text not null,
                    content_blocks_key text not null,
                    attachment_refs_key text not null,
                    attachment_document_count integer not null,
                    text_extractable_count integer not null,
                    ocr_required_count integer not null,
                    reference_only_count integer not null,
                    planning_weight integer not null,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (corpus, collection, notice_id)
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_notice
                on {table_sql} (corpus, collection, planning_weight desc, notice_id asc)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_raw
                on {table_sql} (corpus, collection, raw_asset_id, raw_version_id)
                """
            )

    def _fetchall(self, query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        return tuple(tuple(row) for row in rows)

    def _bulk_upsert_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"""
            with rows as (
                select
                    item.corpus,
                    item.collection,
                    item.notice_id,
                    item.site_id,
                    item.document_id,
                    item.revision_track,
                    item.version_id,
                    item.raw_asset_id,
                    item.raw_version_id,
                    item.source_home_url,
                    item.embedding_model,
                    item.notice_manifest_key,
                    item.content_blocks_key,
                    item.attachment_refs_key,
                    item.attachment_document_count,
                    item.text_extractable_count,
                    item.ocr_required_count,
                    item.reference_only_count,
                    item.planning_weight,
                    item.updated_at,
                    item.record
                from jsonb_to_recordset(%s::jsonb) as item(
                    corpus text,
                    collection text,
                    notice_id text,
                    site_id text,
                    document_id text,
                    revision_track text,
                    version_id text,
                    raw_asset_id text,
                    raw_version_id text,
                    source_home_url text,
                    embedding_model text,
                    notice_manifest_key text,
                    content_blocks_key text,
                    attachment_refs_key text,
                    attachment_document_count integer,
                    text_extractable_count integer,
                    ocr_required_count integer,
                    reference_only_count integer,
                    planning_weight integer,
                    updated_at timestamptz,
                    record jsonb
                )
            )
            insert into {table_sql} (
                corpus,
                collection,
                notice_id,
                site_id,
                document_id,
                revision_track,
                version_id,
                raw_asset_id,
                raw_version_id,
                source_home_url,
                embedding_model,
                notice_manifest_key,
                content_blocks_key,
                attachment_refs_key,
                attachment_document_count,
                text_extractable_count,
                ocr_required_count,
                reference_only_count,
                planning_weight,
                updated_at,
                record
            )
            select
                corpus,
                collection,
                notice_id,
                site_id,
                document_id,
                revision_track,
                version_id,
                raw_asset_id,
                raw_version_id,
                source_home_url,
                embedding_model,
                notice_manifest_key,
                content_blocks_key,
                attachment_refs_key,
                attachment_document_count,
                text_extractable_count,
                ocr_required_count,
                reference_only_count,
                planning_weight,
                updated_at,
                record
            from rows
            on conflict (corpus, collection, notice_id) do update set
                site_id = excluded.site_id,
                document_id = excluded.document_id,
                revision_track = excluded.revision_track,
                version_id = excluded.version_id,
                raw_asset_id = excluded.raw_asset_id,
                raw_version_id = excluded.raw_version_id,
                source_home_url = excluded.source_home_url,
                embedding_model = excluded.embedding_model,
                notice_manifest_key = excluded.notice_manifest_key,
                content_blocks_key = excluded.content_blocks_key,
                attachment_refs_key = excluded.attachment_refs_key,
                attachment_document_count = excluded.attachment_document_count,
                text_extractable_count = excluded.text_extractable_count,
                ocr_required_count = excluded.ocr_required_count,
                reference_only_count = excluded.reference_only_count,
                planning_weight = excluded.planning_weight,
                updated_at = excluded.updated_at,
                record = excluded.record
        """

    @staticmethod
    def _recordset_payload(
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> str:
        payload = []
        for record in records:
            row = asdict(record)
            row["record"] = asdict(record)
            payload.append(row)
        return json.dumps(payload, ensure_ascii=False)


def _list_document_registry_scope_records_for_inventory(
    document_registry: DocumentRegistry,
    *,
    corpus: str,
    collection: str,
    page_size: int = DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE,
) -> tuple[DocumentRegistryRecord, ...]:
    if isinstance(document_registry, PostgresDocumentRegistry):
        return _page_postgres_document_registry_scope_records(
            document_registry,
            corpus=corpus,
            collection=collection,
            page_size=page_size,
        )
    return tuple(document_registry.list_by_scope(corpus, collection))


def _list_raw_asset_registry_scope_records_for_inventory(
    raw_asset_registry: RawAssetRegistry,
    *,
    corpus: str,
    collection: str,
    page_size: int = DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE,
) -> tuple[RawAssetRecord, ...]:
    if isinstance(raw_asset_registry, PostgresRawAssetRegistry):
        return _page_postgres_raw_asset_registry_scope_records(
            raw_asset_registry,
            corpus=corpus,
            collection=collection,
            page_size=page_size,
        )
    return tuple(raw_asset_registry.list_by_scope(corpus, collection))


def _page_postgres_document_registry_scope_records(
    document_registry: PostgresDocumentRegistry,
    *,
    corpus: str,
    collection: str,
    page_size: int,
) -> tuple[DocumentRegistryRecord, ...]:
    normalized_page_size = max(1, int(page_size))
    table_name = getattr(document_registry, "table_name", DEFAULT_DOCUMENT_REGISTRY_TABLE)
    database_url = str(getattr(document_registry, "database_url", "")).strip()
    if not database_url:
        raise ValueError("postgres document registry database url is required")
    records: list[DocumentRegistryRecord] = []
    last_key: tuple[str, str, str] | None = None
    while True:
        query = (
            f"select record from {table_name} "
            "where corpus = %s and collection = %s "
            "and record->>'document_id' like %s "
        )
        params: list[object] = [corpus, collection, "notice:%"]
        if last_key is not None:
            query += "and (document_id, revision_track, version_id) > (%s, %s, %s) "
            params.extend(last_key)
        query += "order by document_id asc, revision_track asc, version_id asc limit %s"
        params.append(normalized_page_size)
        with _patched_postgres_connection(database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()
        if not rows:
            break
        page_records = tuple(
            _document_record_from_dict(_coerce_json_payload(row[0])) for row in rows
        )
        records.extend(page_records)
        last_record = page_records[-1]
        last_key = (
            last_record.document_id,
            last_record.revision_track,
            last_record.version_id,
        )
        if len(page_records) < normalized_page_size:
            break
    return tuple(records)


def _page_postgres_raw_asset_registry_scope_records(
    raw_asset_registry: PostgresRawAssetRegistry,
    *,
    corpus: str,
    collection: str,
    page_size: int,
) -> tuple[RawAssetRecord, ...]:
    normalized_page_size = max(1, int(page_size))
    table_name = getattr(raw_asset_registry, "table_name", DEFAULT_RAW_ASSET_REGISTRY_TABLE)
    database_url = str(getattr(raw_asset_registry, "database_url", "")).strip()
    if not database_url:
        raise ValueError("postgres raw asset registry database url is required")
    records: list[RawAssetRecord] = []
    last_key: tuple[str, str] | None = None
    while True:
        query = f"select record from {table_name} where corpus = %s and collection = %s "
        params: list[object] = [corpus, collection]
        if last_key is not None:
            query += "and (raw_asset_id, raw_version_id) > (%s, %s) "
            params.extend(last_key)
        query += "order by raw_asset_id asc, raw_version_id asc limit %s"
        params.append(normalized_page_size)
        with _patched_postgres_connection(database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()
        if not rows:
            break
        page_records = tuple(
            _raw_asset_record_from_dict(_coerce_json_payload(row[0])) for row in rows
        )
        records.extend(page_records)
        last_record = page_records[-1]
        last_key = (
            last_record.raw_asset_id,
            last_record.raw_version_id,
        )
        if len(page_records) < normalized_page_size:
            break
    return tuple(records)
