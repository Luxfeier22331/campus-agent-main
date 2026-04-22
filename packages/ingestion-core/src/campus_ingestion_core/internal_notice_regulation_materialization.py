from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
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
from campus_ingestion_core.internal_notice_regulation_projection import (
    _HEADING_RE,
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
    InternalNoticeRegulationPromotionDocumentReport,
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_candidate_artifact_manifest,
    build_internal_notice_regulation_promotion_manifest,
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


class InstitutionalRegulationMaterializationObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


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


@dataclass(frozen=True, slots=True)
class _CandidateAggregation:
    primary_report: InternalNoticeRegulationPromotionDocumentReport
    primary_candidate: InternalNoticeRegulationCandidateArtifactDocument
    source_record: DocumentRegistryRecord
    duplicate_reports: tuple[InternalNoticeRegulationPromotionDocumentReport, ...]


def materialize_institutional_regulations_from_internal_notice_scope(
    *,
    request: InternalNoticeRegulationPromotionRequest | None = None,
    env: Mapping[str, str] | None = None,
    object_store: InstitutionalRegulationMaterializationObjectStore | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
) -> InstitutionalRegulationMaterializationReport:
    source = dict(env if env is not None else os.environ)
    runtime_request = request or InternalNoticeRegulationPromotionRequest()
    runtime_object_store = object_store or S3ObjectStoreWriter(ObjectStoreSettings.from_env(source))
    runtime_registry = registry or build_document_registry_from_env(source)
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    runtime_inventory = (
        source_truth_inventory_store
        or build_authenticated_notice_source_truth_inventory_store_from_env(source)
    )
    object_store_settings = ObjectStoreSettings.from_env(source)

    promotion_report = build_internal_notice_regulation_promotion_manifest(
        request=runtime_request,
        env=source,
        registry=runtime_registry,
        source_truth_inventory_store=runtime_inventory,
        object_store=runtime_object_store,
    )
    _candidate_manifest, candidate_documents = (
        build_internal_notice_regulation_candidate_artifact_manifest(
            request=runtime_request,
            env=source,
            registry=runtime_registry,
            source_truth_inventory_store=runtime_inventory,
            object_store=runtime_object_store,
        )
    )
    candidate_documents = tuple(
        candidate_document
        for candidate_document in candidate_documents
        if candidate_document.target_collection == _TARGET_SCOPE[1]
    )

    if not candidate_documents:
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

    source_record_by_lineage = _index_latest_scope_records(
        runtime_registry.list_by_scope(runtime_request.corpus, runtime_request.collection)
    )
    report_by_document_id = {report.document_id: report for report in promotion_report.documents}
    duplicate_reports_by_primary = _group_duplicate_reports(promotion_report.documents)
    aggregations: list[_CandidateAggregation] = []
    for candidate_document in candidate_documents:
        primary_report = report_by_document_id.get(candidate_document.source_document_id)
        if primary_report is None:
            raise ValueError(
                f"candidate source report missing: {candidate_document.source_document_id}"
            )
        source_record = source_record_by_lineage.get(
            (candidate_document.source_document_id, candidate_document.revision_track)
        )
        if source_record is None:
            raise ValueError(
                f"candidate source registry record missing: {candidate_document.source_document_id}"
            )
        aggregations.append(
            _CandidateAggregation(
                primary_report=primary_report,
                primary_candidate=candidate_document,
                source_record=source_record,
                duplicate_reports=duplicate_reports_by_primary.get(
                    candidate_document.source_document_id,
                    (),
                ),
            )
        )

    raw_asset_record = _build_materialization_raw_asset_record(aggregations=aggregations)
    runtime_raw_asset_registry.upsert(raw_asset_record)
    documents = build_institutional_regulation_scope_refresh_documents(
        raw_asset_record=raw_asset_record,
        aggregations=aggregations,
        object_store=runtime_object_store,
        bucket_derived=object_store_settings.bucket_derived,
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
    return InstitutionalRegulationMaterializationReport(
        promotion_candidate_count=len(candidate_documents),
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
        loaded_metadata = load_metadata_from_bytes(projected_document.document_units_bytes)
        loaded_metadata.update(projected_document.metadata)
        loaded_metadata["title"] = projected_document.title
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
                title=projected_document.title,
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
        ingestion_timestamp=datetime.now(timezone.utc).isoformat(),
        import_source=_TARGET_IMPORT_SOURCE,
    )


def _build_projection_metadata(
    *,
    aggregation: _CandidateAggregation,
    title: str,
    semantic_content_hash: str,
    source_page_start: int | None,
    source_page_end: int | None,
) -> dict[str, object]:
    duplicate_reports = aggregation.duplicate_reports
    source_notice_ids = _aggregate_notice_ids(aggregation)
    source_document_ids = tuple(
        sorted(
            {
                aggregation.primary_candidate.source_document_id,
                *(report.document_id for report in duplicate_reports),
            }
        )
    )
    source_parent_document_ids = tuple(
        sorted(
            {
                parent_document_id
                for parent_document_id in (
                    aggregation.primary_candidate.source_parent_document_id,
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
                    aggregation.primary_candidate.source_attachment_ref_id,
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
                    aggregation.primary_candidate.source_attachment_sha256,
                    *(report.source_attachment_sha256 for report in duplicate_reports),
                )
                if attachment_sha256
            }
        )
    )
    duplicate_source_document_ids = tuple(
        sorted(report.document_id for report in duplicate_reports)
    )
    published_date = _normalize_published_date(
        aggregation.primary_candidate.source_notice_release_time
    )
    metadata: dict[str, object] = {
        "title": title,
        "semantic_content_hash": semantic_content_hash,
        "content_kind": "institutional_regulation",
        "content_role": aggregation.primary_candidate.promotion_class,
        "semantic_owner_kind": aggregation.primary_candidate.semantic_owner_kind,
        "is_answer_bearing": True,
        "projection_name": "internal_notice_regulation_promotion",
        "derived_from": "internal_notice_canonical_document",
        "derived_from_document_id": aggregation.primary_candidate.source_document_id,
        "derived_from_document_ids": list(source_document_ids),
        "derived_from_raw_asset_id": aggregation.source_record.raw_asset.raw_asset_id
        if aggregation.source_record.raw_asset is not None
        else None,
        "derived_from_raw_version_id": aggregation.source_record.raw_asset.raw_version_id
        if aggregation.source_record.raw_asset is not None
        else None,
        "parent_document_id": aggregation.primary_candidate.source_parent_document_id,
        "promotion_class": aggregation.primary_candidate.promotion_class,
        "promotion_source_collection": "campus_notices/internal_notice",
        "source_notice_ids": list(source_notice_ids),
        "source_document_ids": list(source_document_ids),
        "source_parent_document_id": aggregation.primary_candidate.source_parent_document_id,
        "source_parent_document_ids": list(source_parent_document_ids),
        "source_attachment_ref_id": aggregation.primary_candidate.source_attachment_ref_id,
        "source_attachment_ref_ids": list(source_attachment_ref_ids),
        "source_attachment_sha256": aggregation.primary_candidate.source_attachment_sha256,
        "source_attachment_sha256s": list(source_attachment_sha256s),
        "source_notice_release_time": aggregation.primary_candidate.source_notice_release_time,
        "regulation_title_normalized": aggregation.primary_candidate.regulation_title_normalized,
        "issuing_org": aggregation.primary_candidate.issuing_org,
        "effective_date": aggregation.primary_candidate.effective_date,
        "revision_signal": aggregation.primary_candidate.revision_signal,
        "duplicate_source_document_ids": list(duplicate_source_document_ids),
        "quality_gates_passed": list(aggregation.primary_candidate.quality_gates_passed),
        "promotion_reasons": list(aggregation.primary_candidate.reasons),
        "source_page_start": source_page_start,
        "source_page_end": source_page_end,
        "published_date": published_date,
    }
    return {key: value for key, value in metadata.items() if value is not None}


def _serialize_projection_rows(
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
    section_path = [title]
    rows: list[dict[str, object]] = []
    root_unit_id = f"{document_id}:root"
    rows.append(
        _build_row(
            document_id=document_id,
            version_id=version_id,
            row_id=f"{document_id}:row-0001",
            row_type="heading",
            clean_text=title,
            metadata={
                **metadata,
                "title": title,
                "detail_label": "标题",
                "section_path": list(section_path),
                "content_role": "regulation_title",
            },
            source_url=source_url,
            source_pdf=source_pdf,
            entitlement_groups=entitlement_groups,
            visibility_scope=visibility_scope,
            visibility_level=visibility_level,
            page_start=page_start,
            page_end=page_end,
            unit_type="institutional_regulation_heading",
            root_unit_id=root_unit_id,
        )
    )
    for index, block in enumerate(_split_markdown_blocks(body), start=2):
        block_text = block["text"]
        if not block_text:
            continue
        if block["row_type"] == "heading":
            section_path = [title, _strip_heading(block_text)]
        rows.append(
            _build_row(
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
                    "content_role": "regulation_body",
                },
                source_url=source_url,
                source_pdf=source_pdf,
                entitlement_groups=entitlement_groups,
                visibility_scope=visibility_scope,
                visibility_level=visibility_level,
                page_start=page_start,
                page_end=page_end,
                unit_type="institutional_regulation_block",
                root_unit_id=root_unit_id,
            )
        )
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


def _build_row(
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


def _group_duplicate_reports(
    reports: Sequence[InternalNoticeRegulationPromotionDocumentReport],
) -> dict[str, tuple[InternalNoticeRegulationPromotionDocumentReport, ...]]:
    grouped: dict[str, list[InternalNoticeRegulationPromotionDocumentReport]] = {}
    for report in reports:
        if not report.duplicate_primary_document_id:
            continue
        grouped.setdefault(report.duplicate_primary_document_id, []).append(report)
    return {
        document_id: tuple(sorted(items, key=lambda item: item.document_id))
        for document_id, items in grouped.items()
    }


def _aggregate_notice_ids(aggregation: _CandidateAggregation) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                aggregation.primary_candidate.notice_id,
                *(report.notice_id for report in aggregation.duplicate_reports),
            }
        )
    )


