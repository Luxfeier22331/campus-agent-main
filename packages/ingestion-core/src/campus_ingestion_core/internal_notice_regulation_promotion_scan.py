from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import asdict
from typing import Any

import campus_ingestion_core.internal_notice_regulation_promotion_shared as shared
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.internal_notice_regulation_promotion_heuristics import (
    _classify_document,
    _detect_document_nature,
    _detect_missing_parent_owner_reason,
    _determine_semantic_owner_kind,
    _extract_effective_date,
    _extract_issuing_org,
    _extract_notice_title,
    _extract_revision_signal,
    _extract_source_notice_release_time,
    _extract_source_title,
    _has_standalone_body_quality,
    _has_substantive_text,
    _looks_like_wrapper_notice,
    _normalize_regulation_title,
    _provenance_complete,
    _resolve_target_collection,
    _split_regulation_title_fields,
    extract_internal_notice_parent_regulation_body_preview,
)
from campus_ingestion_core.internal_notice_regulation_promotion_shared import (
    InternalNoticePromotionObjectStore,
    InternalNoticePromotionRoutingConfig,
    InternalNoticeRegulationPromotionDocumentReport,
)
from campus_ingestion_core.models import DocumentRegistryRecord


def _scan_document(
    *,
    record: DocumentRegistryRecord,
    bucket_derived: str,
    object_store: InternalNoticePromotionObjectStore,
    routing: InternalNoticePromotionRoutingConfig,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    attachment_plan_by_ref: dict[tuple[str, str], dict[str, Any]],
    bucket_source: str,
    materialized_attachment_refs_by_notice: dict[str, frozenset[str]],
) -> InternalNoticeRegulationPromotionDocumentReport:
    site_id, notice_id, source_kind, attachment_ref_id = _parse_document_lineage(record.document_id)
    attachment_plan = (
        attachment_plan_by_ref.get((notice_id, attachment_ref_id))
        if attachment_ref_id is not None
        else None
    )
    input_lane = _resolve_input_lane(source_kind=source_kind, attachment_plan=attachment_plan)
    source_parent_document_id = (
        f"notice:{site_id}:{notice_id}"
        if source_kind == "attachment_document"
        else record.document_id
    )
    source_attachment_sha256 = _resolve_source_attachment_sha256(
        notice_id=notice_id,
        attachment_ref_id=attachment_ref_id,
        attachment_plan=attachment_plan,
        inventory_entry=inventory_entry,
        object_store=object_store,
        bucket_source=bucket_source,
    )
    source_notice_release_time = _extract_source_notice_release_time(inventory_entry, record)
    missing_materialized_attachment_refs = _missing_materialized_attachment_refs(
        notice_id=notice_id,
        inventory_entry=inventory_entry,
        materialized_attachment_refs_by_notice=materialized_attachment_refs_by_notice,
    )

    reasons: list[str] = []
    try:
        if record.canonical_markdown_object_key is None:
            raise ValueError("canonical_markdown_object_key is required")
        markdown = object_store.get_bytes(
            bucket=bucket_derived,
            key=record.canonical_markdown_object_key,
        ).decode("utf-8")
    except Exception as exc:
        reasons.append("canonical_text_unavailable")
        return InternalNoticeRegulationPromotionDocumentReport(
            document_id=record.document_id,
            notice_id=notice_id,
            site_id=site_id,
            source_kind=source_kind,
            source_title=record.document_id,
            input_lane=input_lane,
            revision_track=record.revision_track,
            version_id=record.version_id,
            action=shared.INTERNAL_NOTICE_PROMOTION_ACTION_REQUIRES_MULTIMODAL_PROCESSING,
            promotion_class=shared.INTERNAL_NOTICE_PROMOTION_CLASS_MACHINE_PROCESSING_REQUIRED,
            document_nature="institutional_regulation",
            semantic_owner_kind=_determine_semantic_owner_kind(
                source_kind=source_kind,
                missing_owner_reason=None,
            ),
            target_corpus=routing.target_corpus,
            target_collection=routing.target_collection,
            regulation_title_normalized=None,
            issuing_org=None,
            effective_date=None,
            revision_signal=None,
            source_notice_release_time=source_notice_release_time,
            source_parent_document_id=source_parent_document_id,
            source_attachment_ref_id=attachment_ref_id,
            source_attachment_sha256=source_attachment_sha256,
            duplicate_group_key=None,
            duplicate_primary_document_id=None,
            quality_gates_passed=(),
            missing_required_metadata=tuple(routing.required_promotion_metadata),
            reasons=tuple(reasons),
            artifact_key=record.canonical_markdown_object_key,
            owner_source_missing_reason=None,
            read_failure=str(exc),
        )

    _metadata, body = shared._split_front_matter(markdown)
    source_title = _extract_source_title(
        body=body,
        record=record,
        inventory_entry=inventory_entry,
        source_kind=source_kind,
    )
    parent_body_preview = (
        extract_internal_notice_parent_regulation_body_preview(markdown, source_title=source_title)
        if source_kind == "parent_notice"
        else None
    )
    promotion_body = (
        body if parent_body_preview is None else (parent_body_preview.cleaned_body or body)
    )
    combined_text = "\n".join(
        item
        for item in (source_title, promotion_body, _extract_notice_title(inventory_entry))
        if item
    )
    regulation_title_normalized = _normalize_regulation_title(
        source_title=source_title,
        body=promotion_body,
        inventory_entry=inventory_entry,
    )
    (
        regulation_work_title,
        regulation_edition_label,
        regulation_display_title,
        source_title_literal,
    ) = _split_regulation_title_fields(regulation_title_normalized)
    issuing_org = _extract_issuing_org(combined_text)
    effective_date = shared._optional_text(record.effective_date) or _extract_effective_date(
        promotion_body
    )
    revision_signal = _extract_revision_signal(combined_text)
    duplicate_group_key = _build_duplicate_group_key(
        source_attachment_sha256=source_attachment_sha256,
        regulation_title_normalized=regulation_title_normalized,
        promotion_body=promotion_body,
        fallback_content_hash=record.content_hash,
    )
    quality_gates: list[str] = []
    document_nature = _detect_document_nature(
        source_kind=source_kind,
        source_title=source_title,
        body=promotion_body,
        inventory_entry=inventory_entry,
    )
    target_collection = _resolve_target_collection(
        routing=routing,
        document_nature=document_nature,
    )

    if _has_substantive_text(promotion_body):
        quality_gates.append("canonical_text_available")
    else:
        reasons.append("insufficient_body_text")

    if source_kind == "attachment_document":
        if not _looks_like_wrapper_notice(source_title=source_title, body=body):
            quality_gates.append("wrapper_semantics_removed")
        else:
            reasons.append("wrapper_semantics_still_present")
        if _has_standalone_body_quality(body):
            quality_gates.append("standalone_body_quality_passed")
        else:
            reasons.append("body_quality_needs_review")
    elif parent_body_preview is not None:
        if parent_body_preview.wrapper_semantics_removed:
            quality_gates.append("wrapper_semantics_removed")
        else:
            reasons.append("wrapper_semantics_still_present")
        if parent_body_preview.standalone_body_quality_passed:
            quality_gates.append("standalone_body_quality_passed")
        else:
            reasons.append("body_quality_needs_review")
        if inventory_entry is not None and inventory_entry.attachment_document_count > 0:
            reasons.append("wrapper_notice_retained_in_internal_notice")
    elif inventory_entry is not None and inventory_entry.attachment_document_count > 0:
        reasons.append("wrapper_notice_retained_in_internal_notice")

    if _provenance_complete(
        notice_id=notice_id,
        source_parent_document_id=source_parent_document_id,
        source_kind=source_kind,
        source_attachment_ref_id=attachment_ref_id,
        source_attachment_sha256=source_attachment_sha256,
    ):
        quality_gates.append("provenance_complete")
    else:
        reasons.append("provenance_incomplete")

    missing_parent_owner_reason = _detect_missing_parent_owner_reason(
        source_kind=source_kind,
        source_title=source_title,
        original_body=body,
        inventory_entry=inventory_entry,
        regulation_title_normalized=regulation_title_normalized,
    )
    if source_kind == "parent_notice" and missing_parent_owner_reason is not None:
        reasons.append(missing_parent_owner_reason)
        promotion_class, action = (
            shared.INTERNAL_NOTICE_PROMOTION_CLASS_MACHINE_PROCESSING_REQUIRED,
            shared.INTERNAL_NOTICE_PROMOTION_ACTION_REQUIRES_MULTIMODAL_PROCESSING,
        )
    elif source_kind == "parent_notice" and missing_materialized_attachment_refs:
        reasons.append("input_incomplete_missing_attachment_docs")
        promotion_class, action = (
            shared.INTERNAL_NOTICE_PROMOTION_CLASS_MACHINE_PROCESSING_REQUIRED,
            shared.INTERNAL_NOTICE_PROMOTION_ACTION_REQUIRES_MULTIMODAL_PROCESSING,
        )
    else:
        promotion_class, action = _classify_document(
            source_kind=source_kind,
            input_lane=input_lane,
            source_title=source_title,
            body=promotion_body,
            inventory_entry=inventory_entry,
            routing=routing,
            record=record,
            reasons=reasons,
        )

    if action == "promote_candidate":
        allowed_revision_tracks = routing.promotion_classes[
            promotion_class
        ].accepted_revision_tracks
        if allowed_revision_tracks and record.revision_track not in allowed_revision_tracks:
            reasons.append("revision_track_not_admitted")
            action = routing.default_action
        if not regulation_title_normalized:
            reasons.append("missing_regulation_title")
            action = shared.INTERNAL_NOTICE_PROMOTION_ACTION_REQUIRES_MULTIMODAL_PROCESSING
            promotion_class = shared.INTERNAL_NOTICE_PROMOTION_CLASS_MACHINE_PROCESSING_REQUIRED

    semantic_owner_kind = _determine_semantic_owner_kind(
        source_kind=source_kind,
        missing_owner_reason=missing_parent_owner_reason,
    )
    metadata_fields = {
        "promotion_class": promotion_class,
        "promotion_source_collection": f"{routing.source_corpus}/{routing.source_collection}",
        "semantic_owner_kind": semantic_owner_kind,
        "source_notice_ids": [notice_id],
        "source_parent_document_id": source_parent_document_id,
        "source_attachment_ref_id": attachment_ref_id,
        "source_attachment_sha256": source_attachment_sha256,
        "source_notice_release_time": source_notice_release_time,
        "regulation_title_normalized": regulation_title_normalized,
        "regulation_work_title": regulation_work_title,
        "regulation_edition_label": regulation_edition_label,
        "regulation_display_title": regulation_display_title,
        "source_title_literal": source_title_literal,
        "issuing_org": issuing_org,
        "effective_date": effective_date,
        "revision_signal": revision_signal,
        "supersedes_candidate_keys": [],
    }
    missing_required_metadata = tuple(
        field_name
        for field_name in routing.required_promotion_metadata
        if shared._is_missing_metadata(
            field_name=field_name,
            value=metadata_fields.get(field_name),
            source_kind=source_kind,
        )
    )
    return InternalNoticeRegulationPromotionDocumentReport(
        document_id=record.document_id,
        notice_id=notice_id,
        site_id=site_id,
        source_kind=source_kind,
        source_title=source_title,
        input_lane=input_lane,
        revision_track=record.revision_track,
        version_id=record.version_id,
        action=action,
        promotion_class=promotion_class,
        document_nature=document_nature,
        semantic_owner_kind=semantic_owner_kind,
        target_corpus=routing.target_corpus,
        target_collection=target_collection,
        regulation_title_normalized=regulation_title_normalized,
        issuing_org=issuing_org,
        effective_date=effective_date,
        revision_signal=revision_signal,
        source_notice_release_time=source_notice_release_time,
        source_parent_document_id=source_parent_document_id,
        source_attachment_ref_id=attachment_ref_id,
        source_attachment_sha256=source_attachment_sha256,
        duplicate_group_key=duplicate_group_key,
        duplicate_primary_document_id=None,
        quality_gates_passed=tuple(sorted(set(quality_gates))),
        missing_required_metadata=missing_required_metadata,
        reasons=tuple(dict.fromkeys(reasons)),
        artifact_key=record.canonical_markdown_object_key,
        owner_source_missing_reason=missing_parent_owner_reason,
        regulation_work_title=regulation_work_title,
        regulation_edition_label=regulation_edition_label,
        regulation_display_title=regulation_display_title,
        source_title_literal=source_title_literal,
    )


