from __future__ import annotations

from dataclasses import asdict, dataclass, field
import json
import os
from threading import RLock
from typing import Any, Protocol, Sequence
from urllib.parse import urlsplit

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.authenticated_notice_source_projections import (
    _find_processed_key,
    _load_json_payload,
    _load_jsonl_rows,
    build_authenticated_notice_attachment_projection_plans,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.object_store import is_source_object_key
from campus_ingestion_core.raw_ingestion import S3ObjectStoreClient
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    DEFAULT_DOCUMENT_REGISTRY_TABLE,
    DEFAULT_RAW_ASSET_REGISTRY_TABLE,
    RAW_ASSET_REGISTRY_ENV_KEY,
    RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
    RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    DocumentRegistry,
    PostgresDocumentRegistry,
    PostgresRawAssetRegistry,
    RawAssetRegistry,
    _coerce_json_payload,
    _document_record_from_dict,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _raw_asset_record_from_dict,
    _table_index_suffix,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.settings import ObjectStoreSettings


DEFAULT_SOURCE_TRUTH_INVENTORY_SCHEMA = "ingestion_projection"
DEFAULT_SOURCE_TRUTH_INVENTORY_TABLE = (
    f"{DEFAULT_SOURCE_TRUTH_INVENTORY_SCHEMA}.authenticated_notice_source_truth_inventory"
)
DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY = "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_DATABASE_URL"
DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY = (
    "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_OPERATOR_DATABASE_URL"
)
DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY = (
    "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_MANAGEMENT_DATABASE_URL"
)
AUTHENTICATED_NOTICE_SOURCE_TRUTH_BASE_WEIGHT = 1
AUTHENTICATED_NOTICE_SOURCE_TRUTH_TEXT_ATTACHMENT_WEIGHT = 1
AUTHENTICATED_NOTICE_SOURCE_TRUTH_OCR_ATTACHMENT_WEIGHT = 3
DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE = 256
NOTICE_RISK_LABEL_BODY_ONLY = "body_only"
NOTICE_RISK_LABEL_REFERENCE_ONLY = "body_with_reference_only_attachments"
NOTICE_RISK_LABEL_TEXT_ATTACHMENTS = "body_with_text_attachments"
NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS = "body_with_spatial_attachments"
NOTICE_RISK_LABEL_MIXED_HIGH_RISK = "mixed_high_risk"
HIGH_RISK_NOTICE_LABELS = frozenset(
    {
        NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS,
        NOTICE_RISK_LABEL_MIXED_HIGH_RISK,
    }
)


class AuthenticatedNoticeSourceTruthInventoryObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceTruthInventoryEntry:
    corpus: str
    collection: str
    notice_id: str
    site_id: str
    document_id: str
    revision_track: str
    version_id: str
    raw_asset_id: str
    raw_version_id: str
    source_home_url: str
    embedding_model: str
    notice_manifest_key: str
    content_blocks_key: str
    attachment_refs_key: str
    attachment_document_count: int
    attachment_ref_count: int
    text_extractable_count: int
    ocr_required_count: int
    reference_only_count: int
    manual_review_required_count: int
    notice_risk_label: str
    attachment_mix_score: int
    has_text_table_attachment: bool
    has_spatial_attachment: bool
    has_reference_only_attachment: bool
    planning_weight: int
    updated_at: str = field(default_factory=utc_now)
    parent_snapshot: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> AuthenticatedNoticeSourceTruthInventoryEntry:
        raw = dict(payload)
        raw["parent_snapshot"] = dict(raw.get("parent_snapshot") or {})
        raw["attachment_ref_count"] = int(raw.get("attachment_ref_count") or 0)
        raw["manual_review_required_count"] = int(
            raw.get("manual_review_required_count") or 0
        )
        raw["notice_risk_label"] = str(
            raw.get("notice_risk_label") or NOTICE_RISK_LABEL_BODY_ONLY
        )
        raw["attachment_mix_score"] = int(raw.get("attachment_mix_score") or 0)
        raw["has_text_table_attachment"] = _coerce_bool(
            raw.get("has_text_table_attachment")
        )
        raw["has_spatial_attachment"] = _coerce_bool(raw.get("has_spatial_attachment"))
        raw["has_reference_only_attachment"] = _coerce_bool(
            raw.get("has_reference_only_attachment")
        )
        return cls(**raw)


class AuthenticatedNoticeSourceTruthInventoryStore(Protocol):
    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> None: ...

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> None: ...

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        notice_ids: Sequence[str] = (),
    ) -> tuple[AuthenticatedNoticeSourceTruthInventoryEntry, ...]: ...


