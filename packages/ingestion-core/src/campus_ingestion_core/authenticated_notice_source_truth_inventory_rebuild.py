from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from campus_ingestion_core.authenticated_notice_source_projections import (
    _find_processed_key,
    _load_json_payload,
    _load_jsonl_rows,
    build_authenticated_notice_attachment_routing_records,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory_postgres import (
    _list_document_registry_scope_records_for_inventory,
    _list_raw_asset_registry_scope_records_for_inventory,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory_shared import (
    AUTHENTICATED_NOTICE_SOURCE_TRUTH_BASE_WEIGHT,
    AUTHENTICATED_NOTICE_SOURCE_TRUTH_OCR_ATTACHMENT_WEIGHT,
    AUTHENTICATED_NOTICE_SOURCE_TRUTH_TEXT_ATTACHMENT_WEIGHT,
    HIGH_RISK_NOTICE_LABELS,
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryObjectStore,
    AuthenticatedNoticeSourceTruthInventoryStore,
    _aggregate_notice_risk_counts,
    _derive_notice_risk_label,
    _derive_source_home_url,
    _extract_notice_id_from_document_id,
    _normalize_non_empty_text,
    _normalize_notice_type_names,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.object_store import is_source_object_key
from campus_ingestion_core.raw_ingestion import S3ObjectStoreClient
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings


def build_authenticated_notice_source_truth_inventory_entries(
    *,
    corpus: str,
    collection: str,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    object_store: AuthenticatedNoticeSourceTruthInventoryObjectStore,
    object_store_settings: ObjectStoreSettings,
    source_projections_path=None,
    notice_ids: Sequence[str] = (),
    env: dict[str, str] | None = None,
) -> tuple[AuthenticatedNoticeSourceTruthInventoryEntry, ...]:
    config = _load_source_projections_config(
        source_projections_path=source_projections_path,
        env=env,
    )
    normalized_notice_ids = tuple(
        sorted({str(item).strip() for item in notice_ids if str(item).strip()})
    )
    notice_id_set = set(normalized_notice_ids)
    raw_by_key = {
        (record.raw_asset_id, record.raw_version_id): record
        for record in _list_raw_asset_registry_scope_records_for_inventory(
            raw_asset_registry,
            corpus=corpus,
            collection=collection,
        )
    }
    records = _list_document_registry_scope_records_for_inventory(
        document_registry,
        corpus=corpus,
        collection=collection,
    )
    if normalized_notice_ids:
        records = tuple(
            record
            for record in records
            if _extract_notice_id_from_document_id(record.document_id) in notice_id_set
        )
        found_notice_ids = {
            _extract_notice_id_from_document_id(record.document_id) for record in records
        }
        missing_notice_ids = tuple(
            notice_id for notice_id in normalized_notice_ids if notice_id not in found_notice_ids
        )
        if missing_notice_ids:
            raise ValueError(
                "authenticated notice source inventory notice_ids not found in registry scope: "
                + ", ".join(missing_notice_ids)
            )
    records = _select_latest_authenticated_notice_parent_records_for_inventory(
        records=tuple(
            record
            for record in records
            if record.source_channel == "authenticated_notice_portal"
            and _find_processed_key(record, "source-truth/notice-manifest.json") is not None
            and _find_processed_key(record, "source-truth/content-blocks.jsonl") is not None
            and _find_processed_key(record, "source-truth/attachment-refs.jsonl") is not None
        ),
        raw_by_key=raw_by_key,
    )
    entries: list[AuthenticatedNoticeSourceTruthInventoryEntry] = []
    for record in records:
        notice_manifest_key = _find_processed_key(record, "source-truth/notice-manifest.json")
        content_blocks_key = _find_processed_key(record, "source-truth/content-blocks.jsonl")
        attachment_refs_key = _find_processed_key(record, "source-truth/attachment-refs.jsonl")
        if notice_manifest_key is None or content_blocks_key is None or attachment_refs_key is None:
            continue
        if record.raw_asset is None:
            raise ValueError(
                f"authenticated notice source-truth parent missing raw asset: {record.document_id}"
            )
        raw_key = (record.raw_asset.raw_asset_id, record.raw_asset.raw_version_id)
        raw_record = raw_by_key.get(raw_key)
        if raw_record is None:
            raise ValueError(
                "authenticated notice source inventory requires persisted raw asset registry truth: "
                f"{raw_key[0]}/{raw_key[1]}"
            )
        parent_snapshot = build_authenticated_notice_source_truth_parent_snapshot(
            record=record,
            raw_record=raw_record,
            object_store=object_store,
            object_store_settings=object_store_settings,
            notice_manifest_key=notice_manifest_key,
            content_blocks_key=content_blocks_key,
            attachment_refs_key=attachment_refs_key,
            config=config,
        )
        entries.append(inventory_entry_from_parent_snapshot(parent_snapshot))
    return tuple(sorted(entries, key=lambda entry: entry.notice_id))


def _select_latest_authenticated_notice_parent_records_for_inventory(
    *,
    records: Sequence[DocumentRegistryRecord],
    raw_by_key: Mapping[tuple[str, str], RawAssetRecord],
) -> tuple[DocumentRegistryRecord, ...]:
    selected_by_notice_id: dict[str, DocumentRegistryRecord] = {}
    for record in records:
        notice_id = _extract_notice_id_from_document_id(record.document_id)
        existing = selected_by_notice_id.get(notice_id)
        if existing is None or _inventory_parent_sort_key(
            record=record, raw_by_key=raw_by_key
        ) > _inventory_parent_sort_key(record=existing, raw_by_key=raw_by_key):
            selected_by_notice_id[notice_id] = record
    return tuple(
        sorted(
            selected_by_notice_id.values(),
            key=lambda record: _extract_notice_id_from_document_id(record.document_id),
        )
    )


def _inventory_parent_sort_key(
    *,
    record: DocumentRegistryRecord,
    raw_by_key: Mapping[tuple[str, str], RawAssetRecord],
) -> tuple[bool, datetime, datetime, str]:
    raw_timestamp = datetime.min.replace(tzinfo=UTC)
    if record.raw_asset is not None:
        raw_record = raw_by_key.get(
            (record.raw_asset.raw_asset_id, record.raw_asset.raw_version_id)
        )
        if raw_record is not None:
            raw_timestamp = _parse_inventory_timestamp(raw_record.ingestion_timestamp)
    return (
        record.is_current,
        raw_timestamp,
        _parse_inventory_timestamp(record.ingestion_timestamp),
        record.version_id,
    )


def _parse_inventory_timestamp(value: str) -> datetime:
    normalized = str(value or "").strip()
    if not normalized:
        return datetime.min.replace(tzinfo=UTC)
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def rebuild_authenticated_notice_source_truth_inventory(
    *,
    request,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    object_store: AuthenticatedNoticeSourceTruthInventoryObjectStore | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
    inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    runtime_object_store_settings = object_store_settings or ObjectStoreSettings.from_env(source)
    runtime_document_registry = document_registry or build_document_registry_from_env(
        source,
        prefer_operator=True,
    )
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(
        source,
        prefer_operator=True,
    )
    runtime_object_store = object_store or S3ObjectStoreClient(runtime_object_store_settings)
    runtime_inventory_store = inventory_store
    if runtime_inventory_store is None:
        from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
            build_authenticated_notice_source_truth_inventory_store_from_env,
        )

        runtime_inventory_store = build_authenticated_notice_source_truth_inventory_store_from_env(
            source,
            prefer_operator=True,
        )
    entries = build_authenticated_notice_source_truth_inventory_entries(
        corpus=request.corpus,
        collection=request.collection,
        document_registry=runtime_document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        object_store=runtime_object_store,
        object_store_settings=runtime_object_store_settings,
        source_projections_path=getattr(request, "source_projections_path", None),
        notice_ids=getattr(request, "notice_ids", ()),
        env=source,
    )
    if getattr(request, "notice_ids", ()):
        runtime_inventory_store.upsert_many(entries)
    else:
        runtime_inventory_store.replace_scope(request.corpus, request.collection, entries)
    return {
        "corpus": request.corpus,
        "collection": request.collection,
        "selected_notice_ids": list(getattr(request, "notice_ids", ())),
        "notice_count": len(entries),
        "expected_document_count": sum(1 + entry.attachment_document_count for entry in entries),
        "expected_attachment_document_count": sum(
            entry.attachment_document_count for entry in entries
        ),
        "expected_ocr_candidate_count": sum(entry.ocr_required_count for entry in entries),
        "notice_risk_counts": _aggregate_notice_risk_counts(
            entry.notice_risk_label for entry in entries
        ),
        "high_risk_notice_count": sum(
            1 for entry in entries if entry.notice_risk_label in HIGH_RISK_NOTICE_LABELS
        ),
    }


def build_authenticated_notice_source_truth_parent_snapshot(
    *,
    record: DocumentRegistryRecord,
    raw_record: RawAssetRecord,
    object_store: AuthenticatedNoticeSourceTruthInventoryObjectStore,
    object_store_settings: ObjectStoreSettings,
    notice_manifest_key: str,
    content_blocks_key: str,
    attachment_refs_key: str,
    config,
) -> dict[str, Any]:
    notice_manifest = _load_json_payload(
        object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=notice_manifest_key,
        )
    )
    attachment_refs = _load_jsonl_rows(
        object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=attachment_refs_key,
        )
    )
    source_artifact_keys = tuple(
        key for key in record.processed_object_keys if key and is_source_object_key(str(key))
    )
    return build_authenticated_notice_source_truth_parent_snapshot_from_payloads(
        record=record,
        raw_record=raw_record,
        notice_manifest_key=notice_manifest_key,
        content_blocks_key=content_blocks_key,
        attachment_refs_key=attachment_refs_key,
        source_artifact_keys=source_artifact_keys,
        notice_manifest=notice_manifest,
        attachment_refs=attachment_refs,
        config=config,
        object_store=object_store,
        object_store_settings=object_store_settings,
    )


def build_authenticated_notice_source_truth_parent_snapshot_from_payloads(
    *,
    record: DocumentRegistryRecord,
    raw_record: RawAssetRecord,
    notice_manifest_key: str,
    content_blocks_key: str,
    attachment_refs_key: str,
    source_artifact_keys: Sequence[str],
    notice_manifest: dict[str, Any],
    attachment_refs: Sequence[dict[str, Any]],
    config,
    object_store: AuthenticatedNoticeSourceTruthInventoryObjectStore | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
) -> dict[str, Any]:
    site_id, notice_id = str(record.document_id).split(":")[1:3]
    attachment_ref_count = len(tuple(attachment_refs))
    owner_expectations = [
        dict(item)
        for item in (notice_manifest.get("owner_expectations") or ())
        if isinstance(item, dict)
    ]
    text_extractable_count = 0
    ocr_required_count = 0
    attachment_routing_records = build_authenticated_notice_attachment_routing_records(
        parent_document_id=record.document_id,
        attachment_refs=tuple(attachment_refs),
        config=config,
        object_store=object_store,
        object_store_settings=object_store_settings,
        parent_record=record,
    )
    attachment_projection_plans = tuple(
        dict(item) for item in attachment_routing_records if "materialization_policy" in item
    )
    terminal_attachment_outcomes = tuple(
        dict(item) for item in attachment_routing_records if "terminal_outcome" in item
    )
    for plan in attachment_projection_plans:
        classification = str(plan["classification"])
        if classification == "text_extractable":
            text_extractable_count += 1
        elif classification == "ocr_required":
            ocr_required_count += 1
    multimodal_processing_required_count = sum(
        1
        for plan in attachment_projection_plans
        if str(plan.get("classification") or "") == "multimodal_processing_required"
    )
    reference_only_count = sum(
        1
        for outcome in terminal_attachment_outcomes
        if str(outcome.get("classification") or "") == "reference_only"
    )
    unsupported_binary_count = sum(
        1
        for outcome in terminal_attachment_outcomes
        if str(outcome.get("classification") or "") == "unsupported_binary"
    )
    expected_attachment_documents = [
        dict(plan)
        for plan in attachment_projection_plans
        if str(plan["materialization_policy"]) == "required_document"
    ]
    source_home_url = _normalize_non_empty_text(
        notice_manifest.get("source_home_url")
    ) or _derive_source_home_url(record.source_uri)
    has_text_table_attachment = text_extractable_count > 0 or ocr_required_count > 0
    has_spatial_attachment = multimodal_processing_required_count > 0
    has_reference_only_attachment = reference_only_count > 0
    has_unsupported_binary_attachment = unsupported_binary_count > 0
    attachment_lane_count = sum(
        1
        for count in (
            text_extractable_count,
            ocr_required_count,
            multimodal_processing_required_count,
            reference_only_count,
            unsupported_binary_count,
        )
        if count > 0
    )
    attachment_mix_score = attachment_ref_count + max(0, attachment_lane_count - 1)
    notice_risk_label = _derive_notice_risk_label(
        attachment_ref_count=attachment_ref_count,
        has_text_table_attachment=has_text_table_attachment,
        has_spatial_attachment=has_spatial_attachment,
        has_reference_only_attachment=has_reference_only_attachment,
        has_unsupported_binary_attachment=has_unsupported_binary_attachment,
    )
    planning_weight = (
        AUTHENTICATED_NOTICE_SOURCE_TRUTH_BASE_WEIGHT
        + text_extractable_count * AUTHENTICATED_NOTICE_SOURCE_TRUTH_TEXT_ATTACHMENT_WEIGHT
        + ocr_required_count * AUTHENTICATED_NOTICE_SOURCE_TRUTH_OCR_ATTACHMENT_WEIGHT
    )
    return {
        "notice_id": notice_id,
        "site_id": site_id,
        "document_id": record.document_id,
        "record": _serialize_document_record(record),
        "raw_record": asdict(raw_record),
        "source_artifact_keys": [str(item) for item in source_artifact_keys if str(item).strip()],
        "notice_manifest_key": notice_manifest_key,
        "content_blocks_key": content_blocks_key,
        "attachment_refs_key": attachment_refs_key,
        "attachment_projection_plans": [dict(item) for item in attachment_projection_plans],
        "terminal_attachment_outcomes": [dict(item) for item in terminal_attachment_outcomes],
        "expected_attachment_documents": expected_attachment_documents,
        "attachment_document_count": len(expected_attachment_documents),
        "attachment_ref_count": attachment_ref_count,
        "owner_expectation_count": int(
            notice_manifest.get("owner_expectation_count") or len(owner_expectations)
        ),
        "owner_expectations": owner_expectations,
        "text_extractable_count": text_extractable_count,
        "ocr_required_count": ocr_required_count,
        "reference_only_count": reference_only_count,
        "multimodal_processing_required_count": multimodal_processing_required_count,
        "unsupported_binary_count": unsupported_binary_count,
        "notice_title": _normalize_non_empty_text(
            notice_manifest.get("notice_title_normalized")
            or notice_manifest.get("notice_title_raw")
        )
        or record.document_id,
        "notice_release_time": _normalize_non_empty_text(
            notice_manifest.get("notice_release_time")
        ),
        "notice_type_names": _normalize_notice_type_names(notice_manifest.get("notice_type_names")),
        "notice_risk_label": notice_risk_label,
        "attachment_mix_score": attachment_mix_score,
        "has_text_table_attachment": has_text_table_attachment,
        "has_spatial_attachment": has_spatial_attachment,
        "has_reference_only_attachment": has_reference_only_attachment,
        "has_unsupported_binary_attachment": has_unsupported_binary_attachment,
        "planning_weight": planning_weight,
        "source_home_url": source_home_url,
        "embedding_model": record.embedding_model,
    }


def inventory_entry_from_parent_snapshot(
    parent_snapshot: dict[str, Any],
) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    record = document_record_from_authenticated_notice_source_truth_parent_snapshot(parent_snapshot)
    return AuthenticatedNoticeSourceTruthInventoryEntry(
        corpus=record.corpus,
        collection=record.collection,
        notice_id=str(parent_snapshot["notice_id"]),
        site_id=str(parent_snapshot["site_id"]),
        document_id=str(parent_snapshot["document_id"]),
        revision_track=record.revision_track,
        version_id=record.version_id,
        raw_asset_id=str(parent_snapshot["raw_record"]["raw_asset_id"]),
        raw_version_id=str(parent_snapshot["raw_record"]["raw_version_id"]),
        source_home_url=str(parent_snapshot["source_home_url"]),
        embedding_model=str(parent_snapshot["embedding_model"]),
        notice_manifest_key=str(parent_snapshot["notice_manifest_key"]),
        content_blocks_key=str(parent_snapshot["content_blocks_key"]),
        attachment_refs_key=str(parent_snapshot["attachment_refs_key"]),
        attachment_document_count=int(parent_snapshot["attachment_document_count"]),
        attachment_ref_count=int(parent_snapshot.get("attachment_ref_count") or 0),
        text_extractable_count=int(parent_snapshot["text_extractable_count"]),
        ocr_required_count=int(parent_snapshot["ocr_required_count"]),
        reference_only_count=int(parent_snapshot["reference_only_count"]),
        multimodal_processing_required_count=int(
            parent_snapshot.get("multimodal_processing_required_count") or 0
        ),
        notice_risk_label=str(parent_snapshot.get("notice_risk_label") or "body_only"),
        attachment_mix_score=int(parent_snapshot.get("attachment_mix_score") or 0),
        has_text_table_attachment=bool(parent_snapshot.get("has_text_table_attachment", False)),
        has_spatial_attachment=bool(parent_snapshot.get("has_spatial_attachment", False)),
        has_reference_only_attachment=bool(
            parent_snapshot.get("has_reference_only_attachment", False)
        ),
        planning_weight=int(parent_snapshot["planning_weight"]),
        parent_snapshot=dict(parent_snapshot),
        unsupported_binary_count=int(parent_snapshot.get("unsupported_binary_count") or 0),
        has_unsupported_binary_attachment=bool(
            parent_snapshot.get("has_unsupported_binary_attachment", False)
        ),
    )


def document_record_from_authenticated_notice_source_truth_parent_snapshot(
    parent_snapshot: Mapping[str, Any],
) -> DocumentRegistryRecord:
    record_payload = dict(parent_snapshot["record"])
    processed_object_keys = tuple(
        str(item).strip()
        for item in record_payload.get("processed_object_keys") or ()
        if str(item).strip()
    ) or tuple(
        str(item).strip()
        for item in parent_snapshot.get("source_artifact_keys") or ()
        if str(item).strip()
    )
    return _document_record_from_authenticated_notice_source_truth_snapshot_payload(
        record_payload,
        processed_object_keys=processed_object_keys,
    )


def _document_record_from_authenticated_notice_source_truth_snapshot_payload(
    payload: Mapping[str, Any],
    *,
    processed_object_keys: Sequence[str],
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=str(payload["document_id"]),
        revision_track=str(payload["revision_track"]),
        version_id=str(payload["version_id"]),
        source_uri=str(payload["source_uri"]),
        content_hash=str(payload["content_hash"]),
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
        cleaning_policy_version=str(payload.get("cleaning_policy_version") or ""),
        entitlement_groups=tuple(str(item) for item in payload.get("entitlement_groups") or ()),
        visibility_scope=payload.get("visibility_scope"),
        visibility_level=str(payload.get("visibility_level") or ""),
        policy_projection_version=str(payload.get("policy_projection_version") or ""),
        status=str(payload.get("status") or "active"),
        ingestion_timestamp=str(payload.get("ingestion_timestamp") or ""),
        parser_version=str(payload.get("parser_version") or ""),
        embedding_model=str(payload.get("embedding_model") or ""),
        source_channel=str(payload.get("source_channel") or ""),
        is_current=bool(payload.get("is_current", False)),
        effective_date=payload.get("effective_date"),
        published_date=payload.get("published_date"),
        supersedes_version_id=payload.get("supersedes_version_id"),
        provenance_status=str(payload.get("provenance_status") or ""),
        raw_asset=None,
        source_observations=(),
        document_units_object_key=payload.get("document_units_object_key"),
        provider_response_object_key=payload.get("provider_response_object_key"),
        layout_elements_object_key=payload.get("layout_elements_object_key"),
        canonical_markdown_object_key=payload.get("canonical_markdown_object_key"),
        processed_object_keys=tuple(processed_object_keys),
        import_source=str(payload.get("import_source") or ""),
    )


def _load_source_projections_config(
    *,
    source_projections_path=None,
    env: dict[str, str] | None = None,
):
    config_path = source_projections_path
    if config_path is None:
        config_path = read_authenticated_notice_source_projections_config_path(
            env if env is not None else {}
        )
    return load_authenticated_notice_source_projections_config(config_path)


def _serialize_document_record(record: DocumentRegistryRecord) -> dict[str, Any]:
    return {
        "document_id": record.document_id,
        "revision_track": record.revision_track,
        "version_id": record.version_id,
        "source_uri": record.source_uri,
        "content_hash": record.content_hash,
        "corpus": record.corpus,
        "collection": record.collection,
        "cleaning_policy_version": record.cleaning_policy_version,
        "entitlement_groups": list(record.entitlement_groups),
        "visibility_scope": record.visibility_scope,
        "visibility_level": record.visibility_level,
        "policy_projection_version": record.policy_projection_version,
        "status": record.status,
        "ingestion_timestamp": record.ingestion_timestamp,
        "parser_version": record.parser_version,
        "embedding_model": record.embedding_model,
        "source_channel": record.source_channel,
        "is_current": record.is_current,
        "effective_date": record.effective_date,
        "published_date": record.published_date,
        "supersedes_version_id": record.supersedes_version_id,
        "provenance_status": record.provenance_status,
        "document_units_object_key": record.document_units_object_key,
        "provider_response_object_key": record.provider_response_object_key,
        "layout_elements_object_key": record.layout_elements_object_key,
        "canonical_markdown_object_key": record.canonical_markdown_object_key,
        "processed_object_keys": list(record.processed_object_keys),
        "import_source": record.import_source,
    }