def _apply_duplicate_resolution(
    reports: tuple[InternalNoticeRegulationPromotionDocumentReport, ...],
) -> tuple[InternalNoticeRegulationPromotionDocumentReport, ...]:
    candidate_groups: dict[str, list[InternalNoticeRegulationPromotionDocumentReport]] = {}
    for report in reports:
        if report.action != "promote_candidate" or not report.duplicate_group_key:
            continue
        candidate_groups.setdefault(report.duplicate_group_key, []).append(report)

    rewritten: dict[str, InternalNoticeRegulationPromotionDocumentReport] = {}
    for report in reports:
        rewritten[report.document_id] = report

    for group in candidate_groups.values():
        primary = min(group, key=_candidate_sort_key)
        rewritten[primary.document_id] = _replace_document_report(
            primary,
            quality_gates_passed=tuple(
                sorted({*primary.quality_gates_passed, "duplicate_check_passed"})
            ),
        )
        for duplicate in group:
            if duplicate.document_id == primary.document_id:
                continue
            rewritten[duplicate.document_id] = _replace_document_report(
                duplicate,
                action="hold_in_internal_notice",
                duplicate_primary_document_id=primary.document_id,
                reasons=tuple(
                    dict.fromkeys((*duplicate.reasons, "duplicate_attachment_or_content"))
                ),
            )

    return tuple(rewritten[report.document_id] for report in reports)


