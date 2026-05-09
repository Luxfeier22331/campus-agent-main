from __future__ import annotations

import hashlib
import os
from collections.abc import Mapping, Sequence
from dataclasses import replace

from campus_ingestion_core import (
    internal_notice_consumption_projection_multimodal as _multimodal,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.internal_notice_consumption_notice_entries import (
    _build_notice_level_entries,
)
from campus_ingestion_core.internal_notice_consumption_notice_heuristics import (
    _looks_like_service_status_override_notice,
)
from campus_ingestion_core.internal_notice_consumption_projection_models import (
    InternalNoticeConsumptionProjectionObjectStore,
)
from campus_ingestion_core.internal_notice_consumption_projection_models import (
    InternalNoticeProcessingGapsReport as InternalNoticeProcessingGapsReport,
)
from campus_ingestion_core.internal_notice_consumption_projection_models import (
    InternalNoticeProcessingGapUnit as InternalNoticeProcessingGapUnit,
)
from campus_ingestion_core.internal_notice_consumption_projection_models import (
    NoticeConsumptionProjectionStatus as NoticeConsumptionProjectionStatus,
)
from campus_ingestion_core.internal_notice_consumption_projection_models import (
    NoticeConsumptionProjectionUnitStatus as NoticeConsumptionProjectionUnitStatus,
)
from campus_ingestion_core.internal_notice_consumption_projection_multimodal import (
    NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS,
    NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP,
)
from campus_ingestion_core.internal_notice_consumption_projection_multimodal import (
    NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER as NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
)
from campus_ingestion_core.internal_notice_consumption_projection_routing import (
    index_notice_attachment_records,
    resolve_notice_routing_samples_by_notice,
    should_suppress_regulation_promotion,
)
from campus_ingestion_core.internal_notice_consumption_projection_status import (
    check_internal_notice_processing_gaps as check_internal_notice_processing_gaps,
)
from campus_ingestion_core.internal_notice_consumption_projection_status import (
    read_notice_consumption_projection_status as read_notice_consumption_projection_status,
)
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
    NOTICE_ANSWERABILITY_NOT_ANSWERABLE,
    NOTICE_ANSWERABILITY_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_COMPLETENESS_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_DEFAULT_AGENT_RAG,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    NOTICE_SEMANTIC_OWNER_ATTACHMENT_DOCUMENT,
    NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_SEMANTIC_OWNER_WRAPPER_NOTICE,
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NOTICE_TEMPORAL_POLICY_EXPLICIT_YEAR_ONLY,
    NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
    NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
    PostgresNoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES as NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE as NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_LECTURE_ACTIVITY as NOTICE_PRIMARY_ROLE_LECTURE_ACTIVITY,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW as NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE as NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION as NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE as NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE as NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE as NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY as NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE as NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE as NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE as NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW as NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE as NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION as NOTICE_TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    build_document_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings

_MultimodalConsumptionDecision = _multimodal.MultimodalConsumptionDecision
_build_multimodal_consumption_metadata = _multimodal.build_multimodal_consumption_metadata
_is_unsupported_machine_processing_reason = _multimodal.is_unsupported_machine_processing_reason
_requires_multimodal_processing = _multimodal.requires_multimodal_processing
_resolve_inventory_multimodal_consumption_decision = (
    _multimodal.resolve_inventory_multimodal_consumption_decision
)
_resolve_report_multimodal_consumption_decision = (
    _multimodal.resolve_report_multimodal_consumption_decision
)


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
    selected_notice_ids = normalize_notice_ids(runtime_request.notice_ids)
    report_notice_ids = tuple(sorted({report.notice_id for report in promotion_report.documents}))
    notice_ids = selected_notice_ids or report_notice_ids
    inventory_entries = runtime_inventory.list_by_scope(
        runtime_request.corpus,
        runtime_request.collection,
        notice_ids=notice_ids,
    )
    inventory_by_notice = {entry.notice_id: entry for entry in inventory_entries}
    scope_records = runtime_registry.list_by_scope(
        runtime_request.corpus, runtime_request.collection
    )
    source_record_by_lineage = _index_latest_scope_records(scope_records)
    attachment_records_by_notice = index_notice_attachment_records(scope_records)
    routing_samples_by_notice = resolve_notice_routing_samples_by_notice(
        inventory_entries=inventory_entries,
        env=source,
        object_store=runtime_object_store,
    )
    object_store_settings = ObjectStoreSettings.from_env(source)
    bucket_derived = object_store_settings.bucket_derived
    bucket_source = object_store_settings.bucket_source

    entries: list[NoticeConsumptionProjectionEntry] = []
    for entry in inventory_entries:
        entries.extend(
            _build_notice_level_entries(
                entry,
                routing_sample=routing_samples_by_notice.get(entry.notice_id),
                attachment_records=attachment_records_by_notice.get(entry.notice_id, ()),
                object_store=runtime_object_store,
                source_bucket=bucket_source,
            )
        )
    for report in promotion_report.documents:
        inventory_entry = inventory_by_notice.get(report.notice_id)
        if should_suppress_regulation_promotion(
            report=report,
            inventory_entry=inventory_entry,
            routing_sample=routing_samples_by_notice.get(report.notice_id),
            fallback_service_detector=_looks_like_service_status_override_notice,
        ):
            continue
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
    admission_batch_id: str = "",
    admission_command: str = "",
    admission_created_at: str = "",
    dry_run: bool = False,
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    source = dict(env if env is not None else os.environ)
    runtime_request = request or InternalNoticeRegulationPromotionRequest()
    runtime_projection_store = projection_store or _build_projection_store(source, dry_run=dry_run)
    if (
        not runtime_request.notice_ids
        and not runtime_request.document_ids
        and isinstance(runtime_projection_store, PostgresNoticeConsumptionProjectionStore)
    ):
        raise ValueError(
            "refusing persistent full-scope notice consumption projection rebuild without "
            "explicit notice_ids or document_ids"
        )
    entries = build_internal_notice_consumption_projection_entries(
        request=runtime_request,
        env=source,
        registry=registry,
        source_truth_inventory_store=source_truth_inventory_store,
        object_store=object_store,
    )
    entries = _stamp_consumer_admission_provenance(
        entries,
        admission_batch_id=admission_batch_id,
        admission_command=admission_command,
        admission_created_at=admission_created_at,
    )
    if runtime_request.notice_ids or runtime_request.document_ids:
        selected_notice_ids = runtime_request.notice_ids or tuple(
            sorted({entry.source_notice_id for entry in entries if entry.source_notice_id})
        )
        runtime_projection_store.replace_notices(
            runtime_request.corpus,
            runtime_request.collection,
            notice_ids=selected_notice_ids,
            records=entries,
        )
        return runtime_projection_store.list_by_scope(
            runtime_request.corpus,
            runtime_request.collection,
            notice_ids=selected_notice_ids,
        )
    runtime_projection_store.replace_scope(
        runtime_request.corpus,
        runtime_request.collection,
        entries,
    )
    return runtime_projection_store.list_by_scope(
        runtime_request.corpus, runtime_request.collection
    )


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


def list_existing_internal_notice_consumption_projection_entries(
    store: NoticeConsumptionProjectionStore,
    *,
    request: InternalNoticeRegulationPromotionRequest,
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    entries = store.list_by_scope(
        request.corpus,
        request.collection,
        notice_ids=request.notice_ids,
    )
    if not request.document_ids:
        return entries
    selected_document_ids = {
        str(item).strip() for item in request.document_ids if str(item).strip()
    }
    return tuple(
        entry
        for entry in entries
        if entry.source_document_id in selected_document_ids
        or entry.source_notice_document_id in selected_document_ids
    )


def _stamp_consumer_admission_provenance(
    entries: Sequence[NoticeConsumptionProjectionEntry],
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    if not admission_batch_id and not admission_command and not admission_created_at:
        return tuple(entries)
    stamped: list[NoticeConsumptionProjectionEntry] = []
    for entry in entries:
        metadata = dict(entry.role_metadata or {})
        if admission_batch_id:
            metadata["consumer_admission_batch_id"] = admission_batch_id
        if admission_command:
            metadata["consumer_admission_command"] = admission_command
        if admission_created_at:
            metadata["consumer_admission_created_at"] = admission_created_at
        stamped.append(replace(entry, role_metadata=metadata))
    return tuple(stamped)


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
    multimodal_decision = _resolve_report_multimodal_consumption_decision(
        report=report,
        inventory_entry=inventory_entry,
        title=title,
        body=promotion_body,
    )
    if (
        _requires_multimodal_processing(report)
        and multimodal_decision.policy == NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP
    ):
        completeness_status = NOTICE_COMPLETENESS_REFERENCE_ONLY
    answerability = _resolve_answerability(completeness_status=completeness_status)
    target_surface = _resolve_target_surface(primary_role)
    if (
        _requires_multimodal_processing(report)
        and multimodal_decision.policy == NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP
    ):
        target_surface = NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY
    elif _requires_multimodal_processing(report):
        target_surface = NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE
    elif _is_unsupported_machine_processing_reason(report):
        target_surface = NOTICE_TARGET_SURFACE_UNSUPPORTED
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
    source_attachment_ref_ids = tuple(sorted({str(report.source_attachment_ref_id).strip()} - {""}))
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
        source_notice_document_id=report.source_parent_document_id
        or f"notice:{report.site_id}:{report.notice_id}",
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
            **_build_multimodal_consumption_metadata(multimodal_decision),
            **_build_processing_gap_metadata(report, multimodal_decision),
        },
    )


def _resolve_primary_role(
    report: InternalNoticeRegulationPromotionDocumentReport,
) -> str | None:
    if report.document_nature == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE:
        return NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
    if report.document_nature == NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE:
        return NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE
    if (
        report.document_nature == "institutional_regulation"
        and report.promotion_class == "formal_regulation"
    ):
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
    if _requires_multimodal_processing(report):
        return NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING
    if _is_unsupported_machine_processing_reason(report):
        return NOTICE_COMPLETENESS_REFERENCE_ONLY
    return NOTICE_COMPLETENESS_REFERENCE_ONLY


def _resolve_answerability(*, completeness_status: str) -> str:
    if completeness_status == NOTICE_COMPLETENESS_COMPLETE:
        return NOTICE_ANSWERABILITY_ANSWERABLE
    if completeness_status == NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING:
        return NOTICE_ANSWERABILITY_NOT_ANSWERABLE
    if completeness_status == NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING:
        return NOTICE_ANSWERABILITY_NOT_ANSWERABLE
    return NOTICE_ANSWERABILITY_REFERENCE_ONLY


def _resolve_default_agent(
    *,
    target_surface: str,
    completeness_status: str,
    answerability: str,
) -> str:
    if (
        target_surface != NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY
        and target_surface
        not in {
            NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
            NOTICE_TARGET_SURFACE_UNSUPPORTED,
        }
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
        target_surface != NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY
        and target_surface
        not in {
            NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
            NOTICE_TARGET_SURFACE_UNSUPPORTED,
        }
        and completeness_status == NOTICE_COMPLETENESS_COMPLETE
        and answerability == NOTICE_ANSWERABILITY_ANSWERABLE
    ):
        return NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    if target_surface == NOTICE_TARGET_SURFACE_UNSUPPORTED:
        return NOTICE_CONSUMPTION_STATUS_NO_ADOPTION
    if completeness_status == NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING:
        return NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING
    return NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY


def _build_processing_gap_metadata(
    report: InternalNoticeRegulationPromotionDocumentReport,
    multimodal_decision: _MultimodalConsumptionDecision,
) -> dict[str, object]:
    if (
        _requires_multimodal_processing(report)
        and multimodal_decision.policy == NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS
    ):
        return {
            "processing_gap_reason": "multimodal_processing_required",
        }
    if _is_unsupported_machine_processing_reason(report):
        return {
            "no_adoption_reason": "unsupported_machine_processing_reason",
        }
    return {}


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


def _build_projection_store(
    env: dict[str, str],
    *,
    dry_run: bool,
) -> NoticeConsumptionProjectionStore:
    if dry_run:
        return InMemoryNoticeConsumptionProjectionStore()
    return build_notice_consumption_projection_store_from_env(env)


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