class InMemoryAuthenticatedNoticeSourceTruthInventoryStore:
    def __init__(self) -> None:
        self._entries: dict[
            tuple[str, str, str], AuthenticatedNoticeSourceTruthInventoryEntry
        ] = {}
        self._lock = RLock()

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> None:
        with self._lock:
            for record in records:
                self._entries[(record.corpus, record.collection, record.notice_id)] = record

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> None:
        with self._lock:
            self._entries = {
                key: value
                for key, value in self._entries.items()
                if key[:2] != (corpus, collection)
            }
            for record in records:
                self._entries[(record.corpus, record.collection, record.notice_id)] = record

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        notice_ids: Sequence[str] = (),
    ) -> tuple[AuthenticatedNoticeSourceTruthInventoryEntry, ...]:
        selected_notice_ids = {
            str(item).strip() for item in notice_ids if str(item).strip()
        }
        with self._lock:
            return tuple(
                sorted(
                    (
                        record
                        for record in self._entries.values()
                        if record.corpus == corpus and record.collection == collection
                        and (
                            not selected_notice_ids
                            or record.notice_id in selected_notice_ids
                        )
                    ),
                    key=lambda record: record.notice_id,
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
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
                AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(
                    _coerce_json_payload(row[0])
                )
                for row in rows
            )
        records: list[AuthenticatedNoticeSourceTruthInventoryEntry] = []
        last_notice_id: str | None = None
        while True:
            query = (
                f"select record from {self.table_name} "
                "where corpus = %s and collection = %s "
            )
            params: list[object] = [corpus, collection]
            if last_notice_id is not None:
                query += "and notice_id > %s "
                params.append(last_notice_id)
            query += "order by notice_id asc limit %s"
            params.append(DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE)
            rows = self._fetchall(query, tuple(params))
            if not rows:
                break
            page_records = tuple(
                AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(
                    _coerce_json_payload(row[0])
                )
                for row in rows
            )
            records.extend(page_records)
            last_notice_id = page_records[-1].notice_id
            if len(page_records) < DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE:
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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


def build_authenticated_notice_source_truth_inventory_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresAuthenticatedNoticeSourceTruthInventoryStore:
    source = env if env is not None else dict(os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY} or "
                f"{RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY} or "
                f"{RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when "
                "prefer_operator=True"
            )
        return PostgresAuthenticatedNoticeSourceTruthInventoryStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or source.get(RAW_ASSET_REGISTRY_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresAuthenticatedNoticeSourceTruthInventoryStore(database_url=database_url)


def build_authenticated_notice_source_truth_inventory_entries(
    *,
    corpus: str,
    collection: str,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    object_store: AuthenticatedNoticeSourceTruthInventoryObjectStore,
    object_store_settings: ObjectStoreSettings,
    source_projections_path=None,
    notice_ids: Sequence[str] = (),
    env: dict[str, str] | None = None,
) -> tuple[AuthenticatedNoticeSourceTruthInventoryEntry, ...]:
    config = _load_source_projections_config(
        source_projections_path=source_projections_path,
        env=env,
    )
    normalized_notice_ids = tuple(
        sorted({str(item).strip() for item in notice_ids if str(item).strip()})
    )
    notice_id_set = set(normalized_notice_ids)
    raw_by_key = {
        (record.raw_asset_id, record.raw_version_id): record
        for record in _list_raw_asset_registry_scope_records_for_inventory(
            raw_asset_registry,
            corpus=corpus,
            collection=collection,
        )
    }
    records = _list_document_registry_scope_records_for_inventory(
        document_registry,
        corpus=corpus,
        collection=collection,
    )
    if normalized_notice_ids:
        records = tuple(
            record
            for record in records
            if _extract_notice_id_from_document_id(record.document_id) in notice_id_set
        )
        found_notice_ids = {
            _extract_notice_id_from_document_id(record.document_id) for record in records
        }
        missing_notice_ids = tuple(
            notice_id for notice_id in normalized_notice_ids if notice_id not in found_notice_ids
        )
        if missing_notice_ids:
            raise ValueError(
                "authenticated notice source inventory notice_ids not found in registry scope: "
                + ", ".join(missing_notice_ids)
            )
    entries: list[AuthenticatedNoticeSourceTruthInventoryEntry] = []
    for record in records:
        if record.source_channel != "authenticated_notice_portal":
            continue
        notice_manifest_key = _find_processed_key(record, "source-truth/notice-manifest.json")
        content_blocks_key = _find_processed_key(record, "source-truth/content-blocks.jsonl")
        attachment_refs_key = _find_processed_key(record, "source-truth/attachment-refs.jsonl")
        if notice_manifest_key is None or content_blocks_key is None or attachment_refs_key is None:
            continue
        if record.raw_asset is None:
            raise ValueError(
                f"authenticated notice source-truth parent missing raw asset: {record.document_id}"
            )
        raw_key = (record.raw_asset.raw_asset_id, record.raw_asset.raw_version_id)
        raw_record = raw_by_key.get(raw_key)
        if raw_record is None:
            raise ValueError(
                "authenticated notice source inventory requires persisted raw asset registry truth: "
                f"{raw_key[0]}/{raw_key[1]}"
            )
        parent_snapshot = build_authenticated_notice_source_truth_parent_snapshot(
            record=record,
            raw_record=raw_record,
            object_store=object_store,
            object_store_settings=object_store_settings,
            notice_manifest_key=notice_manifest_key,
            content_blocks_key=content_blocks_key,
            attachment_refs_key=attachment_refs_key,
            config=config,
        )
        entries.append(inventory_entry_from_parent_snapshot(parent_snapshot))
    return tuple(sorted(entries, key=lambda entry: entry.notice_id))


def rebuild_authenticated_notice_source_truth_inventory(
    *,
    request,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    object_store: AuthenticatedNoticeSourceTruthInventoryObjectStore | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
    inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    runtime_object_store_settings = object_store_settings or ObjectStoreSettings.from_env(source)
    runtime_document_registry = document_registry or build_document_registry_from_env(
        source,
        prefer_operator=True,
    )
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(
        source,
        prefer_operator=True,
    )
    runtime_object_store = object_store or S3ObjectStoreClient(runtime_object_store_settings)
    runtime_inventory_store = inventory_store or build_authenticated_notice_source_truth_inventory_store_from_env(
        source,
        prefer_operator=True,
    )
    entries = build_authenticated_notice_source_truth_inventory_entries(
        corpus=request.corpus,
        collection=request.collection,
        document_registry=runtime_document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        object_store=runtime_object_store,
        object_store_settings=runtime_object_store_settings,
        source_projections_path=getattr(request, "source_projections_path", None),
        notice_ids=getattr(request, "notice_ids", ()),
        env=source,
    )
    if getattr(request, "notice_ids", ()):
        runtime_inventory_store.upsert_many(entries)
    else:
        runtime_inventory_store.replace_scope(request.corpus, request.collection, entries)
    return {
        "corpus": request.corpus,
        "collection": request.collection,
        "selected_notice_ids": list(getattr(request, "notice_ids", ())),
        "notice_count": len(entries),
        "expected_document_count": sum(1 + entry.attachment_document_count for entry in entries),
        "expected_attachment_document_count": sum(
            entry.attachment_document_count for entry in entries
        ),
        "expected_ocr_candidate_count": sum(entry.ocr_required_count for entry in entries),
        "notice_risk_counts": _aggregate_notice_risk_counts(
            entry.notice_risk_label for entry in entries
        ),
        "high_risk_notice_count": sum(
            1 for entry in entries if entry.notice_risk_label in HIGH_RISK_NOTICE_LABELS
        ),
    }


def build_authenticated_notice_source_truth_parent_snapshot(
    *,
    record: DocumentRegistryRecord,
    raw_record: RawAssetRecord,
    object_store: AuthenticatedNoticeSourceTruthInventoryObjectStore,
    object_store_settings: ObjectStoreSettings,
    notice_manifest_key: str,
    content_blocks_key: str,
    attachment_refs_key: str,
    config,
) -> dict[str, Any]:
    notice_manifest = _load_json_payload(
        object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=notice_manifest_key,
        )
    )
    attachment_refs = _load_jsonl_rows(
        object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=attachment_refs_key,
        )
    )
    source_artifact_keys = tuple(
        key for key in record.processed_object_keys if key and is_source_object_key(str(key))
    )
    return build_authenticated_notice_source_truth_parent_snapshot_from_payloads(
        record=record,
        raw_record=raw_record,
        notice_manifest_key=notice_manifest_key,
        content_blocks_key=content_blocks_key,
        attachment_refs_key=attachment_refs_key,
        source_artifact_keys=source_artifact_keys,
        notice_manifest=notice_manifest,
        attachment_refs=attachment_refs,
        config=config,
        object_store=object_store,
        object_store_settings=object_store_settings,
    )


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
        with _postgres_connection(database_url) as conn:
            with conn.cursor() as cursor:
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
        query = (
            f"select record from {table_name} "
            "where corpus = %s and collection = %s "
        )
        params: list[object] = [corpus, collection]
        if last_key is not None:
            query += "and (raw_asset_id, raw_version_id) > (%s, %s) "
            params.extend(last_key)
        query += "order by raw_asset_id asc, raw_version_id asc limit %s"
        params.append(normalized_page_size)
        with _postgres_connection(database_url) as conn:
            with conn.cursor() as cursor:
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


