from __future__ import annotations

from campus_ingestion_core.artifacts import (
    LAYOUT_ELEMENTS_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    PersistImportStats,
    apply_authorization_projection_metadata,
    collect_import_document_stats,
    load_metadata_from_bytes,
)
from campus_ingestion_core.collection_config import CollectionTruthConfig
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.curriculum_course_facts_projection import (
    build_curriculum_course_facts_scope_refresh_documents,
)
from campus_ingestion_core.curriculum_program_family_facts_projection import (
    build_curriculum_program_family_facts_scope_refresh_documents,
)
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_facts_scope_refresh_documents,
)
from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result
from campus_ingestion_core.handbook_cleanup import (
    cleanup_handbook_document,
    serialize_handbook_document_units,
)
from campus_ingestion_core.handbook_provider_normalize import (
    normalize_handbook_provider_result,
    serialize_handbook_layout_elements,
)
from campus_ingestion_core.handbook_source_projections import (
    build_handbook_projection_import_documents,
)
from campus_ingestion_core.local_rebuild_runtime import _resolve_collection_raw_asset_id
from campus_ingestion_core.local_rebuild_support import (
    _read_default_visibility_scope,
    _RebuildTraceRecorder,
    _run_traced_stage,
    _summarize_persist_stats,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    DEFAULT_RAW_SOURCE_CHANNEL,
    build_source_model_slug,
    build_source_ocr_artifact_key,
    build_source_truth_artifact_key,
    infer_year_label,
    parse_source_object_key,
)
from campus_ingestion_core.raw_ingestion import (
    DEFAULT_ONLINE_OCR_MODEL,
    DEFAULT_ONLINE_OCR_PROVIDER,
    _build_split_manifest_document_input,
    _load_layout_elements_rows,
    normalize_online_ocr_provider_label,
)
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import (
    SplitManifest,
    SplitManifestDocument,
    load_split_manifest,
)


def _load_replay_source_artifacts(
    *,
    source: dict[str, str],
    request,
    collection_config: CollectionTruthConfig,
    object_store_settings: ObjectStoreSettings,
    object_store,
    source_pdf: str,
) -> dict[str, object]:
    corpus = request.corpus
    collection = request.collection
    split_manifest = load_split_manifest(
        collection_config.split_manifest_path,
        expected_corpus=corpus,
        expected_collection=collection,
    )
    raw_asset_id = _resolve_collection_raw_asset_id(
        request=request, collection_config=collection_config
    )
    raw_version_id = request.raw_version_id
    if raw_version_id is None:
        raise ValueError("RAW_VERSION_ID is required")
    provider_response_key = build_source_ocr_artifact_key(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename=PROVIDER_RESPONSE_FILENAME,
        source_channel=DEFAULT_RAW_SOURCE_CHANNEL,
        model_slug=build_source_model_slug(
            (source.get("OCR_MODEL") or DEFAULT_ONLINE_OCR_MODEL).strip()
            or DEFAULT_ONLINE_OCR_MODEL
        ),
        year=infer_year_label(source_pdf),
    )
    provider_response_bytes = object_store.get_bytes(
        bucket=object_store_settings.bucket_source,
        key=provider_response_key,
    )
    ocr_model = (
        source.get("OCR_MODEL") or DEFAULT_ONLINE_OCR_MODEL
    ).strip() or DEFAULT_ONLINE_OCR_MODEL
    ocr_provider = normalize_online_ocr_provider_label(
        (source.get("OCR_PROVIDER_MODE") or "").strip() or DEFAULT_ONLINE_OCR_PROVIDER
    )
    if collection == "student_handbook":
        structured_rows = normalize_handbook_provider_result(
            source_pdf=source_pdf,
            provider_jsonl_bytes=provider_response_bytes,
            ocr_provider=ocr_provider,
            ocr_model=ocr_model,
            source_artifact_id=raw_asset_id,
        )
        layout_elements_bytes = serialize_handbook_layout_elements(structured_rows)
    else:
        layout_elements_bytes = normalize_curriculum_provider_result(
            provider_jsonl_bytes=provider_response_bytes,
            source_pdf=source_pdf,
            ocr_provider=ocr_provider,
            ocr_model=ocr_model,
        )
        structured_rows = _load_layout_elements_rows(layout_elements_bytes)
    layout_elements_key = build_source_truth_artifact_key(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename=LAYOUT_ELEMENTS_FILENAME,
        source_channel=DEFAULT_RAW_SOURCE_CHANNEL,
        year=infer_year_label(source_pdf),
    )
    object_store.put_bytes(
        bucket=object_store_settings.bucket_source,
        key=provider_response_key,
        data=provider_response_bytes,
        content_type="application/x-ndjson",
    )
    object_store.put_bytes(
        bucket=object_store_settings.bucket_source,
        key=layout_elements_key,
        data=layout_elements_bytes,
        content_type="application/x-ndjson",
    )
    _cleanup_replay_source_artifact_collisions(
        object_store=object_store,
        object_store_settings=object_store_settings,
        source_provider_response_key=provider_response_key,
        canonical_provider_response_key=provider_response_key,
        canonical_layout_elements_key=layout_elements_key,
    )
    return {
        "split_manifest": split_manifest,
        "raw_asset_id": raw_asset_id,
        "raw_version_id": raw_version_id,
        "provider_response_key": provider_response_key,
        "structured_rows": structured_rows,
        "layout_elements_key": layout_elements_key,
    }


