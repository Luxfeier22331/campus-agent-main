from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionManifestReport,
)
from campus_ingestion_core.internal_notice_regulation_promotion_shared import (
    InternalNoticeRegulationPromotionDocumentReport,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
)

_REGULATION_TITLE_KEYWORDS = (
    "办法",
    "规定",
    "细则",
    "条例",
    "章程",
    "准则",
    "指导意见",
    "管理制度",
)
_REGULATION_WRAPPER_PREFIXES = (
    "关于发布",
    "关于印发",
    "关于修订",
    "关于转发",
    "关于公布",
)
_REGULATION_TARGET_SURFACES = {
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
}
_REGULATION_PRIMARY_ROLES = {
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
}


@dataclass(frozen=True, slots=True)
class InternalNoticeSelectedRegulationCohortAuditRow:
    notice_id: str
    title: str
    source_url: str | None
    notice_release_time: str | None
    attachment_ref_count: int
    attachment_document_count: int
    owner_expectation_count: int
    owner_expectation_kinds: tuple[str, ...]
    target_surfaces: tuple[str, ...]
    consumption_statuses: tuple[str, ...]
    source_document_ids: tuple[str, ...]
    classification: str
    target_recommendation: str
    stable_reason: str
    import_eligible: bool


@dataclass(frozen=True, slots=True)
class InternalNoticeSelectedRegulationCohortAuditReport:
    source_corpus: str
    source_collection: str
    requested_notice_ids: tuple[str, ...]
    selected_notice_ids: tuple[str, ...]
    missing_projection_notice_ids: tuple[str, ...]
    row_count: int
    classification_counts: dict[str, int]
    selected_import_notice_ids: tuple[str, ...]
    held_notice_ids: tuple[str, ...]
    rows: tuple[InternalNoticeSelectedRegulationCohortAuditRow, ...]


def build_internal_notice_selected_regulation_cohort_audit(
    *,
    projection_store: NoticeConsumptionProjectionStore,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    promotion_report: InternalNoticeRegulationPromotionManifestReport | None = None,
) -> InternalNoticeSelectedRegulationCohortAuditReport:
    selected_notice_ids = _normalize_notice_ids(notice_ids)
    projection_entries = projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=selected_notice_ids,
    )
    inventory_entries = source_truth_inventory_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=selected_notice_ids,
    )
    inventory_by_notice = {entry.notice_id: entry for entry in inventory_entries}
    entries_by_notice = _group_entries_by_notice(projection_entries)
    promotion_reports_by_notice = _group_promotion_reports_by_notice(promotion_report)

    audit_notice_ids = tuple(
        sorted(
            notice_id
            for notice_id in set(entries_by_notice) | set(promotion_reports_by_notice)
            if _is_regulation_like_notice(
                notice_id=notice_id,
                entries=entries_by_notice.get(notice_id, ()),
                inventory_entry=inventory_by_notice.get(notice_id),
                promotion_reports=promotion_reports_by_notice.get(notice_id, ()),
            )
        )
    )
    missing_projection_notice_ids = tuple(
        notice_id for notice_id in selected_notice_ids if notice_id not in entries_by_notice
    )
    rows = tuple(
        _build_audit_row(
            notice_id=notice_id,
            entries=entries_by_notice.get(notice_id, ()),
            inventory_entry=inventory_by_notice.get(notice_id),
            promotion_reports=promotion_reports_by_notice.get(notice_id, ()),
        )
        for notice_id in audit_notice_ids
    )
    classification_counts = Counter(row.classification for row in rows)
    return InternalNoticeSelectedRegulationCohortAuditReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        requested_notice_ids=selected_notice_ids,
        selected_notice_ids=audit_notice_ids,
        missing_projection_notice_ids=missing_projection_notice_ids,
        row_count=len(rows),
        classification_counts=dict(sorted(classification_counts.items())),
        selected_import_notice_ids=tuple(row.notice_id for row in rows if row.import_eligible),
        held_notice_ids=tuple(row.notice_id for row in rows if not row.import_eligible),
        rows=rows,
    )