def build_authenticated_notice_source_truth_parent_snapshot_from_payloads(
    *,
    record: DocumentRegistryRecord,
    raw_record: RawAssetRecord,
    notice_manifest_key: str,
    content_blocks_key: str,
    attachment_refs_key: str,
    source_artifact_keys: Sequence[str],
    notice_manifest: dict[str, Any],
    attachment_refs: Sequence[dict[str, Any]],
    config,
    object_store: AuthenticatedNoticeSourceTruthInventoryObjectStore | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
) -> dict[str, Any]:
    site_id, notice_id = str(record.document_id).split(":")[1:3]
    attachment_ref_count = len(tuple(attachment_refs))
    owner_expectations = [
        dict(item)
        for item in (notice_manifest.get("owner_expectations") or ())
        if isinstance(item, dict)
    ]
    reference_only_count = 0
    text_extractable_count = 0
    ocr_required_count = 0
    attachment_projection_plans = build_authenticated_notice_attachment_projection_plans(
        parent_document_id=record.document_id,
        attachment_refs=tuple(attachment_refs),
        config=config,
        object_store=object_store,
        object_store_settings=object_store_settings,
        parent_record=record,
    )
    for plan in attachment_projection_plans:
        classification = str(plan["classification"])
        if classification == "text_extractable":
            text_extractable_count += 1
        elif classification == "ocr_required":
            ocr_required_count += 1
    manual_review_required_count = sum(
        1
        for plan in attachment_projection_plans
        if str(plan.get("classification") or "") == "manual_review_required"
    )
    reference_only_count = max(
        0,
        len(tuple(attachment_refs))
        - len(attachment_projection_plans),
    )
    expected_attachment_documents = [
        dict(plan)
        for plan in attachment_projection_plans
        if str(plan["materialization_policy"]) == "required_document"
    ]
    source_home_url = _normalize_non_empty_text(notice_manifest.get("source_home_url")) or _derive_source_home_url(
        record.source_uri
    )
    has_text_table_attachment = text_extractable_count > 0 or ocr_required_count > 0
    has_spatial_attachment = manual_review_required_count > 0
    has_reference_only_attachment = reference_only_count > 0
    attachment_lane_count = sum(
        1
        for count in (
            text_extractable_count,
            ocr_required_count,
            manual_review_required_count,
            reference_only_count,
        )
        if count > 0
    )
    attachment_mix_score = attachment_ref_count + max(0, attachment_lane_count - 1)
    notice_risk_label = _derive_notice_risk_label(
        attachment_ref_count=attachment_ref_count,
        has_text_table_attachment=has_text_table_attachment,
        has_spatial_attachment=has_spatial_attachment,
        has_reference_only_attachment=has_reference_only_attachment,
    )
    planning_weight = (
        AUTHENTICATED_NOTICE_SOURCE_TRUTH_BASE_WEIGHT
        + text_extractable_count * AUTHENTICATED_NOTICE_SOURCE_TRUTH_TEXT_ATTACHMENT_WEIGHT
        + ocr_required_count * AUTHENTICATED_NOTICE_SOURCE_TRUTH_OCR_ATTACHMENT_WEIGHT
    )
    return {
        "notice_id": notice_id,
        "site_id": site_id,
        "document_id": record.document_id,
        "record": _serialize_document_record(record),
        "raw_record": asdict(raw_record),
        "source_artifact_keys": [str(item) for item in source_artifact_keys if str(item).strip()],
        "notice_manifest_key": notice_manifest_key,
        "content_blocks_key": content_blocks_key,
        "attachment_refs_key": attachment_refs_key,
        "attachment_projection_plans": [dict(item) for item in attachment_projection_plans],
        "expected_attachment_documents": expected_attachment_documents,
        "attachment_document_count": len(expected_attachment_documents),
        "attachment_ref_count": attachment_ref_count,
        "owner_expectation_count": int(
            notice_manifest.get("owner_expectation_count") or len(owner_expectations)
        ),
        "owner_expectations": owner_expectations,
        "text_extractable_count": text_extractable_count,
        "ocr_required_count": ocr_required_count,
        "reference_only_count": reference_only_count,
        "manual_review_required_count": manual_review_required_count,
        "notice_title": _normalize_non_empty_text(
            notice_manifest.get("notice_title_normalized")
            or notice_manifest.get("notice_title_raw")
        )
        or record.document_id,
        "notice_release_time": _normalize_non_empty_text(
            notice_manifest.get("notice_release_time")
        ),
        "notice_type_names": _normalize_notice_type_names(
            notice_manifest.get("notice_type_names")
        ),
        "notice_risk_label": notice_risk_label,
        "attachment_mix_score": attachment_mix_score,
        "has_text_table_attachment": has_text_table_attachment,
        "has_spatial_attachment": has_spatial_attachment,
        "has_reference_only_attachment": has_reference_only_attachment,
        "planning_weight": planning_weight,
        "source_home_url": source_home_url,
        "embedding_model": record.embedding_model,
    }


