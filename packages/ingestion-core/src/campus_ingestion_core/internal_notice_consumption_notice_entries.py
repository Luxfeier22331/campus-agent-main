from __future__ import annotations

from collections.abc import Sequence

from campus_ingestion_core import internal_notice_consumption_projection_multimodal as _multimodal
from campus_ingestion_core.authenticated_notice_routing_sampling import (
    AuthenticatedNoticeRoutingSample,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.internal_notice_consumption_notice_heuristics import (
    _looks_like_attachment_form_template_notice_title,
    _looks_like_attachment_form_template_plan,
    _looks_like_stable_contact_update_notice,
    _notice_title_compact,
    _resolve_notice_level_primary_role,
    _resolve_special_service_candidate_kind,
)
from campus_ingestion_core.internal_notice_consumption_projection_models import (
    InternalNoticeConsumptionProjectionObjectStore,
)
from campus_ingestion_core.internal_notice_consumption_projection_routing import (
    resolve_attachment_document_ids,
    resolve_attachment_ref_ids,
    resolve_service_status_candidate_kind,
    routes_to_service_status_candidate,
    routing_metadata,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_ANSWERABLE,
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_ANSWERABILITY_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_COMPLETENESS_REFERENCE_ONLY,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
    NOTICE_PRIMARY_ROLE_LECTURE_ACTIVITY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
    NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
    NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE,
    NOTICE_SEMANTIC_OWNER_ATTACHMENT_DOCUMENT,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_SEMANTIC_OWNER_WRAPPER_NOTICE,
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
    NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
    NOTICE_TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION,
    NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
    NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
    NoticeConsumptionProjectionEntry,
)

_build_multimodal_consumption_metadata = _multimodal.build_multimodal_consumption_metadata
_resolve_inventory_multimodal_consumption_decision = (
    _multimodal.resolve_inventory_multimodal_consumption_decision
)


def _build_notice_level_entries(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    routing_sample: AuthenticatedNoticeRoutingSample | None = None,
    attachment_records: Sequence[DocumentRegistryRecord] = (),
    object_store: InternalNoticeConsumptionProjectionObjectStore | None = None,
    source_bucket: str = "",
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    entries = [_build_notice_window_entry(inventory_entry, routing_sample=routing_sample)]
    category_role = _resolve_notice_level_primary_role(inventory_entry, routing_sample)
    if routes_to_service_status_candidate(
        inventory_entry=inventory_entry,
        routing_sample=routing_sample,
    ):
        entries.append(
            _build_service_status_override_entry(
                inventory_entry,
                routing_sample=routing_sample,
                attachment_records=attachment_records,
            )
        )
    special_service_candidate_kind = _resolve_special_service_candidate_kind(
        inventory_entry,
        routing_sample=routing_sample,
        object_store=object_store,
        source_bucket=source_bucket,
    )
    if special_service_candidate_kind:
        entries.append(
            _build_special_service_notice_entry(
                inventory_entry,
                special_service_candidate_kind=special_service_candidate_kind,
            )
        )
    if _looks_like_stable_contact_update_notice(inventory_entry):
        entries.append(_build_stable_contact_update_entry(inventory_entry))
    if category_role == NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE:
        entries.append(_build_procurement_notice_entry(inventory_entry))
    elif category_role in {
        NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION,
        NOTICE_PRIMARY_ROLE_LECTURE_ACTIVITY,
    }:
        entries.append(_build_no_adoption_notice_entry(inventory_entry, primary_role=category_role))
    entries.extend(_build_attachment_form_template_entries(inventory_entry))
    return tuple(entries)


def _build_notice_window_entry(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    routing_sample: AuthenticatedNoticeRoutingSample | None = None,
) -> NoticeConsumptionProjectionEntry:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    multimodal_decision = _resolve_inventory_multimodal_consumption_decision(inventory_entry)
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus=inventory_entry.corpus,
        source_collection=inventory_entry.collection,
        source_notice_id=inventory_entry.notice_id,
        unit_id=f"notice_unit:{inventory_entry.document_id}:notice_window",
        primary_role=NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        temporal_policy=NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
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
            "owner_expectation_count": int(parent_snapshot.get("owner_expectation_count") or 0),
            **_build_multimodal_consumption_metadata(
                multimodal_decision,
                include_not_required=True,
            ),
            **routing_metadata(routing_sample),
        },
    )


