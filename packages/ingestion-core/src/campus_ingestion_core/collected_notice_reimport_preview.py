from __future__ import annotations

import hashlib
import json
import os
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
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
from campus_ingestion_core.authenticated_notice_source_truth_shared import (
    AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
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
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.settings import (
    DEFAULT_BUCKET_DERIVED,
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreSettings,
    resolve_object_store_bucket_names,
)

PHASE_04_ID = "phase-04-dry-run-reimport-and-universal-search-preview"
REIMPORT_DRY_RUN_SCHEMA_VERSION = "collected_notice_reimport_dry_run.v1"
SOURCE_TRUTH_PREVIEW_SCHEMA_VERSION = "collected_notice_source_truth_preview.v1"
SEARCHABLE_PREVIEW_SCHEMA_VERSION = "collected_notice_searchable_preview.v1"
SEARCHABLE_UNIT_SCHEMA_VERSION = "collected_notice_searchable_unit.v1"
SEARCHABLE_COVERAGE_SCHEMA_VERSION = "collected_notice_searchable_coverage_report.v1"
INVALID_DEFER_MULTIMODAL_SCHEMA_VERSION = (
    "collected_notice_invalid_defer_requires_multimodal_report.v1"
)
SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES = ("notice", FILE_RELEASE_SOURCE_SURFACE)
DEFAULT_PREVIEW_ADMISSION_BATCH_ID = "phase-04-dry-run-searchable-preview"
SEARCH_TEXT_MAX_CHARS = 2_000
BODY_TEXT_MAX_CHARS = 8_000


@dataclass(frozen=True, slots=True)
class CollectedNoticeCapturedRunRef:
    run_id: str
    source_surface: str
    source_bucket: str
    bundle_object_key: str
    manifest_object_key: str
    bundle_content_sha256: str | None = None
    bundle_byte_size: int | None = None
    manifest_content_sha256: str | None = None
    manifest_byte_size: int | None = None
    site_id: str | None = None
    source_home_url: str | None = None
    notices_collected: int | None = None

    def __post_init__(self) -> None:
        for field_name in (
            "run_id",
            "source_surface",
            "source_bucket",
            "bundle_object_key",
            "manifest_object_key",
            "bundle_content_sha256",
            "manifest_content_sha256",
            "site_id",
            "source_home_url",
        ):
            value = getattr(self, field_name)
            if isinstance(value, str):
                object.__setattr__(self, field_name, value.strip() or None)
        for field_name in (
            "run_id",
            "source_surface",
            "source_bucket",
            "bundle_object_key",
            "manifest_object_key",
        ):
            if not getattr(self, field_name):
                raise ValueError(f"{field_name} is required")
        if self.source_surface not in SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES:
            raise ValueError(f"unsupported source_surface: {self.source_surface}")


@dataclass(frozen=True, slots=True)
class CollectedNoticeReimportPreview:
    reimport_plan: dict[str, Any]
    source_truth_preview: dict[str, Any]
    searchable_notice_preview: dict[str, Any]
    coverage_report: dict[str, Any]
    invalid_defer_multimodal_report: dict[str, Any]


@dataclass(frozen=True, slots=True)
class _PreparedPreviewItem:
    source_surface: str
    run_ref: CollectedNoticeCapturedRunRef
    source_identifier: str
    site_id: str
    source_corpus: str
    source_collection: str
    title: str
    published_at: str
    source_url: str
    source_home_url: str
    organization_name: str
    body_text: str
    content_blocks: tuple[dict[str, Any], ...]
    attachment_refs: tuple[dict[str, Any], ...]
    source_artifact_keys: dict[str, str]
    raw_asset_id: str
    raw_version_id: str
    document_id: str
    version_id: str
    content_hash: str
    revision_track: str
    canonical_markdown_object_key: str
    document_units_object_key: str
    processed_object_keys: tuple[str, ...]
    provider_response_object_key: str | None
    visibility_level: str
    visibility_scope: str | None
    entitlement_groups: tuple[str, ...]
    policy_projection_version: str
    source_object_refs: tuple[dict[str, Any], ...]
    multimodal_status: str
    reason_codes: tuple[str, ...]
    classification: dict[str, Any]


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
    prepared_items: list[_PreparedPreviewItem] = []
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
) -> tuple[_PreparedPreviewItem, ...]:
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
    items: list[_PreparedPreviewItem] = []
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
) -> tuple[_PreparedPreviewItem, ...]:
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
    items: list[_PreparedPreviewItem] = []
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
            attachment_refs=(
                {
                    "schema_version": "file_release_source_ref_preview.v1",
                    "attachment_ref_id": f"file_release:{prepared.file_release_id}",
                    "resource_role": "released_file",
                    "source_url": released_file_ref.get("source_url"),
                    "final_url": released_file_ref.get("final_url"),
                    "original_filename": released_file_ref.get("original_filename"),
                    "mime_type": released_file_ref.get("mime_type"),
                    "byte_size": released_file_ref.get("byte_size"),
                    "object_key": released_file_ref.get("object_key"),
                    "content_sha256": released_file_ref.get("content_sha256"),
                    "bucket": released_file_ref.get("bucket"),
                },
            ),
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
) -> _PreparedPreviewItem:
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
    return _PreparedPreviewItem(
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
    )