def _apply_required_quality_gate_enforcement(
    reports: tuple[InternalNoticeRegulationPromotionDocumentReport, ...],
    *,
    routing: InternalNoticePromotionRoutingConfig,
) -> tuple[InternalNoticeRegulationPromotionDocumentReport, ...]:
    rewritten: list[InternalNoticeRegulationPromotionDocumentReport] = []
    for report in reports:
        if report.action != "promote_candidate":
            rewritten.append(report)
            continue
        class_config = routing.promotion_classes.get(report.promotion_class)
        if class_config is None or not class_config.required_quality_gates:
            rewritten.append(report)
            continue
        missing_quality_gates = tuple(
            gate
            for gate in class_config.required_quality_gates
            if gate not in report.quality_gates_passed
        )
        if not missing_quality_gates:
            rewritten.append(report)
            continue
        rewritten.append(
            _replace_document_report(
                report,
                action=shared.INTERNAL_NOTICE_PROMOTION_ACTION_REQUIRES_MULTIMODAL_PROCESSING,
                promotion_class=(
                    shared.INTERNAL_NOTICE_PROMOTION_CLASS_MACHINE_PROCESSING_REQUIRED
                ),
                reasons=tuple(
                    dict.fromkeys(
                        (
                            *report.reasons,
                            *(f"missing_quality_gate:{gate}" for gate in missing_quality_gates),
                        )
                    )
                ),
            )
        )
    return tuple(rewritten)


