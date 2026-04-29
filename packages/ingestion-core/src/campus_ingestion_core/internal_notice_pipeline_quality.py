from __future__ import annotations

import os
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.internal_notice_read_model import (
    InternalNoticeReadModelEntry,
    InternalNoticeReadModelStore,
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
    NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)

PIPELINE_QUALITY_SEVERITY_ERROR = "error"
PIPELINE_QUALITY_SEVERITY_WARNING = "warning"

PIPELINE_STAGE_SOURCE_TRUTH = "source_truth"
PIPELINE_STAGE_CONSUMPTION_PROJECTION = "consumption_projection"
PIPELINE_STAGE_READ_MODEL = "internal_notice_read_model"
PIPELINE_STAGE_TARGET_MATERIALIZATION = "target_materialization"

LEGACY_REVIEW_STATE_MARKERS = frozenset({"manual_review_required", "review_later"})
REGULATION_TARGET_SURFACES = frozenset(
    {
        NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
        NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
        NOTICE_TARGET_SURFACE_SCOPED_RULES,
    }
)
QUERYABLE_NOTICE_TARGET_SURFACES = frozenset(
    {
        NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
    }
)


@dataclass(frozen=True, slots=True)
class InternalNoticePipelineAssetEdge:
    source_notice_id: str
    from_stage: str
    from_asset_id: str
    to_stage: str
    to_asset_id: str
    relation: str
    unit_id: str = ""


@dataclass(frozen=True, slots=True)
class InternalNoticePipelineQualityFinding:
    severity: str
    reason_code: str
    stage: str
    source_notice_id: str = ""
    unit_id: str = ""
    detail: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class InternalNoticePipelineQualityReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    source_truth_notice_count: int
    projection_entry_count: int
    read_model_entry_count: int
    queryable_read_model_card_count: int
    ready_regulation_target_count: int
    target_surface_counts: dict[str, int]
    consumption_status_counts: dict[str, int]
    read_model_target_surface_counts: dict[str, int]
    asset_edges: tuple[InternalNoticePipelineAssetEdge, ...]
    findings: tuple[InternalNoticePipelineQualityFinding, ...]
    ok: bool


def check_internal_notice_pipeline_quality(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    read_model_store: InternalNoticeReadModelStore | None = None,
    require_admission_provenance: bool = True,
) -> InternalNoticePipelineQualityReport:
    source = dict(env if env is not None else os.environ)
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    runtime_inventory_store = (
        source_truth_inventory_store
        or build_authenticated_notice_source_truth_inventory_store_from_env(
            source,
            prefer_operator=True,
        )
    )
    runtime_projection_store = (
        projection_store
        or build_notice_consumption_projection_store_from_env(source, prefer_operator=True)
    )
    runtime_read_model_store = read_model_store or build_internal_notice_read_model_store_from_env(
        source, prefer_operator=True
    )
    source_truth_entries = runtime_inventory_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    projection_entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    read_model_rows = runtime_read_model_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    source_notice_ids = {entry.notice_id for entry in source_truth_entries}
    projection_unit_ids = {entry.unit_id for entry in projection_entries}
    read_model_unit_ids = {row.unit_id for row in read_model_rows}
    projection_by_unit_id = {entry.unit_id: entry for entry in projection_entries}
    read_model_by_unit_id = {row.unit_id: row for row in read_model_rows}
    findings = [
        *_find_missing_source_truth(
            selected_notice_ids=normalized_notice_ids,
            source_notice_ids=source_notice_ids,
        ),
        *_find_projection_layer_issues(
            projection_entries=projection_entries,
            source_notice_ids=source_notice_ids,
            require_admission_provenance=require_admission_provenance,
        ),
        *_find_read_model_layer_issues(
            read_model_rows=read_model_rows,
            projection_unit_ids=projection_unit_ids,
        ),
        *_find_missing_read_model_rows(
            projection_entries=projection_entries,
            read_model_unit_ids=read_model_unit_ids,
        ),
    ]
    asset_edges = _build_asset_edges(
        source_truth_notice_ids=source_notice_ids,
        projection_entries=projection_entries,
        read_model_by_unit_id=read_model_by_unit_id,
        projection_by_unit_id=projection_by_unit_id,
    )
    return InternalNoticePipelineQualityReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        source_truth_notice_count=len(source_truth_entries),
        projection_entry_count=len(projection_entries),
        read_model_entry_count=len(read_model_rows),
        queryable_read_model_card_count=sum(1 for row in read_model_rows if row.queryable),
        ready_regulation_target_count=sum(
            1
            for entry in projection_entries
            if entry.target_surface in REGULATION_TARGET_SURFACES
            and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
        ),
        target_surface_counts=dict(
            sorted(Counter(entry.target_surface for entry in projection_entries).items())
        ),
        consumption_status_counts=dict(
            sorted(Counter(entry.consumption_status for entry in projection_entries).items())
        ),
        read_model_target_surface_counts=dict(
            sorted(Counter(row.target_surface for row in read_model_rows).items())
        ),
        asset_edges=asset_edges,
        findings=tuple(findings),
        ok=not any(finding.severity == PIPELINE_QUALITY_SEVERITY_ERROR for finding in findings),
    )