def _source_truth_candidate(
    item: _PreparedPreviewItem,
    *,
    bucket_source: str,
    bucket_derived: str,
) -> dict[str, Any]:
    return {
        "source_surface": item.source_surface,
        "source_channel": AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        "source_corpus": item.source_corpus,
        "source_collection": item.source_collection,
        "site_id": item.site_id,
        "source_identifier": item.source_identifier,
        "run_id": item.run_ref.run_id,
        "document": {
            "document_id": item.document_id,
            "revision_track": item.revision_track,
            "version_id": item.version_id,
            "source_url": item.source_url,
            "title": item.title,
            "published_at": item.published_at,
            "content_hash": item.content_hash,
            "document_units_object_ref": {
                "bucket": bucket_derived,
                "key": item.document_units_object_key,
                "role": "document_units",
            },
            "canonical_markdown_object_ref": {
                "bucket": bucket_derived,
                "key": item.canonical_markdown_object_key,
                "role": "canonical_markdown",
            },
            "processed_object_keys": list(item.processed_object_keys),
            "visibility_level": item.visibility_level,
            "entitlement_groups": list(item.entitlement_groups),
            "policy_projection_version": item.policy_projection_version,
        },
        "raw_asset": {
            "raw_asset_id": item.raw_asset_id,
            "raw_version_id": item.raw_version_id,
        },
        "source_truth_artifact_refs": [
            {"bucket": bucket_source, "key": key, "role": role}
            for role, key in sorted(item.source_artifact_keys.items())
        ],
        "source_object_refs": list(item.source_object_refs),
        "attachment_refs": list(item.attachment_refs),
        "multimodal_status": item.multimodal_status,
        "reason_codes": list(item.reason_codes),
    }


def _searchable_unit(
    item: _PreparedPreviewItem,
    *,
    generated_at: str,
    admission_batch_id: str,
) -> dict[str, Any]:
    search_text = _search_text(item)
    return {
        "schema_version": SEARCHABLE_UNIT_SCHEMA_VERSION,
        "unit_id": f"searchable:{item.source_surface}:{item.site_id}:{item.source_identifier}",
        "source_channel": AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        "source_surface": item.source_surface,
        "source_corpus": item.source_corpus,
        "source_collection": item.source_collection,
        "site_id": item.site_id,
        "source_notice_id": item.source_identifier,
        "source_document_id": item.document_id,
        "title": item.title,
        "published_at": item.published_at,
        "source_url": item.source_url,
        "source_home_url": item.source_home_url,
        "source_object_refs": list(item.source_object_refs),
        "run_provenance": {
            "run_id": item.run_ref.run_id,
            "bundle_object_key": item.run_ref.bundle_object_key,
            "manifest_object_key": item.run_ref.manifest_object_key,
            "replay_phase": PHASE_04_ID,
        },
        "body_text": item.body_text,
        "body_excerpt": item.body_text[:800],
        "attachment_refs": list(item.attachment_refs),
        "multimodal_status": item.multimodal_status,
        "search_text": search_text,
        "visibility_level": item.visibility_level,
        "entitlement_groups": list(item.entitlement_groups),
        "admission_batch_id": admission_batch_id,
        "normalized_markdown_object_key": item.canonical_markdown_object_key,
        "target_hints": _target_hints(item),
        "classification": dict(item.classification),
        "defer_reason_codes": [],
        "invalid_reason_codes": [],
        "reason_codes": list(item.reason_codes),
        "created_at": generated_at,
        "updated_at": generated_at,
    }


