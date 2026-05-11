from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    build_attachment_fetch_status_records_from_bundle_records,
)
from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
    resolve_authenticated_notice_collector_run_refs,
)
from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
)
from campus_ingestion_core.authenticated_notice_import_sources import (
    AuthenticatedNoticeImportObjectRefs,
    explicit_authenticated_notice_import_object_refs,
    load_authenticated_notice_import_payload_from_object_refs,
)
from campus_ingestion_core.authenticated_notice_source_projections import _load_jsonl_rows
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY,
    DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
    AuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    build_authenticated_notice_source_truth_inventory_store_from_env as build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_PROJECTION_REBUILD,
    CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    InternalNoticeConsumerAdmissionManifest,
    load_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.internal_notice_consumption_projection import (
    NoticeConsumptionProjectionStore,
)
from campus_ingestion_core.internal_notice_read_model import InternalNoticeReadModelStore
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    RAW_ASSET_REGISTRY_ENV_KEY,
    RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)

AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN = "plan"
AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE = "admit_and_materialize"
_SUPPORTED_AUTHENTICATED_NOTICE_IMPORT_MODES = {
    AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
    AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
}

_TYPED_MATERIALIZATION_TARGET_SURFACES = frozenset(
    (
        NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
        NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
    )
)


def load_consumer_admission_manifest_if_needed(
    *,
    request: Any,
    projection_store: NoticeConsumptionProjectionStore | None,
    read_model_store: InternalNoticeReadModelStore | None,
    source: dict[str, str],
) -> InternalNoticeConsumerAdmissionManifest | None:
    del source
    downstream_write_requested = projection_store is not None or read_model_store is not None
    if not downstream_write_requested:
        return None
    if request.consumer_admission_manifest_path is None:
        raise ValueError(
            "consumer admission manifest is required before authenticated notice "
            "projection/read-model materialization"
        )
    return load_internal_notice_consumer_admission_manifest(
        request.consumer_admission_manifest_path
    )


def should_materialize_internal_notice_consumption(*, request: Any) -> bool:
    return (
        not request.source_truth_only
        and request.corpus == DEFAULT_AUTHENTICATED_NOTICE_CORPUS
        and request.collection == DEFAULT_AUTHENTICATED_NOTICE_COLLECTION
    )


def assert_consumer_admission_gate_allows_projection(
    *,
    manifest: InternalNoticeConsumerAdmissionManifest | None,
    request: Any,
    selected_notice_ids: tuple[str, ...],
    replace_scope: bool,
) -> dict[str, Any]:
    report = check_internal_notice_consumer_admission_gate(
        manifest=manifest,
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_PROJECTION_REBUILD,
            source_corpus=request.corpus,
            source_collection=request.collection,
            selected_notice_ids=selected_notice_ids,
            scope_write_mode="replace_scope" if replace_scope else "upsert_selected",
        ),
    )
    if not report.allowed:
        raise ValueError(
            "consumer admission manifest gate blocked projection materialization: "
            + ", ".join(report.reason_codes)
        )
    return asdict(report)


def assert_consumer_admission_gate_allows_read_model(
    *,
    manifest: InternalNoticeConsumerAdmissionManifest | None,
    request: Any,
    selected_notice_ids: tuple[str, ...],
    replace_scope: bool,
) -> dict[str, Any]:
    report = check_internal_notice_consumer_admission_gate(
        manifest=manifest,
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
            source_corpus=request.corpus,
            source_collection=request.collection,
            selected_notice_ids=selected_notice_ids,
            scope_write_mode="replace_scope" if replace_scope else "upsert_selected",
        ),
    )
    if not report.allowed:
        raise ValueError(
            "consumer admission manifest gate blocked read-model materialization: "
            + ", ".join(report.reason_codes)
        )
    return asdict(report)