def _replace_document_report(
    report: InternalNoticeRegulationPromotionDocumentReport,
    /,
    **updates: Any,
) -> InternalNoticeRegulationPromotionDocumentReport:
    payload = asdict(report)
    payload.update(updates)
    return InternalNoticeRegulationPromotionDocumentReport(**payload)


def _candidate_sort_key(
    report: InternalNoticeRegulationPromotionDocumentReport,
) -> tuple[object, ...]:
    lane_rank = {
        "attachment_text_extractable": 0,
        "attachment_ocr_required": 1,
        "notice_body": 2,
    }.get(report.input_lane, 3)
    revision_rank = {
        "current-effective": 0,
        "source-faithful": 1,
    }.get(report.revision_track, 2)
    return (lane_rank, revision_rank, report.document_id)


def _build_duplicate_group_key(
    *,
    source_attachment_sha256: str | None,
    regulation_title_normalized: str | None,
    promotion_body: str,
    fallback_content_hash: str,
) -> str | None:
    if source_attachment_sha256:
        return source_attachment_sha256
    substantive_body = promotion_body.strip()
    if not substantive_body:
        return fallback_content_hash
    title = (regulation_title_normalized or "").strip()
    digest = hashlib.sha256("\n".join((title, substantive_body)).encode("utf-8")).hexdigest()
    return f"semantic:{digest}"