def _find_missing_source_truth(
    *,
    selected_notice_ids: Sequence[str],
    source_notice_ids: set[str],
) -> tuple[InternalNoticePipelineQualityFinding, ...]:
    if not selected_notice_ids:
        return ()
    return tuple(
        InternalNoticePipelineQualityFinding(
            severity=PIPELINE_QUALITY_SEVERITY_ERROR,
            reason_code="missing_source_truth_inventory",
            stage=PIPELINE_STAGE_SOURCE_TRUTH,
            source_notice_id=notice_id,
            detail="selected notice has no source-truth inventory row",
        )
        for notice_id in selected_notice_ids
        if notice_id not in source_notice_ids
    )


def _find_projection_layer_issues(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    source_notice_ids: set[str],
    require_admission_provenance: bool,
) -> tuple[InternalNoticePipelineQualityFinding, ...]:
    findings: list[InternalNoticePipelineQualityFinding] = []
    for entry in projection_entries:
        if entry.source_notice_id not in source_notice_ids:
            findings.append(
                InternalNoticePipelineQualityFinding(
                    severity=PIPELINE_QUALITY_SEVERITY_ERROR,
                    reason_code="missing_source_truth_inventory",
                    stage=PIPELINE_STAGE_CONSUMPTION_PROJECTION,
                    source_notice_id=entry.source_notice_id,
                    unit_id=entry.unit_id,
                    detail="projection row has no source-truth inventory row",
                )
            )
        if require_admission_provenance and not _has_admission_provenance(entry):
            findings.append(
                InternalNoticePipelineQualityFinding(
                    severity=PIPELINE_QUALITY_SEVERITY_ERROR,
                    reason_code="projection_missing_admission_provenance",
                    stage=PIPELINE_STAGE_CONSUMPTION_PROJECTION,
                    source_notice_id=entry.source_notice_id,
                    unit_id=entry.unit_id,
                    detail="projection row is missing consumer admission provenance",
                )
            )
        if _contains_legacy_review_state(entry):
            findings.append(
                InternalNoticePipelineQualityFinding(
                    severity=PIPELINE_QUALITY_SEVERITY_ERROR,
                    reason_code="legacy_review_state_detected",
                    stage=PIPELINE_STAGE_CONSUMPTION_PROJECTION,
                    source_notice_id=entry.source_notice_id,
                    unit_id=entry.unit_id,
                    detail="projection row still contains manual_review_required or review_later",
                )
            )
        if _regulation_ready_without_quality_gate(entry):
            findings.append(
                InternalNoticePipelineQualityFinding(
                    severity=PIPELINE_QUALITY_SEVERITY_ERROR,
                    reason_code="regulation_ready_without_quality_gate",
                    stage=PIPELINE_STAGE_TARGET_MATERIALIZATION,
                    source_notice_id=entry.source_notice_id,
                    unit_id=entry.unit_id,
                    detail="ready regulation target lacks promotion quality evidence",
                    metadata={
                        "target_surface": entry.target_surface,
                        "document_nature": str(entry.role_metadata.get("document_nature") or ""),
                    },
                )
            )
    return tuple(findings)


