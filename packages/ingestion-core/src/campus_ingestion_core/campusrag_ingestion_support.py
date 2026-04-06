from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Protocol

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from campus_ingestion_core.artifacts import (
    CANONICAL_MARKDOWN_FILENAME,
    DOCUMENT_UNITS_FILENAME,
    LAYOUT_ELEMENTS_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.models import (
    DocumentRegistryRecord,
    RawAssetRecord,
    RawAssetRef,
    SourceObservation,
)
from campus_ingestion_core.object_store import (
    build_document_artifact_key,
    build_raw_asset_key,
    is_source_object_key,
)
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.settings import ObjectStoreSettings


@dataclass(frozen=True, slots=True)
class ImportReport:
    import_mode: str
    success_count: int
    skipped_count: int
    failed_count: int
    raw_uploaded_count: int
    raw_reused_count: int
    document_ids: tuple[str, ...]
    unresolved_source_pdfs: tuple[str, ...]
    errors: tuple[str, ...]
    report_path: str
    created_document_ids: tuple[str, ...] = ()
    updated_document_ids: tuple[str, ...] = ()
    skipped_document_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class PersistImportStats:
    success_count: int
    skipped_count: int
    failed_count: int
    raw_uploaded_count: int
    raw_reused_count: int
    document_ids: tuple[str, ...]
    unresolved_source_pdfs: tuple[str, ...]
    errors: tuple[str, ...]
    timestamp: str
    created_document_ids: tuple[str, ...] = ()
    updated_document_ids: tuple[str, ...] = ()
    skipped_document_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DocumentImportInput:
    source_label: str
    document_units_bytes: bytes
    provider_response_bytes: bytes | None
    canonical_markdown_bytes: bytes | None
    metadata: dict[str, object]
    import_source: str
    revision_track: str = "source-faithful"
    source_channel: str = "pdf_ocr"
    is_current: bool = False
    corpus: str = ""
    collection: str = ""
    visibility_scope: str | None = None
    status: str = "active"
    raw_path: Path | None = None
    raw_source_uri: str | None = None
    raw_asset_id: str | None = None
    raw_version_id: str | None = None
    provider_response_object_key: str | None = None
    layout_elements_bytes: bytes | None = None
    layout_elements_object_key: str | None = None
    additional_processed_object_keys: tuple[str, ...] = field(default_factory=tuple)
    title: str | None = None
    year: str | None = None


@dataclass(frozen=True, slots=True)
class ResolvedRawAsset:
    raw_asset_id: str
    raw_version_id: str
    source_filename: str
    path: Path
    raw_source_uri: str
    content_hash: str
    object_key: str


DEFAULT_SOURCE_PREFERENCE = {
    "current-effective": ("official_web", "manual_curated", "pdf_ocr"),
    "source-faithful": ("pdf_ocr", "manual_curated", "official_web"),
    "editorial": ("manual_curated", "official_web", "pdf_ocr"),
}
OFFICIAL_WEB_EQUIVALENT_SOURCE_CHANNELS = frozenset({"official_web"})


class ObjectStoreWriter(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class S3ObjectStoreWriter:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        from campus_ingestion_core.object_store import S3ObjectStoreClientFactory

        self._factory = S3ObjectStoreClientFactory(settings)
        self._client = self._factory.create()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        client = self._one_shot_client_for_zero_byte_payload() if not data else self._client
        try:
            client.put_object(
                Bucket=bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
        finally:
            if client is not self._client:
                close = getattr(client, "close", None)
                if callable(close):
                    close()

    def _one_shot_client_for_zero_byte_payload(self):
        # Local MinIO can stall on the next reused connection after a zero-byte put_object.
        # Isolating empty writes to a throwaway client keeps the shared client pool healthy.
        return self._factory.create()


def _build_source_observation(
    *,
    document: DocumentImportInput,
    metadata: dict[str, object],
    raw_asset: ResolvedRawAsset | None,
    is_primary: bool,
) -> SourceObservation:
    return SourceObservation(
        source_channel=document.source_channel,
        source_uri=derive_source_uri(metadata),
        raw_asset=_resolve_registry_raw_asset_ref(
            raw_asset=raw_asset,
            document=document,
            metadata=metadata,
        ),
        is_primary=is_primary,
        import_source=document.import_source,
    )


def _record_source_observations(record: DocumentRegistryRecord) -> tuple[SourceObservation, ...]:
    if record.source_observations:
        return record.source_observations
    return (
        SourceObservation(
            source_channel=record.source_channel,
            source_uri=record.source_uri,
            raw_asset=record.raw_asset,
            is_primary=True,
            import_source=record.import_source,
        ),
    )


def _source_observation_identity(observation: SourceObservation) -> tuple[str, str, str, str]:
    raw_asset = observation.raw_asset
    return (
        observation.source_channel,
        observation.source_uri,
        raw_asset.raw_asset_id if raw_asset is not None else "",
        raw_asset.raw_version_id if raw_asset is not None else "",
    )


def _source_priority(*, revision_track: str, source_channel: str) -> int:
    preferences = DEFAULT_SOURCE_PREFERENCE.get(revision_track, ("manual_curated", "official_web", "pdf_ocr"))
    try:
        return len(preferences) - preferences.index(source_channel)
    except ValueError:
        return 0


def _document_semantic_hash(*, document: DocumentImportInput) -> str:
    explicit_hash = normalize_optional_text(document.metadata.get("semantic_content_hash"))
    if explicit_hash is not None:
        return explicit_hash
    return hashlib.sha256(document.document_units_bytes).hexdigest()


def _merge_source_observation(existing: SourceObservation, candidate: SourceObservation) -> SourceObservation:
    return SourceObservation(
        source_channel=existing.source_channel,
        source_uri=existing.source_uri,
        raw_asset=candidate.raw_asset if candidate.raw_asset is not None else existing.raw_asset,
        is_primary=existing.is_primary or candidate.is_primary,
        import_source=candidate.import_source or existing.import_source,
    )


def _choose_primary_observation(
    *,
    revision_track: str,
    observations: tuple[SourceObservation, ...],
) -> SourceObservation:
    existing_primary_identity = next(
        (
            _source_observation_identity(observation)
            for observation in observations
            if observation.is_primary
        ),
        None,
    )
    return max(
        observations,
        key=lambda observation: (
            _source_priority(revision_track=revision_track, source_channel=observation.source_channel),
            existing_primary_identity == _source_observation_identity(observation),
        ),
    )


def _merge_equivalent_source_record(
    *,
    existing: DocumentRegistryRecord,
    document: DocumentImportInput,
    metadata: dict[str, object],
    raw_asset: ResolvedRawAsset | None,
    timestamp: str,
) -> DocumentRegistryRecord:
    candidate_observation = _build_source_observation(
        document=document,
        metadata=metadata,
        raw_asset=raw_asset,
        is_primary=False,
    )
    observations_by_identity: dict[tuple[str, str, str, str], SourceObservation] = {}
    for observation in _record_source_observations(existing):
        observations_by_identity[_source_observation_identity(observation)] = observation
    candidate_identity = _source_observation_identity(candidate_observation)
    existing_candidate = observations_by_identity.get(candidate_identity)
    observations_by_identity[candidate_identity] = (
        _merge_source_observation(existing_candidate, candidate_observation)
        if existing_candidate is not None
        else candidate_observation
    )
    chosen_primary = _choose_primary_observation(
        revision_track=existing.revision_track,
        observations=tuple(observations_by_identity.values()),
    )
    normalized_observations = tuple(
        sorted(
            (
                replace(
                    observation,
                    is_primary=_source_observation_identity(observation) == _source_observation_identity(chosen_primary),
                )
                for observation in observations_by_identity.values()
            ),
            key=_source_observation_identity,
        )
    )
    return replace(
        existing,
        source_uri=chosen_primary.source_uri,
        source_channel=chosen_primary.source_channel,
        raw_asset=chosen_primary.raw_asset,
        source_observations=normalized_observations,
        is_current=existing.is_current or document.is_current,
        status="active" if existing.is_current or document.is_current else existing.status,
        ingestion_timestamp=timestamp,
        import_source=(
            document.import_source
            if _source_observation_identity(chosen_primary) == candidate_identity
            else existing.import_source
        ),
    )


def _is_source_level_artifact_key(key: str) -> bool:
    return is_source_object_key(key)


def load_metadata_from_bytes(file_bytes: bytes) -> dict[str, object]:
    first_line = file_bytes.decode("utf-8").splitlines()[0]
    raw = json.loads(first_line)
    document_id = str(raw.get("doc_id") or "")
    version_id = str(raw.get("version_id") or "")
    if not document_id or not version_id:
        raise ValueError("doc_id and version_id are required in OCR JSONL")
    _assert_canonical_row_authorization_metadata(raw)
    source = raw.get("source") or {}
    nested_metadata = raw.get("metadata") or {}
    nested_metadata_dict = nested_metadata if isinstance(nested_metadata, dict) else {}
    source_url = raw.get("source_url")
    if not isinstance(source_url, str) or not source_url.strip():
        source_url = nested_metadata_dict.get("source_url")
    entitlement_groups = _resolve_row_entitlement_groups(raw)
    visibility_scope = normalize_optional_text(raw.get("visibility_scope"))
    visibility_level = _resolve_row_visibility_level(
        raw=raw,
        entitlement_groups=entitlement_groups,
    )
    policy_projection_version = (
        normalize_optional_text(raw.get("policy_projection_version"))
        or DEFAULT_POLICY_PROJECTION_VERSION
    )
    return {
        "document_id": document_id,
        "version_id": version_id,
        "revision_track": str(raw.get("revision_track") or "source-faithful"),
        "source_url": source_url,
        "source_md": raw.get("source_md"),
        "source_id": source.get("id"),
        "source_pdf": normalize_optional_text(raw.get("source_pdf")),
        "raw_page_start": normalize_optional_int(raw.get("page_start")),
        "raw_page_end": normalize_optional_int(raw.get("page_end")),
        "semantic_content_hash": normalize_optional_text(nested_metadata_dict.get("semantic_content_hash")),
        "title": normalize_optional_text(nested_metadata_dict.get("title")),
        "page_family": normalize_optional_text(nested_metadata_dict.get("page_family")),
        "serving_intent": normalize_optional_text(nested_metadata_dict.get("serving_intent")),
        "content_role": normalize_optional_text(nested_metadata_dict.get("content_role")),
        "entitlement_groups": entitlement_groups,
        "visibility_scope": visibility_scope,
        "visibility_level": visibility_level,
        "policy_projection_version": policy_projection_version,
    }


def apply_authorization_projection_metadata(
    metadata: dict[str, object],
    *,
    entitlement_groups: tuple[str, ...] | list[str],
    visibility_scope: str | None,
    visibility_level: str | None = None,
    policy_projection_version: str = DEFAULT_POLICY_PROJECTION_VERSION,
) -> None:
    _assert_canonical_authorization_metadata(metadata)
    normalized_groups = _normalize_group_values(entitlement_groups)
    normalized_scope = normalize_optional_text(visibility_scope)
    normalized_visibility_level = normalize_optional_text(visibility_level)
    resolved_visibility_level = (
        normalized_visibility_level
        or ("restricted" if normalized_groups else "public")
    )
    normalized_policy_projection_version = (
        normalize_optional_text(policy_projection_version)
        or DEFAULT_POLICY_PROJECTION_VERSION
    )

    metadata["entitlement_groups"] = list(normalized_groups)
    metadata["visibility_scope"] = normalized_scope
    metadata["visibility_level"] = resolved_visibility_level
    metadata["policy_projection_version"] = normalized_policy_projection_version


def _resolve_entitlement_groups(metadata: dict[str, object]) -> tuple[str, ...]:
    return _normalize_group_values(metadata.get("entitlement_groups"))


def _resolve_visibility_scope(
    *,
    metadata: dict[str, object],
    document: DocumentImportInput,
    default_visibility_scope: str | None,
) -> str | None:
    metadata_scope = normalize_optional_text(metadata.get("visibility_scope"))
    if metadata_scope is not None:
        return metadata_scope
    if document.visibility_scope is not None:
        return document.visibility_scope
    return default_visibility_scope


def _resolve_visibility_level(
    *,
    metadata: dict[str, object],
    entitlement_groups: tuple[str, ...],
) -> str:
    metadata_visibility_level = normalize_optional_text(metadata.get("visibility_level"))
    if metadata_visibility_level is not None:
        return metadata_visibility_level
    return "restricted" if entitlement_groups else "public"


def _resolve_policy_projection_version(metadata: dict[str, object]) -> str:
    return (
        normalize_optional_text(metadata.get("policy_projection_version"))
        or DEFAULT_POLICY_PROJECTION_VERSION
    )


def _normalize_group_values(value: object) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        return ()
    normalized: list[str] = []
    for item in value:
        text = normalize_optional_text(item)
        if text is not None:
            normalized.append(text)
    return tuple(normalized)


def _resolve_row_entitlement_groups(raw: dict[str, object]) -> tuple[str, ...]:
    return _normalize_group_values(raw.get("entitlement_groups"))


def _resolve_row_visibility_level(
    *,
    raw: dict[str, object],
    entitlement_groups: tuple[str, ...],
) -> str:
    visibility_level = normalize_optional_text(raw.get("visibility_level"))
    if visibility_level is not None:
        return visibility_level
    return "restricted" if entitlement_groups else "public"


def _assert_canonical_row_authorization_metadata(raw: dict[str, object]) -> None:
    if raw.get("acl") is not None:
        raise ValueError("legacy row authorization metadata is not allowed: acl")


def persist_import_documents(
    *,
    documents: list[DocumentImportInput],
    registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    parser_version: str,
    embedding_model: str,
    cleaning_policy_version: str,
    default_visibility_scope: str | None,
    import_mode: str,
    report_dir: Path,
    report_prefix: str,
    unresolved_source_pdfs: tuple[str, ...] = (),
    initial_errors: list[str] | None = None,
    scope_refresh: tuple[str, str] | None = None,
) -> ImportReport:
    stats = collect_import_document_stats(
        documents=documents,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        writer=writer,
        object_store=object_store,
        parser_version=parser_version,
        embedding_model=embedding_model,
        cleaning_policy_version=cleaning_policy_version,
        default_visibility_scope=default_visibility_scope,
        unresolved_source_pdfs=unresolved_source_pdfs,
        initial_errors=initial_errors,
        scope_refresh=scope_refresh,
    )
    return write_import_report(
        import_mode=import_mode,
        report_dir=report_dir,
        report_prefix=report_prefix,
        success_count=stats.success_count,
        skipped_count=stats.skipped_count,
        failed_count=stats.failed_count,
        raw_uploaded_count=stats.raw_uploaded_count,
        raw_reused_count=stats.raw_reused_count,
        document_ids=stats.document_ids,
        created_document_ids=stats.created_document_ids,
        updated_document_ids=stats.updated_document_ids,
        skipped_document_ids=stats.skipped_document_ids,
        unresolved_source_pdfs=stats.unresolved_source_pdfs,
        errors=stats.errors,
        timestamp=stats.timestamp,
    )


def collect_import_document_stats(
    *,
    documents: list[DocumentImportInput],
    registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    parser_version: str,
    embedding_model: str,
    cleaning_policy_version: str,
    default_visibility_scope: str | None,
    unresolved_source_pdfs: tuple[str, ...] = (),
    initial_errors: list[str] | None = None,
    scope_refresh: tuple[str, str] | None = None,
) -> PersistImportStats:
    success_count = 0
    skipped_count = 0
    failed_count = len(initial_errors or [])
    raw_uploaded_count = 0
    raw_reused_count = 0
    document_ids: list[str] = []
    created_document_ids: list[str] = []
    updated_document_ids: list[str] = []
    skipped_document_ids: list[str] = []
    errors = list(initial_errors or [])
    timestamp = utc_now()
    uploaded_raw_assets: set[tuple[str, str]] = set()
    documents_by_scope = _group_documents_by_scope(documents)
    existing_records_by_scope = {
        scope: _prefetch_existing_scope_records(
            registry=registry,
            scope=scope,
            scope_refresh=scope_refresh,
        )
        for scope in documents_by_scope
    }
    if scope_refresh is not None:
        if scope_refresh not in documents_by_scope and documents:
            raise ValueError("scope_refresh must match the imported document scope")
        if len(documents_by_scope) > 1:
            raise ValueError("scope_refresh only supports a single imported scope")
    existing_records_by_lineage = {
        scope: _index_scope_records_by_lineage(records)
        for scope, records in existing_records_by_scope.items()
    }
    pending_records: list[DocumentRegistryRecord] = []
    scope_records_for_refresh: dict[tuple[str, str], dict[tuple[str, str, str], DocumentRegistryRecord]] = {
        scope: {}
        for scope in documents_by_scope
    }

    for document in documents:
        metadata = document.metadata
        source_label = document.source_label
        try:
            document_id = str(metadata["document_id"])
            version_id = str(metadata["version_id"])
            raw_asset = resolved_raw_asset(
                raw_path=document.raw_path,
                raw_source_uri=document.raw_source_uri,
                corpus=document.corpus,
                raw_asset_id_override=document.raw_asset_id,
            )
            if raw_asset is not None:
                raw_asset_key = (raw_asset.raw_asset_id, raw_asset.raw_version_id)
                existing_raw_record = raw_asset_registry.get(*raw_asset_key)
                if existing_raw_record is not None or raw_asset_key in uploaded_raw_assets:
                    raw_reused_count += 1
                else:
                    writer.put_bytes(
                        bucket=object_store.bucket_source,
                        key=raw_asset.object_key,
                        data=document.raw_path.read_bytes(),
                        content_type="application/pdf",
                    )
                    raw_asset_registry.upsert(
                        RawAssetRecord(
                            raw_asset_id=raw_asset.raw_asset_id,
                            raw_version_id=raw_asset.raw_version_id,
                            corpus=document.corpus,
                            collection=document.collection,
                            raw_source_uri=raw_asset.raw_source_uri,
                            content_hash=raw_asset.content_hash,
                            source_filename=raw_asset.source_filename,
                            object_key=raw_asset.object_key,
                            ingestion_timestamp=timestamp,
                            import_source=document.import_source,
                        )
                    )
                    uploaded_raw_assets.add(raw_asset_key)
                    raw_uploaded_count += 1

            document_units_bytes = document.document_units_bytes
            content_hash = _document_semantic_hash(document=document)
            title = document.title or _derive_document_title(metadata=metadata, document_id=document_id)
            year = document.year or _derive_document_year(metadata=metadata)
            scope = (document.corpus, document.collection)
            document_records = existing_records_by_lineage.get(scope, {}).get(
                (document_id, document.revision_track),
                (),
            )
            matching_content_record = next(
                (record for record in document_records if record.content_hash == content_hash),
                None,
            )
            if matching_content_record is None:
                matching_content_record = _find_equivalent_scope_record(
                    existing_records_by_lineage=existing_records_by_lineage,
                    scope=scope,
                    document=document,
                    content_hash=content_hash,
                )
            effective_version_id = matching_content_record.version_id if matching_content_record is not None else version_id
            incoming_source_uri = derive_source_uri(metadata)
            provider_response_key = document.provider_response_object_key
            layout_elements_key = document.layout_elements_object_key
            if document.provider_response_bytes is not None and provider_response_key is None:
                provider_response_key = build_document_artifact_key(
                    corpus=document.corpus,
                    collection=document.collection,
                    document_id=document_id,
                    revision_track=document.revision_track,
                    version_id=effective_version_id,
                    filename=PROVIDER_RESPONSE_FILENAME,
                    title=title,
                    year=year,
                )
            if document.layout_elements_bytes is not None and layout_elements_key is None:
                layout_elements_key = build_document_artifact_key(
                    corpus=document.corpus,
                    collection=document.collection,
                    document_id=document_id,
                    revision_track=document.revision_track,
                    version_id=effective_version_id,
                    filename=LAYOUT_ELEMENTS_FILENAME,
                    title=title,
                    year=year,
                )
            if (
                document.provider_response_bytes is not None
                and provider_response_key is not None
                and _is_source_level_artifact_key(provider_response_key)
            ):
                writer.put_bytes(
                    bucket=_artifact_bucket_for_key(object_store=object_store, key=provider_response_key),
                    key=provider_response_key,
                    data=document.provider_response_bytes,
                    content_type="application/x-ndjson",
                )
            if (
                document.layout_elements_bytes is not None
                and layout_elements_key is not None
                and _is_source_level_artifact_key(layout_elements_key)
            ):
                writer.put_bytes(
                    bucket=_artifact_bucket_for_key(object_store=object_store, key=layout_elements_key),
                    key=layout_elements_key,
                    data=document.layout_elements_bytes,
                    content_type="application/x-ndjson",
                )

            document_units_key = build_document_artifact_key(
                corpus=document.corpus,
                collection=document.collection,
                document_id=document_id,
                revision_track=document.revision_track,
                version_id=effective_version_id,
                filename=DOCUMENT_UNITS_FILENAME,
                title=title,
                year=year,
            )
            canonical_markdown_key = None
            if document.canonical_markdown_bytes is not None:
                canonical_markdown_key = build_document_artifact_key(
                    corpus=document.corpus,
                    collection=document.collection,
                    document_id=document_id,
                    revision_track=document.revision_track,
                    version_id=effective_version_id,
                    filename=CANONICAL_MARKDOWN_FILENAME,
                    title=title,
                    year=year,
                )
            processed_object_keys = tuple(
                dict.fromkeys(
                    key
                    for key in (
                        provider_response_key,
                        layout_elements_key,
                        canonical_markdown_key,
                        document_units_key,
                        *document.additional_processed_object_keys,
                    )
                    if key is not None
                )
            )
            if matching_content_record is not None:
                merged_equivalent_record = _merge_equivalent_source_record(
                    existing=matching_content_record,
                    document=document,
                    metadata=metadata,
                    raw_asset=raw_asset,
                    timestamp=timestamp,
                )
                artifact_refresh_supported = (
                    matching_content_record.version_id == version_id
                    and matching_content_record.source_channel == document.source_channel
                    and matching_content_record.source_uri == incoming_source_uri
                )
                if artifact_refresh_supported and _registry_record_needs_refresh(
                    existing=matching_content_record,
                    document_units_key=document_units_key,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    canonical_markdown_key=canonical_markdown_key,
                    processed_object_keys=processed_object_keys,
                    writer=writer,
                    object_store=object_store,
                ):
                    if (
                        document.provider_response_bytes is not None
                        and provider_response_key is not None
                        and not _is_source_level_artifact_key(provider_response_key)
                    ):
                        writer.put_bytes(
                            bucket=_artifact_bucket_for_key(object_store=object_store, key=provider_response_key),
                            key=provider_response_key,
                            data=document.provider_response_bytes,
                            content_type="application/x-ndjson",
                        )
                    if (
                        document.layout_elements_bytes is not None
                        and layout_elements_key is not None
                        and not _is_source_level_artifact_key(layout_elements_key)
                    ):
                        writer.put_bytes(
                            bucket=_artifact_bucket_for_key(object_store=object_store, key=layout_elements_key),
                            key=layout_elements_key,
                            data=document.layout_elements_bytes,
                            content_type="application/x-ndjson",
                        )
                    if document.canonical_markdown_bytes is not None and canonical_markdown_key is not None:
                        writer.put_bytes(
                            bucket=object_store.bucket_derived,
                            key=canonical_markdown_key,
                            data=document.canonical_markdown_bytes,
                            content_type="text/markdown; charset=utf-8",
                        )
                    writer.put_bytes(
                        bucket=object_store.bucket_derived,
                        key=document_units_key,
                        data=document_units_bytes,
                        content_type="application/x-ndjson",
                    )
                    refreshed_record = _build_registry_record(
                        document_id=document_id,
                        version_id=effective_version_id,
                        metadata=metadata,
                        content_hash=content_hash,
                        document=document,
                        default_visibility_scope=default_visibility_scope,
                        parser_version=parser_version,
                        embedding_model=embedding_model,
                        cleaning_policy_version=cleaning_policy_version,
                        raw_asset=raw_asset,
                        document_units_key=document_units_key,
                        provider_response_key=provider_response_key,
                        layout_elements_key=layout_elements_key,
                        canonical_markdown_key=canonical_markdown_key,
                        processed_object_keys=processed_object_keys,
                        timestamp=timestamp,
                    )
                    refreshed_record = replace(
                        refreshed_record,
                        source_uri=merged_equivalent_record.source_uri,
                        source_channel=merged_equivalent_record.source_channel,
                        raw_asset=merged_equivalent_record.raw_asset,
                        source_observations=merged_equivalent_record.source_observations,
                        is_current=merged_equivalent_record.is_current,
                        status=merged_equivalent_record.status,
                        import_source=merged_equivalent_record.import_source,
                        supersedes_version_id=merged_equivalent_record.supersedes_version_id,
                    )
                    refreshed_record, demoted_records = _apply_current_promotion(
                        existing_records_by_lineage=existing_records_by_lineage,
                        scope=scope,
                        record=refreshed_record,
                    )
                    pending_records.append(refreshed_record)
                    pending_records.extend(demoted_records)
                    _replace_prefetched_lineage_record(
                        existing_records_by_lineage=existing_records_by_lineage,
                        scope=scope,
                        record=refreshed_record,
                    )
                    _record_scope_refresh_candidate(
                        scope_records_for_refresh=scope_records_for_refresh,
                        scope=scope,
                        record=refreshed_record,
                    )
                    for demoted_record in demoted_records:
                        _replace_prefetched_lineage_record(
                            existing_records_by_lineage=existing_records_by_lineage,
                            scope=scope,
                            record=demoted_record,
                        )
                        _record_scope_refresh_candidate(
                            scope_records_for_refresh=scope_records_for_refresh,
                            scope=scope,
                            record=demoted_record,
                        )
                elif merged_equivalent_record != matching_content_record:
                    merged_equivalent_record, demoted_records = _apply_current_promotion(
                        existing_records_by_lineage=existing_records_by_lineage,
                        scope=scope,
                        record=merged_equivalent_record,
                    )
                    pending_records.append(merged_equivalent_record)
                    pending_records.extend(demoted_records)
                    _replace_prefetched_lineage_record(
                        existing_records_by_lineage=existing_records_by_lineage,
                        scope=scope,
                        record=merged_equivalent_record,
                    )
                    _record_scope_refresh_candidate(
                        scope_records_for_refresh=scope_records_for_refresh,
                        scope=scope,
                        record=merged_equivalent_record,
                    )
                    for demoted_record in demoted_records:
                        _replace_prefetched_lineage_record(
                            existing_records_by_lineage=existing_records_by_lineage,
                            scope=scope,
                            record=demoted_record,
                        )
                        _record_scope_refresh_candidate(
                            scope_records_for_refresh=scope_records_for_refresh,
                            scope=scope,
                            record=demoted_record,
                        )
                elif scope_refresh is not None:
                    _record_scope_refresh_candidate(
                        scope_records_for_refresh=scope_records_for_refresh,
                        scope=scope,
                        record=matching_content_record,
                    )
                skipped_count += 1
                skipped_document_ids.append(document_id)
                continue

            if (
                document.provider_response_bytes is not None
                and provider_response_key is not None
                and not _is_source_level_artifact_key(provider_response_key)
            ):
                writer.put_bytes(
                    bucket=_artifact_bucket_for_key(object_store=object_store, key=provider_response_key),
                    key=provider_response_key,
                    data=document.provider_response_bytes,
                    content_type="application/x-ndjson",
                )
            if (
                document.layout_elements_bytes is not None
                and layout_elements_key is not None
                and not _is_source_level_artifact_key(layout_elements_key)
            ):
                writer.put_bytes(
                    bucket=_artifact_bucket_for_key(object_store=object_store, key=layout_elements_key),
                    key=layout_elements_key,
                    data=document.layout_elements_bytes,
                    content_type="application/x-ndjson",
                )
            if document.canonical_markdown_bytes is not None and canonical_markdown_key is not None:
                writer.put_bytes(
                    bucket=object_store.bucket_derived,
                    key=canonical_markdown_key,
                    data=document.canonical_markdown_bytes,
                    content_type="text/markdown; charset=utf-8",
                )
            writer.put_bytes(
                bucket=object_store.bucket_derived,
                key=document_units_key,
                data=document_units_bytes,
                content_type="application/x-ndjson",
            )
            new_record = _build_registry_record(
                document_id=document_id,
                version_id=version_id,
                metadata=metadata,
                content_hash=content_hash,
                document=document,
                default_visibility_scope=default_visibility_scope,
                parser_version=parser_version,
                embedding_model=embedding_model,
                cleaning_policy_version=cleaning_policy_version,
                raw_asset=raw_asset,
                document_units_key=document_units_key,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
                canonical_markdown_key=canonical_markdown_key,
                processed_object_keys=processed_object_keys,
                timestamp=timestamp,
            )
            new_record, demoted_records = _apply_current_promotion(
                existing_records_by_lineage=existing_records_by_lineage,
                scope=scope,
                record=new_record,
            )
            pending_records.append(new_record)
            pending_records.extend(demoted_records)
            _replace_prefetched_lineage_record(
                existing_records_by_lineage=existing_records_by_lineage,
                scope=scope,
                record=new_record,
            )
            _record_scope_refresh_candidate(
                scope_records_for_refresh=scope_records_for_refresh,
                scope=scope,
                record=new_record,
            )
            for demoted_record in demoted_records:
                _replace_prefetched_lineage_record(
                    existing_records_by_lineage=existing_records_by_lineage,
                    scope=scope,
                    record=demoted_record,
                )
                _record_scope_refresh_candidate(
                    scope_records_for_refresh=scope_records_for_refresh,
                    scope=scope,
                    record=demoted_record,
                )
            success_count += 1
            document_ids.append(document_id)
            if document_records:
                updated_document_ids.append(document_id)
            else:
                created_document_ids.append(document_id)
        except Exception as exc:
            failed_count += 1
            errors.append(f"{source_label}: {exc}")

    if scope_refresh is not None and failed_count == 0:
        refreshed_records = tuple(
            sorted(
                scope_records_for_refresh.get(scope_refresh, {}).values(),
                key=lambda record: (record.document_id, record.revision_track, record.version_id),
            )
        )
        replace_scope = getattr(registry, "replace_scope", None)
        if callable(replace_scope):
            replace_scope(scope_refresh[0], scope_refresh[1], refreshed_records)
        else:
            registry.delete_by_scope(scope_refresh[0], scope_refresh[1])
            _write_registry_records(registry=registry, records=refreshed_records)
    else:
        _write_registry_records(
            registry=registry,
            records=tuple(
                sorted(
                    pending_records,
                    key=lambda record: (record.document_id, record.revision_track, record.version_id),
                )
            ),
        )

    return PersistImportStats(
        success_count=success_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=tuple(document_ids),
        created_document_ids=tuple(created_document_ids),
        updated_document_ids=tuple(updated_document_ids),
        skipped_document_ids=tuple(skipped_document_ids),
        unresolved_source_pdfs=unresolved_source_pdfs,
        errors=tuple(errors),
        timestamp=timestamp,
    )


def _prefetch_existing_scope_records(
    *,
    registry: DocumentRegistry,
    scope: tuple[str, str],
    scope_refresh: tuple[str, str] | None,
) -> tuple[DocumentRegistryRecord, ...]:
    list_importable_scope_records = getattr(registry, "list_importable_scope_records_by_scope", None)
    if callable(list_importable_scope_records):
        return tuple(list_importable_scope_records(scope[0], scope[1]))
    try:
        return registry.list_by_scope(scope[0], scope[1])
    except ValueError as exc:
        if scope_refresh == scope and _can_recover_scope_refresh_from_legacy_registry_rows(
            registry=registry,
            exc=exc,
        ):
            return ()
        raise


def _can_recover_scope_refresh_from_legacy_registry_rows(
    *,
    registry: DocumentRegistry,
    exc: ValueError,
) -> bool:
    list_processed_object_keys = getattr(registry, "list_processed_object_keys_by_scope", None)
    return callable(list_processed_object_keys) and (
        "registry payload contains unsupported authorization projection keys" in str(exc)
    )


def build_registered_raw_asset_ref(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    page_start: int | None = None,
    page_end: int | None = None,
) -> RawAssetRef:
    return RawAssetRef(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        page_start=page_start,
        page_end=page_end,
    )


def resolved_raw_asset(
    *,
    raw_path: Path | None,
    raw_source_uri: str | None,
    corpus: str,
    raw_asset_id_override: str | None = None,
) -> ResolvedRawAsset | None:
    if raw_path is None:
        return None
    raw_hash = hashlib.sha256(raw_path.read_bytes()).hexdigest()
    raw_asset_id = raw_asset_id_override or build_raw_asset_id(raw_path.name)
    raw_version_id = f"sha256:{raw_hash}"
    object_key = build_raw_asset_key(
        corpus=corpus,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename=raw_path.name,
    )
    return ResolvedRawAsset(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        source_filename=raw_path.name,
        path=raw_path,
        raw_source_uri=raw_source_uri or f"file://{raw_path.resolve()}",
        content_hash=raw_hash,
        object_key=object_key,
    )


def resolve_raw_path(raw_root: Path, source_pdf: str) -> Path | None:
    for candidate_name in raw_filename_candidates(source_pdf):
        candidate = raw_root / candidate_name
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def raw_filename_candidates(source_pdf: str) -> tuple[str, ...]:
    exact = source_pdf.strip()
    candidates = [exact]
    return tuple(dict.fromkeys(name for name in candidates if name))


def build_raw_asset_id(filename: str) -> str:
    return f"asset:{slugify_label(filename)}"


def slugify_label(value: str) -> str:
    normalized = value.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in normalized).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "asset"


def derive_source_uri(metadata: dict[str, object]) -> str:
    source_url = metadata.get("source_url")
    if isinstance(source_url, str) and source_url:
        return source_url
    for candidate in (metadata.get("source_md"), metadata.get("source_id")):
        relative = extract_canonical_relative_path(candidate)
        if relative is not None:
            return f"campusrag://canonical/{relative}"
    return f"campusrag://import/{metadata['document_id']}/{metadata['version_id']}"


def _build_registry_record(
    *,
    document_id: str,
    version_id: str,
    metadata: dict[str, object],
    content_hash: str,
    document: DocumentImportInput,
    default_visibility_scope: str | None,
    parser_version: str,
    embedding_model: str,
    cleaning_policy_version: str,
    raw_asset: ResolvedRawAsset | None,
    document_units_key: str,
    provider_response_key: str | None,
    layout_elements_key: str | None,
    canonical_markdown_key: str | None,
    processed_object_keys: tuple[str, ...],
    timestamp: str,
) -> DocumentRegistryRecord:
    _assert_canonical_authorization_metadata(metadata)
    source_uri = derive_source_uri(metadata)
    registry_raw_asset = _resolve_registry_raw_asset_ref(
        raw_asset=raw_asset,
        document=document,
        metadata=metadata,
    )
    entitlement_groups = _resolve_entitlement_groups(metadata)
    visibility_scope = _resolve_visibility_scope(
        metadata=metadata,
        document=document,
        default_visibility_scope=default_visibility_scope,
    )
    visibility_level = _resolve_visibility_level(
        metadata=metadata,
        entitlement_groups=entitlement_groups,
    )
    policy_projection_version = _resolve_policy_projection_version(metadata)
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track=document.revision_track,
        version_id=version_id,
        source_uri=source_uri,
        content_hash=content_hash,
        corpus=document.corpus,
        collection=document.collection,
        cleaning_policy_version=cleaning_policy_version,
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        visibility_level=visibility_level,
        policy_projection_version=policy_projection_version,
        status=_resolve_status(metadata=metadata, document=document),
        ingestion_timestamp=timestamp,
        parser_version=parser_version,
        embedding_model=embedding_model,
        source_channel=document.source_channel,
        is_current=document.is_current,
        effective_date=normalize_optional_text(metadata.get("effective_date")),
        published_date=normalize_optional_text(metadata.get("published_date")),
        raw_asset=registry_raw_asset,
        source_observations=(
            SourceObservation(
                source_channel=document.source_channel,
                source_uri=source_uri,
                raw_asset=registry_raw_asset,
                is_primary=True,
                import_source=document.import_source,
            ),
        ),
        document_units_object_key=document_units_key,
        provider_response_object_key=provider_response_key,
        layout_elements_object_key=layout_elements_key,
        canonical_markdown_object_key=canonical_markdown_key,
        processed_object_keys=processed_object_keys,
        import_source=document.import_source,
    )


def _assert_canonical_authorization_metadata(metadata: dict[str, object]) -> None:
    unsupported_keys = tuple(
        key
        for key in metadata
        if _looks_like_authorization_projection_key(key)
        and key not in _SUPPORTED_AUTHORIZATION_METADATA_KEYS
    )
    if unsupported_keys:
        joined = ", ".join(unsupported_keys)
        raise ValueError(
            f"unsupported authorization metadata keys are not allowed: {joined}"
        )


_SUPPORTED_AUTHORIZATION_METADATA_KEYS = frozenset(
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


def _resolve_registry_raw_asset_ref(
    *,
    raw_asset: ResolvedRawAsset | None,
    document: DocumentImportInput,
    metadata: dict[str, object],
) -> RawAssetRef | None:
    if raw_asset is not None:
        return RawAssetRef(
            raw_asset_id=raw_asset.raw_asset_id,
            raw_version_id=raw_asset.raw_version_id,
            page_start=metadata.get("raw_page_start"),
            page_end=metadata.get("raw_page_end"),
        )
    if document.raw_asset_id and document.raw_version_id:
        return RawAssetRef(
            raw_asset_id=document.raw_asset_id,
            raw_version_id=document.raw_version_id,
            page_start=metadata.get("raw_page_start"),
            page_end=metadata.get("raw_page_end"),
        )
    return None


def _registry_record_needs_refresh(
    *,
    existing: DocumentRegistryRecord,
    document_units_key: str,
    provider_response_key: str | None,
    layout_elements_key: str | None,
    canonical_markdown_key: str | None,
    processed_object_keys: tuple[str, ...],
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
) -> bool:
    if existing.document_units_object_key != document_units_key:
        return True
    if existing.provider_response_object_key != provider_response_key:
        return True
    if existing.layout_elements_object_key != layout_elements_key:
        return True
    if existing.canonical_markdown_object_key != canonical_markdown_key:
        return True
    if tuple(existing.processed_object_keys) != processed_object_keys:
        return True
    return _missing_processed_object_keys(
        writer=writer,
        object_store=object_store,
        object_keys=processed_object_keys,
    )


def _missing_processed_object_keys(
    *,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    object_keys: tuple[str, ...],
) -> bool:
    get_bytes = getattr(writer, "get_bytes", None)
    if not callable(get_bytes):
        return False
    for key in object_keys:
        try:
            get_bytes(bucket=_artifact_bucket_for_key(object_store=object_store, key=key), key=key)
        except Exception:
            return True
    return False


def _artifact_bucket_for_key(*, object_store: ObjectStoreSettings, key: str) -> str:
    if is_source_object_key(key):
        return object_store.bucket_source
    return object_store.bucket_derived


def _group_documents_by_scope(
    documents: list[DocumentImportInput],
) -> dict[tuple[str, str], tuple[DocumentImportInput, ...]]:
    grouped: dict[tuple[str, str], list[DocumentImportInput]] = {}
    for document in documents:
        grouped.setdefault((document.corpus, document.collection), []).append(document)
    return {
        scope: tuple(scope_documents)
        for scope, scope_documents in grouped.items()
    }


def _find_equivalent_scope_record(
    *,
    existing_records_by_lineage: dict[
        tuple[str, str],
        dict[tuple[str, str], tuple[DocumentRegistryRecord, ...]],
    ],
    scope: tuple[str, str],
    document: DocumentImportInput,
    content_hash: str,
) -> DocumentRegistryRecord | None:
    if document.source_channel not in OFFICIAL_WEB_EQUIVALENT_SOURCE_CHANNELS:
        return None
    scope_records = existing_records_by_lineage.get(scope, {})
    candidates = [
        record
        for lineage_records in scope_records.values()
        for record in lineage_records
        if record.revision_track == document.revision_track
        and record.content_hash == content_hash
        and record.source_channel in OFFICIAL_WEB_EQUIVALENT_SOURCE_CHANNELS
    ]
    if not candidates:
        return None
    current_candidates = [record for record in candidates if record.is_current]
    ranked_candidates = current_candidates or candidates
    return max(
        ranked_candidates,
        key=lambda record: (
            record.is_current,
            record.ingestion_timestamp,
            record.document_id,
            record.version_id,
        ),
    )


def _index_scope_records_by_lineage(
    records: tuple[DocumentRegistryRecord, ...],
) -> dict[tuple[str, str], tuple[DocumentRegistryRecord, ...]]:
    indexed: dict[tuple[str, str], list[DocumentRegistryRecord]] = {}
    for record in records:
        indexed.setdefault((record.document_id, record.revision_track), []).append(record)
    return {
        lineage: tuple(lineage_records)
        for lineage, lineage_records in indexed.items()
    }


def _record_scope_refresh_candidate(
    *,
    scope_records_for_refresh: dict[tuple[str, str], dict[tuple[str, str, str], DocumentRegistryRecord]],
    scope: tuple[str, str],
    record: DocumentRegistryRecord,
) -> None:
    scope_records_for_refresh.setdefault(scope, {})[
        (record.document_id, record.revision_track, record.version_id)
    ] = record


def _apply_current_promotion(
    *,
    existing_records_by_lineage: dict[
        tuple[str, str],
        dict[tuple[str, str], tuple[DocumentRegistryRecord, ...]],
    ],
    scope: tuple[str, str],
    record: DocumentRegistryRecord,
) -> tuple[DocumentRegistryRecord, tuple[DocumentRegistryRecord, ...]]:
    if not record.is_current:
        return record, ()
    lineage_records = existing_records_by_lineage.get(scope, {}).get((record.document_id, record.revision_track), ())
    prior_current_records = tuple(
        candidate
        for candidate in lineage_records
        if candidate.version_id != record.version_id and candidate.is_current
    )
    promoted_record = record
    if prior_current_records and record.supersedes_version_id is None:
        latest_prior_current = max(prior_current_records, key=lambda candidate: candidate.ingestion_timestamp)
        promoted_record = replace(record, supersedes_version_id=latest_prior_current.version_id)
    demoted_records = tuple(
        replace(
            candidate,
            is_current=False,
            status="superseded" if candidate.status == "active" else candidate.status,
        )
        for candidate in prior_current_records
    )
    return promoted_record, demoted_records


def _replace_prefetched_lineage_record(
    *,
    existing_records_by_lineage: dict[
        tuple[str, str],
        dict[tuple[str, str], tuple[DocumentRegistryRecord, ...]],
    ],
    scope: tuple[str, str],
    record: DocumentRegistryRecord,
) -> None:
    lineage_key = (record.document_id, record.revision_track)
    lineage_records = {
        candidate.version_id: candidate
        for candidate in existing_records_by_lineage.setdefault(scope, {}).get(lineage_key, ())
    }
    lineage_records[record.version_id] = record
    existing_records_by_lineage[scope][lineage_key] = tuple(lineage_records.values())


def _write_registry_records(
    *,
    registry: DocumentRegistry,
    records: tuple[DocumentRegistryRecord, ...],
) -> None:
    if not records:
        return
    upsert_many = getattr(registry, "upsert_many", None)
    if callable(upsert_many):
        upsert_many(records)
        return
    for record in records:
        registry.upsert(record)


def _derive_document_title(*, metadata: dict[str, object], document_id: str) -> str:
    for key in ("title", "document_title"):
        title = normalize_optional_text(metadata.get(key))
        if title is not None:
            return title
    return document_id.split(":")[-1]


def _derive_document_year(*, metadata: dict[str, object]) -> str | None:
    for key in ("published_date", "effective_date", "year", "source_pdf", "source_doc", "source_label"):
        year = _extract_year_label(metadata.get(key))
        if year is not None:
            return year
    return None


def _extract_year_label(value: object) -> str | None:
    text = normalize_optional_text(value)
    if text is None:
        return None
    match = re.search(r"(?<!\d)((?:19|20)\d{2})(?!\d)", text)
    if match is None:
        return None
    return match.group(1)


def normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _resolve_campus_scope(
    *,
    metadata: dict[str, object],
    document: DocumentImportInput,
    default_visibility_scope: str | None,
) -> str | None:
    return _resolve_visibility_scope(
        metadata=metadata,
        document=document,
        default_visibility_scope=default_visibility_scope,
    )


def _resolve_status(*, metadata: dict[str, object], document: DocumentImportInput) -> str:
    metadata_status = normalize_optional_text(metadata.get("status"))
    if metadata_status is not None:
        return metadata_status
    return document.status


def normalize_optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("boolean is not a valid page number")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value)
    raise ValueError(f"invalid integer value: {value!r}")


def extract_canonical_relative_path(value: object) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("\\", "/")
    marker = "rag-data/canonical/"
    if marker not in normalized:
        return None
    return normalized.split(marker, 1)[1].lstrip("/")


def write_import_report(
    *,
    import_mode: str,
    report_dir: Path,
    report_prefix: str,
    success_count: int,
    skipped_count: int,
    failed_count: int,
    raw_uploaded_count: int,
    raw_reused_count: int,
    document_ids: tuple[str, ...],
    unresolved_source_pdfs: tuple[str, ...],
    errors: tuple[str, ...],
    timestamp: str,
    created_document_ids: tuple[str, ...] = (),
    updated_document_ids: tuple[str, ...] = (),
    skipped_document_ids: tuple[str, ...] = (),
) -> ImportReport:
    report_dir.mkdir(parents=True, exist_ok=True)
    safe_timestamp = timestamp.replace(":", "").replace("+", "_plus_")
    report_path = report_dir / f"{report_prefix}-{safe_timestamp}.json"
    payload = {
        "import_mode": import_mode,
        "success_count": success_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
        "raw_uploaded_count": raw_uploaded_count,
        "raw_reused_count": raw_reused_count,
        "document_ids": list(document_ids),
        "created_document_ids": list(created_document_ids),
        "updated_document_ids": list(updated_document_ids),
        "skipped_document_ids": list(skipped_document_ids),
        "unresolved_source_pdfs": list(unresolved_source_pdfs),
        "errors": list(errors),
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return ImportReport(
        import_mode=import_mode,
        success_count=success_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=document_ids,
        report_path=str(report_path),
        created_document_ids=created_document_ids,
        updated_document_ids=updated_document_ids,
        skipped_document_ids=skipped_document_ids,
        unresolved_source_pdfs=unresolved_source_pdfs,
        errors=errors,
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