def _build_replay_documents(
    *,
    source: dict[str, str],
    collection_config: CollectionTruthConfig,
    split_manifest: SplitManifest,
    corpus: str,
    collection: str,
    source_pdf: str,
    raw_asset_id: str,
    raw_version_id: str,
    provider_response_key: str,
    layout_elements_key: str,
    structured_rows: list[dict[str, object]],
    reader=None,
    source_bucket: str | None = None,
    replay_raw_asset_record: RawAssetRecord | None = None,
) -> list[DocumentImportInput]:
    if collection == "student_handbook":
        documents = [
            _build_handbook_replay_document_input(
                source_label=f"{provider_response_key}#{manifest_document.document_id}",
                source_doc=source_pdf,
                manifest_document=manifest_document,
                structured_rows=structured_rows,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
                corpus=corpus,
                collection=collection,
            )
            for manifest_document in split_manifest.documents
        ]
    else:
        raw_asset_ref = RawAssetRecord(
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            corpus=corpus,
            collection=collection,
            raw_source_uri=f"campusrag://source/{corpus}/{raw_asset_id}/{raw_version_id}",
            content_hash=raw_version_id.removeprefix("sha256:") or raw_version_id,
            source_filename=source_pdf,
            object_key=provider_response_key,
            ingestion_timestamp="1970-01-01T00:00:00+00:00",
            import_source="provider_response_replay",
        )
        default_visibility_scope = _read_default_visibility_scope(source)
        documents = [
            _build_split_manifest_document_input(
                raw_asset_record=raw_asset_ref,
                manifest_version=split_manifest.manifest_version,
                manifest_document=manifest_document,
                structured_rows=structured_rows,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
                default_visibility_scope=default_visibility_scope,
                corpus=corpus,
                collection=collection,
            )
            for manifest_document in split_manifest.documents
        ]
    raw_asset_ref = RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus=corpus,
        collection=collection,
        raw_source_uri=f"campusrag://source/{corpus}/{raw_asset_id}/{raw_version_id}",
        content_hash=raw_version_id.removeprefix("sha256:") or raw_version_id,
        source_filename=source_pdf,
        object_key=provider_response_key,
        ingestion_timestamp="1970-01-01T00:00:00+00:00",
        import_source="provider_response_replay",
    )
    if collection == "student_handbook":
        documents.extend(
            build_handbook_projection_import_documents(
                source=source,
                config_path=collection_config.source_projections_path,
                raw_asset_record=raw_asset_ref,
                hybrid_raw_asset_record=replay_raw_asset_record,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
                structured_rows=structured_rows,
                split_manifest_documents=split_manifest.documents,
                reader=reader,
                source_bucket=source_bucket,
                import_source="provider_response_replay",
            )
        )
    if collection == "curriculum_plan":
        documents.extend(
            build_curriculum_course_facts_scope_refresh_documents(
                raw_asset_record=raw_asset_ref,
                source_pdf=source_pdf,
                split_manifest_documents=split_manifest.documents,
                structured_rows=structured_rows,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
            )
        )
        documents.extend(
            build_curriculum_program_family_facts_scope_refresh_documents(
                raw_asset_record=raw_asset_ref,
                source_pdf=source_pdf,
                split_manifest_documents=split_manifest.documents,
            )
        )
        documents.extend(
            build_curriculum_program_semester_facts_scope_refresh_documents(
                raw_asset_record=raw_asset_ref,
                source_pdf=source_pdf,
                split_manifest_documents=split_manifest.documents,
                structured_rows=structured_rows,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
            )
        )
    return documents


