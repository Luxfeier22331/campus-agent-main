from __future__ import annotations

from typing import Protocol

from campus_ingestion_core.campus_agent_ingestion_support import (
    DocumentImportInput,
    apply_authorization_projection_metadata,
    load_metadata_from_bytes,
)
from campus_ingestion_core.handbook_cleanup import (
    cleanup_handbook_document,
    serialize_handbook_document_units,
    validate_handbook_manifest_title,
)
from campus_ingestion_core.handbook_provider_normalize import (
    normalize_handbook_provider_result,
    serialize_handbook_layout_elements,
)
from campus_ingestion_core.handbook_source_projections import (
    build_handbook_projection_import_documents,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.raw_ingestion_online_ocr import OnlineOcrProviderResult
from campus_ingestion_core.raw_ingestion_split_manifest import _write_processed_asset_artifacts
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import SplitManifest, SplitManifestDocument


class _ObjectStoreReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


def build_handbook_split_manifest_documents(
    *,
    raw_asset_record: RawAssetRecord,
    provider_result: OnlineOcrProviderResult,
    split_manifest: SplitManifest,
    writer,
    reader: _ObjectStoreReader,
    object_store: ObjectStoreSettings,
    default_visibility_scope: str | None,
    corpus: str,
    collection: str,
    ocr_provider: str,
    ocr_model: str,
    source: dict[str, str],
) -> tuple[list[DocumentImportInput], list[str]]:
    structured_rows = normalize_handbook_provider_result(
        source_pdf=raw_asset_record.source_filename,
        provider_jsonl_bytes=provider_result.provider_result_bytes,
        ocr_provider=ocr_provider,
        ocr_model=ocr_model,
        source_artifact_id=raw_asset_record.raw_asset_id,
    )
    layout_elements_bytes = serialize_handbook_layout_elements(structured_rows)
    documents: list[DocumentImportInput] = []
    errors: list[str] = []
    provider_response_key, layout_elements_key = _write_processed_asset_artifacts(
        writer=writer,
        object_store=object_store,
        corpus=corpus,
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        source_filename=raw_asset_record.source_filename,
        ocr_model=ocr_model,
        provider_response_bytes=provider_result.provider_result_bytes,
        layout_elements_bytes=layout_elements_bytes,
    )
    for manifest_document in split_manifest.documents:
        try:
            documents.append(
                _build_handbook_manifest_document_input(
                    raw_asset_record=raw_asset_record,
                    manifest_document=manifest_document,
                    structured_rows=structured_rows,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    default_visibility_scope=default_visibility_scope,
                    corpus=corpus,
                    collection=collection,
                )
            )
        except Exception as exc:
            errors.append(f"{raw_asset_record.object_key}#{manifest_document.document_id}: {exc}")
    try:
        documents.extend(
            build_handbook_projection_import_documents(
                source=source,
                raw_asset_record=raw_asset_record,
                hybrid_raw_asset_record=raw_asset_record,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
                structured_rows=structured_rows,
                split_manifest_documents=split_manifest.documents,
                reader=reader,
                source_bucket=object_store.bucket_source,
                import_source="raw_online_ocr",
            )
        )
    except Exception as exc:
        errors.append(f"{raw_asset_record.object_key}#declared-projections: {exc}")
    return documents, errors


def _build_handbook_manifest_document_input(
    *,
    raw_asset_record: RawAssetRecord,
    manifest_document: SplitManifestDocument,
    structured_rows: list[dict[str, object]],
    provider_response_key: str,
    layout_elements_key: str,
    default_visibility_scope: str | None,
    corpus: str,
    collection: str,
) -> DocumentImportInput:
    validate_handbook_manifest_title(
        structured_rows=structured_rows,
        manifest_document=manifest_document,
    )
    cleanup_result = cleanup_handbook_document(
        structured_rows=structured_rows,
        manifest_document=manifest_document,
        source_doc=raw_asset_record.source_filename,
    )
    document_units_bytes = serialize_handbook_document_units(cleanup_result.document_units)
    metadata = load_metadata_from_bytes(document_units_bytes)
    metadata["title"] = cleanup_result.title
    metadata["raw_page_start"] = manifest_document.page_start
    metadata["raw_page_end"] = manifest_document.page_end
    apply_authorization_projection_metadata(
        metadata,
        entitlement_groups=manifest_document.resolved_entitlement_groups(),
        visibility_scope=manifest_document.resolved_visibility_scope(default_visibility_scope),
        visibility_level=manifest_document.resolved_visibility_level(),
    )
    metadata["status"] = manifest_document.status
    return DocumentImportInput(
        source_label=f"{raw_asset_record.object_key}#{manifest_document.document_id}",
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=cleanup_result.canonical_markdown.encode("utf-8"),
        metadata=metadata,
        import_source="raw_online_ocr",
        revision_track="source-faithful",
        source_channel="pdf_ocr",
        is_current=True,
        corpus=corpus,
        collection=collection,
        visibility_scope=manifest_document.resolved_visibility_scope(default_visibility_scope),
        status=manifest_document.status,
        raw_path=None,
        raw_source_uri=raw_asset_record.raw_source_uri,
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        provider_response_object_key=provider_response_key,
        additional_processed_object_keys=(layout_elements_key,),
        title=cleanup_result.title,
    )
