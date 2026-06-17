from __future__ import annotations

import json
import os
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from campus_ingestion_core.authenticated_notice_closeout_staged_documents import (
    load_verified_closeout_run_document_record_pairs,
)
from campus_ingestion_core.authenticated_notice_closeout_store import (
    CloseoutStore,
    build_authenticated_notice_closeout_store_from_env,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    HIGH_RISK_NOTICE_LABELS,
    NOTICE_RISK_LABEL_BODY_ONLY,
    AuthenticatedNoticeSourceTruthInventoryStore,
    _aggregate_notice_risk_counts,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.internal_notice_chunking_validation_shared import (
    _ATTACHMENT_OCR_LANE,
    _ATTACHMENT_TEXT_LANE,
    _NOTICE_BODY_LANE,
    INTERNAL_NOTICE_SCOPE,
    InternalNoticeChunkValidationArtifactReader,
    InternalNoticeChunkValidationFailure,
    InternalNoticeNoticeRiskProfile,
    InternalNoticeScannedDocument,
    InternalNoticeValidationInputs,
    _derive_document_title,
    _load_rows,
    _require_document_units_key,
    _resolve_max_workers,
    _resolve_notice_id_from_document_id,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store_admin import S3ObjectStoreAdmin
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names


def _build_validation_inputs(
    *,
    env: dict[str, str] | None,
    registry: DocumentRegistry | None,
    object_store: InternalNoticeChunkValidationArtifactReader | None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None,
    preparation_run_id: str | None,
    closeout_run_id: str | None,
    closeout_store: CloseoutStore | None,
) -> InternalNoticeValidationInputs:
    source = dict(env if env is not None else os.environ)
    corpus, collection = INTERNAL_NOTICE_SCOPE
    if preparation_run_id and closeout_run_id:
        raise ValueError("preparation_run_id and closeout_run_id are mutually exclusive")
    runtime_registry = registry
    bucket_source, bucket_derived = resolve_object_store_bucket_names(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(
        ObjectStoreSettings.from_env(
            {
                **source,
                "OBJECT_STORE_BUCKET_SOURCE": bucket_source,
                "OBJECT_STORE_BUCKET_DERIVED": bucket_derived,
            }
        )
    )
    if preparation_run_id:
        raise ValueError(
            "preparation_run_id is no longer supported; use closeout_run_id or current scope"
        )
    if closeout_run_id:
        runtime_closeout_store = (
            closeout_store
            or build_authenticated_notice_closeout_store_from_env(
                source,
                prefer_operator=True,
            )
        )
        selected_records = tuple(
            pair.staged_record
            for pair in load_verified_closeout_run_document_record_pairs(
                run_id=closeout_run_id,
                closeout_store=runtime_closeout_store,
                expected_corpus=corpus,
                expected_collection=collection,
            )
        )
        records = selected_records
        missing_manifest_records = ()
        selection_mode: Literal["current_scope", "verified_closeout_run"] = "verified_closeout_run"
        resolved_closeout_run_id = closeout_run_id
    else:
        runtime_registry = runtime_registry or build_document_registry_from_env(
            source,
            prefer_operator=True,
        )
        records = tuple(runtime_registry.list_by_scope(corpus, collection))
        selected_records = _select_current_source_faithful_records(records)
        missing_manifest_records = ()
        selection_mode = "current_scope"
        resolved_closeout_run_id = None
    notice_risk_profiles, notice_risk_counts, high_risk_notice_count = _resolve_notice_risk_context(
        source=source,
        object_store=runtime_object_store,
        derived_bucket=bucket_derived,
        corpus=corpus,
        collection=collection,
        selected_records=selected_records,
        source_truth_inventory_store=source_truth_inventory_store,
        closeout_run_id=resolved_closeout_run_id,
        closeout_store=closeout_store,
    )
    return InternalNoticeValidationInputs(
        source=source,
        registry=runtime_registry,
        object_store=runtime_object_store,
        derived_bucket=bucket_derived,
        corpus=corpus,
        collection=collection,
        records=records,
        selected_records=selected_records,
        selection_mode=selection_mode,
        preparation_run_id=preparation_run_id,
        closeout_run_id=resolved_closeout_run_id,
        missing_manifest_records=missing_manifest_records,
        notice_risk_profiles=notice_risk_profiles,
        notice_risk_counts=notice_risk_counts,
        high_risk_notice_count=high_risk_notice_count,
    )


def _select_current_source_faithful_records(
    records: Sequence[DocumentRegistryRecord],
) -> tuple[DocumentRegistryRecord, ...]:
    grouped: dict[str, list[DocumentRegistryRecord]] = {}
    for record in records:
        grouped.setdefault(record.document_id, []).append(record)
    selected_records: list[DocumentRegistryRecord] = []
    for document_id in sorted(grouped):
        doc_records = grouped[document_id]
        preferred = [
            record
            for record in doc_records
            if record.is_current and record.revision_track == "source-faithful"
        ]
        if preferred:
            selected_records.append(max(preferred, key=lambda record: record.ingestion_timestamp))
            continue
        source_faithful = [
            record for record in doc_records if record.revision_track == "source-faithful"
        ]
        if source_faithful:
            selected_records.append(
                max(source_faithful, key=lambda record: record.ingestion_timestamp)
            )
    return tuple(selected_records)


def _scan_all_documents(
    *,
    inputs: InternalNoticeValidationInputs,
) -> tuple[InternalNoticeScannedDocument, ...]:
    if not inputs.selected_records:
        return ()
    max_workers = max(1, min(_resolve_max_workers(inputs.source), len(inputs.selected_records)))
    if max_workers == 1:
        return tuple(
            _scan_record(record=record, inputs=inputs) for record in inputs.selected_records
        )
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        return tuple(
            executor.map(
                lambda record: _scan_record(record=record, inputs=inputs), inputs.selected_records
            )
        )


def _scan_record(
    *,
    record: DocumentRegistryRecord,
    inputs: InternalNoticeValidationInputs,
) -> InternalNoticeScannedDocument:
    title = record.document_id
    lane = (
        _NOTICE_BODY_LANE
        if not record.document_id.startswith("notice_attachment:")
        else _ATTACHMENT_TEXT_LANE
    )
    notice_id = _resolve_notice_id_from_document_id(record.document_id)
    notice_risk_profile = inputs.notice_risk_profiles.get(notice_id)
    try:
        structured_jsonl_bytes = inputs.object_store.get_bytes(
            bucket=inputs.derived_bucket,
            key=_require_document_units_key(record),
        )
        rows = tuple(_load_rows(structured_jsonl_bytes))
        title = _derive_document_title(rows) or title
        lane = _resolve_document_lane(record=record, rows=rows)
    except Exception as exc:
        return InternalNoticeScannedDocument(
            title=title,
            lane=lane,
            notice_id=notice_id,
            notice_risk_profile=notice_risk_profile,
            record=record,
            rows=(),
            chunks=(),
            read_failure=InternalNoticeChunkValidationFailure(
                document_id=record.document_id,
                title=title,
                artifact_key=record.document_units_object_key,
                error=f"{type(exc).__name__}: {exc}",
            ),
        )
    try:
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_jsonl_bytes,
        )
    except Exception as exc:
        return InternalNoticeScannedDocument(
            title=title,
            lane=lane,
            notice_id=notice_id,
            notice_risk_profile=notice_risk_profile,
            record=record,
            rows=rows,
            chunks=(),
            chunk_failure=InternalNoticeChunkValidationFailure(
                document_id=record.document_id,
                title=title,
                artifact_key=record.document_units_object_key,
                error=f"{type(exc).__name__}: {exc}",
            ),
        )
    return InternalNoticeScannedDocument(
        title=title,
        lane=lane,
        notice_id=notice_id,
        notice_risk_profile=notice_risk_profile,
        record=record,
        rows=rows,
        chunks=chunks,
    )


def _resolve_document_lane(
    *,
    record: DocumentRegistryRecord,
    rows: Sequence[dict[str, object]],
) -> str:
    if not record.document_id.startswith("notice_attachment:"):
        return _NOTICE_BODY_LANE
    for row in rows:
        metadata = dict(row.get("metadata") or {})
        extraction_class = str(metadata.get("extraction_class") or "").strip()
        if extraction_class == "text_extractable":
            return _ATTACHMENT_TEXT_LANE
        if extraction_class == "ocr_required":
            return _ATTACHMENT_OCR_LANE
    raise ValueError(f"attachment extraction_class is required for {record.document_id}")


def _resolve_notice_risk_context(
    *,
    source: dict[str, str],
    object_store: InternalNoticeChunkValidationArtifactReader,
    derived_bucket: str,
    corpus: str,
    collection: str,
    selected_records: Sequence[DocumentRegistryRecord],
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None,
    closeout_run_id: str | None,
    closeout_store: CloseoutStore | None,
) -> tuple[dict[str, InternalNoticeNoticeRiskProfile], dict[str, int], int]:
    notice_ids = tuple(
        sorted(
            {
                notice_id
                for record in selected_records
                if (notice_id := _resolve_notice_id_from_document_id(record.document_id))
            }
        )
    )
    if not notice_ids:
        return {}, {}, 0
    if closeout_run_id:
        runtime_closeout_store = (
            closeout_store
            or build_authenticated_notice_closeout_store_from_env(
                source,
                prefer_operator=True,
            )
        )
        run = runtime_closeout_store.get_run(closeout_run_id)
        if (
            run is not None
            and str(getattr(run, "source_truth_inventory_object_key", "") or "").strip()
        ):
            profiles = _load_notice_risk_profiles_from_closeout_run(
                run_id=closeout_run_id,
                inventory_object_key=str(run.source_truth_inventory_object_key),
                object_store=object_store,
                derived_bucket=derived_bucket,
                notice_ids=notice_ids,
            )
            if profiles:
                return _summarize_notice_risk_profiles(profiles)
    runtime_inventory_store = source_truth_inventory_store
    if runtime_inventory_store is None:
        try:
            runtime_inventory_store = (
                build_authenticated_notice_source_truth_inventory_store_from_env(
                    source,
                    prefer_operator=True,
                )
            )
        except ValueError:
            runtime_inventory_store = None
    if runtime_inventory_store is None:
        return {}, {}, 0
    entries = runtime_inventory_store.list_by_scope(corpus, collection, notice_ids=notice_ids)
    profiles = {
        entry.notice_id: InternalNoticeNoticeRiskProfile(
            notice_id=entry.notice_id,
            notice_risk_label=str(entry.notice_risk_label or NOTICE_RISK_LABEL_BODY_ONLY),
            attachment_mix_score=int(entry.attachment_mix_score or 0),
            attachment_ref_count=int(entry.attachment_ref_count or 0),
            has_text_table_attachment=bool(entry.has_text_table_attachment),
            has_spatial_attachment=bool(entry.has_spatial_attachment),
            has_reference_only_attachment=bool(entry.has_reference_only_attachment),
        )
        for entry in entries
    }
    return _summarize_notice_risk_profiles(profiles)


def _load_notice_risk_profiles_from_closeout_run(
    *,
    run_id: str,
    inventory_object_key: str,
    object_store: InternalNoticeChunkValidationArtifactReader,
    derived_bucket: str,
    notice_ids: Sequence[str],
) -> dict[str, InternalNoticeNoticeRiskProfile]:
    payload = json.loads(
        object_store.get_bytes(bucket=derived_bucket, key=inventory_object_key).decode("utf-8")
    )
    if str(payload.get("run_id") or "") != run_id:
        raise ValueError(f"closeout frozen inventory run mismatch: {run_id}")
    selected_notice_ids = {str(item).strip() for item in notice_ids if str(item).strip()}
    profiles: dict[str, InternalNoticeNoticeRiskProfile] = {}
    for parent in tuple(payload.get("parents") or ()):
        notice_id = str(parent.get("notice_id") or "").strip()
        if not notice_id or (selected_notice_ids and notice_id not in selected_notice_ids):
            continue
        profiles[notice_id] = InternalNoticeNoticeRiskProfile(
            notice_id=notice_id,
            notice_risk_label=str(parent.get("notice_risk_label") or NOTICE_RISK_LABEL_BODY_ONLY),
            attachment_mix_score=int(parent.get("attachment_mix_score") or 0),
            attachment_ref_count=int(parent.get("attachment_ref_count") or 0),
            has_text_table_attachment=bool(parent.get("has_text_table_attachment")),
            has_spatial_attachment=bool(parent.get("has_spatial_attachment")),
            has_reference_only_attachment=bool(parent.get("has_reference_only_attachment")),
        )
    return profiles


def _summarize_notice_risk_profiles(
    profiles: dict[str, InternalNoticeNoticeRiskProfile],
) -> tuple[dict[str, InternalNoticeNoticeRiskProfile], dict[str, int], int]:
    notice_risk_counts = _aggregate_notice_risk_counts(
        tuple(profile.notice_risk_label for profile in profiles.values())
    )
    high_risk_notice_count = sum(
        1 for profile in profiles.values() if profile.notice_risk_label in HIGH_RISK_NOTICE_LABELS
    )
    return profiles, notice_risk_counts, high_risk_notice_count