def _select_latest_scope_records(
    records: Sequence[DocumentRegistryRecord],
) -> tuple[DocumentRegistryRecord, ...]:
    latest_by_key: dict[tuple[str, str], DocumentRegistryRecord] = {}
    for record in records:
        key = (record.document_id, record.revision_track)
        current = latest_by_key.get(key)
        if current is None or _record_sort_key(record) > _record_sort_key(current):
            latest_by_key[key] = record
    return tuple(
        sorted(
            latest_by_key.values(),
            key=lambda runtime_record: (runtime_record.document_id, runtime_record.revision_track),
        )
    )


def _record_sort_key(record: DocumentRegistryRecord) -> tuple[object, ...]:
    return (1 if record.is_current else 0, record.ingestion_timestamp, record.version_id)


def _filter_selected_records(
    records: Sequence[DocumentRegistryRecord],
    *,
    notice_ids: tuple[str, ...],
    document_ids: tuple[str, ...],
) -> tuple[DocumentRegistryRecord, ...]:
    notice_id_set = set(notice_ids)
    document_id_set = set(document_ids)
    if not notice_id_set and not document_id_set:
        return tuple(records)
    selected: list[DocumentRegistryRecord] = []
    for record in records:
        notice_id = _extract_notice_id(record.document_id)
        if (notice_id_set and notice_id in notice_id_set) or (
            document_id_set and record.document_id in document_id_set
        ):
            selected.append(record)
    return tuple(selected)


def _build_attachment_plan_index(
    entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
) -> dict[tuple[str, str], dict[str, Any]]:
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in entries:
        for raw_plan in entry.parent_snapshot.get("attachment_projection_plans") or ():
            plan = dict(raw_plan)
            attachment_ref_id = shared._optional_text(plan.get("attachment_ref_id"))
            if attachment_ref_id is None:
                continue
            index[(entry.notice_id, attachment_ref_id)] = plan
    return index


