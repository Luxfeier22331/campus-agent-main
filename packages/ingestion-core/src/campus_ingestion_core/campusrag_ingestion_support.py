from __future__ import annotations

from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_authorization import (
    apply_authorization_projection_metadata,
    load_metadata_from_bytes,
)
from campus_ingestion_core.campusrag_ingestion_reporting import (
    ImportReport,
    utc_now,
    write_import_report,
)
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.settings import ObjectStoreSettings

from .campusrag_ingestion_support_models import (
    DocumentImportInput,
    ObjectStoreWriter,
    PersistImportStats,
    S3ObjectStoreWriter,
)
from .campusrag_ingestion_support_registry import (
    _build_registry_record,
    build_registered_raw_asset_ref,
)
from .campusrag_ingestion_support_stats import collect_import_document_stats


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
    import_mode: str,
    report_dir: Path,
    report_prefix: str,
    default_campus_scope: str | None = None,
    default_visibility_scope: str | None = None,
    unresolved_source_pdfs: tuple[str, ...] = (),
    initial_errors: list[str] | None = None,
    scope_refresh: tuple[str, str] | None = None,
) -> ImportReport:
    resolved_default_scope = default_visibility_scope or default_campus_scope
    stats = collect_import_document_stats(
        documents=documents,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        writer=writer,
        object_store=object_store,
        parser_version=parser_version,
        embedding_model=embedding_model,
        cleaning_policy_version=cleaning_policy_version,
        default_campus_scope=resolved_default_scope,
        default_visibility_scope=resolved_default_scope,
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


__all__ = [
    "DocumentImportInput",
    "ImportReport",
    "ObjectStoreWriter",
    "PersistImportStats",
    "S3ObjectStoreWriter",
    "_build_registry_record",
    "apply_authorization_projection_metadata",
    "build_registered_raw_asset_ref",
    "collect_import_document_stats",
    "load_metadata_from_bytes",
    "persist_import_documents",
    "utc_now",
    "write_import_report",
]