def _build_audit_row(
    *,
    notice_id: str,
    entries: Sequence[NoticeConsumptionProjectionEntry],
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    promotion_reports: Sequence[InternalNoticeRegulationPromotionDocumentReport],
) -> InternalNoticeSelectedRegulationCohortAuditRow:
    classification, target_recommendation, stable_reason, import_eligible = _classify_notice(
        entries=entries,
        promotion_reports=promotion_reports,
    )
    parent_snapshot = dict(None if inventory_entry is None else inventory_entry.parent_snapshot)
    owner_expectation_kinds = tuple(
        sorted(
            {
                _optional_text(item.get("owner_kind"))
                for item in parent_snapshot.get("owner_expectations") or ()
                if isinstance(item, dict) and _optional_text(item.get("owner_kind"))
            }
        )
    )
    return InternalNoticeSelectedRegulationCohortAuditRow(
        notice_id=notice_id,
        title=_resolve_title(entries=entries, inventory_entry=inventory_entry),
        source_url=_resolve_source_url(inventory_entry),
        notice_release_time=_resolve_notice_release_time(entries, inventory_entry),
        attachment_ref_count=0 if inventory_entry is None else inventory_entry.attachment_ref_count,
        attachment_document_count=(
            0 if inventory_entry is None else inventory_entry.attachment_document_count
        ),
        owner_expectation_count=int(parent_snapshot.get("owner_expectation_count") or 0),
        owner_expectation_kinds=owner_expectation_kinds,
        target_surfaces=tuple(sorted({entry.target_surface for entry in entries})),
        consumption_statuses=tuple(sorted({entry.consumption_status for entry in entries})),
        source_document_ids=tuple(
            sorted(
                {
                    str(entry.source_document_id or entry.source_notice_document_id)
                    for entry in entries
                    if str(entry.source_document_id or entry.source_notice_document_id).strip()
                }
            )
        ),
        classification=classification,
        target_recommendation=target_recommendation,
        stable_reason=stable_reason,
        import_eligible=import_eligible,
    )


def _classify_notice(
    *,
    entries: Sequence[NoticeConsumptionProjectionEntry],
    promotion_reports: Sequence[InternalNoticeRegulationPromotionDocumentReport],
) -> tuple[str, str, str, bool]:
    if _has_ready_target(entries, NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES):
        return (
            "full_text_candidate",
            NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
            "target_ready",
            True,
        )
    if _has_ready_target(entries, NOTICE_TARGET_SURFACE_SCOPED_RULES):
        return ("scoped_rule_candidate", NOTICE_TARGET_SURFACE_SCOPED_RULES, "target_ready", True)

    stable_reasons = _stable_reasons(entries=entries, promotion_reports=promotion_reports)
    owner_reason = _first_reason(
        stable_reasons,
        (
            "attachment_backed_regulation_body_missing",
            "file_release_backed_regulation_body_missing",
            "official_web_backed_regulation_body_missing",
        ),
    )
    if owner_reason == "attachment_backed_regulation_body_missing":
        return ("attachment_owner_candidate", "owner_recovery", owner_reason, False)
    if owner_reason == "file_release_backed_regulation_body_missing":
        return ("file_release_owner_candidate", "owner_recovery", owner_reason, False)
    if owner_reason == "official_web_backed_regulation_body_missing":
        return ("official_web_owner_candidate", "owner_recovery", owner_reason, False)
    if "parent_notice_body_not_full_regulation_text" in stable_reasons:
        return (
            "amendment_summary_only",
            "notice_card_only",
            "parent_notice_body_not_full_regulation_text",
            False,
        )
    if any(report.promotion_class == "wrapper_notice_only" for report in promotion_reports):
        return ("wrapper_notice_only", "notice_card_only", "wrapper_notice_only", False)
    if any(
        entry.semantic_owner == NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING
        or entry.completeness_status == NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING
        for entry in entries
    ):
        return ("missing_owner", "owner_recovery", "authoritative_owner_missing", False)
    return (
        "notice_card_only",
        "notice_card_only",
        "no_target_ready_regulation_projection_entry",
        False,
    )


def _has_ready_target(
    entries: Sequence[NoticeConsumptionProjectionEntry],
    target_surface: str,
) -> bool:
    return any(
        entry.target_surface == target_surface
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
        for entry in entries
    )


