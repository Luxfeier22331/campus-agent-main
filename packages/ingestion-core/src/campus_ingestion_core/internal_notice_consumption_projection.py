from __future__ import annotations

import hashlib
import os
from collections.abc import Mapping, Sequence
from typing import Protocol

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_promotion_manifest,
)
from campus_ingestion_core.internal_notice_regulation_promotion_artifacts import (
    _extract_candidate_promotion_body,
)
from campus_ingestion_core.internal_notice_regulation_promotion_shared import (
    InternalNoticeRegulationPromotionDocumentReport,
)
from campus_ingestion_core.internal_notice_scoped_rule_materialization_shared import (
    _extract_campus_site,
    _extract_cycle_year,
    _extract_force_status,
    _extract_school_unit_name,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_ANSWERABLE,
    NOTICE_ANSWERABILITY_MANUAL_REVIEW_REQUIRED,
    NOTICE_ANSWERABILITY_NOT_ANSWERABLE,
    NOTICE_ANSWERABILITY_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_COMPLETENESS_MANUAL_REVIEW_REQUIRED,
    NOTICE_COMPLETENESS_REFERENCE_ONLY,
    NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED,
    NOTICE_CONSUMPTION_STATUS_NOTICE_RUNTIME,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_DEFAULT_AGENT_RAG,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    NOTICE_SEMANTIC_OWNER_ATTACHMENT_DOCUMENT,
    NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_SEMANTIC_OWNER_WRAPPER_NOTICE,
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_NOTICE_RUNTIME,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
    NOTICE_TEMPORAL_POLICY_EXPLICIT_YEAR_ONLY,
    NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
    NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    build_document_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings


class InternalNoticeConsumptionProjectionObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


def build_internal_notice_consumption_projection_entries(
    *,
    request: InternalNoticeRegulationPromotionRequest | None = None,
    env: Mapping[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    object_store: InternalNoticeConsumptionProjectionObjectStore | None = None,
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    source = dict(env if env is not None else os.environ)
    runtime_request = request or InternalNoticeRegulationPromotionRequest()
    runtime_registry = registry or build_document_registry_from_env(source)
    runtime_inventory = (
        source_truth_inventory_store
        or build_authenticated_notice_source_truth_inventory_store_from_env(source)
    )
    runtime_object_store = object_store or S3ObjectStoreWriter(ObjectStoreSettings.from_env(source))
    promotion_report = build_internal_notice_regulation_promotion_manifest(
        request=runtime_request,
        env=source,
        registry=runtime_registry,
        source_truth_inventory_store=runtime_inventory,
        object_store=runtime_object_store,
    )
    notice_ids = tuple(sorted({report.notice_id for report in promotion_report.documents}))
    inventory_entries = runtime_inventory.list_by_scope(
        runtime_request.corpus,
        runtime_request.collection,
        notice_ids=notice_ids,
    )
    inventory_by_notice = {entry.notice_id: entry for entry in inventory_entries}
    source_record_by_lineage = _index_latest_scope_records(
        runtime_registry.list_by_scope(runtime_request.corpus, runtime_request.collection)
    )
    bucket_derived = ObjectStoreSettings.from_env(source).bucket_derived

    entries: list[NoticeConsumptionProjectionEntry] = [
        _build_notice_window_entry(entry) for entry in inventory_entries
    ]
    for report in promotion_report.documents:
        inventory_entry = inventory_by_notice.get(report.notice_id)
        source_record = source_record_by_lineage.get((report.document_id, report.revision_track))
        document_entry = _build_document_consumption_entry(
            report=report,
            inventory_entry=inventory_entry,
            source_record=source_record,
            object_store=runtime_object_store,
            bucket_derived=bucket_derived,
        )
        if document_entry is not None:
            entries.append(document_entry)
    return tuple(sorted(entries, key=lambda item: (item.source_notice_id, item.unit_id)))


def rebuild_internal_notice_consumption_projection(
    *,
    request: InternalNoticeRegulationPromotionRequest | None = None,
    env: Mapping[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    object_store: InternalNoticeConsumptionProjectionObjectStore | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    source = dict(env if env is not None else os.environ)
    runtime_request = request or InternalNoticeRegulationPromotionRequest()
    runtime_projection_store = (
        projection_store
        or _build_projection_store_with_fallback(source)
    )
    entries = build_internal_notice_consumption_projection_entries(
        request=runtime_request,
        env=source,
        registry=registry,
        source_truth_inventory_store=source_truth_inventory_store,
        object_store=object_store,
    )
    if runtime_request.notice_ids or runtime_request.document_ids:
        runtime_projection_store.upsert_many(entries)
        return runtime_projection_store.list_by_scope(
            runtime_request.corpus,
            runtime_request.collection,
            notice_ids=tuple(
                sorted(
                    {
                        entry.source_notice_id
                        for entry in entries
                        if entry.source_notice_id
                    }
                )
            ),
        )
    runtime_projection_store.replace_scope(
        runtime_request.corpus,
        runtime_request.collection,
        entries,
    )
    return runtime_projection_store.list_by_scope(runtime_request.corpus, runtime_request.collection)


def select_ready_target_document_ids(
    entries: Sequence[NoticeConsumptionProjectionEntry],
    *,
    target_surface: str,
    primary_roles: Sequence[str] = (),
) -> tuple[str, ...]:
    allowed_roles = frozenset(str(item).strip() for item in primary_roles if str(item).strip())
    return tuple(
        sorted(
            {
                str(entry.source_document_id)
                for entry in entries
                if entry.target_surface == target_surface
                and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
                and entry.source_document_id
                and (not allowed_roles or entry.primary_role in allowed_roles)
            }
        )
    )


def _build_notice_window_entry(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> NoticeConsumptionProjectionEntry:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus=inventory_entry.corpus,
        source_collection=inventory_entry.collection,
        source_notice_id=inventory_entry.notice_id,
        unit_id=f"notice_unit:{inventory_entry.document_id}:notice_window",
        primary_role=NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_RUNTIME,
        temporal_policy=NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_NOTICE_RUNTIME,
        source_notice_document_id=inventory_entry.document_id,
        source_document_id=inventory_entry.document_id,
        source_notice_release_time=str(parent_snapshot.get("notice_release_time") or "") or None,
        role_metadata={
            "notice_title": str(parent_snapshot.get("notice_title") or inventory_entry.document_id),
            "notice_type_names": tuple(parent_snapshot.get("notice_type_names") or ()),
            "notice_risk_label": inventory_entry.notice_risk_label,
            "attachment_ref_count": inventory_entry.attachment_ref_count,
            "attachment_document_count": inventory_entry.attachment_document_count,
            "text_extractable_count": inventory_entry.text_extractable_count,
            "ocr_required_count": inventory_entry.ocr_required_count,
            "reference_only_count": inventory_entry.reference_only_count,
            "manual_review_required_count": inventory_entry.manual_review_required_count,
            "owner_expectation_count": int(parent_snapshot.get("owner_expectation_count") or 0),
        },
    )


def _build_document_consumption_entry(
    *,
    report: InternalNoticeRegulationPromotionDocumentReport,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    source_record: DocumentRegistryRecord | None,
    object_store: InternalNoticeConsumptionProjectionObjectStore,
    bucket_derived: str,
) -> NoticeConsumptionProjectionEntry | None:
    primary_role = _resolve_primary_role(report)
    if primary_role is None:
        return None
    title = str(report.source_title or report.regulation_title_normalized or report.document_id)
    promotion_body = _load_promotion_body(
        report=report,
        inventory_entry=inventory_entry,
        source_record=source_record,
        object_store=object_store,
        bucket_derived=bucket_derived,
    )
    combined_text = "\n".join(item for item in (title, promotion_body) if item)
    semantic_owner = _resolve_semantic_owner(report)
    completeness_status = _resolve_completeness_status(report)
    answerability = _resolve_answerability(completeness_status=completeness_status)
    target_surface = _resolve_target_surface(primary_role)
    default_agent = _resolve_default_agent(
        target_surface=target_surface,
        completeness_status=completeness_status,
        answerability=answerability,
    )
    consumption_status = _resolve_consumption_status(
        target_surface=target_surface,
        completeness_status=completeness_status,
        answerability=answerability,
    )
    source_attachment_ref_ids = tuple(
        sorted({str(report.source_attachment_ref_id).strip()} - {""})
    )
    title_digest = hashlib.sha256(
        "\n".join(
            (
                report.document_id,
                primary_role,
                title,
                report.version_id,
            )
        ).encode("utf-8")
    ).hexdigest()[:16]
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=report.notice_id,
        unit_id=f"notice_unit:{report.site_id}:{report.notice_id}:{primary_role}:{title_digest}",
        primary_role=primary_role,
        semantic_owner=semantic_owner,
        default_agent=default_agent,
        target_surface=target_surface,
        temporal_policy=_resolve_temporal_policy(primary_role),
        completeness_status=completeness_status,
        answerability=answerability,
        consumption_status=consumption_status,
        source_notice_document_id=report.source_parent_document_id or f"notice:{report.site_id}:{report.notice_id}",
        source_document_id=report.document_id,
        source_attachment_ref_ids=source_attachment_ref_ids,
        source_notice_release_time=report.source_notice_release_time,
        role_metadata={
            "title": title,
            "document_nature": report.document_nature,
            "promotion_class": report.promotion_class,
            "semantic_owner_kind": report.semantic_owner_kind,
            "owner_source_missing_reason": report.owner_source_missing_reason,
            "source_kind": report.source_kind,
            "source_parent_document_id": report.source_parent_document_id,
            "source_attachment_sha256": report.source_attachment_sha256,
            "reasons": report.reasons,
            "quality_gates_passed": report.quality_gates_passed,
            "issuing_org": report.issuing_org,
            "effective_date": report.effective_date,
            "revision_signal": report.revision_signal,
            "regulation_title_normalized": report.regulation_title_normalized,
            "cycle_year": _extract_cycle_year(combined_text),
            "school_unit_name": _extract_school_unit_name(title),
            "campus_site": _extract_campus_site(combined_text),
            "force_status": _extract_force_status(combined_text),
        },
    )


def _resolve_primary_role(
    report: InternalNoticeRegulationPromotionDocumentReport,
) -> str | None:
    if report.document_nature == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE:
        return NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
    if report.document_nature == NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE:
        return NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE
    if report.document_nature == "institutional_regulation" and report.promotion_class == "formal_regulation":
        return NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY
    return None


def _resolve_temporal_policy(primary_role: str) -> str:
    if primary_role == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE:
        return NOTICE_TEMPORAL_POLICY_EXPLICIT_YEAR_ONLY
    if primary_role == NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE:
        return NOTICE_TEMPORAL_POLICY_TIME_WINDOWED
    return NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED


def _resolve_target_surface(primary_role: str) -> str:
    if primary_role in {
        NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
        NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    }:
        return NOTICE_TARGET_SURFACE_SCOPED_RULES
    return NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES


def _resolve_semantic_owner(report: InternalNoticeRegulationPromotionDocumentReport) -> str:
    if report.owner_source_missing_reason is not None:
        return NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING
    if report.document_nature == "wrapper_notice":
        return NOTICE_SEMANTIC_OWNER_WRAPPER_NOTICE
    if report.semantic_owner_kind == "attachment_document":
        return NOTICE_SEMANTIC_OWNER_ATTACHMENT_DOCUMENT
    return NOTICE_SEMANTIC_OWNER_NOTICE_BODY


def _resolve_completeness_status(report: InternalNoticeRegulationPromotionDocumentReport) -> str:
    if report.action == "promote_candidate":
        return NOTICE_COMPLETENESS_COMPLETE
    if report.owner_source_missing_reason is not None or (
        "input_incomplete_missing_attachment_docs" in set(report.reasons)
    ):
        return NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING
    if report.action == "manual_review_required":
        return NOTICE_COMPLETENESS_MANUAL_REVIEW_REQUIRED
    return NOTICE_COMPLETENESS_REFERENCE_ONLY


def _resolve_answerability(*, completeness_status: str) -> str:
    if completeness_status == NOTICE_COMPLETENESS_COMPLETE:
        return NOTICE_ANSWERABILITY_ANSWERABLE
    if completeness_status == NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING:
        return NOTICE_ANSWERABILITY_NOT_ANSWERABLE
    if completeness_status == NOTICE_COMPLETENESS_MANUAL_REVIEW_REQUIRED:
        return NOTICE_ANSWERABILITY_MANUAL_REVIEW_REQUIRED
    return NOTICE_ANSWERABILITY_REFERENCE_ONLY


def _resolve_default_agent(
    *,
    target_surface: str,
    completeness_status: str,
    answerability: str,
) -> str:
    if (
        target_surface != NOTICE_TARGET_SURFACE_NOTICE_RUNTIME
        and completeness_status == NOTICE_COMPLETENESS_COMPLETE
        and answerability == NOTICE_ANSWERABILITY_ANSWERABLE
    ):
        return NOTICE_DEFAULT_AGENT_RAG
    return NOTICE_DEFAULT_AGENT_NOTICE


def _resolve_consumption_status(
    *,
    target_surface: str,
    completeness_status: str,
    answerability: str,
) -> str:
    if (
        target_surface != NOTICE_TARGET_SURFACE_NOTICE_RUNTIME
        and completeness_status == NOTICE_COMPLETENESS_COMPLETE
        and answerability == NOTICE_ANSWERABILITY_ANSWERABLE
    ):
        return NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    if completeness_status == NOTICE_COMPLETENESS_MANUAL_REVIEW_REQUIRED:
        return NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED
    return NOTICE_CONSUMPTION_STATUS_NOTICE_RUNTIME


def _load_promotion_body(
    *,
    report: InternalNoticeRegulationPromotionDocumentReport,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    source_record: DocumentRegistryRecord | None,
    object_store: InternalNoticeConsumptionProjectionObjectStore,
    bucket_derived: str,
) -> str:
    if source_record is None or source_record.canonical_markdown_object_key is None:
        return ""
    source_markdown = object_store.get_bytes(
        bucket=bucket_derived,
        key=source_record.canonical_markdown_object_key,
    ).decode("utf-8")
    return _extract_candidate_promotion_body(
        source_markdown=source_markdown,
        report=report,
        inventory_entry=inventory_entry,
    )


def _build_projection_store_with_fallback(
    env: dict[str, str],
) -> NoticeConsumptionProjectionStore:
    try:
        return build_notice_consumption_projection_store_from_env(env)
    except ValueError:
        return InMemoryNoticeConsumptionProjectionStore()


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
