from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    AuthenticatedNoticeAttachmentFetchStatusStore,
    build_attachment_fetch_status_records_from_bundle_records,
)
from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
)
from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
    DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL,
    DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
    DEFAULT_AUTHENTICATED_NOTICE_IMPORT_SOURCE,
    DEFAULT_AUTHENTICATED_NOTICE_PARSER_VERSION,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)
from campus_ingestion_core.authenticated_notice_import_assets import (
    _assert_attachment_blob_root_precondition,
    _content_type_for_artifact,
    _maybe_backfill_attachment_objects_for_import,
)
from campus_ingestion_core.authenticated_notice_import_env import (
    _build_attachment_fetch_status_store_from_env_if_configured,
    _build_consumption_projection_store_from_env_if_configured,
    _build_read_model_store_from_env_if_configured,
)
from campus_ingestion_core.authenticated_notice_import_env_presence import (
    env_has_attachment_fetch_status_config,
    env_has_consumption_projection_config,
    env_has_inventory_store_config,
    env_has_read_model_config,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    assert_authenticated_notice_import_source_shape as _assert_authenticated_notice_import_source_shape,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    assert_consumer_admission_gate_allows_projection as _assert_consumer_admission_gate_allows_projection,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    assert_consumer_admission_gate_allows_read_model as _assert_consumer_admission_gate_allows_read_model,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    build_authenticated_notice_import_admission_report as _build_authenticated_notice_import_admission_report,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    build_inventory_store_from_env_if_configured as _build_inventory_store_from_env_if_configured,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    load_authenticated_notice_import_payload as _load_authenticated_notice_import_payload,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    load_bundle_payload as _load_bundle_payload,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    load_consumer_admission_manifest_if_needed as _load_consumer_admission_manifest_if_needed,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    load_optional_json as _load_optional_json,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    manifest_declares_full_scope_replace as _manifest_declares_full_scope_replace,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    normalize_import_mode as _normalize_import_mode,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    prepared_notice_ids as _prepared_notice_ids,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    resolve_selected_notice_ids_for_import as _resolve_selected_notice_ids_for_import,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    selected_notice_ids_from_export_manifest as _selected_notice_ids_from_export_manifest,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    should_materialize_internal_notice_consumption as _should_materialize_internal_notice_consumption,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    should_preserve_authenticated_notice_scope_record as _should_preserve_authenticated_notice_scope_record,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    typed_materialization_candidate_summary as _typed_materialization_candidate_summary,
)
from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
    read_authenticated_notice_notice_family_config_path,
)
from campus_ingestion_core.authenticated_notice_source_projections import (
    _load_json_payload,
    _load_jsonl_rows,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
)
from campus_ingestion_core.authenticated_notice_source_truth import (
    AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
    AuthenticatedNoticeSourceMaterial,
    prepare_authenticated_notice_source_material,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_parent_snapshot_from_payloads,
    inventory_entry_from_parent_snapshot,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    build_authenticated_notice_source_truth_inventory_store_from_env as build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    S3ObjectStoreWriter,
    apply_authorization_projection_metadata,
    collect_import_document_stats,
    utc_now,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    admitted_notice_ids_for_target_surface,
)
from campus_ingestion_core.internal_notice_consumption_projection import (
    NoticeConsumptionProjectionStore,
    rebuild_internal_notice_consumption_projection,
)
from campus_ingestion_core.internal_notice_read_model import (
    InternalNoticeReadModelStore,
    rebuild_internal_notice_read_model,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
)
from campus_ingestion_core.object_store import (
    build_raw_asset_key,
    build_source_provider_artifact_key,
    build_source_truth_artifact_key,
    is_source_object_key,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.scope_catalog import assert_known_scope
from campus_ingestion_core.settings import ObjectStoreSettings

AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN = "plan"
AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE = "admit_and_materialize"
_SUPPORTED_AUTHENTICATED_NOTICE_IMPORT_MODES = {
    AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
    AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
}


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeImportRequest:
    bundle_path: Path | None = None
    export_manifest_path: Path | None = None
    site_id: str = ""
    source_home_url: str = ""
    run_id: str | None = None
    source_bucket: str | None = None
    bundle_object_key: str | None = None
    manifest_object_key: str | None = None
    bundle_content_sha256: str | None = None
    bundle_byte_size: int | None = None
    manifest_content_sha256: str | None = None
    manifest_byte_size: int | None = None
    allow_local_fixture_import: bool = False
    collector_run_ledger_table: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE
    consumer_admission_manifest_path: Path | None = None
    attachment_blob_root: Path | None = None
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS
    collection: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTION
    default_entitlement_groups: tuple[str, ...] = DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS
    visibility_scope: str | None = DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE
    parser_version: str = DEFAULT_AUTHENTICATED_NOTICE_PARSER_VERSION
    embedding_model: str = DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL
    import_source: str = DEFAULT_AUTHENTICATED_NOTICE_IMPORT_SOURCE
    mode: str = AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN
    replace_scope: bool = False
    source_truth_only: bool = False

    def __post_init__(self) -> None:
        if self.bundle_path is not None:
            object.__setattr__(self, "bundle_path", Path(self.bundle_path))
        if self.export_manifest_path is not None:
            object.__setattr__(self, "export_manifest_path", Path(self.export_manifest_path))
        if self.consumer_admission_manifest_path is not None:
            object.__setattr__(
                self,
                "consumer_admission_manifest_path",
                Path(self.consumer_admission_manifest_path),
            )
        if self.attachment_blob_root is not None:
            object.__setattr__(self, "attachment_blob_root", Path(self.attachment_blob_root))
        object.__setattr__(
            self,
            "default_entitlement_groups",
            tuple(group.strip() for group in self.default_entitlement_groups if group.strip()),
        )
        object.__setattr__(self, "mode", _normalize_import_mode(self.mode))
        for field_name in (
            "run_id",
            "source_bucket",
            "bundle_object_key",
            "manifest_object_key",
            "bundle_content_sha256",
            "manifest_content_sha256",
            "collector_run_ledger_table",
        ):
            value = getattr(self, field_name)
            if isinstance(value, str):
                object.__setattr__(self, field_name, value.strip() or None)
        assert_known_scope(self.corpus, self.collection)
        if not self.site_id.strip():
            raise ValueError("site_id is required")
        if not self.source_home_url.strip():
            raise ValueError("source_home_url is required")
        _assert_authenticated_notice_import_source_shape(self)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticePreparedImport:
    notice_id: str
    raw_asset_id: str
    raw_version_id: str
    raw_record: RawAssetRecord
    capture_artifacts: dict[str, bytes]
    provider_artifacts: dict[str, bytes]
    source_truth_artifacts: dict[str, bytes]
    source_artifact_keys: dict[str, str]
    document_import: DocumentImportInput


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeBundleImportResult:
    notice_count: int
    notice_imports: tuple[AuthenticatedNoticePreparedImport, ...]


def prepare_authenticated_notice_bundle_records(
    *,
    request: AuthenticatedNoticeImportRequest,
    bundle_records: tuple[dict[str, Any], ...] | list[dict[str, Any]],
    export_manifest: dict[str, Any] | None = None,
) -> AuthenticatedNoticeBundleImportResult:
    runtime_profile = load_runtime_profile(request.corpus, request.collection)
    notice_family_config = load_authenticated_notice_notice_family_config(
        read_authenticated_notice_notice_family_config_path({})
    )
    prepared: list[AuthenticatedNoticePreparedImport] = []
    for bundle_record in bundle_records:
        material = prepare_authenticated_notice_source_material(
            bundle_record=bundle_record,
            export_manifest=export_manifest,
            site_id=request.site_id,
            source_home_url=request.source_home_url,
            notice_family_config=notice_family_config,
        )
        prepared.append(
            _prepare_notice_import(
                material=material,
                request=request,
                cleaning_policy_version=runtime_profile.cleaning_policy_version,
            )
        )
    return AuthenticatedNoticeBundleImportResult(
        notice_count=len(prepared),
        notice_imports=tuple(prepared),
    )


def load_authenticated_notice_bundle_payload(path: Path) -> tuple[dict[str, Any], ...]:
    return _load_bundle_payload(path)


def load_authenticated_notice_export_manifest(
    path: Path | None,
) -> dict[str, Any] | None:
    return _load_optional_json(path)


def import_authenticated_notice_bundle(
    request: AuthenticatedNoticeImportRequest,
) -> AuthenticatedNoticeBundleImportResult:
    export_manifest, bundle_payload = _load_authenticated_notice_import_payload(
        request=request,
        env=dict(os.environ),
        object_store=None,
    )
    return prepare_authenticated_notice_bundle_records(
        request=request,
        bundle_records=bundle_payload,
        export_manifest=export_manifest,
    )


def import_authenticated_notice_export(
    *,
    request: AuthenticatedNoticeImportRequest,
    env: dict[str, str] | None = None,
    object_store: S3ObjectStoreWriter | object | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    attachment_fetch_status_store: AuthenticatedNoticeAttachmentFetchStatusStore | None = None,
    consumption_projection_store: NoticeConsumptionProjectionStore | None = None,
    read_model_store: InternalNoticeReadModelStore | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    export_manifest, bundle_payload = _load_authenticated_notice_import_payload(
        request=request,
        env=source,
        object_store=object_store,
    )
    prepared = prepare_authenticated_notice_bundle_records(
        request=request,
        bundle_records=bundle_payload,
        export_manifest=export_manifest,
    )
    prepared_notice_ids = _prepared_notice_ids(prepared)
    manifest_selected_notice_ids = _selected_notice_ids_from_export_manifest(export_manifest)
    replace_scope = request.replace_scope or _manifest_declares_full_scope_replace(export_manifest)
    selected_notice_ids = _resolve_selected_notice_ids_for_import(
        replace_scope=replace_scope,
        manifest_selected_notice_ids=manifest_selected_notice_ids,
        prepared_notice_ids=prepared_notice_ids,
        notice_count=prepared.notice_count,
    )
    dry_run_report = _build_authenticated_notice_import_admission_report(
        request=request,
        prepared=prepared,
        bundle_payload=bundle_payload,
        selected_notice_ids=selected_notice_ids,
        replace_scope=replace_scope,
        source_truth_inventory_enabled=source_truth_inventory_store is not None
        or env_has_inventory_store_config(source),
        attachment_fetch_status_enabled=attachment_fetch_status_store is not None
        or env_has_attachment_fetch_status_config(source),
        consumption_projection_enabled=_should_materialize_internal_notice_consumption(
            request=request
        )
        and (
            consumption_projection_store is not None
            or env_has_consumption_projection_config(source)
        ),
        read_model_enabled=_should_materialize_internal_notice_consumption(request=request)
        and (read_model_store is not None or env_has_read_model_config(source)),
        consumer_admission_manifest_supplied=(
            request.consumer_admission_manifest_path is not None
            and _should_materialize_internal_notice_consumption(request=request)
        ),
    )
    if request.mode == AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN:
        return dry_run_report

    _assert_attachment_blob_root_precondition(
        request=request,
        export_manifest=export_manifest,
        bundle_records=bundle_payload,
    )
    object_store_settings = ObjectStoreSettings.from_env(source)
    writer = object_store or S3ObjectStoreWriter(object_store_settings)
    registry = document_registry or build_document_registry_from_env(source)
    raw_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    inventory_store = source_truth_inventory_store
    if inventory_store is None:
        inventory_store = _build_inventory_store_from_env_if_configured(source)
    fetch_status_store = attachment_fetch_status_store
    if fetch_status_store is None:
        fetch_status_store = _build_attachment_fetch_status_store_from_env_if_configured(source)

    raw_uploaded_count = 0
    raw_reused_count = 0
    for notice_import in prepared.notice_imports:
        existing_raw_record = raw_registry.get(
            notice_import.raw_record.raw_asset_id,
            notice_import.raw_record.raw_version_id,
        )
        if existing_raw_record is None:
            raw_registry.upsert(notice_import.raw_record)
            raw_uploaded_count += 1
        else:
            raw_reused_count += 1
        for artifact_path, payload in (
            list(notice_import.capture_artifacts.items())
            + list(notice_import.provider_artifacts.items())
            + list(notice_import.source_truth_artifacts.items())
        ):
            key = notice_import.source_artifact_keys[artifact_path]
            writer.put_bytes(
                bucket=object_store_settings.bucket_source,
                key=key,
                data=payload,
                content_type=_content_type_for_artifact(artifact_path),
            )

    attachment_object_backfill_summary = _maybe_backfill_attachment_objects_for_import(
        request=request,
        source=source,
        object_store=writer,
        notice_ids=tuple(notice_import.notice_id for notice_import in prepared.notice_imports),
    )

    runtime_profile = load_runtime_profile(request.corpus, request.collection)
    stats = collect_import_document_stats(
        documents=[notice_import.document_import for notice_import in prepared.notice_imports],
        registry=registry,
        raw_asset_registry=raw_registry,
        writer=writer,
        object_store=object_store_settings,
        parser_version=request.parser_version,
        embedding_model=request.embedding_model,
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        default_visibility_scope=request.visibility_scope,
        scope_refresh=((request.corpus, request.collection) if replace_scope else None),
        scope_refresh_preserve_existing=_should_preserve_authenticated_notice_scope_record,
    )
    if inventory_store is not None:
        config_path = read_authenticated_notice_source_projections_config_path(source)
        config = load_authenticated_notice_source_projections_config(config_path)
        inventory_entries = []
        for notice_import in prepared.notice_imports:
            translated = notice_import.document_import
            parent_record = registry.get(
                str(translated.metadata["document_id"]),
                translated.revision_track,
                str(translated.metadata["version_id"]),
            )
            if parent_record is None:
                raise ValueError(
                    "authenticated notice import failed to persist parent document before inventory sync: "
                    f"{translated.metadata['document_id']}"
                )
            parent_snapshot = build_authenticated_notice_source_truth_parent_snapshot_from_payloads(
                record=parent_record,
                raw_record=notice_import.raw_record,
                notice_manifest_key=notice_import.source_artifact_keys[
                    "source-truth/notice-manifest.json"
                ],
                content_blocks_key=notice_import.source_artifact_keys[
                    "source-truth/content-blocks.jsonl"
                ],
                attachment_refs_key=notice_import.source_artifact_keys[
                    "source-truth/attachment-refs.jsonl"
                ],
                source_artifact_keys=tuple(
                    key
                    for key in notice_import.source_artifact_keys.values()
                    if key and is_source_object_key(str(key))
                ),
                notice_manifest=_load_json_payload(
                    notice_import.source_truth_artifacts["source-truth/notice-manifest.json"]
                ),
                attachment_refs=_load_jsonl_rows(
                    notice_import.source_truth_artifacts["source-truth/attachment-refs.jsonl"]
                ),
                config=config,
                object_store=writer,
                object_store_settings=object_store_settings,
            )
            inventory_entries.append(inventory_entry_from_parent_snapshot(parent_snapshot))
        if replace_scope:
            inventory_store.replace_scope(
                request.corpus,
                request.collection,
                tuple(inventory_entries),
            )
        else:
            inventory_store.upsert_many(tuple(inventory_entries))
    prepared_consumer_notice_ids = tuple(
        notice_import.notice_id for notice_import in prepared.notice_imports
    )
    projection_store = None
    runtime_read_model_store = None
    consumer_admission_manifest = None
    consumer_projection_gate_report: dict[str, Any] | None = None
    consumer_read_model_gate_report: dict[str, Any] | None = None
    projection_entries = ()
    read_model_entries = ()
    if _should_materialize_internal_notice_consumption(request=request):
        projection_store = consumption_projection_store
        if projection_store is None:
            projection_store = _build_consumption_projection_store_from_env_if_configured(source)
        consumer_admission_manifest = _load_consumer_admission_manifest_if_needed(
            request=request,
            projection_store=projection_store,
            read_model_store=read_model_store,
            source=source,
        )
        consumer_projection_notice_ids = prepared_consumer_notice_ids
        if projection_store is not None:
            consumer_projection_gate_report = _assert_consumer_admission_gate_allows_projection(
                manifest=consumer_admission_manifest,
                request=request,
                selected_notice_ids=prepared_consumer_notice_ids,
                replace_scope=replace_scope,
            )
        if inventory_store is not None and projection_store is not None:
            projection_entries = rebuild_internal_notice_consumption_projection(
                request=InternalNoticeRegulationPromotionRequest(
                    corpus=request.corpus,
                    collection=request.collection,
                    notice_ids=consumer_projection_notice_ids,
                ),
                env=source,
                registry=registry,
                source_truth_inventory_store=inventory_store,
                object_store=writer,
                projection_store=projection_store,
            )
        runtime_read_model_store = read_model_store
        if projection_store is not None and runtime_read_model_store is None:
            runtime_read_model_store = _build_read_model_store_from_env_if_configured(source)
        read_model_admitted_notice_ids = (
            admitted_notice_ids_for_target_surface(
                consumer_admission_manifest,
                target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            )
            if consumer_admission_manifest is not None
            else prepared_consumer_notice_ids
        )
        read_model_admitted_notice_id_set = set(read_model_admitted_notice_ids)
        read_model_notice_ids = tuple(
            notice_id
            for notice_id in prepared_consumer_notice_ids
            if notice_id in read_model_admitted_notice_id_set
        )
        if runtime_read_model_store is not None and read_model_notice_ids:
            consumer_read_model_gate_report = _assert_consumer_admission_gate_allows_read_model(
                manifest=consumer_admission_manifest,
                request=request,
                selected_notice_ids=read_model_notice_ids,
                replace_scope=replace_scope,
            )
        if (
            inventory_store is not None
            and projection_store is not None
            and runtime_read_model_store is not None
            and read_model_notice_ids
        ):
            read_model_entries = rebuild_internal_notice_read_model(
                source_corpus=request.corpus,
                source_collection=request.collection,
                notice_ids=read_model_notice_ids,
                env=source,
                projection_store=projection_store,
                read_model_store=runtime_read_model_store,
                registry=registry,
                object_store=writer,
                bucket_derived=object_store_settings.bucket_derived,
            )
    result = {
        "mode": request.mode,
        "source_truth_only": request.source_truth_only,
        "write_enabled": True,
        "notice_count": prepared.notice_count,
        "created_document_ids": list(stats.created_document_ids),
        "updated_document_ids": list(stats.updated_document_ids),
        "skipped_document_ids": list(stats.skipped_document_ids),
        "raw_uploaded_count": raw_uploaded_count,
        "raw_reused_count": raw_reused_count,
        "scope_write_mode": "replace_scope" if replace_scope else "upsert_selected",
        "selected_notice_ids": list(selected_notice_ids),
        "admission_report": dry_run_report["admission_report"],
        "write_plan": dry_run_report["write_plan"],
        "errors": list(stats.errors),
    }
    if selected_notice_ids:
        result["selected_notices"] = _selected_notice_summaries(
            prepared=prepared,
            selected_notice_ids=selected_notice_ids,
        )
    if projection_store is not None:
        result["consumption_projection_entry_count"] = len(projection_entries)
        typed_materialization = _typed_materialization_candidate_summary(projection_entries)
        result["typed_materialization_candidate_count"] = typed_materialization["count"]
        result["typed_materialization_candidate_kind_counts"] = typed_materialization["kind_counts"]
    if runtime_read_model_store is not None:
        result["internal_notice_read_model_entry_count"] = len(read_model_entries)
    if consumer_projection_gate_report is not None:
        result["consumer_admission_projection_gate"] = consumer_projection_gate_report
    if consumer_read_model_gate_report is not None:
        result["consumer_admission_read_model_gate"] = consumer_read_model_gate_report
    if attachment_object_backfill_summary is not None:
        result["attachment_object_backfill"] = attachment_object_backfill_summary
    if fetch_status_store is not None:
        fetch_status_records = build_attachment_fetch_status_records_from_bundle_records(
            bundle_records=bundle_payload,
            site_id=request.site_id,
            observed_at=(export_manifest or {}).get("exported_at")
            if isinstance(export_manifest, dict)
            else None,
        )
        fetch_status_store.upsert_many(fetch_status_records)
        result["attachment_fetch_status_record_count"] = len(fetch_status_records)
    return result


def _selected_notice_summaries(
    *,
    prepared: AuthenticatedNoticeBundleImportResult,
    selected_notice_ids: tuple[str, ...],
) -> list[dict[str, str]]:
    selected = {notice_id for notice_id in selected_notice_ids if notice_id}
    summaries: list[dict[str, str]] = []
    for notice_import in prepared.notice_imports:
        notice_id = str(notice_import.notice_id).strip()
        if not notice_id or (selected and notice_id not in selected):
            continue
        title = str(notice_import.document_import.title or "").strip()
        item = {"notice_id": notice_id}
        if title:
            item["title"] = title
        summaries.append(item)
    return summaries


def _prepare_notice_import(
    *,
    material: AuthenticatedNoticeSourceMaterial,
    request: AuthenticatedNoticeImportRequest,
    cleaning_policy_version: str,
) -> AuthenticatedNoticePreparedImport:
    document_id = f"notice:{request.site_id}:{material.notice_id}"
    version_id = material.raw_version_id
    detail_key = build_raw_asset_key(
        corpus=request.corpus,
        raw_asset_id=material.raw_asset_id,
        raw_version_id=material.raw_version_id,
        filename="detail-response.json",
        source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        year=material.year,
    )
    source_artifact_keys: dict[str, str] = {
        "capture/list-response.json": build_raw_asset_key(
            corpus=request.corpus,
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="list-response.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=material.year,
        ),
        "capture/detail-response.json": detail_key,
        "capture/fetch-metadata.json": build_raw_asset_key(
            corpus=request.corpus,
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="fetch-metadata.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=material.year,
        ),
        "provider/normalized-notice.json": build_source_provider_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="normalized-notice.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            model_slug="bundle-import-v1",
            year=material.year,
        ),
        "provider/discovered-links.jsonl": build_source_provider_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="discovered-links.jsonl",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            model_slug="bundle-import-v1",
            year=material.year,
        ),
        "provider/attachment-observations.jsonl": build_source_provider_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="attachment-observations.jsonl",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            model_slug="bundle-import-v1",
            year=material.year,
        ),
        "source-truth/notice-manifest.json": build_source_truth_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="notice-manifest.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=material.year,
        ),
        "source-truth/content-blocks.jsonl": build_source_truth_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="content-blocks.jsonl",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=material.year,
        ),
        "source-truth/attachment-refs.jsonl": build_source_truth_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="attachment-refs.jsonl",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=material.year,
        ),
    }
    metadata: dict[str, Any] = {
        "document_id": document_id,
        "version_id": version_id,
        "source_url": material.source_uri,
        "source_id": document_id,
        "raw_page_start": None,
        "raw_page_end": None,
    }
    apply_authorization_projection_metadata(
        metadata,
        entitlement_groups=request.default_entitlement_groups,
        visibility_scope=request.visibility_scope,
        visibility_level="restricted" if request.default_entitlement_groups else "public",
        policy_projection_version=DEFAULT_POLICY_PROJECTION_VERSION,
    )
    document_import = DocumentImportInput(
        source_label=f"notice:{material.notice_id}",
        document_units_bytes=material.document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=material.canonical_markdown_bytes,
        metadata=metadata,
        import_source=request.import_source,
        revision_track="source-faithful",
        source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        is_current=False,
        corpus=request.corpus,
        collection=request.collection,
        visibility_scope=request.visibility_scope,
        raw_source_uri=material.source_uri,
        raw_asset_id=material.raw_asset_id,
        raw_version_id=material.raw_version_id,
        provider_response_object_key=source_artifact_keys["provider/normalized-notice.json"],
        additional_processed_object_keys=(
            source_artifact_keys["capture/list-response.json"],
            source_artifact_keys["capture/detail-response.json"],
            source_artifact_keys["capture/fetch-metadata.json"],
            source_artifact_keys["provider/discovered-links.jsonl"],
            source_artifact_keys["provider/attachment-observations.jsonl"],
            source_artifact_keys["source-truth/notice-manifest.json"],
            source_artifact_keys["source-truth/content-blocks.jsonl"],
            source_artifact_keys["source-truth/attachment-refs.jsonl"],
        ),
        title=material.title,
        year=material.year,
    )
    raw_record = RawAssetRecord(
        raw_asset_id=material.raw_asset_id,
        raw_version_id=material.raw_version_id,
        corpus=request.corpus,
        collection=request.collection,
        raw_source_uri=material.source_uri,
        content_hash=material.raw_version_id.split(":", 1)[1],
        source_filename="detail-response.json",
        object_key=detail_key,
        ingestion_timestamp=utc_now(),
        import_source=request.import_source,
    )
    return AuthenticatedNoticePreparedImport(
        notice_id=material.notice_id,
        raw_asset_id=material.raw_asset_id,
        raw_version_id=material.raw_version_id,
        raw_record=raw_record,
        capture_artifacts=material.capture_artifacts,
        provider_artifacts=material.provider_artifacts,
        source_truth_artifacts=material.source_truth_artifacts,
        source_artifact_keys=source_artifact_keys,
        document_import=document_import,
    )


__all__ = [
    "AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE",
    "AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN",
    "AuthenticatedNoticeBundleImportResult",
    "AuthenticatedNoticeImportRequest",
    "AuthenticatedNoticePreparedImport",
    "import_authenticated_notice_bundle",
    "import_authenticated_notice_export",
    "load_authenticated_notice_bundle_payload",
    "load_authenticated_notice_export_manifest",
    "prepare_authenticated_notice_bundle_records",
]