def _reimport_plan(
    *,
    selected_run_refs: Sequence[CollectedNoticeCapturedRunRef],
    source_truth_candidates: Sequence[dict[str, Any]],
    searchable_units: Sequence[dict[str, Any]],
    coverage_report: dict[str, Any],
    invalid_defer_multimodal_report: dict[str, Any],
    duplicate_skips: Sequence[dict[str, Any]],
    input_refs: dict[str, Any],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    source_artifact_object_count = sum(
        len(candidate["source_truth_artifact_refs"]) for candidate in source_truth_candidates
    )
    needs_multimodal_units = [
        unit for unit in searchable_units if unit["multimodal_status"] in {"pending", "failed"}
    ]
    admission_entries = [_admission_entry(unit) for unit in searchable_units]
    report_id = _report_id(selected_run_refs, searchable_units)
    return {
        "schema_version": REIMPORT_DRY_RUN_SCHEMA_VERSION,
        "report_id": report_id,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_04_ID,
        "input_refs": input_refs,
        "selection_policy": {
            "name": "verified-run-object-native-reimport-preview",
            "version": "phase4.v1",
            "source_surfaces": list(SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES),
        },
        "planned_writes": {
            "raw_asset_registry_rows": len(source_truth_candidates),
            "document_registry_rows": len(source_truth_candidates),
            "source_truth_inventory_rows": len(source_truth_candidates),
            "source_artifact_object_count": source_artifact_object_count,
            "derived_document_object_count": len(source_truth_candidates) * 2,
            "searchable_read_model_rows": len(searchable_units),
            "consumer_admission_candidate_rows": len(admission_entries),
        },
        "planned_deletes": {},
        "planned_updates": {},
        "planned_skips": [
            *list(invalid_defer_multimodal_report.get("invalid_captures") or ()),
            *list(duplicate_skips),
        ],
        "planned_defers": list(invalid_defer_multimodal_report.get("deferred_units") or ()),
        "planned_blocks": [
            {
                "unit_id": unit["unit_id"],
                "source_notice_id": unit["source_notice_id"],
                "source_surface": unit["source_surface"],
                "reason_codes": unit["reason_codes"],
            }
            for unit in needs_multimodal_units
        ],
        "counts": {
            "selected_run_count": len(selected_run_refs),
            "source_truth_candidate_count": len(source_truth_candidates),
            "searchable_unit_count": len(searchable_units),
            "invalid_capture_count": invalid_defer_multimodal_report["invalid_capture_count"],
            "needs_multimodal_count": invalid_defer_multimodal_report["needs_multimodal_count"],
            "duplicate_source_identity_skipped_count": len(duplicate_skips),
            "missing_searchable_unit_count": coverage_report["missing_searchable_unit_count"],
            "by_source_surface": dict(Counter(unit["source_surface"] for unit in searchable_units)),
        },
        "preconditions": [
            "write mode must consume this dry-run report as explicit manifest input",
            "Phase 5 must complete multimodal candidates before typed target replay",
            "operator must review invalid_capture rows before execution",
        ],
        "backup_requirements": {
            "database_tables": [
                "document_registry",
                "raw_asset_registry",
                "authenticated_notice_source_truth_inventory",
                "internal_notice_read_model",
                "notice_consumption_projection",
            ],
            "object_buckets": [DEFAULT_BUCKET_SOURCE, DEFAULT_BUCKET_DERIVED],
            "required_before_write": True,
        },
        "write_manifest_candidate": {
            "schema_version": "collected_notice_reimport_write_manifest_candidate.v1",
            "dry_run_report_id": report_id,
            "source_truth_candidates": list(source_truth_candidates),
            "searchable_units": list(searchable_units),
            "consumer_admission_candidates": admission_entries,
        },
        "verification_queries": [
            {
                "name": "source_truth_inventory_count_matches_preview",
                "expected_count": len(source_truth_candidates),
            },
            {
                "name": "searchable_unit_count_matches_preview",
                "expected_count": len(searchable_units),
            },
        ],
    }


def _coverage_report(
    *,
    prepared_items: Sequence[_PreparedPreviewItem],
    searchable_units: Sequence[dict[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    valid_keys = {
        _source_key(
            source_surface=item.source_surface,
            site_id=item.site_id,
            source_identifier=item.source_identifier,
        )
        for item in prepared_items
    }
    searchable_keys = {
        _source_key(
            source_surface=str(unit["source_surface"]),
            site_id=str(unit["site_id"]),
            source_identifier=str(unit["source_notice_id"]),
        )
        for unit in searchable_units
    }
    missing = tuple(sorted(valid_keys - searchable_keys))
    extra = tuple(sorted(searchable_keys - valid_keys))
    valid_count = len(valid_keys)
    return {
        "schema_version": SEARCHABLE_COVERAGE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "phase": PHASE_04_ID,
        "valid_captured_notice_count": valid_count,
        "searchable_unit_count": len(searchable_units),
        "coverage_ratio": (len(searchable_keys & valid_keys) / valid_count) if valid_count else 1.0,
        "missing_searchable_unit_count": len(missing),
        "extra_searchable_unit_count": len(extra),
        "duplicate_searchable_unit_count": len(searchable_units) - len(searchable_keys),
        "missing_searchable_units": list(missing),
        "extra_searchable_units": list(extra),
        "verdict": "passed" if not missing and not extra else "failed",
    }


def _invalid_defer_multimodal_report(
    *,
    invalid_captures: Sequence[dict[str, Any]],
    searchable_units: Sequence[dict[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    needs_multimodal_units = [
        _unit_summary(unit)
        for unit in searchable_units
        if unit["multimodal_status"] in {"pending", "failed"}
    ]
    deferred_units = [
        _unit_summary(unit) for unit in searchable_units if unit.get("defer_reason_codes")
    ]
    return {
        "schema_version": INVALID_DEFER_MULTIMODAL_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "phase": PHASE_04_ID,
        "invalid_capture_count": len(invalid_captures),
        "defer_count": len(deferred_units),
        "needs_multimodal_count": len(needs_multimodal_units),
        "invalid_captures": list(invalid_captures),
        "deferred_units": deferred_units,
        "needs_multimodal_units": needs_multimodal_units,
    }


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
    items: Sequence[_PreparedPreviewItem],
) -> tuple[tuple[_PreparedPreviewItem, ...], tuple[dict[str, Any], ...]]:
    latest_by_source_key: dict[str, _PreparedPreviewItem] = {}
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


def _content_blocks_body_text(content_blocks: Sequence[Mapping[str, Any]]) -> str:
    lines = []
    for block in content_blocks:
        role = str(block.get("block_role") or "").strip().lower()
        text = str(block.get("text_normalized") or block.get("text_raw") or "").strip()
        if not text or role == "title":
            continue
        lines.append(text)
    return "\n".join(lines).strip()


def _source_object_refs(
    *,
    run_ref: CollectedNoticeCapturedRunRef,
    source_artifact_keys: Mapping[str, str],
    attachment_refs: Sequence[Mapping[str, Any]],
    bucket_source: str,
) -> tuple[dict[str, Any], ...]:
    refs: list[dict[str, Any]] = [
        _object_ref(
            bucket=run_ref.source_bucket,
            key=run_ref.bundle_object_key,
            role="collector_bundle",
            sha256=run_ref.bundle_content_sha256,
            byte_size=run_ref.bundle_byte_size,
        ),
        _object_ref(
            bucket=run_ref.source_bucket,
            key=run_ref.manifest_object_key,
            role="collector_manifest",
            sha256=run_ref.manifest_content_sha256,
            byte_size=run_ref.manifest_byte_size,
        ),
    ]
    refs.extend(
        _object_ref(bucket=bucket_source, key=key, role=role)
        for role, key in sorted(source_artifact_keys.items())
    )
    for index, attachment_ref in enumerate(attachment_refs, start=1):
        object_key = _optional_text(attachment_ref.get("object_key"))
        if not object_key:
            continue
        refs.append(
            _object_ref(
                bucket=_optional_text(attachment_ref.get("bucket")) or bucket_source,
                key=object_key,
                role=str(attachment_ref.get("resource_role") or f"attachment:{index}"),
                sha256=_optional_text(
                    attachment_ref.get("content_sha256") or attachment_ref.get("sha256")
                ),
                byte_size=_optional_int(attachment_ref.get("byte_size")),
                extra={
                    "mime_type": _optional_text(attachment_ref.get("mime_type")),
                    "source_url": _optional_text(attachment_ref.get("source_url")),
                    "final_url": _optional_text(attachment_ref.get("final_url")),
                },
            )
        )
    return tuple(_dedupe_object_refs(refs))


def _object_ref(
    *,
    bucket: str,
    key: str,
    role: str,
    sha256: str | None = None,
    byte_size: int | None = None,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "bucket": bucket,
        "key": key,
        "role": role,
    }
    if sha256:
        payload["sha256"] = sha256
    if byte_size is not None:
        payload["byte_size"] = byte_size
    for extra_key, value in (extra or {}).items():
        if value not in {None, ""}:
            payload[extra_key] = value
    return payload


def _dedupe_object_refs(refs: Sequence[dict[str, Any]]) -> tuple[dict[str, Any], ...]:
    seen: set[tuple[str, str, str]] = set()
    deduped = []
    for ref in refs:
        key = (str(ref.get("bucket")), str(ref.get("key")), str(ref.get("role")))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(ref)
    return tuple(deduped)


def _resolve_multimodal_status(
    *,
    source_surface: str,
    body_text: str,
    attachment_refs: Sequence[Mapping[str, Any]],
) -> tuple[str, tuple[str, ...]]:
    reason_codes: list[str] = []
    if not body_text.strip():
        reason_codes.append("empty_body_text")
    if source_surface == FILE_RELEASE_SOURCE_SURFACE:
        reason_codes.append("released_file_text_extraction_pending")
    for attachment in attachment_refs:
        object_key = _optional_text(attachment.get("object_key"))
        mime_type = str(attachment.get("mime_type") or "").strip().lower()
        filename = str(
            attachment.get("original_filename") or attachment.get("source_url") or ""
        ).strip()
        role = str(attachment.get("resource_role") or "").strip().lower()
        if not object_key:
            reason_codes.append("attachment_object_missing")
        if (
            role == "inline_image"
            or mime_type.startswith("image/")
            or _has_suffix(
                filename,
                (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"),
            )
        ):
            reason_codes.append("image_attachment_pending_text_extraction")
        elif mime_type == "application/pdf" or _has_suffix(filename, (".pdf",)):
            reason_codes.append("pdf_attachment_pending_text_extraction")
        elif _is_office_like(mime_type=mime_type, filename=filename):
            reason_codes.append("office_attachment_pending_text_extraction")
    normalized_reason_codes = tuple(dict.fromkeys(reason_codes))
    if normalized_reason_codes:
        return "pending", normalized_reason_codes
    return "not_required", ()


def _search_text(item: _PreparedPreviewItem) -> str:
    values = [
        item.title,
        item.organization_name,
        item.source_identifier,
        item.published_at,
        item.source_url,
        item.body_text,
    ]
    for attachment in item.attachment_refs:
        values.extend(
            [
                str(attachment.get("anchor_text") or ""),
                str(attachment.get("original_filename") or ""),
                str(attachment.get("source_url") or ""),
                str(attachment.get("final_url") or ""),
            ]
        )
    return "\n".join(value.strip() for value in values if value and value.strip())[
        :SEARCH_TEXT_MAX_CHARS
    ]


def _target_hints(item: _PreparedPreviewItem) -> dict[str, Any]:
    classification_targets = list(item.classification.get("target_candidates") or ())
    return {
        "candidate_targets": classification_targets,
        "policy": "notice-family-classification.v1",
        "hint_strength": "classifier_route" if classification_targets else "none",
        "weak_keyword_targets": _weak_keyword_targets(item),
    }


def _weak_keyword_targets(item: _PreparedPreviewItem) -> list[str]:
    text = f"{item.title}\n{item.body_text}".lower()
    hints = []
    if any(token in text for token in ("班车", "校车", "通勤车", "发车", "时刻表")):
        hints.append("transport_schedule")
    if any(token in text for token in ("规章", "办法", "规定", "条例", "制度")):
        hints.append("regulation")
    if any(token in text for token in ("暂停", "恢复", "开放", "关闭", "停用", "启用")):
        hints.append("service_status")
    return list(dict.fromkeys(hints))


def _admission_entry(unit: Mapping[str, Any]) -> dict[str, Any]:
    consumption_class = (
        "needs_multimodal" if unit["multimodal_status"] == "pending" else "search_only"
    )
    return {
        "entry_id": f"notice:{unit['site_id']}:{unit['source_notice_id']}",
        "source_channel": unit["source_channel"],
        "source_surface": unit["source_surface"],
        "source_corpus": unit["source_corpus"],
        "source_collection": unit["source_collection"],
        "site_id": unit["site_id"],
        "source_notice_id": unit["source_notice_id"],
        "source_document_id": unit["source_document_id"],
        "source_url": unit["source_url"],
        "run_id": unit["run_provenance"]["run_id"],
        "source_object_refs": unit["source_object_refs"],
        "consumption_class": consumption_class,
        "target": None,
        "target_surface": None,
        "target_hints": unit["target_hints"],
        "multimodal_policy": "pending"
        if unit["multimodal_status"] == "pending"
        else "not_required",
        "reason_codes": unit["reason_codes"],
        "preconditions": ["phase5_multimodal_output"]
        if consumption_class == "needs_multimodal"
        else [],
        "searchable_unit_id": unit["unit_id"],
    }


def _input_refs(
    *,
    selected_run_refs: Sequence[CollectedNoticeCapturedRunRef],
    rejected_run_refs: Sequence[Mapping[str, Any]],
    input_inventory_path: str | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "selected_run_refs": [asdict(ref) for ref in selected_run_refs],
        "rejected_run_refs": list(rejected_run_refs),
    }
    if input_inventory_path:
        payload["captured_runs_inventory_path"] = input_inventory_path
    return payload


def _report_id(
    selected_run_refs: Sequence[CollectedNoticeCapturedRunRef],
    searchable_units: Sequence[Mapping[str, Any]],
) -> str:
    payload = {
        "runs": [asdict(ref) for ref in selected_run_refs],
        "units": [
            {
                "unit_id": unit["unit_id"],
                "source_notice_id": unit["source_notice_id"],
                "source_surface": unit["source_surface"],
            }
            for unit in searchable_units
        ],
    }
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    return f"collected-notice-reimport-preview-{digest}"


def _unit_summary(unit: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "unit_id": unit["unit_id"],
        "source_surface": unit["source_surface"],
        "source_notice_id": unit["source_notice_id"],
        "title": unit["title"],
        "source_url": unit["source_url"],
        "multimodal_status": unit["multimodal_status"],
        "reason_codes": unit["reason_codes"],
        "source_object_refs": unit["source_object_refs"],
    }


def _source_key(*, source_surface: str, site_id: str, source_identifier: str) -> str:
    return f"{source_surface}:{site_id}:{source_identifier}"


def _resolved_site_id(
    run_ref: CollectedNoticeCapturedRunRef,
    export_manifest: Mapping[str, Any],
    default_site_id: str,
) -> str:
    return (
        run_ref.site_id
        or _optional_text(export_manifest.get("site_id"))
        or _optional_text(export_manifest.get("site"))
        or default_site_id
    )


def _resolved_source_home_url(
    run_ref: CollectedNoticeCapturedRunRef,
    export_manifest: Mapping[str, Any],
    default_source_home_url: str,
) -> str:
    return (
        run_ref.source_home_url
        or _optional_text(export_manifest.get("source_home_url"))
        or default_source_home_url
    )


def _bucket_names(env: Mapping[str, str]) -> tuple[str, str]:
    try:
        return resolve_object_store_bucket_names(dict(env))
    except Exception:
        return DEFAULT_BUCKET_SOURCE, DEFAULT_BUCKET_DERIVED


def _visibility_level(metadata: Mapping[str, Any]) -> str:
    value = _optional_text(metadata.get("visibility_level"))
    if value:
        return value
    return "restricted" if _text_tuple(metadata.get("entitlement_groups")) else "public"


def _text_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        values = (value,)
    else:
        values = tuple(value) if isinstance(value, Sequence) else ()
    return tuple(str(item).strip() for item in values if str(item).strip())


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _has_suffix(value: str, suffixes: Sequence[str]) -> bool:
    normalized = value.lower()
    return any(normalized.endswith(suffix) for suffix in suffixes)


def _is_office_like(*, mime_type: str, filename: str) -> bool:
    if _has_suffix(filename, (".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx")):
        return True
    return any(
        token in mime_type
        for token in (
            "msword",
            "officedocument",
            "ms-excel",
            "ms-powerpoint",
            "spreadsheet",
            "presentation",
            "wordprocessing",
        )
    )


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