def _find_read_model_layer_issues(
    *,
    read_model_rows: Sequence[InternalNoticeReadModelEntry],
    projection_unit_ids: set[str],
) -> tuple[InternalNoticePipelineQualityFinding, ...]:
    findings: list[InternalNoticePipelineQualityFinding] = []
    for row in read_model_rows:
        if row.unit_id not in projection_unit_ids:
            findings.append(
                InternalNoticePipelineQualityFinding(
                    severity=PIPELINE_QUALITY_SEVERITY_ERROR,
                    reason_code="read_model_extra_without_projection",
                    stage=PIPELINE_STAGE_READ_MODEL,
                    source_notice_id=row.source_notice_id,
                    unit_id=row.unit_id,
                    detail="read-model row has no matching projection row",
                )
            )
        if not row.queryable:
            continue
        if not row.title.strip():
            findings.append(
                InternalNoticePipelineQualityFinding(
                    severity=PIPELINE_QUALITY_SEVERITY_ERROR,
                    reason_code="read_model_missing_title",
                    stage=PIPELINE_STAGE_READ_MODEL,
                    source_notice_id=row.source_notice_id,
                    unit_id=row.unit_id,
                    detail="queryable notice read-model row is missing title",
                )
            )
        if not row.source_url.strip():
            findings.append(
                InternalNoticePipelineQualityFinding(
                    severity=PIPELINE_QUALITY_SEVERITY_ERROR,
                    reason_code="read_model_missing_source_url",
                    stage=PIPELINE_STAGE_READ_MODEL,
                    source_notice_id=row.source_notice_id,
                    unit_id=row.unit_id,
                    detail="queryable notice read-model row is missing source_url",
                )
            )
    return tuple(findings)


def _find_missing_read_model_rows(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    read_model_unit_ids: set[str],
) -> tuple[InternalNoticePipelineQualityFinding, ...]:
    return tuple(
        InternalNoticePipelineQualityFinding(
            severity=PIPELINE_QUALITY_SEVERITY_ERROR,
            reason_code="queryable_projection_missing_read_model",
            stage=PIPELINE_STAGE_READ_MODEL,
            source_notice_id=entry.source_notice_id,
            unit_id=entry.unit_id,
            detail="queryable projection row is missing from internal notice read model",
        )
        for entry in projection_entries
        if _projection_row_should_have_read_model(entry)
        and entry.unit_id not in read_model_unit_ids
    )


