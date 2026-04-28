from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    S3ObjectStoreWriter,
    apply_authorization_projection_metadata,
    collect_import_document_stats,
    load_metadata_from_bytes,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    list_existing_internal_notice_consumption_projection_entries,
)
from campus_ingestion_core.internal_notice_regulation_materialization_candidates import (
    CandidateAggregation as _CandidateAggregation,
)
from campus_ingestion_core.internal_notice_regulation_materialization_candidates import (
    InstitutionalRegulationMaterializationObjectStore,
)
from campus_ingestion_core.internal_notice_regulation_materialization_candidates import (
    build_projection_ready_aggregations as _build_projection_ready_aggregations,
)
from campus_ingestion_core.internal_notice_regulation_projection import (
    InternalNoticeRegulationProjectionContext,
    build_internal_notice_regulation_projected_document,
)
from campus_ingestion_core.internal_notice_regulation_projection import (
    build_institutional_regulation_document_id as _build_institutional_regulation_document_id,
)
from campus_ingestion_core.internal_notice_regulation_projection import (
    build_institutional_regulation_version_id as _build_institutional_regulation_version_id,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationCandidateArtifactDocument,
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.object_store import build_raw_asset_key
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings

_TARGET_SCOPE = ("regulations", "institutional_rules")
_TARGET_SOURCE_FILENAME = "internal-notice-regulation-promotion-manifest.json"
_TARGET_IMPORT_SOURCE = "internal_notice_regulation_materialization"
_TARGET_PARSER_VERSION = "internal_notice_regulation_materialization_v1"
_SOURCE_URL_PREFIX = "campusrag://promotion/internal_notice"
_DATE_YEAR_RE = re.compile(r"(19|20)\d{2}")


@dataclass(frozen=True, slots=True)
class InstitutionalRegulationMaterializationReport:
    promotion_candidate_count: int
    materialized_document_count: int
    created_document_ids: tuple[str, ...]
    updated_document_ids: tuple[str, ...]
    source_notice_ids: tuple[str, ...]
    source_document_ids: tuple[str, ...]
    raw_asset_id: str
    raw_version_id: str


def materialize_institutional_regulations_from_internal_notice_scope(
    *,
    request: InternalNoticeRegulationPromotionRequest | None = None,
    env: Mapping[str, str] | None = None,
    object_store: InstitutionalRegulationMaterializationObjectStore | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    consumption_projection_store: NoticeConsumptionProjectionStore | None = None,
) -> InstitutionalRegulationMaterializationReport:
    source = dict(env if env is not None else os.environ)
    runtime_request = request or InternalNoticeRegulationPromotionRequest()
    runtime_object_store = object_store or S3ObjectStoreWriter(ObjectStoreSettings.from_env(source))
    runtime_registry = registry or build_document_registry_from_env(source)
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    if consumption_projection_store is not None:
        runtime_consumption_projection_store = consumption_projection_store
    else:
        runtime_consumption_projection_store = build_notice_consumption_projection_store_from_env(
            source
        )
    object_store_settings = ObjectStoreSettings.from_env(source)
    selected_request = bool(runtime_request.notice_ids or runtime_request.document_ids)
    projection_entries = list_existing_internal_notice_consumption_projection_entries(
        runtime_consumption_projection_store,
        request=runtime_request,
    )
    ready_projection_entries = tuple(
        entry
        for entry in projection_entries
        if entry.target_surface == NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES
        and entry.primary_role == NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
        and (entry.source_document_id or entry.source_notice_document_id)
    )
    source_record_by_lineage = _index_latest_scope_records(
        runtime_registry.list_by_scope(runtime_request.corpus, runtime_request.collection)
    )
    aggregations = _build_projection_ready_aggregations(
        projection_entries=ready_projection_entries,
        source_record_by_lineage=source_record_by_lineage,
        object_store=runtime_object_store,
        bucket_derived=object_store_settings.bucket_derived,
    )
    if not aggregations:
        if not selected_request:
            runtime_registry.replace_scope(_TARGET_SCOPE[0], _TARGET_SCOPE[1], ())
        return InstitutionalRegulationMaterializationReport(
            promotion_candidate_count=0,
            materialized_document_count=0,
            created_document_ids=(),
            updated_document_ids=(),
            source_notice_ids=(),
            source_document_ids=(),
            raw_asset_id="",
            raw_version_id="",
        )

    raw_asset_record = _build_materialization_raw_asset_record(aggregations=aggregations)
    runtime_raw_asset_registry.upsert(raw_asset_record)
    documents = build_institutional_regulation_scope_refresh_documents(
        raw_asset_record=raw_asset_record,
        aggregations=aggregations,
        object_store=runtime_object_store,
        bucket_derived=object_store_settings.bucket_derived,
    )
    materialized_document_ids = tuple(
        str(document.metadata["document_id"]) for document in documents
    )
    stats = collect_import_document_stats(
        documents=documents,
        registry=runtime_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        writer=runtime_object_store,
        object_store=object_store_settings,
        parser_version=_TARGET_PARSER_VERSION,
        embedding_model=_read_embedding_model_name(source),
        cleaning_policy_version=load_runtime_profile(*_TARGET_SCOPE).cleaning_policy_version,
        default_visibility_scope=None,
        scope_refresh=_TARGET_SCOPE,
        scope_refresh_preserve_existing=_build_selected_scope_preserve_predicate(
            materialized_document_ids
        )
        if selected_request
        else None,
    )
    return InstitutionalRegulationMaterializationReport(
        promotion_candidate_count=len(aggregations),
        materialized_document_count=len(documents),
        created_document_ids=stats.created_document_ids,
        updated_document_ids=stats.updated_document_ids,
        source_notice_ids=tuple(
            sorted(
                {
                    notice_id
                    for aggregation in aggregations
                    for notice_id in _aggregate_notice_ids(aggregation)
                }
            )
        ),
        source_document_ids=tuple(
            sorted(aggregation.primary_candidate.source_document_id for aggregation in aggregations)
        ),
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
    )


def build_institutional_regulation_scope_refresh_documents(
    *,
    raw_asset_record: RawAssetRecord,
    aggregations: Sequence[_CandidateAggregation],
    object_store: InstitutionalRegulationMaterializationObjectStore,
    bucket_derived: str,
    corpus: str = _TARGET_SCOPE[0],
    collection: str = _TARGET_SCOPE[1],
) -> list[DocumentImportInput]:
    documents: list[DocumentImportInput] = []
    for aggregation in aggregations:
        source_page_start, source_page_end = _load_source_page_bounds(
            object_store=object_store,
            bucket_derived=bucket_derived,
            source_record=aggregation.source_record,
        )
        projected_document = build_internal_notice_regulation_projected_document(
            candidate_document=aggregation.primary_candidate,
            context=InternalNoticeRegulationProjectionContext(
                source_notice_ids=_aggregate_notice_ids(aggregation),
                source_document_ids=tuple(
                    sorted(
                        {
                            aggregation.primary_candidate.source_document_id,
                            *(report.document_id for report in aggregation.duplicate_reports),
                        }
                    )
                ),
                source_parent_document_ids=tuple(
                    sorted(
                        {
                            parent_document_id
                            for parent_document_id in (
                                aggregation.primary_candidate.source_parent_document_id,
                                *(
                                    report.source_parent_document_id
                                    for report in aggregation.duplicate_reports
                                ),
                            )
                            if parent_document_id
                        }
                    )
                ),
                source_attachment_ref_ids=tuple(
                    sorted(
                        {
                            attachment_ref_id
                            for attachment_ref_id in (
                                aggregation.primary_candidate.source_attachment_ref_id,
                                *(
                                    report.source_attachment_ref_id
                                    for report in aggregation.duplicate_reports
                                ),
                            )
                            if attachment_ref_id
                        }
                    )
                ),
                source_attachment_sha256s=tuple(
                    sorted(
                        {
                            attachment_sha256
                            for attachment_sha256 in (
                                aggregation.primary_candidate.source_attachment_sha256,
                                *(
                                    report.source_attachment_sha256
                                    for report in aggregation.duplicate_reports
                                ),
                            )
                            if attachment_sha256
                        }
                    )
                ),
                duplicate_source_document_ids=tuple(
                    sorted(report.document_id for report in aggregation.duplicate_reports)
                ),
                derived_from_raw_asset_id=aggregation.source_record.raw_asset.raw_asset_id
                if aggregation.source_record.raw_asset is not None
                else None,
                derived_from_raw_version_id=aggregation.source_record.raw_asset.raw_version_id
                if aggregation.source_record.raw_asset is not None
                else None,
                source_page_start=source_page_start,
                source_page_end=source_page_end,
                source_filename=raw_asset_record.source_filename,
            ),
        )
        materialized_title = _resolve_materialized_regulation_title(aggregation.primary_candidate)
        loaded_metadata = load_metadata_from_bytes(projected_document.document_units_bytes)
        loaded_metadata.update(projected_document.metadata)
        loaded_metadata["title"] = materialized_title
        apply_authorization_projection_metadata(
            loaded_metadata,
            entitlement_groups=aggregation.source_record.entitlement_groups,
            visibility_scope=aggregation.source_record.visibility_scope,
            visibility_level=aggregation.source_record.visibility_level,
        )
        loaded_metadata["status"] = "active"
        documents.append(
            DocumentImportInput(
                source_label=f"{raw_asset_record.object_key}#{projected_document.document_id}",
                document_units_bytes=projected_document.document_units_bytes,
                provider_response_bytes=None,
                canonical_markdown_bytes=projected_document.canonical_markdown.encode("utf-8"),
                metadata=loaded_metadata,
                import_source=_TARGET_IMPORT_SOURCE,
                revision_track=aggregation.primary_candidate.revision_track,
                source_channel="manual_curated",
                is_current=True,
                corpus=corpus,
                collection=collection,
                visibility_scope=aggregation.source_record.visibility_scope,
                status="active",
                raw_path=None,
                raw_source_uri=raw_asset_record.raw_source_uri,
                raw_asset_id=raw_asset_record.raw_asset_id,
                raw_version_id=raw_asset_record.raw_version_id,
                provider_response_object_key=None,
                additional_processed_object_keys=(),
                title=materialized_title,
                year=_infer_year_label(aggregation.primary_candidate),
            )
        )
    return documents


def build_institutional_regulation_document_id(
    *,
    regulation_title_normalized: str,
    regulation_work_title: str | None = None,
    issuing_org: str,
    semantic_scope: str = "regulations/institutional_rules",
) -> str:
    return _build_institutional_regulation_document_id(
        regulation_title_normalized=regulation_title_normalized,
        regulation_work_title=regulation_work_title,
        issuing_org=issuing_org,
        semantic_scope=semantic_scope,
    )


def _resolve_materialized_regulation_title(
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
) -> str:
    return (
        candidate_document.regulation_work_title or candidate_document.regulation_title_normalized
    ).strip()


def build_institutional_regulation_version_id(
    *,
    semantic_content_hash: str,
    effective_date: str | None,
    revision_signal: str | None,
) -> str:
    return _build_institutional_regulation_version_id(
        semantic_content_hash=semantic_content_hash,
        effective_date=effective_date,
        revision_signal=revision_signal,
    )


def _build_materialization_raw_asset_record(
    *,
    aggregations: Sequence[_CandidateAggregation],
) -> RawAssetRecord:
    payload = [
        {
            "source_document_id": aggregation.primary_candidate.source_document_id,
            "candidate_id": aggregation.primary_candidate.candidate_id,
            "title": aggregation.primary_candidate.regulation_title_normalized,
            "effective_date": aggregation.primary_candidate.effective_date,
            "revision_signal": aggregation.primary_candidate.revision_signal,
            "notice_ids": _aggregate_notice_ids(aggregation),
        }
        for aggregation in aggregations
    ]
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    raw_asset_id = "asset:internal-notice-regulation-promotion"
    raw_version_id = f"sha256:{digest}"
    year = next(
        (
            _infer_year_label(aggregation.primary_candidate)
            for aggregation in aggregations
            if _infer_year_label(aggregation.primary_candidate) is not None
        ),
        None,
    )
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus=_TARGET_SCOPE[0],
        collection=_TARGET_SCOPE[1],
        raw_source_uri=f"{_SOURCE_URL_PREFIX}/materialization/{raw_version_id}",
        content_hash=digest,
        source_filename=_TARGET_SOURCE_FILENAME,
        object_key=build_raw_asset_key(
            corpus=_TARGET_SCOPE[0],
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            filename=_TARGET_SOURCE_FILENAME,
            source_channel="manual_curated",
            year=year,
        ),
        ingestion_timestamp=datetime.now(UTC).isoformat(),
        import_source=_TARGET_IMPORT_SOURCE,
    )