def typed_materialization_candidate_summary(entries: tuple[Any, ...]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    total = 0
    for entry in entries:
        if entry.consumption_status != NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET:
            continue
        if entry.target_surface not in _TYPED_MATERIALIZATION_TARGET_SURFACES:
            continue
        kind = typed_materialization_candidate_kind(entry)
        counts[kind] = counts.get(kind, 0) + 1
        total += 1
    return {
        "count": total,
        "kind_counts": dict(sorted(counts.items())),
    }


def typed_materialization_candidate_kind(entry: Any) -> str:
    metadata = dict(getattr(entry, "role_metadata", {}) or {})
    if entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE:
        return (
            str(metadata.get("service_status_candidate_kind") or "service_status").strip()
            or "service_status"
        )
    if entry.target_surface == NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE:
        return "special_service"
    if entry.target_surface == NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE:
        return "stable_contact"
    return str(entry.target_surface)


def normalize_import_mode(mode: str) -> str:
    normalized = str(mode or "").strip().lower().replace("-", "_")
    aliases = {
        "dry_run": AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
        "dryrun": AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
        "preview": AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
        "materialize": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
        "write": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
        "admit": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
        "admit_and_write": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in _SUPPORTED_AUTHENTICATED_NOTICE_IMPORT_MODES:
        raise ValueError(
            "unsupported authenticated notice import mode: "
            f"{mode!r}; expected one of {sorted(_SUPPORTED_AUTHENTICATED_NOTICE_IMPORT_MODES)}"
        )
    return normalized


def build_authenticated_notice_import_admission_report(
    *,
    request: Any,
    prepared: Any,
    bundle_payload: tuple[dict[str, Any], ...],
    selected_notice_ids: tuple[str, ...],
    replace_scope: bool,
    source_truth_inventory_enabled: bool,
    attachment_fetch_status_enabled: bool,
    consumption_projection_enabled: bool,
    read_model_enabled: bool,
    consumer_admission_manifest_supplied: bool = False,
) -> dict[str, Any]:
    attachment_ref_count = 0
    reference_only_attachment_ref_count = 0
    notices_with_attachments = 0
    empty_body_notice_count = 0
    for notice_import in prepared.notice_imports:
        attachment_refs = _load_jsonl_rows(
            notice_import.source_truth_artifacts["source-truth/attachment-refs.jsonl"]
        )
        attachment_ref_count += len(attachment_refs)
        if attachment_refs:
            notices_with_attachments += 1
        reference_only_attachment_ref_count += sum(
            1 for row in attachment_refs if not str(row.get("object_key") or "").strip()
        )
        content_blocks = _load_jsonl_rows(
            notice_import.source_truth_artifacts["source-truth/content-blocks.jsonl"]
        )
        body_blocks = [
            row
            for row in content_blocks
            if str(row.get("block_role") or "").strip().lower() != "title"
            and str(row.get("text_normalized") or "").strip()
        ]
        if not body_blocks:
            empty_body_notice_count += 1

    attachment_fetch_status_rows = 0
    if attachment_fetch_status_enabled:
        attachment_fetch_status_rows = len(
            build_attachment_fetch_status_records_from_bundle_records(
                bundle_records=bundle_payload,
                site_id=request.site_id,
                observed_at=None,
            )
        )

    source_artifact_object_count = sum(
        len(notice_import.source_artifact_keys) for notice_import in prepared.notice_imports
    )
    write_plan = {
        "raw_asset_registry_rows": prepared.notice_count,
        "document_registry_parent_rows": prepared.notice_count,
        "source_truth_inventory_rows": prepared.notice_count
        if source_truth_inventory_enabled
        else 0,
        "source_artifact_object_count": source_artifact_object_count,
        "derived_document_object_count": prepared.notice_count * 2,
        "attachment_fetch_status_rows": attachment_fetch_status_rows,
        "consumption_projection_rebuild": consumption_projection_enabled,
        "internal_notice_read_model_rebuild": read_model_enabled,
        "consumer_admission_manifest_supplied": consumer_admission_manifest_supplied,
    }
    admission_report = {
        "notice_count": prepared.notice_count,
        "selected_notice_count": len(selected_notice_ids),
        "selected_notice_ids": list(selected_notice_ids),
        "scope_write_mode": "replace_scope" if replace_scope else "upsert_selected",
        "replace_scope": replace_scope,
        "attachment_ref_count": attachment_ref_count,
        "reference_only_attachment_ref_count": reference_only_attachment_ref_count,
        "notices_with_attachments": notices_with_attachments,
        "empty_body_notice_count": empty_body_notice_count,
        "consumer_admission_manifest_supplied": consumer_admission_manifest_supplied,
    }
    return {
        "mode": request.mode,
        "source_truth_only": request.source_truth_only,
        "write_enabled": False,
        "notice_count": prepared.notice_count,
        "created_document_ids": [],
        "updated_document_ids": [],
        "skipped_document_ids": [],
        "raw_uploaded_count": 0,
        "raw_reused_count": 0,
        "scope_write_mode": "replace_scope" if replace_scope else "upsert_selected",
        "selected_notice_ids": list(selected_notice_ids),
        "admission_report": admission_report,
        "write_plan": write_plan,
        "errors": [],
    }


def build_inventory_store_from_env_if_configured(
    env: dict[str, str],
) -> AuthenticatedNoticeSourceTruthInventoryStore | None:
    operator_env_keys = (
        DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
        SHARED_POSTGRES_OPERATOR_ENV_KEY,
        DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
        RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
    )
    if any(env.get(key) for key in operator_env_keys):
        return build_authenticated_notice_source_truth_inventory_store_from_env(
            env,
            prefer_operator=True,
        )
    runtime_env_keys = (
        DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY,
        SHARED_POSTGRES_ENV_KEY,
        DOCUMENT_REGISTRY_ENV_KEY,
        RAW_ASSET_REGISTRY_ENV_KEY,
    )
    if any(env.get(key) for key in runtime_env_keys):
        return build_authenticated_notice_source_truth_inventory_store_from_env(env)
    return None


def should_preserve_authenticated_notice_scope_record(record: DocumentRegistryRecord) -> bool:
    return not str(record.document_id).startswith("notice:")


def selected_notice_ids_from_export_manifest(
    export_manifest: dict[str, Any] | None,
) -> tuple[str, ...]:
    if not isinstance(export_manifest, dict):
        return ()
    filters = export_manifest.get("filters")
    if not isinstance(filters, dict):
        return ()
    return tuple(
        dict.fromkeys(
            str(item).strip()
            for item in filters.get("selected_notice_ids") or ()
            if str(item).strip()
        )
    )


def prepared_notice_ids(prepared: Any) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            str(notice_import.notice_id).strip()
            for notice_import in prepared.notice_imports
            if str(notice_import.notice_id).strip()
        )
    )