def _build_semantic_content_hash(
    candidate: InternalNoticeRegulationCandidateArtifactDocument,
) -> str:
    return hashlib.sha256(_render_canonical_markdown(candidate).encode("utf-8")).hexdigest()


def _render_canonical_markdown(
    candidate: InternalNoticeRegulationCandidateArtifactDocument,
) -> str:
    body = candidate.promotion_body.strip()
    title = candidate.regulation_title_normalized.strip()
    return f"# {title}\n\n{body}\n"


def _split_markdown_blocks(body: str) -> tuple[dict[str, str], ...]:
    blocks: list[dict[str, str]] = []
    for raw_block in body.split("\n\n"):
        cleaned = raw_block.strip()
        if not cleaned:
            continue
        row_type = "heading" if cleaned.startswith("#") else "paragraph"
        blocks.append({"row_type": row_type, "text": cleaned})
    return tuple(blocks)


def _strip_heading(text: str) -> str:
    return _HEADING_RE.sub("", text.strip())


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


def _normalize_published_date(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", normalized):
        return normalized
    match = re.match(r"(?P<year>\d{4})年(?P<month>\d{1,2})月(?P<day>\d{1,2})日", normalized)
    if match is None:
        return normalized
    return (
        f"{int(match.group('year')):04d}-{int(match.group('month')):02d}-"
        f"{int(match.group('day')):02d}"
    )


def _infer_year_label(candidate: InternalNoticeRegulationCandidateArtifactDocument) -> str | None:
    for value in (candidate.effective_date, candidate.source_notice_release_time):
        if value is None:
            continue
        match = _DATE_YEAR_RE.search(value)
        if match is not None:
            return match.group(0)
    return None


def _slugify_identifier(value: str) -> str:
    normalized = value.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in normalized).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "document"


def _read_embedding_model_name(env: Mapping[str, str]) -> str:
    return str(env.get("EMBEDDING_MODEL") or "Qwen3-Embedding-4B")


__all__ = [
    "InstitutionalRegulationMaterializationReport",
    "build_institutional_regulation_document_id",
    "build_institutional_regulation_scope_refresh_documents",
    "build_institutional_regulation_version_id",
    "materialize_institutional_regulations_from_internal_notice_scope",
]