def inventory_entry_from_parent_snapshot(
    parent_snapshot: dict[str, Any],
) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    record_payload = dict(parent_snapshot["record"])
    return AuthenticatedNoticeSourceTruthInventoryEntry(
        corpus=str(record_payload["corpus"]),
        collection=str(record_payload["collection"]),
        notice_id=str(parent_snapshot["notice_id"]),
        site_id=str(parent_snapshot["site_id"]),
        document_id=str(parent_snapshot["document_id"]),
        revision_track=str(record_payload["revision_track"]),
        version_id=str(record_payload["version_id"]),
        raw_asset_id=str(parent_snapshot["raw_record"]["raw_asset_id"]),
        raw_version_id=str(parent_snapshot["raw_record"]["raw_version_id"]),
        source_home_url=str(parent_snapshot["source_home_url"]),
        embedding_model=str(parent_snapshot["embedding_model"]),
        notice_manifest_key=str(parent_snapshot["notice_manifest_key"]),
        content_blocks_key=str(parent_snapshot["content_blocks_key"]),
        attachment_refs_key=str(parent_snapshot["attachment_refs_key"]),
        attachment_document_count=int(parent_snapshot["attachment_document_count"]),
        attachment_ref_count=int(parent_snapshot.get("attachment_ref_count") or 0),
        text_extractable_count=int(parent_snapshot["text_extractable_count"]),
        ocr_required_count=int(parent_snapshot["ocr_required_count"]),
        reference_only_count=int(parent_snapshot["reference_only_count"]),
        manual_review_required_count=int(parent_snapshot.get("manual_review_required_count") or 0),
        notice_risk_label=str(
            parent_snapshot.get("notice_risk_label") or NOTICE_RISK_LABEL_BODY_ONLY
        ),
        attachment_mix_score=int(parent_snapshot.get("attachment_mix_score") or 0),
        has_text_table_attachment=bool(parent_snapshot.get("has_text_table_attachment", False)),
        has_spatial_attachment=bool(parent_snapshot.get("has_spatial_attachment", False)),
        has_reference_only_attachment=bool(
            parent_snapshot.get("has_reference_only_attachment", False)
        ),
        planning_weight=int(parent_snapshot["planning_weight"]),
        parent_snapshot=dict(parent_snapshot),
    )