def resolve_selected_notice_ids_for_import(
    *,
    replace_scope: bool,
    manifest_selected_notice_ids: tuple[str, ...],
    prepared_notice_ids: tuple[str, ...],
    notice_count: int,
) -> tuple[str, ...]:
    if replace_scope:
        return ()
    if manifest_selected_notice_ids:
        missing_from_manifest = sorted(set(prepared_notice_ids) - set(manifest_selected_notice_ids))
        if missing_from_manifest:
            raise ValueError(
                "authenticated notice bounded import manifest selected_notice_ids must cover "
                "all bundle notice ids; missing: " + ", ".join(missing_from_manifest)
            )
        return prepared_notice_ids
    if notice_count and not prepared_notice_ids:
        raise ValueError("authenticated notice bounded import requires derivable notice ids")
    return prepared_notice_ids


def manifest_declares_full_scope_replace(export_manifest: dict[str, Any] | None) -> bool:
    if not isinstance(export_manifest, dict):
        return False
    containers: list[dict[str, Any]] = [export_manifest]
    for key in ("source_truth_import", "source_truth", "import"):
        value = export_manifest.get(key)
        if isinstance(value, dict):
            containers.append(value)
    for container in containers:
        if container.get("replace_scope") is True:
            return True
        for key in ("scope_write_mode", "scope_refresh", "source_truth_scope"):
            value = str(container.get(key) or "").strip().lower()
            if value in {
                "replace_scope",
                "full",
                "full_replace",
                "replace",
                "all",
            }:
                return True
    return False


def load_authenticated_notice_import_payload(
    *,
    request: Any,
    env: dict[str, str],
    object_store: object | None,
) -> tuple[dict[str, Any] | None, tuple[dict[str, Any], ...]]:
    object_refs = authenticated_notice_import_object_refs_from_request(
        request=request,
        env=env,
    )
    if object_refs is not None:
        loaded = load_authenticated_notice_import_payload_from_object_refs(
            refs=object_refs,
            env=env,
            object_store=object_store,
            bundle_label="authenticated notice bundle",
            manifest_label="authenticated notice export manifest",
        )
        return loaded.export_manifest, loaded.bundle_records
    return (
        load_optional_json(request.export_manifest_path),
        load_bundle_payload(request.bundle_path),
    )


