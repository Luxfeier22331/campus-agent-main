from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path

from qdrant_client import QdrantClient

from campus_ingestion_core.campusrag_ingestion_support import ImportReport, write_import_report
from campus_ingestion_core.collection_source_ocr import resolve_collection_source_ocr_runtime
from campus_ingestion_core.contact_directory_projection import (
    write_contact_directory_projection_release_from_import_documents,
)
from campus_ingestion_core.local_rebuild_documents import (
    _build_replay_documents,
    _collect_projection_aware_import_stats,
    _load_replay_source_artifacts,
)
from campus_ingestion_core.local_rebuild_indexing import _index_replayed_documents
from campus_ingestion_core.local_rebuild_runtime import (
    _build_document_registry_for_rebuild,
    _build_raw_asset_registry_for_rebuild,
    _build_replay_request_from_env,
    _default_replay_source_pdf,
    _resolve_replay_source_pdf,
    _resolve_runtime_collection_config,
    _should_index_qdrant_for_replay,
)
from campus_ingestion_core.local_rebuild_support import (
    RebuildRequest,
    ReplayObjectStore,
    S3ObjectStoreAdmin,
    _build_rebuild_trace_recorder,
    _read_default_visibility_scope,
    _run_traced_stage,
    _summarize_persist_stats,
)
from campus_ingestion_core.service_catalog_projection import (
    write_service_catalog_projection_release_from_current_projections,
)
from campus_ingestion_core.service_guide_projection import (
    write_service_guide_projection_release_from_manifest_if_available,
)
from campus_ingestion_core.settings import ObjectStoreSettings