def _load_source_projections_config(*, source_projections_path=None, env: dict[str, str] | None = None):
    config_path = source_projections_path
    if config_path is None:
        config_path = read_authenticated_notice_source_projections_config_path(
            env if env is not None else {}
        )
    return load_authenticated_notice_source_projections_config(config_path)


def _serialize_document_record(record: DocumentRegistryRecord) -> dict[str, Any]:
    return {
        "document_id": record.document_id,
        "revision_track": record.revision_track,
        "version_id": record.version_id,
        "source_uri": record.source_uri,
        "content_hash": record.content_hash,
        "corpus": record.corpus,
        "collection": record.collection,
        "cleaning_policy_version": record.cleaning_policy_version,
        "entitlement_groups": list(record.entitlement_groups),
        "visibility_scope": record.visibility_scope,
        "visibility_level": record.visibility_level,
        "policy_projection_version": record.policy_projection_version,
        "status": record.status,
        "ingestion_timestamp": record.ingestion_timestamp,
        "parser_version": record.parser_version,
        "embedding_model": record.embedding_model,
        "source_channel": record.source_channel,
        "is_current": record.is_current,
        "effective_date": record.effective_date,
        "published_date": record.published_date,
        "supersedes_version_id": record.supersedes_version_id,
        "provenance_status": record.provenance_status,
        "document_units_object_key": record.document_units_object_key,
        "provider_response_object_key": record.provider_response_object_key,
        "layout_elements_object_key": record.layout_elements_object_key,
        "canonical_markdown_object_key": record.canonical_markdown_object_key,
        "processed_object_keys": list(record.processed_object_keys),
        "import_source": record.import_source,
    }


