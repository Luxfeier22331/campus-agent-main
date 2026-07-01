from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace

from campus_ingestion_core.campus_agent_ingestion_artifacts import (
    build_document_processed_object_keys,
    resolve_document_artifact_keys,
)
from campus_ingestion_core.campus_agent_ingestion_metadata import (
    derive_document_title,
    derive_document_year,
    derive_source_uri,
    resolve_registry_raw_asset_ref,
    resolved_raw_asset,
)
from campus_ingestion_core.campus_agent_ingestion_refresh import (
    artifact_bucket_for_key,
    registry_record_needs_refresh,
)
from campus_ingestion_core.campus_agent_ingestion_registry_state import (
    apply_current_promotion,
    group_documents_by_scope,
    index_scope_records_by_lineage,
    prefetch_existing_scope_records,
    record_scope_refresh_candidate,
    replace_prefetched_lineage_record,
    write_registry_records,
)
from campus_ingestion_core.campus_agent_ingestion_reporting import utc_now
from campus_ingestion_core.campus_agent_ingestion_sources import (
    build_source_observation,
    document_semantic_hash,
    find_equivalent_scope_record,
    merge_equivalent_source_record,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.object_store import is_source_object_key
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.settings import ObjectStoreSettings

from .campus_agent_ingestion_support_models import (
    DocumentImportInput,
    ObjectStoreWriter,
    PersistImportStats,
)
from .campus_agent_ingestion_support_registry import _build_registry_record


def _is_source_level_artifact_key(key: str) -> bool:
    return is_source_object_key(key)


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
    default_campus_scope: str | None = None,
    default_visibility_scope: str | None = None,
    unresolved_source_pdfs: tuple[str, ...] = (),
    initial_errors: list[str] | None = None,
    scope_refresh: tuple[str, str] | None = None,
    scope_refresh_preserve_existing: Callable[[DocumentRegistryRecord], bool] | None = None,
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
    documents_by_scope = group_documents_by_scope(documents)
    existing_records_by_scope = {
        scope: prefetch_existing_scope_records(
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
        scope: index_scope_records_by_lineage(records)
        for scope, records in existing_records_by_scope.items()
    }
    pending_records: list[DocumentRegistryRecord] = []
    scope_records_for_refresh: dict[
        tuple[str, str], dict[tuple[str, str, str], DocumentRegistryRecord]
    ] = {scope: {} for scope in documents_by_scope}
    if scope_refresh is not None and scope_refresh_preserve_existing is not None:
        preserved_records = {
            (record.document_id, record.revision_track, record.version_id): record
            for record in existing_records_by_scope.get(scope_refresh, ())
            if scope_refresh_preserve_existing(record)
        }
        if preserved_records:
            scope_records_for_refresh.setdefault(scope_refresh, {}).update(preserved_records)

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
            content_hash = document_semantic_hash(
                document_units_bytes=document.document_units_bytes,
                semantic_content_hash=document.metadata.get("semantic_content_hash"),
            )
            title = document.title or derive_document_title(
                metadata=metadata, document_id=document_id
            )
            year = document.year or derive_document_year(metadata=metadata)
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
                matching_content_record = find_equivalent_scope_record(
                    existing_records_by_lineage=existing_records_by_lineage,
                    scope=scope,
                    source_channel=document.source_channel,
                    revision_track=document.revision_track,
                    content_hash=content_hash,
                )
            effective_version_id = (
                matching_content_record.version_id
                if matching_content_record is not None
                else version_id
            )
            incoming_source_uri = derive_source_uri(metadata)
            artifact_keys = resolve_document_artifact_keys(
                document=document,
                document_id=document_id,
                version_id=effective_version_id,
                title=title,
                year=year,
            )
            provider_response_key = artifact_keys.provider_response_key
            layout_elements_key = artifact_keys.layout_elements_key
            if (
                document.provider_response_bytes is not None
                and provider_response_key is not None
                and _is_source_level_artifact_key(provider_response_key)
            ):
                writer.put_bytes(
                    bucket=artifact_bucket_for_key(
                        object_store=object_store, key=provider_response_key
                    ),
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
                    bucket=artifact_bucket_for_key(
                        object_store=object_store, key=layout_elements_key
                    ),
                    key=layout_elements_key,
                    data=document.layout_elements_bytes,
                    content_type="application/x-ndjson",
                )
            for artifact in document.additional_processed_artifacts:
                writer.put_bytes(
                    bucket=artifact_bucket_for_key(
                        object_store=object_store, key=artifact.object_key
                    ),
                    key=artifact.object_key,
                    data=artifact.data,
                    content_type=artifact.content_type,
                )

            document_units_key = artifact_keys.document_units_key
            canonical_markdown_key = artifact_keys.canonical_markdown_key
            processed_object_keys = build_document_processed_object_keys(
                document_units_key=document_units_key,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
                canonical_markdown_key=canonical_markdown_key,
                additional_keys=document.additional_processed_object_keys,
            )
            if matching_content_record is not None:
                merged_equivalent_record = merge_equivalent_source_record(
                    existing=matching_content_record,
                    candidate_observation=build_source_observation(
                        source_channel=document.source_channel,
                        source_uri=derive_source_uri(metadata),
                        raw_asset=resolve_registry_raw_asset_ref(
                            raw_asset=raw_asset,
                            document=document,
                            metadata=metadata,
                        ),
                        is_primary=False,
                        import_source=document.import_source,
                    ),
                    candidate_is_current=document.is_current,
                    timestamp=timestamp,
                )
                artifact_refresh_supported = (
                    matching_content_record.version_id == version_id
                    and matching_content_record.source_channel == document.source_channel
                    and matching_content_record.source_uri == incoming_source_uri
                )
                if artifact_refresh_supported and registry_record_needs_refresh(
                    existing=matching_content_record,
                    document_units_bytes=document_units_bytes,
                    document_units_key=document_units_key,
                    provider_response_bytes=document.provider_response_bytes,
                    provider_response_key=provider_response_key,
                    layout_elements_bytes=document.layout_elements_bytes,
                    layout_elements_key=layout_elements_key,
                    canonical_markdown_bytes=document.canonical_markdown_bytes,
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
                            bucket=artifact_bucket_for_key(
                                object_store=object_store, key=provider_response_key
                            ),
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
                            bucket=artifact_bucket_for_key(
                                object_store=object_store, key=layout_elements_key
                            ),
                            key=layout_elements_key,
                            data=document.layout_elements_bytes,
                            content_type="application/x-ndjson",
                        )
                    if (
                        document.canonical_markdown_bytes is not None
                        and canonical_markdown_key is not None
                    ):
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
                    refreshed_record, demoted_records = apply_current_promotion(
                        existing_records_by_lineage=existing_records_by_lineage,
                        scope=scope,
                        record=refreshed_record,
                    )
                    pending_records.append(refreshed_record)
                    pending_records.extend(demoted_records)
                    replace_prefetched_lineage_record(
                        existing_records_by_lineage=existing_records_by_lineage,
                        scope=scope,
                        record=refreshed_record,
                    )
                    record_scope_refresh_candidate(
                        scope_records_for_refresh=scope_records_for_refresh,
                        scope=scope,
                        record=refreshed_record,
                    )
                    for demoted_record in demoted_records:
                        replace_prefetched_lineage_record(
                            existing_records_by_lineage=existing_records_by_lineage,
                            scope=scope,
                            record=demoted_record,
                        )
                        record_scope_refresh_candidate(
                            scope_records_for_refresh=scope_records_for_refresh,
                            scope=scope,
                            record=demoted_record,
                        )
                elif merged_equivalent_record != matching_content_record:
                    merged_equivalent_record, demoted_records = apply_current_promotion(
                        existing_records_by_lineage=existing_records_by_lineage,
                        scope=scope,
                        record=merged_equivalent_record,
                    )
                    pending_records.append(merged_equivalent_record)
                    pending_records.extend(demoted_records)
                    replace_prefetched_lineage_record(
                        existing_records_by_lineage=existing_records_by_lineage,
                        scope=scope,
                        record=merged_equivalent_record,
                    )
                    record_scope_refresh_candidate(
                        scope_records_for_refresh=scope_records_for_refresh,
                        scope=scope,
                        record=merged_equivalent_record,
                    )
                    for demoted_record in demoted_records:
                        replace_prefetched_lineage_record(
                            existing_records_by_lineage=existing_records_by_lineage,
                            scope=scope,
                            record=demoted_record,
                        )
                        record_scope_refresh_candidate(
                            scope_records_for_refresh=scope_records_for_refresh,
                            scope=scope,
                            record=demoted_record,
                        )
                elif scope_refresh is not None:
                    record_scope_refresh_candidate(
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
                    bucket=artifact_bucket_for_key(
                        object_store=object_store, key=provider_response_key
                    ),
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
                    bucket=artifact_bucket_for_key(
                        object_store=object_store, key=layout_elements_key
                    ),
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
            new_record, demoted_records = apply_current_promotion(
                existing_records_by_lineage=existing_records_by_lineage,
                scope=scope,
                record=new_record,
            )
            pending_records.append(new_record)
            pending_records.extend(demoted_records)
            replace_prefetched_lineage_record(
                existing_records_by_lineage=existing_records_by_lineage,
                scope=scope,
                record=new_record,
            )
            record_scope_refresh_candidate(
                scope_records_for_refresh=scope_records_for_refresh,
                scope=scope,
                record=new_record,
            )
            for demoted_record in demoted_records:
                replace_prefetched_lineage_record(
                    existing_records_by_lineage=existing_records_by_lineage,
                    scope=scope,
                    record=demoted_record,
                )
                record_scope_refresh_candidate(
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
            write_registry_records(registry=registry, records=refreshed_records)
    else:
        write_registry_records(
            registry=registry,
            records=tuple(
                sorted(
                    pending_records,
                    key=lambda record: (
                        record.document_id,
                        record.revision_track,
                        record.version_id,
                    ),
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