def _stable_reasons(
    *,
    entries: Sequence[NoticeConsumptionProjectionEntry],
    promotion_reports: Sequence[InternalNoticeRegulationPromotionDocumentReport],
) -> tuple[str, ...]:
    reasons: list[str] = []
    for entry in entries:
        metadata = dict(entry.role_metadata or {})
        for value in (
            metadata.get("owner_source_missing_reason"),
            metadata.get("processing_gap_reason"),
            metadata.get("no_adoption_reason"),
        ):
            normalized = _optional_text(value)
            if normalized is not None:
                reasons.append(normalized)
        for value in metadata.get("reasons") or ():
            normalized = _optional_text(value)
            if normalized is not None:
                reasons.append(normalized)
    for report in promotion_reports:
        reasons.extend(report.reasons)
        normalized = _optional_text(report.owner_source_missing_reason)
        if normalized is not None:
            reasons.append(normalized)
    return tuple(dict.fromkeys(reasons))


def _is_regulation_like_notice(
    *,
    notice_id: str,
    entries: Sequence[NoticeConsumptionProjectionEntry],
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    promotion_reports: Sequence[InternalNoticeRegulationPromotionDocumentReport],
) -> bool:
    del notice_id
    if promotion_reports:
        return True
    if any(
        entry.target_surface in _REGULATION_TARGET_SURFACES
        or entry.primary_role in _REGULATION_PRIMARY_ROLES
        for entry in entries
    ):
        return True
    title = _resolve_title(entries=entries, inventory_entry=inventory_entry)
    return _looks_like_regulation_title(title)


def _looks_like_regulation_title(title: str) -> bool:
    normalized = title.strip()
    if not normalized:
        return False
    if any(keyword in normalized for keyword in _REGULATION_TITLE_KEYWORDS):
        return True
    return any(
        normalized.startswith(prefix) and "《" in normalized
        for prefix in _REGULATION_WRAPPER_PREFIXES
    )


def _resolve_title(
    *,
    entries: Sequence[NoticeConsumptionProjectionEntry],
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str:
    for entry in entries:
        metadata = dict(entry.role_metadata or {})
        for key in ("title", "notice_title", "regulation_title_normalized"):
            normalized = _optional_text(metadata.get(key))
            if normalized is not None:
                return normalized
    if inventory_entry is not None:
        snapshot = dict(inventory_entry.parent_snapshot or {})
        normalized = _optional_text(snapshot.get("notice_title"))
        if normalized is not None:
            return normalized
        return inventory_entry.document_id
    return ""


def _resolve_source_url(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str | None:
    if inventory_entry is None:
        return None
    snapshot = dict(inventory_entry.parent_snapshot or {})
    for value in (
        snapshot.get("notice_browser_url"),
        snapshot.get("portal_print_url"),
        dict(snapshot.get("record") or {}).get("source_uri"),
        inventory_entry.source_home_url,
    ):
        normalized = _optional_text(value)
        if normalized is not None:
            return normalized
    return None


def _resolve_notice_release_time(
    entries: Sequence[NoticeConsumptionProjectionEntry],
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str | None:
    for entry in entries:
        normalized = _optional_text(entry.source_notice_release_time)
        if normalized is not None:
            return normalized
    if inventory_entry is None:
        return None
    snapshot = dict(inventory_entry.parent_snapshot or {})
    return _optional_text(snapshot.get("notice_release_time"))


def _group_entries_by_notice(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> dict[str, tuple[NoticeConsumptionProjectionEntry, ...]]:
    grouped: dict[str, list[NoticeConsumptionProjectionEntry]] = {}
    for entry in entries:
        grouped.setdefault(entry.source_notice_id, []).append(entry)
    return {notice_id: tuple(rows) for notice_id, rows in grouped.items()}


def _group_promotion_reports_by_notice(
    report: InternalNoticeRegulationPromotionManifestReport | None,
) -> dict[str, tuple[InternalNoticeRegulationPromotionDocumentReport, ...]]:
    if report is None:
        return {}
    grouped: dict[str, list[InternalNoticeRegulationPromotionDocumentReport]] = {}
    for document in report.documents:
        grouped.setdefault(document.notice_id, []).append(document)
    return {notice_id: tuple(rows) for notice_id, rows in grouped.items()}


def _first_reason(reasons: Sequence[str], candidates: Sequence[str]) -> str | None:
    reason_set = set(reasons)
    for candidate in candidates:
        if candidate in reason_set:
            return candidate
    return None


def _normalize_notice_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def _optional_text(value: Any) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None
