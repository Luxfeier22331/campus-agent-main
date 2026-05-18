from __future__ import annotations

import re

from campus_ingestion_core.official_web_academic_calendar_projection import (
    block_has_academic_calendar_image_ref,
)
from campus_ingestion_core.official_web_projection_engine_common import (
    _CAMPUS_ADDRESS_RE,
    _EMAIL_RE,
    _LOCATION_RE,
    _OFFICE_HOURS_RE,
    _PHONE_RE,
    _optional_int,
    _require_optional_text,
)
from campus_ingestion_core.official_web_projection_shared import _normalize_block_text


def _main_content_lines(blocks: list[dict[str, object]]) -> list[str]:
    return _block_lines(_main_content_blocks(blocks))


def _main_content_blocks(blocks: list[dict[str, object]]) -> list[dict[str, object]]:
    return [
        block
        for block in blocks
        if bool(block.get("isMainContent")) or block.get("blockRole") == "title"
    ]


def _candidate_content_blocks(
    *,
    blocks: list[dict[str, object]],
    consumer_family: str,
) -> list[dict[str, object]]:
    if consumer_family == "academic_calendar_candidate":
        return [
            block
            for block in blocks
            if bool(block.get("isMainContent"))
            or block.get("blockRole") == "title"
            or block_has_academic_calendar_image_ref(block)
        ]
    if consumer_family in {"regulation_candidate", "student_regulation_candidate"}:
        return _regulation_candidate_content_blocks(blocks)
    if consumer_family != "contact_directory_candidate":
        return _main_content_blocks(blocks)
    candidate_blocks: list[dict[str, object]] = []
    for block in blocks:
        text = _normalize_block_text(block)
        if not text:
            continue
        if bool(block.get("isMainContent")) or block.get("blockRole") == "title":
            candidate_blocks.append(block)
            continue
        if _has_contact_directory_signal(text):
            candidate_blocks.append(block)
    return candidate_blocks


def _regulation_candidate_content_blocks(
    blocks: list[dict[str, object]],
) -> list[dict[str, object]]:
    main_blocks = _main_content_blocks(blocks)
    retained: list[dict[str, object]] = []
    for block in main_blocks:
        if _is_redundant_inline_link_child(block=block, blocks=main_blocks):
            continue
        retained.append(block)
    return retained


def _is_redundant_inline_link_child(
    *,
    block: dict[str, object],
    blocks: list[dict[str, object]],
) -> bool:
    if str(block.get("blockRole") or block.get("block_role") or "") != "link":
        return False
    text = _normalize_block_text(block)
    if not text:
        return False
    dom_path = _require_optional_text(block.get("domPath") or block.get("dom_path"))
    if not dom_path:
        return _has_nearby_parent_text_containing_link(block=block, blocks=blocks, text=text)
    parent_dom_path = _parent_dom_path_for_inline_anchor(dom_path)
    if parent_dom_path is None:
        return False
    for candidate in blocks:
        if candidate is block:
            continue
        candidate_dom_path = _require_optional_text(
            candidate.get("domPath") or candidate.get("dom_path")
        )
        if candidate_dom_path != parent_dom_path:
            continue
        candidate_text = _normalize_block_text(candidate)
        if text in candidate_text and len(candidate_text) > len(text):
            return True
    return False


def _parent_dom_path_for_inline_anchor(dom_path: str) -> str | None:
    stripped = dom_path.strip()
    match = re.search(r"\s*>\s*a\[\d+\]$", stripped)
    if match is None:
        return None
    return stripped[: match.start()].strip()


def _has_nearby_parent_text_containing_link(
    *,
    block: dict[str, object],
    blocks: list[dict[str, object]],
    text: str,
) -> bool:
    block_order = _optional_int(block.get("blockOrder") or block.get("block_order"))
    if block_order is None:
        return False
    for candidate in blocks:
        if candidate is block:
            continue
        candidate_order = _optional_int(candidate.get("blockOrder") or candidate.get("block_order"))
        if candidate_order is None or abs(candidate_order - block_order) > 1:
            continue
        candidate_text = _normalize_block_text(candidate)
        if text in candidate_text and len(candidate_text) > len(text):
            return True
    return False


def _block_lines(blocks: list[dict[str, object]]) -> list[str]:
    lines: list[str] = []
    for block in blocks:
        text = _normalize_block_text(block)
        if text:
            lines.append(text)
    return lines


def _has_contact_directory_signal(text: str) -> bool:
    return bool(
        _PHONE_RE.search(text)
        or _EMAIL_RE.search(text)
        or _LOCATION_RE.search(text)
        or _CAMPUS_ADDRESS_RE.search(text)
        or _OFFICE_HOURS_RE.search(text)
    )


def _build_evidence_spans(blocks: list[dict[str, object]]) -> list[dict[str, object]]:
    from campus_ingestion_core.official_web_projection_engine_service_extract import (
        _extract_locations,
    )

    spans: list[dict[str, object]] = []
    for block in blocks:
        text = _normalize_block_text(block)
        if not text:
            continue
        row_id = str(block.get("rowId") or block.get("row_id") or "")
        for phone in _PHONE_RE.findall(text):
            spans.append({"evidence_type": "phone", "row_id": row_id, "text": phone})
        for location in _LOCATION_RE.findall(text):
            spans.append(
                {
                    "evidence_type": "location",
                    "row_id": row_id,
                    "text": location.strip(),
                }
            )
        for location in _extract_locations([text]):
            spans.append(
                {
                    "evidence_type": "location",
                    "row_id": row_id,
                    "text": location,
                }
            )
        for email in _EMAIL_RE.findall(text):
            spans.append({"evidence_type": "email", "row_id": row_id, "text": email})
    return spans