def authenticated_notice_import_object_refs_from_request(
    *,
    request: Any,
    env: dict[str, str],
) -> AuthenticatedNoticeImportObjectRefs | None:
    if request.run_id:
        resolved = resolve_authenticated_notice_collector_run_refs(
            env=env,
            run_id=request.run_id,
            expected_source_surface="notice",
            table_name=request.collector_run_ledger_table
            or DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
        )
        return explicit_authenticated_notice_import_object_refs(
            source_bucket=resolved.source_bucket,
            bundle_object_key=resolved.bundle_object_key,
            manifest_object_key=resolved.manifest_object_key,
            bundle_content_sha256=resolved.bundle_content_sha256,
            bundle_byte_size=resolved.bundle_byte_size,
            manifest_content_sha256=resolved.manifest_content_sha256,
            manifest_byte_size=resolved.manifest_byte_size,
            run_id=resolved.run_id,
        )
    if request.source_bucket or request.bundle_object_key or request.manifest_object_key:
        return explicit_authenticated_notice_import_object_refs(
            source_bucket=request.source_bucket,
            bundle_object_key=request.bundle_object_key,
            manifest_object_key=request.manifest_object_key,
            bundle_content_sha256=request.bundle_content_sha256,
            bundle_byte_size=request.bundle_byte_size,
            manifest_content_sha256=request.manifest_content_sha256,
            manifest_byte_size=request.manifest_byte_size,
        )
    return None


def assert_authenticated_notice_import_source_shape(request: Any) -> None:
    run_id_selected = request.run_id is not None
    object_ref_selected = any(
        value is not None
        for value in (
            request.source_bucket,
            request.bundle_object_key,
            request.manifest_object_key,
        )
    )
    local_selected = request.bundle_path is not None or request.export_manifest_path is not None
    selected_mode_count = sum((run_id_selected, object_ref_selected, local_selected))
    if selected_mode_count != 1:
        raise ValueError(
            "authenticated notice import requires exactly one input mode: "
            "run_id, object refs, or local fixture import"
        )
    if run_id_selected:
        return
    if object_ref_selected:
        explicit_authenticated_notice_import_object_refs(
            source_bucket=request.source_bucket,
            bundle_object_key=request.bundle_object_key,
            manifest_object_key=request.manifest_object_key,
            bundle_content_sha256=request.bundle_content_sha256,
            bundle_byte_size=request.bundle_byte_size,
            manifest_content_sha256=request.manifest_content_sha256,
            manifest_byte_size=request.manifest_byte_size,
        )
        return
    if request.bundle_path is None:
        raise ValueError("bundle_path is required for authenticated notice local fixture import")
    if not request.allow_local_fixture_import:
        raise ValueError(
            "--allow-local-fixture-import / allow_local_fixture_import is required for "
            "authenticated notice local fixture import"
        )


def load_bundle_payload(path: Path) -> tuple[dict[str, Any], ...]:
    if not path.exists():
        raise ValueError(f"bundle_path does not exist: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("authenticated notice bundle must be a JSON array")
    return tuple(item for item in payload if isinstance(item, dict))


def load_optional_json(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    if not path.exists():
        raise ValueError(f"export_manifest_path does not exist: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("export manifest must be a JSON object")
    return payload


__all__ = [
    "AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE",
    "AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN",
    "assert_authenticated_notice_import_source_shape",
    "assert_consumer_admission_gate_allows_projection",
    "assert_consumer_admission_gate_allows_read_model",
    "build_authenticated_notice_import_admission_report",
    "build_inventory_store_from_env_if_configured",
    "load_authenticated_notice_import_payload",
    "load_bundle_payload",
    "load_consumer_admission_manifest_if_needed",
    "load_optional_json",
    "manifest_declares_full_scope_replace",
    "normalize_import_mode",
    "prepared_notice_ids",
    "resolve_selected_notice_ids_for_import",
    "selected_notice_ids_from_export_manifest",
    "should_materialize_internal_notice_consumption",
    "should_preserve_authenticated_notice_scope_record",
    "typed_materialization_candidate_summary",
]
