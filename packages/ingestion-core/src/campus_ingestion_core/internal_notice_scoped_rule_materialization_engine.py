from __future__ import annotations

import hashlib
import json
import os
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Protocol

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
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
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    list_existing_internal_notice_consumption_projection_entries,
    select_ready_target_document_ids,
)
from campus_ingestion_core.internal_notice_regulation_materialization import (
    _index_latest_scope_records,
    _load_source_page_bounds,
)
from campus_ingestion_core.internal_notice_regulation_projection import (
    build_institutional_regulation_document_id,
    build_institutional_regulation_version_id,
    normalize_internal_notice_projection_published_date,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticePromotionObjectStore,
    InternalNoticeRegulationPromotionDocumentReport,
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_promotion_manifest,
)
from campus_ingestion_core.internal_notice_regulation_promotion_artifacts import (
    _extract_candidate_promotion_body,
)
from campus_ingestion_core.internal_notice_scoped_rule_materialization_shared import (
    _SOURCE_URL_PREFIX,
    _TARGET_IMPORT_SOURCE,
    _TARGET_PARSER_VERSION,
    _TARGET_SCOPE,
    _TARGET_SOURCE_FILENAME,
    InternalNoticeScopedRuleCandidate,
    InternalNoticeScopedRuleMaterializationReport,
    _aggregate_notice_ids,
    _candidate_group_key,
    _detect_scoped_rule_nature,
    _extract_campus_site,
    _extract_cycle_year,
    _extract_force_status,
    _extract_school_unit_name,
    _infer_year_label,
    _read_embedding_model_name,
    _scoped_rule_sort_key,
    _ScopedRuleAggregation,
    _split_markdown_blocks,
    _strip_heading,
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


class ScopedRuleMaterializationObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


def materialize_scoped_rules_from_internal_notice_scope(
    *,
    request: InternalNoticeRegulationPromotionRequest | None = None,
    env: Mapping[str, str] | None = None,
    object_store: ScopedRuleMaterializationObjectStore | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    consumption_projection_store: NoticeConsumptionProjectionStore | None = None,
) -> InternalNoticeScopedRuleMaterializationReport:
    source = dict(env if env is not None else os.environ)
    runtime_request = request or InternalNoticeRegulationPromotionRequest()
    runtime_object_store = object_store or S3ObjectStoreWriter(ObjectStoreSettings.from_env(source))
    runtime_registry = registry or build_document_registry_from_env(source)
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    runtime_inventory = (
        source_truth_inventory_store
        or build_authenticated_notice_source_truth_inventory_store_from_env(source)
    )
    if consumption_projection_store is not None:
        runtime_consumption_projection_store = consumption_projection_store
    else:
        try:
            runtime_consumption_projection_store = (
                build_notice_consumption_projection_store_from_env(source)
            )
        except ValueError:
            runtime_consumption_projection_store = InMemoryNoticeConsumptionProjectionStore()
    object_store_settings = ObjectStoreSettings.from_env(source)
    projection_entries = list_existing_internal_notice_consumption_projection_entries(
        runtime_consumption_projection_store,
        request=runtime_request,
    )
    ready_document_ids = frozenset(
        select_ready_target_document_ids(
            projection_entries,
            target_surface=NOTICE_TARGET_SURFACE_SCOPED_RULES,
            primary_roles=(
                NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
                NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
            ),
        )
    )

    promotion_report = build_internal_notice_regulation_promotion_manifest(
        request=runtime_request,
        env=source,
        registry=runtime_registry,
        source_truth_inventory_store=runtime_inventory,
        object_store=runtime_object_store,
    )
    source_record_by_lineage = _index_latest_scope_records(
        runtime_registry.list_by_scope(runtime_request.corpus, runtime_request.collection)
    )
    notice_ids = tuple(sorted({report.notice_id for report in promotion_report.documents}))
    inventory_entries = runtime_inventory.list_by_scope(
        runtime_request.corpus,
        runtime_request.collection,
        notice_ids=notice_ids,
    )
    inventory_by_notice = {entry.notice_id: entry for entry in inventory_entries}
    bucket_derived = object_store_settings.bucket_derived

    candidates: list[InternalNoticeScopedRuleCandidate] = []
    report_by_document_id: dict[str, InternalNoticeRegulationPromotionDocumentReport] = {}
    for report in promotion_report.documents:
        document_nature = _detect_scoped_rule_nature(report)
        if document_nature is None:
            continue
        if report.document_id not in ready_document_ids:
            continue
        source_record = source_record_by_lineage.get((report.document_id, report.revision_track))
        if source_record is None:
            continue
        inventory_entry = inventory_by_notice.get(report.notice_id)
        candidate = _build_scoped_rule_candidate(
            report=report,
            source_record=source_record,
            inventory_entry=inventory_entry,
            object_store=runtime_object_store,
            bucket_derived=bucket_derived,
            document_nature=document_nature,
        )
        candidates.append(candidate)
        report_by_document_id[report.document_id] = report

    if not candidates:
        runtime_registry.replace_scope(_TARGET_SCOPE[0], _TARGET_SCOPE[1], ())
        return InternalNoticeScopedRuleMaterializationReport(
            scoped_rule_candidate_count=0,
            materialized_document_count=0,
            created_document_ids=(),
            updated_document_ids=(),
            document_nature_counts={},
            source_notice_ids=(),
            source_document_ids=(),
            raw_asset_id="",
            raw_version_id="",
        )

    nature_counts = Counter(candidate.document_nature for candidate in candidates)
    aggregations = _build_scoped_rule_aggregations(
        candidates=candidates,
        report_by_document_id=report_by_document_id,
        source_record_by_lineage=source_record_by_lineage,
    )
    raw_asset_record = _build_scoped_rule_raw_asset_record(aggregations=aggregations)
    runtime_raw_asset_registry.upsert(raw_asset_record)
    documents = build_scoped_rule_scope_refresh_documents(
        raw_asset_record=raw_asset_record,
        aggregations=aggregations,
        object_store=runtime_object_store,
        bucket_derived=bucket_derived,
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
    )
    return InternalNoticeScopedRuleMaterializationReport(
        scoped_rule_candidate_count=len(candidates),
        materialized_document_count=len(documents),
        created_document_ids=stats.created_document_ids,
        updated_document_ids=stats.updated_document_ids,
        document_nature_counts=dict(sorted(nature_counts.items())),
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


def build_scoped_rule_scope_refresh_documents(
    *,
    raw_asset_record: RawAssetRecord,
    aggregations: Sequence[_ScopedRuleAggregation],
    object_store: ScopedRuleMaterializationObjectStore,
    bucket_derived: str,
    corpus: str = _TARGET_SCOPE[0],
    collection: str = _TARGET_SCOPE[1],
) -> list[DocumentImportInput]:
    documents: list[DocumentImportInput] = []
    for aggregation in aggregations:
        candidate = aggregation.primary_candidate
        title = candidate.title
        canonical_markdown = f"# {title}\n\n{candidate.promotion_body.strip()}\n"
        semantic_content_hash = hashlib.sha256(canonical_markdown.encode("utf-8")).hexdigest()
        document_id = build_institutional_regulation_document_id(
            regulation_title_normalized=title,
            issuing_org=candidate.issuing_org or "中央民族大学",
            semantic_scope="regulations/scoped_rules",
        )
        version_id = build_institutional_regulation_version_id(
            semantic_content_hash=semantic_content_hash,
            effective_date=candidate.effective_date,
            revision_signal=candidate.revision_signal,
        )
        source_page_start, source_page_end = _load_source_page_bounds(
            object_store=object_store,
            bucket_derived=bucket_derived,
            source_record=aggregation.source_record,
        )
        metadata = _build_scoped_rule_projection_metadata(
            aggregation=aggregation,
            title=title,
            semantic_content_hash=semantic_content_hash,
            source_page_start=source_page_start,
            source_page_end=source_page_end,
        )
        document_units_bytes = _serialize_scoped_rule_rows(
            document_id=document_id,
            version_id=version_id,
            title=title,
            body=candidate.promotion_body,
            metadata=metadata,
            source_url=f"{_SOURCE_URL_PREFIX}/{candidate.source_document_id}",
            source_pdf=aggregation.source_record.source_uri.rsplit("/", 1)[-1],
            entitlement_groups=aggregation.source_record.entitlement_groups,
            visibility_scope=aggregation.source_record.visibility_scope,
            visibility_level=aggregation.source_record.visibility_level,
            page_start=source_page_start,
            page_end=source_page_end,
        )
        loaded_metadata = load_metadata_from_bytes(document_units_bytes)
        loaded_metadata.update(metadata)
        loaded_metadata["title"] = title
        apply_authorization_projection_metadata(
            loaded_metadata,
            entitlement_groups=aggregation.source_record.entitlement_groups,
            visibility_scope=aggregation.source_record.visibility_scope,
            visibility_level=aggregation.source_record.visibility_level,
        )
        loaded_metadata["status"] = "active"
        documents.append(
            DocumentImportInput(
                source_label=f"{raw_asset_record.object_key}#{document_id}",
                document_units_bytes=document_units_bytes,
                provider_response_bytes=None,
                canonical_markdown_bytes=canonical_markdown.encode("utf-8"),
                metadata=loaded_metadata,
                import_source=_TARGET_IMPORT_SOURCE,
                revision_track=candidate.revision_track,
                source_channel="manual_curated",
                is_current=aggregation.source_record.is_current,
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
                title=title,
                year=candidate.cycle_year or _infer_year_label(candidate),
            )
        )
    return documents


def _build_scoped_rule_candidate(
    *,
    report: InternalNoticeRegulationPromotionDocumentReport,
    source_record: DocumentRegistryRecord,
    inventory_entry: object,
    object_store: InternalNoticePromotionObjectStore,
    bucket_derived: str,
    document_nature: str,
) -> InternalNoticeScopedRuleCandidate:
    source_markdown = object_store.get_bytes(
        bucket=bucket_derived,
        key=source_record.canonical_markdown_object_key or "",
    ).decode("utf-8")
    promotion_body = _extract_candidate_promotion_body(
        source_markdown=source_markdown,
        report=report,
        inventory_entry=inventory_entry,
    )
    title = report.source_title or report.regulation_title_normalized
    combined_text = "\n".join(item for item in (title, promotion_body) if item)
    return InternalNoticeScopedRuleCandidate(
        source_document_id=report.document_id,
        notice_id=report.notice_id,
        site_id=report.site_id,
        source_kind=report.source_kind,
        input_lane=report.input_lane,
        revision_track=report.revision_track,
        version_id=report.version_id,
        document_nature=document_nature,
        title=title,
        issuing_org=report.issuing_org,
        effective_date=report.effective_date,
        revision_signal=report.revision_signal,
        source_notice_release_time=report.source_notice_release_time,
        source_parent_document_id=report.source_parent_document_id,
        source_attachment_ref_id=report.source_attachment_ref_id,
        source_attachment_sha256=report.source_attachment_sha256,
        duplicate_group_key=report.duplicate_group_key,
        source_uri=source_record.source_uri,
        entitlement_groups=source_record.entitlement_groups,
        visibility_scope=source_record.visibility_scope,
        visibility_level=source_record.visibility_level,
        is_current=source_record.is_current,
        reasons=report.reasons,
        promotion_body=promotion_body,
        cycle_year=_extract_cycle_year(combined_text),
        school_unit_name=_extract_school_unit_name(title),
        campus_site=_extract_campus_site(combined_text),
        force_status=_extract_force_status(combined_text),
    )


def _build_scoped_rule_aggregations(
    *,
    candidates: Sequence[InternalNoticeScopedRuleCandidate],
    report_by_document_id: Mapping[str, InternalNoticeRegulationPromotionDocumentReport],
    source_record_by_lineage: Mapping[tuple[str, str], DocumentRegistryRecord],
) -> tuple[_ScopedRuleAggregation, ...]:
    groups: dict[str, list[InternalNoticeScopedRuleCandidate]] = {}
    for candidate in candidates:
        key = _candidate_group_key(candidate)
        groups.setdefault(key, []).append(candidate)

    aggregations: list[_ScopedRuleAggregation] = []
    for group in groups.values():
        primary = min(group, key=_scoped_rule_sort_key)
        duplicate_candidates = tuple(
            sorted(
                (
                    candidate
                    for candidate in group
                    if candidate.source_document_id != primary.source_document_id
                ),
                key=lambda item: item.source_document_id,
            )
        )
        primary_report = report_by_document_id[primary.source_document_id]
        duplicate_reports = tuple(
            report_by_document_id[candidate.source_document_id]
            for candidate in duplicate_candidates
        )
        source_record = source_record_by_lineage[
            (primary.source_document_id, primary.revision_track)
        ]
        aggregations.append(
            _ScopedRuleAggregation(
                primary_report=primary_report,
                primary_candidate=primary,
                source_record=source_record,
                duplicate_reports=duplicate_reports,
            )
        )
    return tuple(sorted(aggregations, key=lambda item: item.primary_candidate.source_document_id))


def _build_scoped_rule_raw_asset_record(
    *,
    aggregations: Sequence[_ScopedRuleAggregation],
) -> RawAssetRecord:
    payload = [
        {
            "source_document_id": aggregation.primary_candidate.source_document_id,
            "document_nature": aggregation.primary_candidate.document_nature,
            "title": aggregation.primary_candidate.title,
            "effective_date": aggregation.primary_candidate.effective_date,
            "revision_signal": aggregation.primary_candidate.revision_signal,
            "notice_ids": _aggregate_notice_ids(aggregation),
        }
        for aggregation in aggregations
    ]
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    raw_asset_id = "asset:internal-notice-scoped-rules-materialization"
    raw_version_id = f"sha256:{digest}"
    year = next(
        (
            aggregation.primary_candidate.cycle_year
            or _infer_year_label(aggregation.primary_candidate)
            for aggregation in aggregations
            if aggregation.primary_candidate.cycle_year
            or _infer_year_label(aggregation.primary_candidate)
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


def _build_scoped_rule_projection_metadata(
    *,
    aggregation: _ScopedRuleAggregation,
    title: str,
    semantic_content_hash: str,
    source_page_start: int | None,
    source_page_end: int | None,
) -> dict[str, object]:
    candidate = aggregation.primary_candidate
    duplicate_reports = aggregation.duplicate_reports
    source_notice_ids = _aggregate_notice_ids(aggregation)
    source_document_ids = tuple(
        sorted(
            {
                candidate.source_document_id,
                *(report.document_id for report in duplicate_reports),
            }
        )
    )
    source_parent_document_ids = tuple(
        sorted(
            {
                parent_document_id
                for parent_document_id in (
                    candidate.source_parent_document_id,
                    *(report.source_parent_document_id for report in duplicate_reports),
                )
                if parent_document_id
            }
        )
    )
    source_attachment_ref_ids = tuple(
        sorted(
            {
                attachment_ref_id
                for attachment_ref_id in (
                    candidate.source_attachment_ref_id,
                    *(report.source_attachment_ref_id for report in duplicate_reports),
                )
                if attachment_ref_id
            }
        )
    )
    source_attachment_sha256s = tuple(
        sorted(
            {
                attachment_sha256
                for attachment_sha256 in (
                    candidate.source_attachment_sha256,
                    *(report.source_attachment_sha256 for report in duplicate_reports),
                )
                if attachment_sha256
            }
        )
    )
    metadata: dict[str, object] = {
        "title": title,
        "semantic_content_hash": semantic_content_hash,
        "content_kind": "scoped_rule",
        "content_role": candidate.document_nature,
        "document_nature": candidate.document_nature,
        "is_answer_bearing": True,
        "projection_name": "internal_notice_scoped_rule_materialization",
        "derived_from": "internal_notice_canonical_document",
        "derived_from_document_id": candidate.source_document_id,
        "derived_from_document_ids": list(source_document_ids),
        "derived_from_raw_asset_id": aggregation.source_record.raw_asset.raw_asset_id
        if aggregation.source_record.raw_asset is not None
        else None,
        "derived_from_raw_version_id": aggregation.source_record.raw_asset.raw_version_id
        if aggregation.source_record.raw_asset is not None
        else None,
        "parent_document_id": candidate.source_parent_document_id,
        "promotion_source_collection": "campus_notices/internal_notice",
        "source_notice_ids": list(source_notice_ids),
        "source_document_ids": list(source_document_ids),
        "source_parent_document_id": candidate.source_parent_document_id,
        "source_parent_document_ids": list(source_parent_document_ids),
        "source_attachment_ref_id": candidate.source_attachment_ref_id,
        "source_attachment_ref_ids": list(source_attachment_ref_ids),
        "source_attachment_sha256": candidate.source_attachment_sha256,
        "source_attachment_sha256s": list(source_attachment_sha256s),
        "source_notice_release_time": candidate.source_notice_release_time,
        "regulation_title_normalized": title,
        "issuing_org": candidate.issuing_org,
        "effective_date": candidate.effective_date,
        "revision_signal": candidate.revision_signal,
        "cycle_year": candidate.cycle_year,
        "school_unit_name": candidate.school_unit_name,
        "campus_site": candidate.campus_site,
        "force_status": candidate.force_status,
        "duplicate_source_document_ids": [report.document_id for report in duplicate_reports],
        "promotion_reasons": list(candidate.reasons),
        "source_page_start": source_page_start,
        "source_page_end": source_page_end,
        "published_date": normalize_internal_notice_projection_published_date(
            candidate.source_notice_release_time
        ),
    }
    return {key: value for key, value in metadata.items() if value is not None}


def _serialize_scoped_rule_rows(
    *,
    document_id: str,
    version_id: str,
    title: str,
    body: str,
    metadata: dict[str, object],
    source_url: str,
    source_pdf: str,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
    visibility_level: str,
    page_start: int | None,
    page_end: int | None,
) -> bytes:
    rows: list[dict[str, object]] = []
    root_unit_id = f"{document_id}:root"
    rows.append(
        _build_scoped_row(
            document_id=document_id,
            version_id=version_id,
            row_id=f"{document_id}:row-0001",
            row_type="heading",
            clean_text=title,
            metadata={
                **metadata,
                "title": title,
                "detail_label": "标题",
                "section_path": [title],
                "content_role": "scoped_rule_title",
            },
            source_url=source_url,
            source_pdf=source_pdf,
            entitlement_groups=entitlement_groups,
            visibility_scope=visibility_scope,
            visibility_level=visibility_level,
            page_start=page_start,
            page_end=page_end,
            unit_type="scoped_rule_heading",
            root_unit_id=root_unit_id,
        )
    )
    section_path = [title]
    for index, block in enumerate(_split_markdown_blocks(body), start=2):
        block_text = block["text"]
        if not block_text:
            continue
        if block["row_type"] == "heading":
            section_path = [title, _strip_heading(block_text)]
        rows.append(
            _build_scoped_row(
                document_id=document_id,
                version_id=version_id,
                row_id=f"{document_id}:row-{index:04d}",
                row_type=str(block["row_type"]),
                clean_text=block_text,
                metadata={
                    **metadata,
                    "title": title,
                    "detail_label": "正文",
                    "section_path": list(section_path),
                    "content_role": "scoped_rule_body",
                },
                source_url=source_url,
                source_pdf=source_pdf,
                entitlement_groups=entitlement_groups,
                visibility_scope=visibility_scope,
                visibility_level=visibility_level,
                page_start=page_start,
                page_end=page_end,
                unit_type="scoped_rule_block",
                root_unit_id=root_unit_id,
            )
        )
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


def _build_scoped_row(
    *,
    document_id: str,
    version_id: str,
    row_id: str,
    row_type: str,
    clean_text: str,
    metadata: dict[str, object],
    source_url: str,
    source_pdf: str,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
    visibility_level: str,
    page_start: int | None,
    page_end: int | None,
    unit_type: str,
    root_unit_id: str,
) -> dict[str, object]:
    return {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": row_id,
        "row_id": row_id,
        "row_type": row_type,
        "clean_text": clean_text,
        "source_pdf": source_pdf,
        "source_url": source_url,
        "source": {"id": source_url},
        "page_start": page_start,
        "page_end": page_end,
        "entitlement_groups": list(entitlement_groups),
        "visibility_scope": visibility_scope,
        "visibility_level": visibility_level,
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "metadata": metadata,
    }