def _collect_projection_aware_import_stats(
    *,
    source: dict[str, str],
    documents: list[DocumentImportInput],
    registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    writer,
    object_store: ObjectStoreSettings,
    parser_version: str,
    embedding_model: str,
    default_visibility_scope: str | None,
    primary_scope: tuple[str, str],
    trace_recorder: _RebuildTraceRecorder | None = None,
) -> PersistImportStats:
    grouped: dict[tuple[str, str], list[DocumentImportInput]] = {}
    for document in documents:
        grouped.setdefault((document.corpus, document.collection), []).append(document)

    success_count = 0
    skipped_count = 0
    failed_count = 0
    raw_uploaded_count = 0
    raw_reused_count = 0
    errors: list[str] = []
    document_ids: list[str] = []
    created_document_ids: list[str] = []
    updated_document_ids: list[str] = []
    skipped_document_ids: list[str] = []
    timestamp = "1970-01-01T00:00:00+00:00"
    for scope, scope_documents in grouped.items():
        profile = load_runtime_profile(scope[0], scope[1])
        scope_refresh = scope if scope == primary_scope else None
        stats = _run_traced_stage(
            trace_recorder,
            "replay.persist_scope",
            lambda: collect_import_document_stats(
                documents=scope_documents,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
                writer=writer,
                object_store=object_store,
                parser_version=parser_version,
                embedding_model=embedding_model,
                cleaning_policy_version=profile.cleaning_policy_version,
                default_visibility_scope=default_visibility_scope,
                scope_refresh=scope_refresh,
            ),
            fields={
                "scope": f"{scope[0]}/{scope[1]}",
                "document_count": len(scope_documents),
                "scope_refresh": scope_refresh is not None,
            },
            result_fields=_summarize_persist_stats,
        )
        timestamp = stats.timestamp
        success_count += stats.success_count
        skipped_count += stats.skipped_count
        failed_count += stats.failed_count
        raw_uploaded_count += stats.raw_uploaded_count
        raw_reused_count += stats.raw_reused_count
        errors.extend(stats.errors)
        document_ids.extend(stats.document_ids)
        created_document_ids.extend(stats.created_document_ids)
        updated_document_ids.extend(stats.updated_document_ids)
        skipped_document_ids.extend(stats.skipped_document_ids)

    return PersistImportStats(
        success_count=success_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=tuple(document_ids),
        unresolved_source_pdfs=(),
        errors=tuple(errors),
        timestamp=timestamp,
        created_document_ids=tuple(created_document_ids),
        updated_document_ids=tuple(updated_document_ids),
        skipped_document_ids=tuple(skipped_document_ids),
    )


def _build_handbook_replay_document_input(
    *,
    source_label: str,
    source_doc: str,
    manifest_document: SplitManifestDocument,
    structured_rows: list[dict[str, object]],
    provider_response_key: str,
    layout_elements_key: str,
    corpus: str,
    collection: str,
) -> DocumentImportInput:
    cleanup_result = cleanup_handbook_document(
        structured_rows=structured_rows,
        manifest_document=manifest_document,
        source_doc=source_doc,
    )
    document_units_bytes = serialize_handbook_document_units(cleanup_result.document_units)
    metadata = load_metadata_from_bytes(document_units_bytes)
    metadata["title"] = cleanup_result.title
    apply_authorization_projection_metadata(
        metadata,
        entitlement_groups=manifest_document.resolved_entitlement_groups(),
        visibility_scope=manifest_document.resolved_visibility_scope(),
        visibility_level=manifest_document.resolved_visibility_level(),
    )
    metadata["status"] = manifest_document.status
    return DocumentImportInput(
        source_label=source_label,
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=cleanup_result.canonical_markdown.encode("utf-8"),
        metadata=metadata,
        import_source="provider_response_replay",
        revision_track="source-faithful",
        source_channel="pdf_ocr",
        is_current=True,
        corpus=corpus,
        collection=collection,
        visibility_scope=manifest_document.resolved_visibility_scope(),
        status=manifest_document.status,
        raw_path=None,
        raw_source_uri=None,
        raw_asset_id=None,
        provider_response_object_key=provider_response_key,
        additional_processed_object_keys=(layout_elements_key,),
        title=cleanup_result.title,
    )


def _replace_object_key_filename(object_key: str, filename: str) -> str:
    parts = [part for part in object_key.strip("/").split("/") if part]
    if not parts:
        raise ValueError("object key is required")
    parts[-1] = filename
    return "/".join(parts)


def _cleanup_replay_source_artifact_collisions(
    *,
    object_store,
    object_store_settings: ObjectStoreSettings,
    source_provider_response_key: str,
    canonical_provider_response_key: str,
    canonical_layout_elements_key: str,
) -> None:
    delete_prefix = getattr(object_store, "delete_prefix", None)
    if not callable(delete_prefix):
        return
    if source_provider_response_key != canonical_provider_response_key:
        delete_prefix(
            bucket=object_store_settings.bucket_source,
            prefix=source_provider_response_key,
            exclude_keys=(canonical_provider_response_key,),
        )
    candidate_source_layout_keys = {
        _replace_object_key_filename(source_provider_response_key, LAYOUT_ELEMENTS_FILENAME),
    }
    parsed_source_key = parse_source_object_key(source_provider_response_key)
    if parsed_source_key is not None:
        candidate_source_layout_keys.add(
            build_source_truth_artifact_key(
                raw_asset_id=f"asset:{parsed_source_key['source_asset_slug']}",
                raw_version_id=str(parsed_source_key["raw_version_id"]),
                filename=LAYOUT_ELEMENTS_FILENAME,
                source_channel=str(parsed_source_key["source_channel"]),
                year=str(parsed_source_key["year"]),
            )
        )
    for source_layout_elements_key in candidate_source_layout_keys:
        if source_layout_elements_key != canonical_layout_elements_key:
            delete_prefix(
                bucket=object_store_settings.bucket_source,
                prefix=source_layout_elements_key,
                exclude_keys=(canonical_layout_elements_key,),
            )