def _index_latest_scope_records(
    records: Sequence[DocumentRegistryRecord],
) -> dict[tuple[str, str], DocumentRegistryRecord]:
    latest: dict[tuple[str, str], DocumentRegistryRecord] = {}
    for record in records:
        key = (record.document_id, record.revision_track)
        current = latest.get(key)
        if current is None or _record_sort_key(record) > _record_sort_key(current):
            latest[key] = record
    return latest


def _record_sort_key(record: DocumentRegistryRecord) -> tuple[object, ...]:
    return (1 if record.is_current else 0, record.ingestion_timestamp, record.version_id)


def _aggregate_notice_ids(aggregation: _CandidateAggregation) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                aggregation.primary_candidate.notice_id,
                *(report.notice_id for report in aggregation.duplicate_reports),
            }
        )
    )


def _build_selected_scope_preserve_predicate(
    materialized_document_ids: Sequence[str],
) -> Callable[[DocumentRegistryRecord], bool]:
    materialized_document_id_set = set(materialized_document_ids)
    return lambda record: record.document_id not in materialized_document_id_set


def _load_source_page_bounds(
    *,
    object_store: InstitutionalRegulationMaterializationObjectStore,
    bucket_derived: str,
    source_record: DocumentRegistryRecord,
) -> tuple[int | None, int | None]:
    if source_record.document_units_object_key is None:
        return (None, None)
    try:
        payload = object_store.get_bytes(
            bucket=bucket_derived,
            key=source_record.document_units_object_key,
        ).decode("utf-8")
    except Exception:
        return (None, None)
    page_starts: list[int] = []
    page_ends: list[int] = []
    for line in payload.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        page_start = row.get("page_start")
        page_end = row.get("page_end")
        if isinstance(page_start, int):
            page_starts.append(page_start)
        if isinstance(page_end, int):
            page_ends.append(page_end)
    return (
        min(page_starts) if page_starts else None,
        max(page_ends) if page_ends else None,
    )


def _infer_year_label(candidate: InternalNoticeRegulationCandidateArtifactDocument) -> str | None:
    for value in (candidate.effective_date, candidate.source_notice_release_time):
        if value is None:
            continue
        match = _DATE_YEAR_RE.search(value)
        if match is not None:
            return match.group(0)
    return None


def _read_embedding_model_name(env: Mapping[str, str]) -> str:
    return str(env.get("EMBEDDING_MODEL") or "Qwen3-Embedding-4B")


__all__ = [
    "InstitutionalRegulationMaterializationReport",
    "build_institutional_regulation_document_id",
    "build_institutional_regulation_scope_refresh_documents",
    "build_institutional_regulation_version_id",
    "materialize_institutional_regulations_from_internal_notice_scope",
]
