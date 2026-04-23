from __future__ import annotations

from typing import Any

import campus_ingestion_core.internal_notice_regulation_promotion_shared as shared
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.internal_notice_regulation_promotion_shared import (
    InternalNoticeParentRegulationBodyPreview,
    InternalNoticePromotionRoutingConfig,
)
from campus_ingestion_core.models import DocumentRegistryRecord


def _extract_notice_title(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str | None:
    if inventory_entry is None:
        return None
    return shared._optional_text(inventory_entry.parent_snapshot.get("notice_title"))


def _extract_heading_title(body: str) -> str | None:
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        return shared._HEADING_RE.sub("", stripped).strip() or None
    return None


def _extract_quoted_title(value: str | None) -> str | None:
    if value is None:
        return None
    match = shared._QUOTE_TITLE_RE.search(value)
    if match is None:
        return None
    return match.group(1).strip() or None


def _clean_title_label(value: str | None) -> str | None:
    normalized = shared._optional_text(value)
    if normalized is None:
        return None
    cleaned = shared.re.sub(r"^附件\s*\d+\s*/\s*", "", normalized).strip()
    cleaned = shared.re.sub(r"\.(docx?|pdf)$", "", cleaned, flags=shared.re.IGNORECASE).strip()
    return cleaned or None


def _looks_like_section_heading_title(value: str) -> bool:
    return shared._SECTION_HEADING_TITLE_RE.match(value.strip()) is not None


def _extract_standalone_title_candidate(value: str | None) -> str | None:
    normalized = _clean_title_label(value)
    if normalized is None:
        return None
    if _looks_like_wrapper_notice(source_title=normalized, body=""):
        return None
    if _looks_like_section_heading_title(normalized):
        return None
    return normalized


def _extract_source_title(
    *,
    body: str,
    record: DocumentRegistryRecord,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    source_kind: str,
) -> str:
    if source_kind == "parent_notice":
        title = _extract_notice_title(inventory_entry)
        if title:
            return title
    body_title = _extract_heading_title(body)
    if body_title:
        return body_title
    return record.document_id


def _extract_source_notice_release_time(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    record: DocumentRegistryRecord,
) -> str | None:
    if inventory_entry is not None:
        value = shared._optional_text(inventory_entry.parent_snapshot.get("notice_release_time"))
        if value is not None:
            return value
        record_payload = dict(inventory_entry.parent_snapshot.get("record") or {})
        value = shared._optional_text(record_payload.get("published_date"))
        if value is not None:
            return value
    return shared._optional_text(record.published_date)


def _normalize_regulation_title(
    *,
    source_title: str,
    body: str,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str | None:
    heading_title = _extract_heading_title(body)
    notice_title = _extract_notice_title(inventory_entry)
    for candidate in (
        _extract_quoted_title(source_title),
        _extract_standalone_title_candidate(source_title),
        _extract_standalone_title_candidate(heading_title),
        _extract_quoted_title(heading_title),
        _extract_quoted_title(body),
        _extract_quoted_title(notice_title),
        _extract_standalone_title_candidate(notice_title),
    ):
        normalized = _clean_title_label(candidate)
        if normalized:
            return normalized
    return None


def _looks_like_edition_label(value: str) -> bool:
    normalized = value.strip()
    if not normalized:
        return False
    return bool(
        shared.re.fullmatch(r"20\d{2}\s*版", normalized)
        or shared.re.fullmatch(r"20\d{2}年(?:修订|修正版|更新版)", normalized)
        or shared.re.fullmatch(r"第?\d+版", normalized)
        or normalized in {"最新版", "修订版", "修正版", "更新版"}
    )


def _split_regulation_title_fields(
    title: str | None,
) -> tuple[str | None, str | None, str | None, str | None]:
    source_title_literal = shared._optional_text(title)
    if source_title_literal is None:
        return (None, None, None, None)
    work_title = source_title_literal
    edition_label: str | None = None
    parenthetical_match = shared._TRAILING_PARENTHETICAL_RE.match(source_title_literal)
    if parenthetical_match is not None:
        candidate_label = parenthetical_match.group("label").strip()
        candidate_work_title = shared._optional_text(parenthetical_match.group("work"))
        if candidate_work_title is not None and _looks_like_edition_label(candidate_label):
            work_title = candidate_work_title
            edition_label = candidate_label
    if edition_label is None:
        bare_match = shared._TRAILING_BARE_EDITION_RE.match(source_title_literal)
        if bare_match is not None:
            candidate_label = bare_match.group("label").strip()
            candidate_work_title = shared._optional_text(bare_match.group("work"))
            if candidate_work_title is not None:
                work_title = candidate_work_title
                edition_label = candidate_label
    display_title = work_title if edition_label is None else f"{work_title} / {edition_label}"
    return (work_title, edition_label, display_title, source_title_literal)


def _extract_issuing_org(text: str) -> str | None:
    match = shared._ISSUING_ORG_RE.search(text)
    if match is None:
        return None
    return match.group(1)


def _extract_effective_date(text: str) -> str | None:
    match = shared._DATE_RE.search(text)
    if match is None:
        return None
    return match.group(1)


def _extract_revision_signal(text: str) -> str | None:
    match = shared._REVISION_SIGNAL_RE.search(text)
    if match is None:
        return None
    return match.group(1)


def extract_internal_notice_parent_regulation_body_preview(
    markdown: str,
    *,
    source_title: str | None = None,
) -> InternalNoticeParentRegulationBodyPreview:
    _metadata, body = shared._split_front_matter(markdown)
    source_title_resolved = _clean_title_label(source_title) or _extract_heading_title(body) or ""
    regulation_title_normalized = _normalize_regulation_title(
        source_title=source_title_resolved,
        body=body,
        inventory_entry=None,
    )
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    if lines and _clean_title_label(shared._HEADING_RE.sub("", lines[0])) == _clean_title_label(
        source_title_resolved
    ):
        lines = lines[1:]

    removed_leading_lines: list[str] = []
    removed_trailing_lines: list[str] = []

    while lines and _is_wrapper_leading_line(
        lines[0],
        regulation_title_normalized=regulation_title_normalized,
    ):
        removed_leading_lines.append(lines.pop(0))

    while lines and _is_document_number_line(lines[0]):
        removed_leading_lines.append(lines.pop(0))

    while lines and _is_wrapper_leading_line(
        lines[0],
        regulation_title_normalized=regulation_title_normalized,
    ):
        removed_leading_lines.append(lines.pop(0))

    while lines and _is_wrapper_trailing_line(lines[-1]):
        removed_trailing_lines.insert(0, lines.pop())

    cleaned_body = "\n\n".join(lines).strip()
    wrapper_semantics_removed = not _looks_like_wrapper_body(cleaned_body)
    standalone_body_quality_passed = _has_standalone_body_quality(cleaned_body)
    regulation_structure_retained = _has_regulation_body_structure(cleaned_body)
    return InternalNoticeParentRegulationBodyPreview(
        source_title=source_title_resolved,
        regulation_title_normalized=regulation_title_normalized,
        cleaned_body=cleaned_body,
        removed_leading_lines=tuple(removed_leading_lines),
        removed_trailing_lines=tuple(removed_trailing_lines),
        wrapper_semantics_removed=wrapper_semantics_removed,
        standalone_body_quality_passed=standalone_body_quality_passed,
        regulation_structure_retained=regulation_structure_retained,
        promotable_standalone_body=(
            wrapper_semantics_removed
            and standalone_body_quality_passed
            and regulation_structure_retained
        ),
    )


def _is_wrapper_leading_line(
    line: str,
    *,
    regulation_title_normalized: str | None,
) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    if normalized.endswith(("：", ":")):
        return True
    if any(keyword in normalized for keyword in shared._WRAPPER_NOTICE_KEYWORDS):
        return True
    if "我校于" in normalized and any(
        keyword in normalized for keyword in ("印发", "发布", "修订")
    ):
        return True
    return bool(regulation_title_normalized and regulation_title_normalized in normalized and any(keyword in normalized for keyword in ("印发", "发布", "修订", "通知如下")))


def _is_wrapper_trailing_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    if normalized.startswith("附件"):
        return True
    if normalized.startswith("特此通知"):
        return True
    if shared._DATE_RE.fullmatch(normalized) is not None:
        return True
    return bool(len(normalized) <= 24 and any(keyword in normalized for keyword in ("中央民族大学", "处", "部", "学院", "中心", "办公室")))


def _is_document_number_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    return shared._DOCUMENT_NUMBER_RE.fullmatch(normalized) is not None


def _looks_like_formal_regulation(text: str) -> bool:
    return any(keyword in text for keyword in shared._FORMAL_REGULATION_KEYWORDS)


def _looks_like_normative_handbook(text: str) -> bool:
    return any(keyword in text for keyword in shared._NORMATIVE_HANDBOOK_KEYWORDS)


def _looks_like_wrapper_notice(*, source_title: str, body: str) -> bool:
    combined = "\n".join((source_title, body))
    if any(source_title.startswith(prefix) for prefix in shared._WRAPPER_NOTICE_PREFIXES):
        return True
    if "通知" in source_title and shared._QUOTE_TITLE_RE.search(source_title):
        return True
    return any(keyword in combined for keyword in shared._WRAPPER_NOTICE_KEYWORDS)


def _looks_like_wrapper_body(body: str) -> bool:
    return any(keyword in body for keyword in shared._WRAPPER_BODY_KEYWORDS)


def _normalize_text_match(value: str | None) -> str:
    if value is None:
        return ""
    return shared._TEXT_MATCH_NORMALIZE_RE.sub("", value)


def _looks_like_draft_document(text: str) -> bool:
    return any(keyword in text for keyword in shared._DRAFT_KEYWORDS)


def _looks_like_operational_scheme(text: str) -> bool:
    return any(keyword in text for keyword in shared._OPERATIONAL_SCHEME_KEYWORDS)


def _looks_like_annual_cycle_or_program_rule(text: str) -> bool:
    return any(keyword in text for keyword in shared._ANNUAL_CYCLE_OR_PROGRAM_RULE_KEYWORDS)


def _looks_like_time_bound_operational_rule(text: str) -> bool:
    return any(keyword in text for keyword in shared._TIME_BOUND_OPERATIONAL_KEYWORDS)


def _has_substantive_text(body: str) -> bool:
    return len(shared.re.sub(r"\s+", "", body)) >= 20


def _has_standalone_body_quality(body: str) -> bool:
    return len(shared.re.sub(r"\s+", "", body)) >= 48


def _has_regulation_body_structure(body: str) -> bool:
    return any(
        pattern.search(body) is not None
        for pattern in (
            shared._ARTICLE_MARKER_RE,
            shared._SECTION_MARKER_RE,
            shared._SUBSECTION_MARKER_RE,
            shared._NUMERIC_LIST_MARKER_RE,
            shared._CIRCLED_LIST_MARKER_RE,
        )
    )


def _provenance_complete(
    *,
    notice_id: str,
    source_parent_document_id: str | None,
    source_kind: str,
    source_attachment_ref_id: str | None,
    source_attachment_sha256: str | None,
) -> bool:
    if not notice_id or not source_parent_document_id:
        return False
    if source_kind != "attachment_document":
        return True
    return bool(source_attachment_ref_id and source_attachment_sha256)


def _resolve_target_collection(
    *,
    routing: InternalNoticePromotionRoutingConfig,
    document_nature: str,
) -> str:
    return (
        routing.document_nature_target_collections.get(document_nature) or routing.target_collection
    )


def _detect_document_nature(
    *,
    source_kind: str,
    source_title: str,
    body: str,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str:
    combined_text = "\n".join(item for item in (source_title, body) if item)
    has_promotable_attachment = (
        source_kind == "parent_notice"
        and inventory_entry is not None
        and inventory_entry.attachment_document_count > 0
    )
    body_is_standalone_parent_regulation = _has_regulation_body_structure(
        body
    ) and _has_substantive_text(body)
    if has_promotable_attachment:
        return "wrapper_notice"
    if (
        _looks_like_wrapper_notice(
            source_title=source_title,
            body=body,
        )
        and not body_is_standalone_parent_regulation
    ):
        return "wrapper_notice"
    if _looks_like_annual_cycle_or_program_rule(combined_text):
        return "annual_cycle_rule"
    if _looks_like_time_bound_operational_rule(combined_text):
        return "time_bound_operational_rule"
    return "institutional_regulation"


def _determine_semantic_owner_kind(
    *,
    source_kind: str,
    missing_owner_reason: str | None,
) -> str:
    if missing_owner_reason == "attachment_backed_regulation_body_missing":
        return "attachment_document"
    if missing_owner_reason == "file_release_backed_regulation_body_missing":
        return "file_release_document"
    if source_kind == "attachment_document":
        return "attachment_document"
    return "notice_body"


def _body_references_regulation_attachment(
    *,
    body: str,
    regulation_title_normalized: str | None,
) -> bool:
    normalized_title = _normalize_text_match(regulation_title_normalized)
    if not normalized_title:
        return False
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or "附件" not in stripped:
            continue
        if not any(keyword in stripped for keyword in shared._ATTACHMENT_REFERENCE_KEYWORDS):
            continue
        if normalized_title in _normalize_text_match(stripped):
            return True
    return False


def _looks_like_file_release_reference(body: str) -> bool:
    return any(keyword in body for keyword in shared._FILE_RELEASE_REFERENCE_KEYWORDS)


def _detect_missing_parent_owner_reason_from_expectations(
    *,
    parent_snapshot: dict[str, Any] | None,
    regulation_title_normalized: str | None,
) -> str | None:
    attachment_expected = False
    file_release_expected = False
    normalized_regulation_title = _normalize_text_match(regulation_title_normalized)
    for raw_expectation in (parent_snapshot or {}).get("owner_expectations") or ():
        if not isinstance(raw_expectation, dict):
            continue
        owner_kind = shared._optional_text(raw_expectation.get("owner_kind"))
        if owner_kind not in {"attachment_document", "file_release_document"}:
            continue
        owner_title_hint = shared._optional_text(raw_expectation.get("owner_title_hint"))
        normalized_owner_title_hint = _normalize_text_match(owner_title_hint)
        if (
            normalized_regulation_title
            and normalized_owner_title_hint
            and normalized_regulation_title not in normalized_owner_title_hint
            and normalized_owner_title_hint not in normalized_regulation_title
        ):
            continue
        if owner_kind == "attachment_document":
            attachment_expected = True
            continue
        if owner_kind == "file_release_document":
            file_release_expected = True
    if attachment_expected:
        return "attachment_backed_regulation_body_missing"
    if file_release_expected:
        return "file_release_backed_regulation_body_missing"
    return None


def _detect_missing_parent_owner_reason(
    *,
    source_kind: str,
    source_title: str,
    original_body: str,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    regulation_title_normalized: str | None,
) -> str | None:
    if source_kind != "parent_notice":
        return None
    if inventory_entry is not None and (
        inventory_entry.attachment_ref_count > 0 or inventory_entry.attachment_document_count > 0
    ):
        return None
    expectation_reason = _detect_missing_parent_owner_reason_from_expectations(
        parent_snapshot=None if inventory_entry is None else inventory_entry.parent_snapshot,
        regulation_title_normalized=regulation_title_normalized,
    )
    if expectation_reason is not None:
        return expectation_reason
    if _body_references_regulation_attachment(
        body=original_body,
        regulation_title_normalized=regulation_title_normalized,
    ):
        return "attachment_backed_regulation_body_missing"
    if _looks_like_wrapper_notice(source_title=source_title, body=original_body) and (
        _looks_like_file_release_reference(original_body)
    ):
        return "file_release_backed_regulation_body_missing"
    return None


def _classify_document(
    *,
    source_kind: str,
    input_lane: str,
    source_title: str,
    body: str,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    routing: InternalNoticePromotionRoutingConfig,
    record: DocumentRegistryRecord,
    reasons: list[str],
) -> tuple[str, str]:
    combined_text = "\n".join(item for item in (source_title, body) if item)
    if source_kind == "parent_notice":
        title_signal_text = "\n".join(
            item
            for item in (
                source_title,
                _extract_notice_title(inventory_entry),
            )
            if item
        )
        if _looks_like_draft_document(combined_text):
            reasons.append("draft_signal_detected")
            return ("manual_promotion_review", "manual_review_required")
        if _looks_like_annual_cycle_or_program_rule(combined_text):
            reasons.append("annual_cycle_or_program_rule_detected")
        if _looks_like_operational_scheme(combined_text):
            reasons.append("operational_scheme_signal_detected")
            return ("manual_promotion_review", "manual_review_required")
        if _looks_like_time_bound_operational_rule(combined_text):
            reasons.append("time_bound_operational_rule_detected")
        has_promotable_attachment = (
            inventory_entry is not None and inventory_entry.attachment_document_count > 0
        )
        body_has_regulation_structure = _has_regulation_body_structure(body)
        body_is_promotable_parent_regulation = (
            body_has_regulation_structure and _has_substantive_text(body)
        )
        if body_is_promotable_parent_regulation and _looks_like_formal_regulation(
            title_signal_text
        ):
            if has_promotable_attachment:
                reasons.append("wrapper_notice_retained_in_internal_notice")
                return ("wrapper_notice_only", routing.default_action)
            return ("formal_regulation", "promote_candidate")
        if body_is_promotable_parent_regulation and _looks_like_normative_handbook(
            title_signal_text
        ):
            if has_promotable_attachment:
                reasons.append("wrapper_notice_retained_in_internal_notice")
                return ("wrapper_notice_only", routing.default_action)
            return ("normative_handbook", "promote_candidate")
        if (
            _looks_like_wrapper_notice(source_title=source_title, body=body)
            or has_promotable_attachment
        ):
            return ("wrapper_notice_only", routing.default_action)
        if _looks_like_formal_regulation(title_signal_text) or _looks_like_normative_handbook(
            title_signal_text
        ):
            reasons.append("regulation_like_parent_body_needs_review")
            return ("manual_promotion_review", "manual_review_required")
        return ("wrapper_notice_only", routing.default_action)

    if input_lane not in set(routing.accepted_input_lanes):
        reasons.append("input_lane_not_admitted")
        return ("manual_promotion_review", "manual_review_required")
    if _looks_like_draft_document(combined_text):
        reasons.append("draft_signal_detected")
        return ("manual_promotion_review", "manual_review_required")
    if _looks_like_annual_cycle_or_program_rule(combined_text):
        reasons.append("annual_cycle_or_program_rule_detected")
    if _looks_like_operational_scheme(combined_text):
        reasons.append("operational_scheme_signal_detected")
        return ("manual_promotion_review", "manual_review_required")
    if _looks_like_time_bound_operational_rule(combined_text):
        reasons.append("time_bound_operational_rule_detected")
    if _looks_like_formal_regulation(combined_text):
        return ("formal_regulation", "promote_candidate")
    if _looks_like_normative_handbook(combined_text):
        return ("normative_handbook", "promote_candidate")
    reasons.append("promotion_class_ambiguous")
    if record.revision_track not in {"source-faithful", "current-effective"}:
        reasons.append("unsupported_revision_track")
    return ("manual_promotion_review", "manual_review_required")