def replay_provider_response_rebuild(
    *,
    request: RebuildRequest | None = None,
    env: dict[str, str] | None = None,
    object_store: ReplayObjectStore | None = None,
    registry=None,
    raw_asset_registry=None,
    qdrant_client: QdrantClient | None = None,
) -> ImportReport:
    source = dict(env if env is not None else os.environ)
    trace_recorder = _build_rebuild_trace_recorder(source)
    runtime_request = request or _build_replay_request_from_env(source)
    corpus = runtime_request.corpus
    collection = runtime_request.collection
    source_ocr_runtime = resolve_collection_source_ocr_runtime(corpus=corpus, collection=collection)
    collection_config = _resolve_runtime_collection_config(
        source=source, corpus=corpus, collection=collection
    )
    if collection not in {"student_rules", "curriculum_plan"}:
        raise ValueError("provider_response_replay only supports student_rules or curriculum_plan")
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(
        source, corpus
    )
    runtime_request = replace(
        runtime_request,
        source_pdf=_resolve_replay_source_pdf(
            source=source,
            request=runtime_request,
            collection_config=collection_config,
            raw_asset_registry=runtime_raw_asset_registry,
        ),
    )
    source_pdf = runtime_request.source_pdf or _default_replay_source_pdf(collection)

    object_store_settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(object_store_settings)
    source_artifacts = _run_traced_stage(
        trace_recorder,
        "replay.load_source_artifacts",
        lambda: _load_replay_source_artifacts(
            source=source,
            request=runtime_request,
            collection_config=collection_config,
            object_store_settings=object_store_settings,
            object_store=runtime_object_store,
            source_pdf=source_pdf,
        ),
        fields={
            "corpus": corpus,
            "collection": collection,
            "source_pdf": source_pdf,
        },
        result_fields=lambda payload: {
            "split_document_count": len(payload["split_manifest"].documents),
            "structured_row_count": len(payload["structured_rows"]),
        },
    )
    split_manifest = source_artifacts["split_manifest"]
    raw_asset_id = source_artifacts["raw_asset_id"]
    raw_version_id = source_artifacts["raw_version_id"]
    provider_response_key = source_artifacts["provider_response_key"]
    structured_rows = source_artifacts["structured_rows"]
    layout_elements_key = source_artifacts["layout_elements_key"]
    replay_raw_asset_record = runtime_raw_asset_registry.get(raw_asset_id, raw_version_id)

    documents = _run_traced_stage(
        trace_recorder,
        "replay.build_documents",
        lambda: _build_replay_documents(
            source=source,
            collection_config=collection_config,
            split_manifest=split_manifest,
            corpus=corpus,
            collection=collection,
            source_pdf=source_pdf,
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            structured_rows=structured_rows,
            reader=runtime_object_store,
            source_bucket=object_store_settings.bucket_source,
            replay_raw_asset_record=replay_raw_asset_record,
        ),
        fields={
            "corpus": corpus,
            "collection": collection,
            "split_document_count": len(split_manifest.documents),
        },
        result_fields=lambda built_documents: {"document_count": len(built_documents)},
    )
    runtime_registry = registry or _build_document_registry_for_rebuild(source, corpus)
    stats = _run_traced_stage(
        trace_recorder,
        "replay.persist_documents",
        lambda: _collect_projection_aware_import_stats(
            source=source,
            documents=documents,
            registry=runtime_registry,
            raw_asset_registry=runtime_raw_asset_registry,
            writer=runtime_object_store,
            object_store=object_store_settings,
            parser_version=source_ocr_runtime.parser_version,
            embedding_model=_read_embedding_model_name(source),
            default_visibility_scope=_read_default_visibility_scope(source),
            primary_scope=(corpus, collection),
            trace_recorder=trace_recorder,
        ),
        fields={
            "corpus": corpus,
            "collection": collection,
            "document_count": len(documents),
        },
        result_fields=_summarize_persist_stats,
    )
    errors = list(stats.errors)
    failed_count = stats.failed_count
    contact_directory_reports = ()
    service_guide_report = None
    if failed_count == 0:
        try:
            contact_directory_reports = (
                write_contact_directory_projection_release_from_import_documents(
                    documents=documents,
                    output_dir=Path(
                        (source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()
                    )
                    / "contact-directory-projection",
                    generated_at=stats.timestamp,
                    object_store=runtime_object_store,
                    bucket=object_store_settings.bucket_derived,
                )
            )
        except Exception as exc:
            failed_count += 1
            errors.append(f"contact directory projection failed: {exc}")
    if failed_count == 0:
        try:
            service_guide_report = (
                write_service_guide_projection_release_from_manifest_if_available(
                    source=source,
                    upstream_corpus=corpus,
                    upstream_collection=collection,
                    output_dir=Path(
                        (source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()
                    )
                    / "service-guide-projection",
                    generated_at=stats.timestamp,
                    object_store=runtime_object_store,
                    bucket=object_store_settings.bucket_derived,
                )
            )
        except Exception as exc:
            failed_count += 1
            errors.append(f"service guide projection failed: {exc}")
    if failed_count == 0 and service_guide_report is not None:
        try:
            contact_directory_projection_path = (
                contact_directory_reports[0].current_projection_path
                if contact_directory_reports
                else None
            )
            write_service_catalog_projection_release_from_current_projections(
                service_guide_projection_path=service_guide_report.current_projection_path,
                contact_directory_projection_path=contact_directory_projection_path,
                output_dir=Path((source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip())
                / "service-catalog-projection",
                generated_at=stats.timestamp,
                object_store=runtime_object_store,
                bucket=object_store_settings.bucket_derived,
            )
        except Exception as exc:
            failed_count += 1
            errors.append(f"service catalog projection failed: {exc}")
    if _should_index_qdrant_for_replay(source):
        try:
            _run_traced_stage(
                trace_recorder,
                "replay.index_documents",
                lambda: _index_replayed_documents(
                    source=source,
                    registry=runtime_registry,
                    documents=documents,
                    object_store=runtime_object_store,
                    qdrant_client=qdrant_client,
                    trace_recorder=trace_recorder,
                ),
                fields={
                    "scope_count": len(
                        {(document.corpus, document.collection) for document in documents}
                    ),
                    "document_count": len(documents),
                },
            )
        except Exception as exc:
            failed_count += 1
            errors.append(f"replay indexing failed: {exc}")
    return write_import_report(
        import_mode="provider_response_replay",
        report_dir=Path((source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
        report_prefix="replay-provider-response-rebuild",
        success_count=stats.success_count,
        skipped_count=stats.skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=stats.raw_uploaded_count,
        raw_reused_count=stats.raw_reused_count,
        document_ids=stats.document_ids,
        unresolved_source_pdfs=stats.unresolved_source_pdfs,
        errors=tuple(errors),
        timestamp=stats.timestamp,
    )


def _read_embedding_model_name(source: dict[str, str]) -> str:
    model = (source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or "").strip()
    if not model:
        raise ValueError("INGESTION_EMBEDDING_MODEL or EMBEDDING_MODEL is required")
    return model
