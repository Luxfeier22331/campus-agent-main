from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)
from campus_ingestion_core.authenticated_notice_file_release_import import (
    FILE_RELEASE_SOURCE_SURFACE,
    AuthenticatedNoticeFileReleaseImportRequest,
    _assert_file_release_manifest_schema,
    _file_release_export_from_payload,
    _prepare_file_release_import,
)
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    prepare_authenticated_notice_bundle_records,
)
from campus_ingestion_core.authenticated_notice_import_sources import (
    explicit_authenticated_notice_import_object_refs,
    load_authenticated_notice_import_payload_from_object_refs,
)
from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
    read_authenticated_notice_notice_family_config_path,
)
from campus_ingestion_core.campusrag_ingestion_artifacts import (
    build_document_processed_object_keys,
    resolve_document_artifact_keys,
)
from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.campusrag_ingestion_sources import document_semantic_hash
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.collected_notice_classification import (
    classify_collected_notice_unit,
)
from campus_ingestion_core.collected_notice_reimport_preview_models import (
    BODY_TEXT_MAX_CHARS,
    DEFAULT_PREVIEW_ADMISSION_BATCH_ID,
    PHASE_04_ID,
    SEARCHABLE_PREVIEW_SCHEMA_VERSION,
    SOURCE_TRUTH_PREVIEW_SCHEMA_VERSION,
    SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES,
    CollectedNoticeCapturedRunRef,
    CollectedNoticeReimportPreview,
    PreparedPreviewItem,
)
from campus_ingestion_core.collected_notice_reimport_preview_outputs import (
    _coverage_report,
    _input_refs,
    _invalid_defer_multimodal_report,
    _reimport_plan,
    _searchable_unit,
    _source_key,
    _source_truth_candidate,
)
from campus_ingestion_core.collected_notice_reimport_preview_source_refs import (
    _bucket_names,
    _content_blocks_body_text,
    _file_release_required_attachment_ref,
    _optional_int,
    _optional_text,
    _resolve_multimodal_status,
    _resolved_site_id,
    _resolved_source_home_url,
    _source_object_refs,
    _source_retention_summary_from_attachment_refs,
    _source_retention_summary_from_manifest,
    _text_tuple,
    _visibility_level,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.settings import (
    ObjectStoreSettings,
)


def select_collected_notice_reimport_run_refs(
    inventory_payload: Mapping[str, Any],
    *,
    source_surfaces: Sequence[str] = SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES,
) -> tuple[tuple[CollectedNoticeCapturedRunRef, ...], tuple[dict[str, Any], ...]]:
    selected_surfaces = frozenset(str(item).strip() for item in source_surfaces if item)
    selected: list[CollectedNoticeCapturedRunRef] = []
    rejected: list[dict[str, Any]] = []
    for raw_row in inventory_payload.get("runs") or ():
        if not isinstance(raw_row, Mapping):
            continue
        row = dict(raw_row)
        source_surface = str(row.get("source_surface") or "").strip()
        if source_surface not in selected_surfaces:
            rejected.append(
                _rejected_run_ref(
                    row,
                    reason_codes=("unsupported_source_surface",),
                )
            )
            continue
        status = str(row.get("status") or "").strip()
        verification_status = str(row.get("verification_status") or "").strip()
        reason_codes = []
        if status != "success":
            reason_codes.append("collector_run_not_success")
        if verification_status != "verified":
            reason_codes.append("collector_run_not_verified")
        if reason_codes:
            rejected.append(_rejected_run_ref(row, reason_codes=tuple(reason_codes)))
            continue
        try:
            selected.append(_captured_run_ref_from_inventory_row(row))
        except ValueError as exc:
            rejected.append(
                _rejected_run_ref(
                    row,
                    reason_codes=("missing_or_invalid_object_ref",),
                    error=str(exc),
                )
            )
    return (
        tuple(sorted(selected, key=lambda item: (item.source_surface, item.run_id))),
        tuple(sorted(rejected, key=lambda item: (item.get("source_surface", ""), item["run_id"]))),
    )


def build_collected_notice_reimport_preview_from_inventory_path(
    *,
    captured_runs_inventory_path: Path,
    env: Mapping[str, str] | None = None,
    object_store: object | None = None,
    source_surfaces: Sequence[str] = SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES,
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_reimport",
    default_site_id: str = "muc_internal_portal",
    default_source_home_url: str = "https://my.muc.edu.cn",
) -> CollectedNoticeReimportPreview:
    payload = json.loads(Path(captured_runs_inventory_path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("captured runs inventory must be a JSON object")
    selected, rejected = select_collected_notice_reimport_run_refs(
        payload,
        source_surfaces=source_surfaces,
    )
    return build_collected_notice_reimport_preview(
        run_refs=selected,
        rejected_run_refs=rejected,
        env=env,
        object_store=object_store,
        generated_by=generated_by,
        default_site_id=default_site_id,
        default_source_home_url=default_source_home_url,
        input_inventory_path=str(captured_runs_inventory_path),
    )


def build_collected_notice_reimport_preview(
    *,
    run_refs: Sequence[CollectedNoticeCapturedRunRef],
    rejected_run_refs: Sequence[Mapping[str, Any]] = (),
    env: Mapping[str, str] | None = None,
    object_store: object | None = None,
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_reimport",
    default_site_id: str = "muc_internal_portal",
    default_source_home_url: str = "https://my.muc.edu.cn",
    input_inventory_path: str | None = None,
) -> CollectedNoticeReimportPreview:
    source = dict(env if env is not None else os.environ)
    reader = object_store or S3ObjectStoreWriter(ObjectStoreSettings.from_env(source))
    bucket_source, bucket_derived = _bucket_names(source)
    generated_at = utc_now()
    prepared_items: list[PreparedPreviewItem] = []
    invalid_captures = [dict(item) for item in rejected_run_refs]
    selected_run_refs = tuple(sorted(run_refs, key=lambda item: (item.source_surface, item.run_id)))
    classification_config = load_authenticated_notice_notice_family_config(
        read_authenticated_notice_notice_family_config_path(source)
    )
    for run_ref in selected_run_refs:
        try:
            if run_ref.source_surface == "notice":
                prepared_items.extend(
                    _prepare_notice_run_preview_items(
                        run_ref=run_ref,
                        env=source,
                        object_store=reader,
                        default_site_id=default_site_id,
                        default_source_home_url=default_source_home_url,
                        bucket_source=bucket_source,
                        bucket_derived=bucket_derived,
                        classification_config=classification_config,
                    )
                )
            elif run_ref.source_surface == FILE_RELEASE_SOURCE_SURFACE:
                prepared_items.extend(
                    _prepare_file_release_run_preview_items(
                        run_ref=run_ref,
                        env=source,
                        object_store=reader,
                        default_site_id=default_site_id,
                        default_source_home_url=default_source_home_url,
                        bucket_source=bucket_source,
                        bucket_derived=bucket_derived,
                        classification_config=classification_config,
                    )
                )
        except Exception as exc:
            invalid_captures.append(
                {
                    "run_id": run_ref.run_id,
                    "source_surface": run_ref.source_surface,
                    "consumption_class": "invalid_capture",
                    "reason_codes": ["import_preview_failed"],
                    "error": str(exc),
                }
            )

    prepared_items, duplicate_skips = _dedupe_prepared_items(tuple(prepared_items))
    source_truth_candidates = tuple(
        _source_truth_candidate(item, bucket_source=bucket_source, bucket_derived=bucket_derived)
        for item in prepared_items
    )
    searchable_units = tuple(
        _searchable_unit(
            item,
            generated_at=generated_at,
            admission_batch_id=DEFAULT_PREVIEW_ADMISSION_BATCH_ID,
        )
        for item in prepared_items
    )
    coverage_report = _coverage_report(
        prepared_items=tuple(prepared_items),
        searchable_units=searchable_units,
        generated_at=generated_at,
        generated_by=generated_by,
    )
    invalid_defer_multimodal_report = _invalid_defer_multimodal_report(
        invalid_captures=tuple(invalid_captures),
        searchable_units=searchable_units,
        generated_at=generated_at,
        generated_by=generated_by,
    )
    input_refs = _input_refs(
        selected_run_refs=selected_run_refs,
        rejected_run_refs=tuple(invalid_captures),
        input_inventory_path=input_inventory_path,
    )
    reimport_plan = _reimport_plan(
        selected_run_refs=selected_run_refs,
        source_truth_candidates=source_truth_candidates,
        searchable_units=searchable_units,
        coverage_report=coverage_report,
        invalid_defer_multimodal_report=invalid_defer_multimodal_report,
        duplicate_skips=duplicate_skips,
        input_refs=input_refs,
        generated_at=generated_at,
        generated_by=generated_by,
    )
    return CollectedNoticeReimportPreview(
        reimport_plan=reimport_plan,
        source_truth_preview={
            "schema_version": SOURCE_TRUTH_PREVIEW_SCHEMA_VERSION,
            "generated_at": generated_at,
            "generated_by": generated_by,
            "mode": "dry_run",
            "phase": PHASE_04_ID,
            "candidate_count": len(source_truth_candidates),
            "candidates": list(source_truth_candidates),
        },
        searchable_notice_preview={
            "schema_version": SEARCHABLE_PREVIEW_SCHEMA_VERSION,
            "generated_at": generated_at,
            "generated_by": generated_by,
            "mode": "dry_run",
            "phase": PHASE_04_ID,
            "unit_count": len(searchable_units),
            "units": list(searchable_units),
        },
        coverage_report=coverage_report,
        invalid_defer_multimodal_report=invalid_defer_multimodal_report,
    )


def preview_to_output_files(preview: CollectedNoticeReimportPreview) -> dict[str, dict[str, Any]]:
    return {
        "reimport-plan.dry-run.json": preview.reimport_plan,
        "source-truth-preview.json": preview.source_truth_preview,
        "searchable-notice-preview.json": preview.searchable_notice_preview,
        "searchable-coverage-report.json": preview.coverage_report,
        "invalid-defer-requires-multimodal-report.json": (preview.invalid_defer_multimodal_report),
    }


def _prepare_notice_run_preview_items(
    *,
    run_ref: CollectedNoticeCapturedRunRef,
    env: Mapping[str, str],
    object_store: object,
    default_site_id: str,
    default_source_home_url: str,
    bucket_source: str,
    bucket_derived: str,
    classification_config: Any,
) -> tuple[PreparedPreviewItem, ...]:
    loaded = _load_import_payload(run_ref=run_ref, env=env, object_store=object_store)
    site_id = _resolved_site_id(run_ref, loaded.export_manifest, default_site_id)
    source_home_url = _resolved_source_home_url(
        run_ref,
        loaded.export_manifest,
        default_source_home_url,
    )
    request = AuthenticatedNoticeImportRequest(
        source_bucket=run_ref.source_bucket,
        bundle_object_key=run_ref.bundle_object_key,
        manifest_object_key=run_ref.manifest_object_key,
        bundle_content_sha256=run_ref.bundle_content_sha256,
        bundle_byte_size=run_ref.bundle_byte_size,
        manifest_content_sha256=run_ref.manifest_content_sha256,
        manifest_byte_size=run_ref.manifest_byte_size,
        site_id=site_id,
        source_home_url=source_home_url,
        default_entitlement_groups=DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
        visibility_scope=DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
    )
    prepared = prepare_authenticated_notice_bundle_records(
        request=request,
        bundle_records=loaded.bundle_records,
        export_manifest=loaded.export_manifest,
    )
    runtime_profile = load_runtime_profile(request.corpus, request.collection)
    items: list[PreparedPreviewItem] = []
    for notice_import in prepared.notice_imports:
        notice_manifest = _json_payload(
            notice_import.source_truth_artifacts["source-truth/notice-manifest.json"]
        )
        content_blocks = _jsonl_payload(
            notice_import.source_truth_artifacts["source-truth/content-blocks.jsonl"]
        )
        attachment_refs = _jsonl_payload(
            notice_import.source_truth_artifacts["source-truth/attachment-refs.jsonl"]
        )
        document = notice_import.document_import
        item = _prepared_preview_item(
            source_surface="notice",
            run_ref=run_ref,
            source_identifier=notice_import.notice_id,
            site_id=site_id,
            source_corpus=request.corpus,
            source_collection=request.collection,
            title=str(notice_manifest.get("notice_title_normalized") or document.title or ""),
            published_at=str(notice_manifest.get("notice_release_time") or ""),
            source_url=str(
                notice_manifest.get("notice_browser_url") or document.raw_source_uri or ""
            ),
            source_home_url=source_home_url,
            organization_name=str(notice_manifest.get("organization_name") or ""),
            content_blocks=content_blocks,
            attachment_refs=attachment_refs,
            source_artifact_keys=notice_import.source_artifact_keys,
            raw_asset_id=notice_import.raw_asset_id,
            raw_version_id=notice_import.raw_version_id,
            document=document,
            parser_version=request.parser_version,
            embedding_model=request.embedding_model,
            cleaning_policy_version=runtime_profile.cleaning_policy_version,
            bucket_source=bucket_source,
            bucket_derived=bucket_derived,
            classification_config=classification_config,
            source_retention=_source_retention_summary_from_manifest(
                notice_manifest=notice_manifest,
                attachment_refs=attachment_refs,
            ),
        )
        items.append(item)
    return tuple(items)


def _prepare_file_release_run_preview_items(
    *,
    run_ref: CollectedNoticeCapturedRunRef,
    env: Mapping[str, str],
    object_store: object,
    default_site_id: str,
    default_source_home_url: str,
    bucket_source: str,
    bucket_derived: str,
    classification_config: Any,
) -> tuple[PreparedPreviewItem, ...]:
    loaded = _load_import_payload(run_ref=run_ref, env=env, object_store=object_store)
    _assert_file_release_manifest_schema(loaded.export_manifest)
    export = _file_release_export_from_payload(
        bundle_records=loaded.bundle_records,
        export_manifest=loaded.export_manifest,
    )
    site_id = _resolved_site_id(run_ref, loaded.export_manifest, default_site_id)
    source_home_url = _resolved_source_home_url(
        run_ref,
        loaded.export_manifest,
        default_source_home_url,
    )
    request = AuthenticatedNoticeFileReleaseImportRequest(
        source_bucket=run_ref.source_bucket,
        bundle_object_key=run_ref.bundle_object_key,
        manifest_object_key=run_ref.manifest_object_key,
        bundle_content_sha256=run_ref.bundle_content_sha256,
        bundle_byte_size=run_ref.bundle_byte_size,
        manifest_content_sha256=run_ref.manifest_content_sha256,
        manifest_byte_size=run_ref.manifest_byte_size,
        site_id=site_id or export.site_id or default_site_id,
        source_home_url=source_home_url or export.source_home_url or default_source_home_url,
    )
    runtime_profile = load_runtime_profile(request.corpus, request.collection)
    items: list[PreparedPreviewItem] = []
    for bundle_record in export.bundle_records:
        prepared = _prepare_file_release_import(
            request=request,
            bundle_record=bundle_record,
            export_manifest=export.export_manifest,
        )
        manifest = _json_payload(
            prepared.source_truth_artifacts["source-truth/file-release-manifest.json"]
        )
        content_blocks = _jsonl_payload(
            prepared.source_truth_artifacts["source-truth/content-blocks.jsonl"]
        )
        released_file_ref = _json_payload(
            prepared.source_truth_artifacts["source-truth/released-file-ref.json"]
        )
        document = prepared.document_import
        attachment_refs = (
            _file_release_required_attachment_ref(
                file_release_id=str(prepared.file_release_id),
                released_file_ref=released_file_ref,
            ),
        )
        item = _prepared_preview_item(
            source_surface=FILE_RELEASE_SOURCE_SURFACE,
            run_ref=run_ref,
            source_identifier=str(prepared.file_release_id),
            site_id=request.site_id,
            source_corpus=request.corpus,
            source_collection=request.collection,
            title=str(manifest.get("filename") or document.title or ""),
            published_at=str(manifest.get("filetime") or ""),
            source_url=str(manifest.get("source_file_url") or document.raw_source_uri or ""),
            source_home_url=request.source_home_url,
            organization_name=str(
                manifest.get("filedepartment") or manifest.get("explain_department") or ""
            ),
            content_blocks=content_blocks,
            attachment_refs=attachment_refs,
            source_artifact_keys=prepared.source_artifact_keys,
            raw_asset_id=prepared.raw_record.raw_asset_id,
            raw_version_id=prepared.raw_record.raw_version_id,
            document=document,
            parser_version=request.parser_version,
            embedding_model=request.embedding_model,
            cleaning_policy_version=runtime_profile.cleaning_policy_version,
            bucket_source=bucket_source,
            bucket_derived=bucket_derived,
            classification_config=classification_config,
            source_retention=_source_retention_summary_from_attachment_refs(
                notice_capture_route="candidate_document_owner",
                attachment_refs=attachment_refs,
            ),
        )
        items.append(item)
    return tuple(items)


def _prepared_preview_item(
    *,
    source_surface: str,
    run_ref: CollectedNoticeCapturedRunRef,
    source_identifier: str,
    site_id: str,
    source_corpus: str,
    source_collection: str,
    title: str,
    published_at: str,
    source_url: str,
    source_home_url: str,
    organization_name: str,
    content_blocks: tuple[dict[str, Any], ...],
    attachment_refs: tuple[dict[str, Any], ...],
    source_artifact_keys: dict[str, str],
    raw_asset_id: str,
    raw_version_id: str,
    document: Any,
    parser_version: str,
    embedding_model: str,
    cleaning_policy_version: str,
    bucket_source: str,
    bucket_derived: str,
    classification_config: Any,
    source_retention: Mapping[str, Any] | None = None,
) -> PreparedPreviewItem:
    document_id = str(document.metadata["document_id"])
    version_id = str(document.metadata["version_id"])
    artifact_keys = resolve_document_artifact_keys(
        document=document,
        document_id=document_id,
        version_id=version_id,
        title=document.title,
        year=document.year,
    )
    processed_object_keys = build_document_processed_object_keys(
        document_units_key=artifact_keys.document_units_key,
        provider_response_key=artifact_keys.provider_response_key,
        layout_elements_key=artifact_keys.layout_elements_key,
        canonical_markdown_key=artifact_keys.canonical_markdown_key,
        additional_keys=document.additional_processed_object_keys,
    )
    body_text = _content_blocks_body_text(content_blocks)
    multimodal_status, reason_codes = _resolve_multimodal_status(
        source_surface=source_surface,
        body_text=body_text,
        attachment_refs=attachment_refs,
    )
    source_object_refs = _source_object_refs(
        run_ref=run_ref,
        source_artifact_keys=source_artifact_keys,
        attachment_refs=attachment_refs,
        bucket_source=bucket_source,
    )
    classification = classify_collected_notice_unit(
        source_identifier=str(source_identifier),
        source_surface=source_surface,
        title=title,
        body_text=body_text,
        attachment_refs=attachment_refs,
        config=classification_config,
    )
    resolved_source_retention = dict(
        source_retention
        or _source_retention_summary_from_attachment_refs(
            notice_capture_route=str(
                (attachment_refs[0] if attachment_refs else {}).get("notice_capture_route")
                or "capture_only_no_adoption"
            ),
            attachment_refs=attachment_refs,
        )
    )
    return PreparedPreviewItem(
        source_surface=source_surface,
        run_ref=run_ref,
        source_identifier=str(source_identifier),
        site_id=site_id,
        source_corpus=source_corpus,
        source_collection=source_collection,
        title=title,
        published_at=published_at,
        source_url=source_url,
        source_home_url=source_home_url,
        organization_name=organization_name,
        body_text=body_text[:BODY_TEXT_MAX_CHARS],
        content_blocks=content_blocks,
        attachment_refs=attachment_refs,
        source_artifact_keys=source_artifact_keys,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        document_id=document_id,
        version_id=version_id,
        content_hash=document_semantic_hash(
            document_units_bytes=document.document_units_bytes,
            semantic_content_hash=document.metadata.get("semantic_content_hash"),
        ),
        revision_track=document.revision_track,
        canonical_markdown_object_key=artifact_keys.canonical_markdown_key or "",
        document_units_object_key=artifact_keys.document_units_key,
        processed_object_keys=processed_object_keys,
        provider_response_object_key=artifact_keys.provider_response_key,
        visibility_level=_visibility_level(document.metadata),
        visibility_scope=document.visibility_scope,
        entitlement_groups=_text_tuple(document.metadata.get("entitlement_groups")),
        policy_projection_version=str(document.metadata.get("policy_projection_version") or ""),
        source_object_refs=source_object_refs,
        multimodal_status=multimodal_status,
        reason_codes=reason_codes,
        classification=classification,
        source_retention=resolved_source_retention,
    )


def _load_import_payload(
    *,
    run_ref: CollectedNoticeCapturedRunRef,
    env: Mapping[str, str],
    object_store: object,
):
    refs = explicit_authenticated_notice_import_object_refs(
        source_bucket=run_ref.source_bucket,
        bundle_object_key=run_ref.bundle_object_key,
        manifest_object_key=run_ref.manifest_object_key,
        bundle_content_sha256=run_ref.bundle_content_sha256,
        bundle_byte_size=run_ref.bundle_byte_size,
        manifest_content_sha256=run_ref.manifest_content_sha256,
        manifest_byte_size=run_ref.manifest_byte_size,
        run_id=run_ref.run_id,
    )
    return load_authenticated_notice_import_payload_from_object_refs(
        refs=refs,
        env=dict(env),
        object_store=object_store,
        bundle_label=f"{run_ref.source_surface} bundle",
        manifest_label=f"{run_ref.source_surface} manifest",
    )


def _dedupe_prepared_items(
    items: Sequence[PreparedPreviewItem],
) -> tuple[tuple[PreparedPreviewItem, ...], tuple[dict[str, Any], ...]]:
    latest_by_source_key: dict[str, PreparedPreviewItem] = {}
    for item in items:
        latest_by_source_key[
            _source_key(
                source_surface=item.source_surface,
                site_id=item.site_id,
                source_identifier=item.source_identifier,
            )
        ] = item
    deduped = tuple(
        sorted(
            latest_by_source_key.values(),
            key=lambda item: (item.source_surface, item.site_id, item.source_identifier),
        )
    )
    kept_item_ids = {id(item) for item in deduped}
    duplicate_skips = [
        {
            "source_surface": item.source_surface,
            "site_id": item.site_id,
            "source_notice_id": item.source_identifier,
            "run_id": item.run_ref.run_id,
            "title": item.title,
            "source_url": item.source_url,
            "reason_codes": ["duplicate_source_identity"],
        }
        for item in items
        if id(item) not in kept_item_ids
    ]
    return deduped, tuple(
        sorted(
            duplicate_skips,
            key=lambda item: (
                str(item["source_surface"]),
                str(item["source_notice_id"]),
                str(item["run_id"]),
            ),
        )
    )


def _captured_run_ref_from_inventory_row(row: Mapping[str, Any]) -> CollectedNoticeCapturedRunRef:
    return CollectedNoticeCapturedRunRef(
        run_id=str(row.get("run_id") or ""),
        source_surface=str(row.get("source_surface") or ""),
        source_bucket=str(row.get("source_bucket") or ""),
        bundle_object_key=str(row.get("bundle_object_key") or ""),
        manifest_object_key=str(row.get("manifest_object_key") or ""),
        bundle_content_sha256=_optional_text(row.get("bundle_content_sha256")),
        bundle_byte_size=_optional_int(row.get("bundle_byte_size")),
        manifest_content_sha256=_optional_text(row.get("manifest_content_sha256")),
        manifest_byte_size=_optional_int(row.get("manifest_byte_size")),
        site_id=_optional_text(row.get("site_id")),
        source_home_url=_optional_text(row.get("source_home_url")),
        notices_collected=_optional_int(row.get("notices_collected")),
    )


def _rejected_run_ref(
    row: Mapping[str, Any],
    *,
    reason_codes: Sequence[str],
    error: str | None = None,
) -> dict[str, Any]:
    payload = {
        "run_id": str(row.get("run_id") or ""),
        "source_surface": str(row.get("source_surface") or ""),
        "status": str(row.get("status") or ""),
        "verification_status": str(row.get("verification_status") or ""),
        "consumption_class": "invalid_capture",
        "reason_codes": list(reason_codes),
        "failure_reason": row.get("failure_reason"),
    }
    if error:
        payload["error"] = error
    return payload


def _json_payload(payload: bytes) -> dict[str, Any]:
    parsed = json.loads(payload.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("expected JSON object source-truth artifact")
    return parsed


def _jsonl_payload(payload: bytes) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    for line in payload.decode("utf-8").splitlines():
        if not line.strip():
            continue
        parsed = json.loads(line)
        if isinstance(parsed, dict):
            rows.append(parsed)
    return tuple(rows)


__all__ = [
    "PHASE_04_ID",
    "SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES",
    "CollectedNoticeCapturedRunRef",
    "CollectedNoticeReimportPreview",
    "build_collected_notice_reimport_preview",
    "build_collected_notice_reimport_preview_from_inventory_path",
    "preview_to_output_files",
    "select_collected_notice_reimport_run_refs",
]