def _build_asset_edges(
    *,
    source_truth_notice_ids: set[str],
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    read_model_by_unit_id: Mapping[str, InternalNoticeReadModelEntry],
    projection_by_unit_id: Mapping[str, NoticeConsumptionProjectionEntry],
) -> tuple[InternalNoticePipelineAssetEdge, ...]:
    edges: list[InternalNoticePipelineAssetEdge] = []
    for entry in sorted(projection_entries, key=lambda item: (item.source_notice_id, item.unit_id)):
        if entry.source_notice_id in source_truth_notice_ids:
            edges.append(
                InternalNoticePipelineAssetEdge(
                    source_notice_id=entry.source_notice_id,
                    from_stage=PIPELINE_STAGE_SOURCE_TRUTH,
                    from_asset_id=f"notice:{entry.source_notice_id}",
                    to_stage=PIPELINE_STAGE_CONSUMPTION_PROJECTION,
                    to_asset_id=entry.unit_id,
                    relation="projects_to",
                    unit_id=entry.unit_id,
                )
            )
        if entry.unit_id in read_model_by_unit_id:
            edges.append(
                InternalNoticePipelineAssetEdge(
                    source_notice_id=entry.source_notice_id,
                    from_stage=PIPELINE_STAGE_CONSUMPTION_PROJECTION,
                    from_asset_id=entry.unit_id,
                    to_stage=PIPELINE_STAGE_READ_MODEL,
                    to_asset_id=entry.unit_id,
                    relation="indexes_to",
                    unit_id=entry.unit_id,
                )
            )
        if (
            entry.target_surface not in QUERYABLE_NOTICE_TARGET_SURFACES
            and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
        ):
            edges.append(
                InternalNoticePipelineAssetEdge(
                    source_notice_id=entry.source_notice_id,
                    from_stage=PIPELINE_STAGE_CONSUMPTION_PROJECTION,
                    from_asset_id=entry.unit_id,
                    to_stage=PIPELINE_STAGE_TARGET_MATERIALIZATION,
                    to_asset_id=f"{entry.target_surface}:{entry.unit_id}",
                    relation="materializes_to",
                    unit_id=entry.unit_id,
                )
            )
    for unit_id, row in sorted(read_model_by_unit_id.items()):
        if unit_id in projection_by_unit_id:
            continue
        edges.append(
            InternalNoticePipelineAssetEdge(
                source_notice_id=row.source_notice_id,
                from_stage=PIPELINE_STAGE_READ_MODEL,
                from_asset_id=unit_id,
                to_stage=PIPELINE_STAGE_READ_MODEL,
                to_asset_id=unit_id,
                relation="orphan",
                unit_id=unit_id,
            )
        )
    return tuple(edges)


def _projection_row_should_have_read_model(entry: NoticeConsumptionProjectionEntry) -> bool:
    return (
        entry.target_surface in QUERYABLE_NOTICE_TARGET_SURFACES
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY
    )


def _has_admission_provenance(entry: NoticeConsumptionProjectionEntry) -> bool:
    return bool(
        str(entry.role_metadata.get("consumer_admission_batch_id") or "").strip()
        and str(entry.role_metadata.get("consumer_admission_command") or "").strip()
    )


def _contains_legacy_review_state(entry: NoticeConsumptionProjectionEntry) -> bool:
    values = (
        entry.primary_role,
        entry.semantic_owner,
        entry.target_surface,
        entry.consumption_status,
        *_flatten_metadata_values(entry.role_metadata),
    )
    return any(str(value).strip() in LEGACY_REVIEW_STATE_MARKERS for value in values)


def _flatten_metadata_values(value: object) -> tuple[object, ...]:
    if isinstance(value, Mapping):
        flattened: list[object] = []
        for key, item in value.items():
            flattened.append(key)
            flattened.extend(_flatten_metadata_values(item))
        return tuple(flattened)
    if isinstance(value, Sequence) and not isinstance(value, str):
        flattened = []
        for item in value:
            flattened.extend(_flatten_metadata_values(item))
        return tuple(flattened)
    return (value,)


def _regulation_ready_without_quality_gate(entry: NoticeConsumptionProjectionEntry) -> bool:
    if (
        entry.target_surface not in REGULATION_TARGET_SURFACES
        or entry.consumption_status != NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    ):
        return False
    quality_gates = tuple(
        str(item).strip()
        for item in (entry.role_metadata.get("quality_gates_passed") or ())
        if str(item).strip()
    )
    document_nature = str(entry.role_metadata.get("document_nature") or "").strip()
    owner_source_missing_reason = str(
        entry.role_metadata.get("owner_source_missing_reason") or ""
    ).strip()
    return (
        not quality_gates
        or document_nature == "wrapper_notice"
        or bool(owner_source_missing_reason)
    )


__all__ = [
    "InternalNoticePipelineAssetEdge",
    "InternalNoticePipelineQualityFinding",
    "InternalNoticePipelineQualityReport",
    "check_internal_notice_pipeline_quality",
]
