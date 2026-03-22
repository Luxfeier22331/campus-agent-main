from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    ImportReport,
    ObjectStoreWriter,
    S3ObjectStoreWriter,
    bind_existing_ocr_raw_provenance,
    load_metadata_from_bytes,
    persist_import_documents,
    utc_now,
    write_import_report,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings


DEFAULT_EXISTING_OCR_PARSER_VERSION = "campusrag-import-v1"


@dataclass(frozen=True, slots=True)
class ExistingOcrImportSettings:
    ocr_root: Path
    raw_root: Path | None
    report_dir: Path
    parser_version: str
    embedding_model: str
    default_campus_scope: str | None
    object_store: ObjectStoreSettings

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "ExistingOcrImportSettings":
        source = env if env is not None else os.environ
        ocr_root_value = (source.get("CAMPUSRAG_OCR_ROOT") or "").strip()
        if not ocr_root_value:
            raise ValueError("CAMPUSRAG_OCR_ROOT is required")
        raw_root_value = (source.get("CAMPUSRAG_RAW_ROOT") or "").strip()
        return cls(
            ocr_root=Path(ocr_root_value),
            raw_root=Path(raw_root_value) if raw_root_value else None,
            report_dir=Path((source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
            parser_version=DEFAULT_EXISTING_OCR_PARSER_VERSION,
            embedding_model=(source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or "").strip(),
            default_campus_scope=(source.get("INGESTION_DEFAULT_CAMPUS_SCOPE") or "").strip() or None,
            object_store=ObjectStoreSettings.from_env(source),
        )


def import_campusrag_existing_ocr(
    *,
    env: dict[str, str] | None = None,
    object_store: ObjectStoreWriter | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> ImportReport:
    settings = ExistingOcrImportSettings.from_env(env)
    registry = registry or build_document_registry_from_env(env)
    raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(env)
    writer = object_store or S3ObjectStoreWriter(settings.object_store)

    documents: list[DocumentImportInput] = []
    errors: list[str] = []
    for jsonl_path in sorted((settings.ocr_root / "by_doc").glob("*/*.jsonl")):
        try:
            file_bytes = jsonl_path.read_bytes()
            metadata = load_metadata_from_bytes(file_bytes)
        except Exception as exc:
            errors.append(f"{jsonl_path}: {exc}")
            continue
        documents.append(
            DocumentImportInput(
                source_label=str(jsonl_path),
                structured_result_bytes=file_bytes,
                provider_result_bytes=None,
                metadata=metadata,
                import_source="campusrag_existing_ocr",
            )
        )

    unresolved_source_pdfs: tuple[str, ...] = ()
    if settings.raw_root is not None and documents:
        original_documents = list(documents)
        documents, unresolved_source_pdfs = bind_existing_ocr_raw_provenance(documents, settings.raw_root)
        if unresolved_source_pdfs:
            unresolved_errors = []
            unresolved_set = set(unresolved_source_pdfs)
            for document in original_documents:
                source_pdf = str(document.metadata.get("source_pdf") or "") or "<missing>"
                if source_pdf in unresolved_set:
                    unresolved_errors.append(
                        f"{document.source_label}: unable to resolve raw source PDFs: {', '.join(unresolved_source_pdfs)}"
                    )
            timestamp = utc_now()
            return write_import_report(
                import_mode="existing_ocr",
                report_dir=settings.report_dir,
                report_prefix="import-campusrag-existing-ocr",
                success_count=0,
                skipped_count=0,
                failed_count=len(errors) + len(unresolved_errors),
                raw_uploaded_count=0,
                raw_reused_count=0,
                document_ids=(),
                unresolved_source_pdfs=unresolved_source_pdfs,
                errors=tuple(errors + unresolved_errors),
                timestamp=timestamp,
            )

    return persist_import_documents(
        documents=documents,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        writer=writer,
        object_store=settings.object_store,
        parser_version=settings.parser_version,
        embedding_model=settings.embedding_model,
        default_campus_scope=settings.default_campus_scope,
        import_mode="existing_ocr",
        report_dir=settings.report_dir,
        report_prefix="import-campusrag-existing-ocr",
        unresolved_source_pdfs=unresolved_source_pdfs,
        initial_errors=errors,
    )