def _build_procurement_notice_entry(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> NoticeConsumptionProjectionEntry:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    notice_title = str(parent_snapshot.get("notice_title") or inventory_entry.document_id)
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus=inventory_entry.corpus,
        source_collection=inventory_entry.collection,
        source_notice_id=inventory_entry.notice_id,
        unit_id=f"notice_unit:{inventory_entry.document_id}:procurement_notice",
        primary_role=NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
        temporal_policy=NOTICE_TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        source_notice_document_id=inventory_entry.document_id,
        source_document_id=inventory_entry.document_id,
        source_notice_release_time=str(parent_snapshot.get("notice_release_time") or "") or None,
        role_metadata={
            "notice_title": notice_title,
            "notice_category": NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
            "notice_query_reason": "internal_procurement_notice_history",
        },
    )


def _build_no_adoption_notice_entry(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    primary_role: str,
) -> NoticeConsumptionProjectionEntry:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    notice_title = str(parent_snapshot.get("notice_title") or inventory_entry.document_id)
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus=inventory_entry.corpus,
        source_collection=inventory_entry.collection,
        source_notice_id=inventory_entry.notice_id,
        unit_id=f"notice_unit:{inventory_entry.document_id}:{primary_role}",
        primary_role=primary_role,
        semantic_owner=NOTICE_SEMANTIC_OWNER_WRAPPER_NOTICE,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
        temporal_policy=NOTICE_TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION,
        completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
        answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
        consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        source_notice_document_id=inventory_entry.document_id,
        source_document_id=inventory_entry.document_id,
        source_notice_release_time=str(parent_snapshot.get("notice_release_time") or "") or None,
        role_metadata={
            "notice_title": notice_title,
            "notice_category": primary_role,
            "no_adoption_reason": "internal_restricted_publication_not_admitted",
        },
    )


def _build_service_status_override_entry(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    routing_sample: AuthenticatedNoticeRoutingSample | None = None,
    attachment_records: Sequence[DocumentRegistryRecord] = (),
) -> NoticeConsumptionProjectionEntry:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    notice_title = str(parent_snapshot.get("notice_title") or inventory_entry.document_id)
    attachment_document_ids = resolve_attachment_document_ids(
        inventory_entry=inventory_entry,
        attachment_records=attachment_records,
    )
    attachment_ref_ids = resolve_attachment_ref_ids(
        inventory_entry=inventory_entry,
        attachment_document_ids=attachment_document_ids,
    )
    service_status_candidate_kind = resolve_service_status_candidate_kind(
        title_compact=_notice_title_compact(inventory_entry),
        routing_sample=routing_sample,
    )
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus=inventory_entry.corpus,
        source_collection=inventory_entry.collection,
        source_notice_id=inventory_entry.notice_id,
        unit_id=f"notice_unit:{inventory_entry.document_id}:service_status_override",
        primary_role=NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=inventory_entry.document_id,
        source_document_id=inventory_entry.document_id,
        source_attachment_ref_ids=attachment_ref_ids,
        source_notice_release_time=str(parent_snapshot.get("notice_release_time") or "") or None,
        role_metadata={
            "notice_title": notice_title,
            "notice_category": NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
            "notice_query_reason": "service_status_typed_materialization_candidate",
            "service_status_candidate_kind": service_status_candidate_kind,
            "attachment_document_ids": attachment_document_ids,
            **routing_metadata(routing_sample),
        },
    )


