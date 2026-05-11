from __future__ import annotations

import hashlib
import json
import re

from campus_ingestion_core.official_web_academic_calendar_projection import (
    build_academic_calendar_typed_candidate,
)
from campus_ingestion_core.official_web_projection_engine_common import (
    _EMAIL_RE,
    _OFFICE_HOURS_RE,
    _PHONE_RE,
    _REGULATION_NON_BODY_RE,
    _regulation_release_scope,
    _require_optional_text,
    _require_text,
    _string_list,
    _target_matches,
    _target_projection_fields,
    _unique,
)
from campus_ingestion_core.official_web_projection_engine_content import (
    _block_lines,
    _build_evidence_spans,
    _candidate_content_blocks,
    _main_content_lines,
)
from campus_ingestion_core.official_web_projection_engine_service_extract import (
    _contact_candidate_display_name,
    _extract_contact_points,
    _extract_locations,
    _extract_responsible_offices,
    _extract_service_entry_points,
    _extract_service_materials,
    _extract_service_procedure_groups,
    _extract_service_process_steps,
    _regulation_selected_write_suppressed,
    _selected_write_suppressed,
    _service_candidate_name,
)
from campus_ingestion_core.official_web_projection_shared import _normalize_block_text
from campus_ingestion_core.official_web_projection_units import _resolve_document_title
from campus_ingestion_core.official_web_regulation_structure import (
    build_official_web_regulation_structure,
    build_regulation_content_summary,
)
from campus_ingestion_core.official_web_regulation_titles import (
    normalize_official_web_regulation_title,
    official_web_regulation_title_metadata,
)


def _build_consumer_candidate_page(
    *,
    blocks: list[dict[str, object]],
    consumer_family: str,
    manifest: dict[str, object],
    materialization_policy: str,
    matched_evidence: list[str],
    review_policy: str,
    selected_write_target: str,
    target_lineage: dict[str, object] | None,
    target_collection: str,
    target_corpus: str,
    title: str,
) -> dict[str, object]:
    normalized_canonical_url = _require_text(
        manifest.get("normalizedCanonicalUrl"),
        "normalizedCanonicalUrl",
    )
    raw_version_id = _require_text(manifest.get("rawVersionId"), "rawVersionId")
    candidate_title = title
    title_projection_fields: dict[str, object] = {}
    if consumer_family in {"regulation_candidate", "student_regulation_candidate"}:
        title_info = normalize_official_web_regulation_title(title)
        candidate_title = title_info.display_title
        title_projection_fields = {
            "title_raw": title_info.raw_title,
            "title_base": title_info.base_title,
            **official_web_regulation_title_metadata(title_info),
        }
    typed_candidate_schema_version, typed_candidate, quality_gate, evidence_spans = (
        _build_typed_candidate(
            blocks=blocks,
            consumer_family=consumer_family,
            normalized_canonical_url=normalized_canonical_url,
            raw_title=title,
            title=candidate_title,
            target_lineage=target_lineage,
        )
    )
    if _should_skip_empty_source_pack_preview_regulation_candidate(
        blocks=blocks,
        consumer_family=consumer_family,
        manifest=manifest,
        quality_gate=quality_gate,
    ):
        return {}
    candidate = {
        "candidate_key": _build_candidate_key(
            consumer_family=consumer_family,
            normalized_canonical_url=normalized_canonical_url,
            raw_version_id=raw_version_id,
            selected_write_target=selected_write_target,
        ),
        "consumer_family": consumer_family,
        "materialization_policy": materialization_policy,
        "target_corpus": target_corpus,
        "target_collection": target_collection,
        "normalized_canonical_url": normalized_canonical_url,
        "raw_asset_id": manifest["rawAssetId"],
        "raw_version_id": raw_version_id,
        "title": candidate_title,
        **title_projection_fields,
        "matched_evidence": matched_evidence,
        "selected_write_target": selected_write_target,
        "review_policy": review_policy,
        "reason": f"{materialization_policy} consumer denominator match",
        "typed_candidate_schema_version": typed_candidate_schema_version,
        "typed_candidate": typed_candidate,
        "quality_gate": quality_gate,
        "evidence_spans": evidence_spans,
    }
    if consumer_family == "notice_news_candidate":
        candidate["source_family"] = "official_web_public_notice"
    if target_lineage is not None:
        candidate.update(_target_projection_fields(target_lineage))
    return candidate


