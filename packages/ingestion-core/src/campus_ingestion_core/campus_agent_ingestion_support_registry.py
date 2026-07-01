from __future__ import annotations

from campus_ingestion_core.campus_agent_ingestion_authorization import (
    assert_canonical_authorization_metadata,
    normalize_optional_text,
    resolve_entitlement_groups,
    resolve_policy_projection_version,
    resolve_status,
    resolve_visibility_level,
    resolve_visibility_scope,
)
from campus_ingestion_core.campus_agent_ingestion_metadata import (
    ResolvedRawAsset,
    derive_source_uri,
    resolve_registry_raw_asset_ref,
)
from campus_ingestion_core.campus_agent_ingestion_sources import build_source_observation
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRef

from .campus_agent_ingestion_support_models import DocumentImportInput


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
    assert_canonical_authorization_metadata(metadata)
    source_uri = derive_source_uri(metadata)
    registry_raw_asset = resolve_registry_raw_asset_ref(
        raw_asset=raw_asset,
        document=document,
        metadata=metadata,
    )
    entitlement_groups = resolve_entitlement_groups(metadata)
    visibility_scope = resolve_visibility_scope(
        metadata=metadata,
        document=document,
        default_visibility_scope=default_visibility_scope,
    )
    visibility_level = resolve_visibility_level(
        metadata=metadata,
        entitlement_groups=entitlement_groups,
    )
    policy_projection_version = resolve_policy_projection_version(metadata)
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
        status=resolve_status(metadata=metadata, document=document),
        ingestion_timestamp=timestamp,
        parser_version=parser_version,
        embedding_model=embedding_model,
        source_channel=document.source_channel,
        is_current=document.is_current,
        effective_date=normalize_optional_text(metadata.get("effective_date")),
        published_date=normalize_optional_text(metadata.get("published_date")),
        raw_asset=registry_raw_asset,
        source_observations=(
            build_source_observation(
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