def _build_special_service_notice_entry(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    special_service_candidate_kind: str,
) -> NoticeConsumptionProjectionEntry:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    notice_title = str(parent_snapshot.get("notice_title") or inventory_entry.document_id)
    is_transport_reservation = special_service_candidate_kind == "transport_reservation_instruction"
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus=inventory_entry.corpus,
        source_collection=inventory_entry.collection,
        source_notice_id=inventory_entry.notice_id,
        unit_id=f"notice_unit:{inventory_entry.document_id}:special_service_notice",
        primary_role=NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=(
            NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES
            if is_transport_reservation
            else NOTICE_DEFAULT_AGENT_NOTICE
        ),
        target_surface=NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=(
            NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
            if is_transport_reservation
            else NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY
        ),
        source_notice_document_id=inventory_entry.document_id,
        source_document_id=inventory_entry.document_id,
        source_notice_release_time=str(parent_snapshot.get("notice_release_time") or "") or None,
        role_metadata={
            "notice_title": notice_title,
            "notice_category": NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
            "special_service_candidate_kind": special_service_candidate_kind,
            "notice_query_reason": (
                "transport_reservation_instruction_typed_materialization_candidate"
                if is_transport_reservation
                else "special_service_not_admitted"
            ),
        },
    )


def _build_stable_contact_update_entry(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> NoticeConsumptionProjectionEntry:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    notice_title = str(parent_snapshot.get("notice_title") or inventory_entry.document_id)
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus=inventory_entry.corpus,
        source_collection=inventory_entry.collection,
        source_notice_id=inventory_entry.notice_id,
        unit_id=f"notice_unit:{inventory_entry.document_id}:stable_contact_update",
        primary_role=NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        source_notice_document_id=inventory_entry.document_id,
        source_document_id=inventory_entry.document_id,
        source_notice_release_time=str(parent_snapshot.get("notice_release_time") or "") or None,
        role_metadata={
            "notice_title": notice_title,
            "notice_category": NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE,
            "notice_query_reason": "stable_contact_not_admitted",
        },
    )


def _build_attachment_form_template_entries(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    notice_title = str(parent_snapshot.get("notice_title") or inventory_entry.document_id)
    plans = tuple(
        dict(plan)
        for plan in parent_snapshot.get("attachment_projection_plans") or ()
        if isinstance(plan, dict)
    )
    entries: list[NoticeConsumptionProjectionEntry] = []
    for plan in plans:
        if not _looks_like_attachment_form_template_plan(plan):
            continue
        attachment_ref_id = str(plan.get("attachment_ref_id") or "").strip()
        if not attachment_ref_id:
            continue
        attachment_document_id = str(plan.get("document_id") or "").strip()
        filename = str(
            plan.get("attachment_filename")
            or plan.get("original_filename")
            or plan.get("filename")
            or ""
        ).strip()
        entries.append(
            NoticeConsumptionProjectionEntry(
                source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
                source_corpus=inventory_entry.corpus,
                source_collection=inventory_entry.collection,
                source_notice_id=inventory_entry.notice_id,
                unit_id=(
                    f"notice_unit:{inventory_entry.document_id}:"
                    f"attachment_form_template:{attachment_ref_id}"
                ),
                primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
                semantic_owner=NOTICE_SEMANTIC_OWNER_ATTACHMENT_DOCUMENT,
                default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
                target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                temporal_policy=NOTICE_TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION,
                completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
                answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
                consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                source_notice_document_id=inventory_entry.document_id,
                source_document_id=attachment_document_id or inventory_entry.document_id,
                source_attachment_ref_ids=(attachment_ref_id,),
                source_notice_release_time=str(parent_snapshot.get("notice_release_time") or "")
                or None,
                role_metadata={
                    "notice_title": str(
                        parent_snapshot.get("notice_title") or inventory_entry.document_id
                    ),
                    "attachment_ref_id": attachment_ref_id,
                    "attachment_document_id": attachment_document_id or None,
                    "attachment_filename": filename or None,
                    "notice_query_reason": "attachment_form_template_query_hint_only",
                },
            )
        )
    if entries or inventory_entry.text_extractable_count <= 0:
        return tuple(entries)
    return tuple(entries)