def _extract_notice_id_from_document_id(document_id: str) -> str:
    parts = [part.strip() for part in str(document_id).split(":")]
    if len(parts) < 3 or parts[0] != "notice" or not parts[2]:
        raise ValueError(
            f"authenticated notice source inventory requires notice document ids: {document_id}"
        )
    return parts[2]


def _derive_notice_risk_label(
    *,
    attachment_ref_count: int,
    has_text_table_attachment: bool,
    has_spatial_attachment: bool,
    has_reference_only_attachment: bool,
) -> str:
    if attachment_ref_count <= 0:
        return NOTICE_RISK_LABEL_BODY_ONLY
    if has_spatial_attachment and (has_text_table_attachment or has_reference_only_attachment):
        return NOTICE_RISK_LABEL_MIXED_HIGH_RISK
    if has_spatial_attachment:
        return NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS
    if has_text_table_attachment:
        return NOTICE_RISK_LABEL_TEXT_ATTACHMENTS
    if has_reference_only_attachment:
        return NOTICE_RISK_LABEL_REFERENCE_ONLY
    return NOTICE_RISK_LABEL_BODY_ONLY


def _aggregate_notice_risk_counts(labels: Sequence[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for label in labels:
        normalized = str(label).strip() or NOTICE_RISK_LABEL_BODY_ONLY
        counts[normalized] = counts.get(normalized, 0) + 1
    return dict(sorted(counts.items()))


def _normalize_notice_type_names(value: object) -> list[str]:
    normalized: list[str] = []
    for item in value or ():
        text = _normalize_non_empty_text(item)
        if text is not None:
            normalized.append(text)
    return normalized


def _coerce_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes"}:
            return True
        if normalized in {"0", "false", "no", ""}:
            return False
    return bool(value)


def _derive_source_home_url(source_uri: str) -> str:
    normalized = source_uri.strip()
    parsed = urlsplit(normalized)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return normalized


def _normalize_non_empty_text(value: Any) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


__all__ = [
    "AuthenticatedNoticeSourceTruthInventoryEntry",
    "AuthenticatedNoticeSourceTruthInventoryObjectStore",
    "AuthenticatedNoticeSourceTruthInventoryStore",
    "DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY",
    "DEFAULT_SOURCE_TRUTH_INVENTORY_SCHEMA",
    "DEFAULT_SOURCE_TRUTH_INVENTORY_TABLE",
    "InMemoryAuthenticatedNoticeSourceTruthInventoryStore",
    "PostgresAuthenticatedNoticeSourceTruthInventoryStore",
    "_list_document_registry_scope_records_for_inventory",
    "_list_raw_asset_registry_scope_records_for_inventory",
    "build_authenticated_notice_source_truth_inventory_entries",
    "build_authenticated_notice_source_truth_inventory_store_from_env",
    "build_authenticated_notice_source_truth_parent_snapshot",
    "build_authenticated_notice_source_truth_parent_snapshot_from_payloads",
    "inventory_entry_from_parent_snapshot",
    "rebuild_authenticated_notice_source_truth_inventory",
]