def _build_candidate_key(
    *,
    consumer_family: str,
    normalized_canonical_url: str,
    raw_version_id: str,
    selected_write_target: str,
) -> str:
    digest = hashlib.sha256(
        json.dumps(
            {
                "consumer_family": consumer_family,
                "normalized_canonical_url": normalized_canonical_url,
                "raw_version_id": raw_version_id,
                "selected_write_target": selected_write_target,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:24]
    return f"owcand_{digest}"


def _build_typed_candidate(
    *,
    blocks: list[dict[str, object]],
    consumer_family: str,
    normalized_canonical_url: str,
    raw_title: str | None = None,
    title: str,
    target_lineage: dict[str, object] | None = None,
) -> tuple[str, dict[str, object], dict[str, object], list[dict[str, object]]]:
    main_lines = _main_content_lines(blocks)
    candidate_blocks = _candidate_content_blocks(blocks=blocks, consumer_family=consumer_family)
    lines = _block_lines(candidate_blocks)
    page_text = "\n".join(lines)
    phones = _unique(_PHONE_RE.findall(page_text))
    emails = _unique(_EMAIL_RE.findall(page_text))
    locations = _extract_locations(lines)
    office_hours = _unique(match.strip() for match in _OFFICE_HOURS_RE.findall(page_text))
    evidence_spans = _build_evidence_spans(candidate_blocks)
    suppressed = _selected_write_suppressed(title=title, lines=main_lines)

    if consumer_family == "contact_directory_candidate":
        contact_points = _extract_contact_points(lines)
        typed_candidate = {
            "display_name": _contact_candidate_display_name(
                title=title,
                contact_points=contact_points,
                target_lineage=target_lineage,
            ),
            "phones": phones,
            "emails": emails,
            "locations": locations,
            "office_hours": office_hours,
            "contact_points": contact_points,
            "source_url": normalized_canonical_url,
            "source_title": title,
        }
        return (
            "official_web_contact_directory_candidate.v1",
            typed_candidate,
            _quality_gate(
                suppressed=suppressed,
                has_identity=bool(title.strip()),
                has_required_evidence=bool(phones or emails),
                has_source=bool(normalized_canonical_url.strip()),
            ),
            evidence_spans,
        )

    if consumer_family == "service_guide_candidate":
        process_steps = _extract_service_process_steps(lines)
        procedure_groups = _extract_service_procedure_groups(
            title=title,
            target_lineage=target_lineage,
            normalized_canonical_url=normalized_canonical_url,
            process_steps=process_steps,
        )
        materials = _extract_service_materials(lines)
        entry_points = _extract_service_entry_points(lines)
        responsible_office = _extract_responsible_offices(lines)
        typed_candidate = {
            "service_name": _service_candidate_name(
                title=title,
                target_lineage=target_lineage,
            ),
            "process_steps": process_steps,
            "procedure_groups": procedure_groups,
            "materials": materials,
            "responsible_office": responsible_office,
            "entry_points": entry_points,
            "contacts": {
                "phones": phones,
                "emails": emails,
                "locations": locations,
                "office_hours": office_hours,
            },
            "field_source_urls": {
                "process_steps": [normalized_canonical_url] if process_steps else [],
                "procedure_groups": [normalized_canonical_url] if procedure_groups else [],
                "materials": [normalized_canonical_url] if materials else [],
                "entry_points": [normalized_canonical_url] if entry_points else [],
                "responsible_office": [normalized_canonical_url] if responsible_office else [],
                "contacts": [normalized_canonical_url]
                if (phones or emails or locations or office_hours)
                else [],
            },
            "source_url": normalized_canonical_url,
            "source_title": title,
        }
        return (
            "official_web_service_guide_candidate.v1",
            typed_candidate,
            _quality_gate(
                suppressed=suppressed,
                has_identity=bool(title.strip()),
                has_required_evidence=bool(process_steps),
                has_source=bool(normalized_canonical_url.strip()),
            ),
            evidence_spans,
        )

    if consumer_family == "academic_calendar_candidate":
        typed_candidate = build_academic_calendar_typed_candidate(
            lines=lines,
            candidate_blocks=candidate_blocks,
            normalized_canonical_url=normalized_canonical_url,
            title=title,
        )
        calendar_arrangement = str(typed_candidate.get("calendar_arrangement") or "").strip()
        calendar_records = typed_candidate.get("records")
        calendar_image_refs = typed_candidate.get("calendar_image_refs")
        has_required_evidence = bool(calendar_arrangement and calendar_records)
        missing_reason = (
            "missing_structured_calendar_records"
            if calendar_arrangement and calendar_image_refs and not calendar_records
            else "missing_required_evidence"
        )
        return (
            "official_web_academic_calendar_candidate.v1",
            typed_candidate,
            _quality_gate(
                suppressed=suppressed,
                has_identity=bool(title.strip()),
                has_required_evidence=has_required_evidence,
                has_source=bool(normalized_canonical_url.strip()),
                missing_required_evidence_reason=missing_reason,
            ),
            evidence_spans,
        )

    if consumer_family in {"regulation_candidate", "student_regulation_candidate"}:
        structure = build_official_web_regulation_structure(
            source_title=raw_title or title,
            lines=lines,
        )
        title_info = structure.title_info
        source_title_info = normalize_official_web_regulation_title(raw_title or title)
        normalized_summary = build_regulation_content_summary(structure.answer_bearing_lines)
        release_scope = _regulation_release_scope(target_lineage)
        typed_candidate = {
            "reference_title": title_info.display_title,
            "title_base": title_info.base_title,
            "title_raw": title_info.raw_title,
            **official_web_regulation_title_metadata(title_info),
            "normalized_content_summary": normalized_summary,
            "regulation_text": structure.regulation_text,
            "regulation_lines": list(structure.regulation_lines),
            "authoritative_source_url": normalized_canonical_url,
            "release_scope": release_scope,
            "source_url": normalized_canonical_url,
            "source_title": source_title_info.display_title,
            "source_title_raw": source_title_info.raw_title,
        }
        return (
            "official_web_regulation_candidate.v1",
            typed_candidate,
            _quality_gate(
                suppressed=_regulation_selected_write_suppressed(title=title),
                has_identity=bool(title.strip()),
                has_required_evidence=bool(normalized_summary),
                has_source=bool(normalized_canonical_url.strip()),
                missing_required_evidence_reason="missing_answer_bearing_regulation_body",
            ),
            evidence_spans,
        )

    return (
        "official_web_inventory_candidate.v1",
        {
            "source_url": normalized_canonical_url,
            "source_title": title,
        },
        {
            "decision": "inventory_only",
            "reason_codes": [],
        },
        evidence_spans,
    )


def _quality_gate(
    *,
    suppressed: bool,
    has_identity: bool,
    has_required_evidence: bool,
    has_source: bool,
    missing_required_evidence_reason: str = "missing_required_evidence",
) -> dict[str, object]:
    reason_codes: list[str] = []
    if suppressed:
        reason_codes.append("selected_write_suppressed_page_type")
    if not has_identity:
        reason_codes.append("missing_candidate_identity")
    if not has_required_evidence:
        reason_codes.append(missing_required_evidence_reason)
    if not has_source:
        reason_codes.append("missing_source_url")
    return {
        "decision": "pass" if not reason_codes else "reject",
        "reason_codes": reason_codes,
    }


def _should_skip_empty_source_pack_preview_regulation_candidate(
    *,
    blocks: list[dict[str, object]],
    consumer_family: str,
    manifest: dict[str, object],
    quality_gate: dict[str, object],
) -> bool:
    if consumer_family not in {"regulation_candidate", "student_regulation_candidate"}:
        return False
    if not _is_source_pack_preview_regulation_manifest(manifest):
        return False
    title = _resolve_document_title(manifest=manifest, blocks=blocks)
    if _regulation_selected_write_suppressed(title=title):
        return True
    if "missing_answer_bearing_regulation_body" not in _string_list(
        quality_gate.get("reason_codes")
    ):
        return False
    return _looks_like_attachment_only_regulation_page(blocks)


def _is_source_pack_preview_regulation_manifest(manifest: dict[str, object]) -> bool:
    target_matches = _target_matches(manifest)
    if not target_matches:
        return False
    return all(
        _require_optional_text(match.get("worksetReason"))
        == "source_pack_preview_seed"
        and _require_optional_text(match.get("selectedWriteTarget"))
        in {"regulations/institutional_rules", "regulations/student_rules"}
        for match in target_matches
    )


def _looks_like_attachment_only_regulation_page(blocks: list[dict[str, object]]) -> bool:
    main_blocks = [block for block in blocks if bool(block.get("isMainContent"))]
    if not main_blocks:
        return False
    substantive_lines = 0
    for block in main_blocks:
        text = _normalize_block_text(block)
        if not text or _REGULATION_NON_BODY_RE.search(text):
            continue
        if str(block.get("blockRole") or block.get("block_role") or "") == "link":
            link_target = str(block.get("linkTarget") or block.get("link_target") or "").strip()
            if link_target and re.search(
                r"(?:/__local/|\.docx?(?:\?|$)|\.pdf(?:\?|$)|\.xls[x]?(?:\?|$))",
                link_target,
                re.IGNORECASE,
            ):
                continue
        if str(block.get("blockRole") or block.get("block_role") or "") == "heading":
            continue
        if len(re.sub(r"\s+", "", text)) <= 12:
            continue
        substantive_lines += 1
    return substantive_lines == 0