def _resolve_source_attachment_sha256(
    *,
    notice_id: str,
    attachment_ref_id: str | None,
    attachment_plan: dict[str, Any] | None,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    object_store: InternalNoticePromotionObjectStore,
    bucket_source: str,
) -> str | None:
    if attachment_ref_id is None:
        return None
    for value in (
        None if attachment_plan is None else attachment_plan.get("attachment_content_sha256"),
        None if attachment_plan is None else attachment_plan.get("content_sha256"),
    ):
        normalized = shared._optional_text(value)
        if normalized is not None:
            return normalized
    if inventory_entry is None or not inventory_entry.attachment_refs_key:
        return None
    try:
        payload = object_store.get_bytes(
            bucket=bucket_source,
            key=inventory_entry.attachment_refs_key,
        ).decode("utf-8")
    except Exception:
        return None
    for line in payload.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            row = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if shared._optional_text(row.get("notice_id")) != notice_id:
            continue
        if shared._optional_text(row.get("attachment_ref_id")) != attachment_ref_id:
            continue
        normalized = shared._optional_text(row.get("content_sha256"))
        if normalized is not None:
            return normalized
    return None


def _build_materialized_attachment_ref_index(
    records: Sequence[DocumentRegistryRecord],
) -> dict[str, frozenset[str]]:
    index: dict[str, set[str]] = {}
    for record in records:
        _site_id, notice_id, source_kind, attachment_ref_id = _parse_document_lineage(
            record.document_id
        )
        if source_kind != "attachment_document" or attachment_ref_id is None:
            continue
        index.setdefault(notice_id, set()).add(attachment_ref_id)
    return {notice_id: frozenset(refs) for notice_id, refs in index.items()}


def _missing_materialized_attachment_refs(
    *,
    notice_id: str,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    materialized_attachment_refs_by_notice: dict[str, frozenset[str]],
) -> tuple[str, ...]:
    if inventory_entry is None:
        return ()
    expected_ref_ids = {
        attachment_ref_id
        for attachment_ref_id in (
            shared._optional_text(plan.get("attachment_ref_id"))
            for plan in inventory_entry.parent_snapshot.get("attachment_projection_plans") or ()
        )
        if attachment_ref_id is not None
        and _attachment_projection_requires_materialized_document(
            inventory_entry.parent_snapshot,
            attachment_ref_id,
        )
    }
    if not expected_ref_ids:
        return ()
    materialized_ref_ids = set(materialized_attachment_refs_by_notice.get(notice_id, frozenset()))
    return tuple(sorted(expected_ref_ids - materialized_ref_ids))


def _attachment_projection_requires_materialized_document(
    parent_snapshot: dict[str, Any],
    attachment_ref_id: str,
) -> bool:
    for raw_plan in parent_snapshot.get("attachment_projection_plans") or ():
        plan = dict(raw_plan)
        if shared._optional_text(plan.get("attachment_ref_id")) != attachment_ref_id:
            continue
        policy = shared._optional_text(plan.get("materialization_policy"))
        if policy in {"required_document", "conditional_on_extracted_text"}:
            return True
        classification = shared._optional_text(plan.get("classification"))
        return classification in {"text_extractable", "ocr_required"}
    return False


def _parse_document_lineage(document_id: str) -> tuple[str, str, str, str | None]:
    attachment_match = shared._ATTACHMENT_ID_PATTERN.fullmatch(document_id)
    if attachment_match is not None:
        return (
            attachment_match.group("site_id"),
            attachment_match.group("notice_id"),
            "attachment_document",
            attachment_match.group("attachment_ref_id"),
        )
    notice_match = shared._NOTICE_ID_PATTERN.fullmatch(document_id)
    if notice_match is None:
        raise ValueError(f"unsupported internal notice document id: {document_id}")
    return (
        notice_match.group("site_id"),
        notice_match.group("notice_id"),
        "parent_notice",
        None,
    )


def _extract_notice_id(document_id: str) -> str:
    return _parse_document_lineage(document_id)[1]


def _resolve_input_lane(
    *,
    source_kind: str,
    attachment_plan: dict[str, Any] | None,
) -> str:
    if source_kind == "parent_notice":
        return "notice_body"
    classification = shared._optional_text(
        None if attachment_plan is None else attachment_plan.get("classification")
    )
    if classification == "text_extractable":
        return "attachment_text_extractable"
    if classification == "ocr_required":
        return "attachment_ocr_required"
    return "attachment_unknown"
