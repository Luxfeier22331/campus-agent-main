from __future__ import annotations

import json
import re

from campus_ingestion_core.curriculum_chunk_units_shared import (
    _CURRICULUM_COURSE_MAP_HEADING,
    DerivedStructuredUnit,
    _curriculum_structural_level,
    _is_curriculum_course_map_section_path,
    _is_curriculum_course_map_title_line,
    _is_table_cue_row,
    _looks_like_curriculum_page_marker_line,
    _looks_like_curriculum_structure_heading,
    _looks_like_curriculum_version_note,
    _normalize_heading_level,
    _normalize_optional_text,
    _resolve_row_visibility_level,
    _row_id,
    _section_path,
)
from campus_ingestion_core.models import DocumentRegistryRecord


def build_curriculum_structured_units(
    *,
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
) -> tuple[DerivedStructuredUnit, ...]:
    rows = _load_curriculum_rows(record=record, structured_jsonl_bytes=structured_jsonl_bytes)
    table_row_ids = {_row_id(row) for row in rows if str(row.get("row_type") or "") == "table"}
    table_group_ids = {
        (str(row.get("continuation_group_id") or "").strip() or _row_id(row))
        for row in rows
        if str(row.get("row_type") or "") == "table"
    }
    table_groups = _group_table_rows(rows)
    emitted_table_groups: set[str] = set()
    heading_stack: list[tuple[int, str]] = []
    heading_stack_history: dict[str, list[tuple[int, str]]] = {}
    narrative_rows: list[dict[str, object]] = []
    units: list[DerivedStructuredUnit] = []

    for row in rows:
        row_type = str(row.get("row_type") or "")
        group_id = _table_group_id(
            row, table_row_ids=table_row_ids, table_group_ids=table_group_ids
        )
        if group_id is not None:
            table_lead_in_rows: list[dict[str, object]] = []
            if narrative_rows:
                narrative_rows, table_lead_in_rows = _split_table_lead_in_rows(narrative_rows)
                if narrative_rows:
                    if _should_emit_heading_residual_section_unit(
                        narrative_rows=narrative_rows,
                        lead_in_rows=tuple(table_lead_in_rows),
                    ):
                        units.append(
                            _build_section_unit(
                                narrative_rows=narrative_rows,
                                section_path=_section_path(heading_stack),
                            )
                        )
                    narrative_rows = []
            effective_heading_stack = _trim_heading_stack_for_absorbed_table_lead_ins(
                heading_stack=heading_stack,
                lead_in_rows=tuple(table_lead_in_rows),
                heading_stack_history=heading_stack_history,
            )
            if group_id not in emitted_table_groups:
                units.append(
                    _build_table_unit(
                        table_groups[group_id],
                        section_path=_section_path(effective_heading_stack),
                        lead_in_rows=tuple(table_lead_in_rows),
                    )
                )
                emitted_table_groups.add(group_id)
            heading_stack = effective_heading_stack
            continue

        if row_type in {"page_number", "image", "footer"}:
            continue
        if row_type == "heading":
            if _should_flush_narrative_rows_before_next_heading(
                narrative_rows=narrative_rows, incoming_row=row
            ):
                units.append(
                    _build_section_unit(
                        narrative_rows=narrative_rows, section_path=_section_path(heading_stack)
                    )
                )
                narrative_rows = []
            heading_level = _resolve_curriculum_heading_level(row)
            if heading_level is None:
                raise ValueError(
                    "curriculum structured row_type=heading requires heading_level in document-units"
                )
            heading_text = str(row.get("clean_text") or "").strip()
            previous_heading_stack = list(heading_stack)
            if not _should_keep_curriculum_heading_out_of_section_path(
                heading_stack=heading_stack,
                heading_level=heading_level,
                row=row,
            ):
                heading_stack = [item for item in heading_stack if item[0] < heading_level]
                if heading_text:
                    heading_stack.append((heading_level, heading_text))
            if heading_text:
                heading_stack_history[_row_id(row)] = previous_heading_stack
            narrative_rows.append(row)
            continue
        if row_type in {"paragraph", "note"}:
            narrative_rows.append(row)
            continue
        if row_type == "toc_entry":
            continue

    if narrative_rows:
        units.append(
            _build_section_unit(
                narrative_rows=narrative_rows, section_path=_section_path(heading_stack)
            )
        )
    return _normalize_curriculum_units(tuple(units))


def _load_curriculum_rows(
    *,
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line in structured_jsonl_bytes.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        raw = json.loads(stripped)
        if str(raw.get("chunk_id") or "").strip() == "document-0000":
            raise ValueError("structured input must not contain synthetic document-0000 rows")
        doc_id = str(raw.get("doc_id") or "").strip()
        version_id = str(raw.get("version_id") or "").strip()
        if doc_id != record.document_id:
            raise ValueError(
                f"structured doc_id {doc_id!r} does not match registry document_id {record.document_id!r}"
            )
        if version_id != record.version_id:
            raise ValueError(
                f"structured version_id {version_id!r} does not match registry version_id {record.version_id!r}"
            )
        _row_id(raw)
        rows.append(raw)
    return rows


def _group_table_rows(rows: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    table_row_ids = {_row_id(row) for row in rows if str(row.get("row_type") or "") == "table"}
    table_group_ids = {
        (str(row.get("continuation_group_id") or "").strip() or _row_id(row))
        for row in rows
        if str(row.get("row_type") or "") == "table"
    }
    groups: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        group_id = _table_group_id(
            row, table_row_ids=table_row_ids, table_group_ids=table_group_ids
        )
        if group_id is None:
            continue
        groups.setdefault(group_id, []).append(row)
    return groups


def _table_group_id(
    row: dict[str, object],
    *,
    table_row_ids: set[str],
    table_group_ids: set[str],
) -> str | None:
    row_type = str(row.get("row_type") or "")
    continuation_group_id = str(row.get("continuation_group_id") or "").strip()
    owner_row_id = str(row.get("owner_row_id") or "").strip()
    if row_type == "table":
        return continuation_group_id or _row_id(row)
    if row_type in {"table_caption", "note"} and (
        owner_row_id in table_row_ids or continuation_group_id in table_group_ids
    ):
        if row_type == "note" and _looks_like_detached_table_note(str(row.get("clean_text") or "")):
            return None
        return continuation_group_id
    return None


def _build_section_unit(
    *,
    narrative_rows: list[dict[str, object]],
    section_path: list[str],
) -> DerivedStructuredUnit:
    text_parts = [
        str(row.get("clean_text") or "").strip()
        for row in narrative_rows
        if _should_keep_curriculum_narrative_text_row(row)
        if str(row.get("clean_text") or "").strip()
    ]
    source_chunk_id = _normalize_optional_text(narrative_rows[0].get("chunk_id"))
    root_unit_id = _row_id(narrative_rows[0]) or source_chunk_id or "curriculum:section"
    page_values = [
        int(row.get("page_start"))
        for row in narrative_rows
        if isinstance(row.get("page_start"), int)
    ]
    end_values = [
        int(row.get("page_end")) for row in narrative_rows if isinstance(row.get("page_end"), int)
    ]
    heading_level = next(
        (
            _resolve_curriculum_heading_level(row)
            for row in narrative_rows
            if str(row.get("row_type") or "") == "heading"
        ),
        None,
    )
    section_hint = next(
        (
            str(row.get("section_hint") or "").strip()
            for row in narrative_rows
            if str(row.get("section_hint") or "").strip()
        ),
        None,
    )
    return DerivedStructuredUnit(
        unit_type="section_text",
        root_unit_id=root_unit_id,
        source_chunk_id=source_chunk_id,
        text="\n\n".join(text_parts),
        anchor={
            "page_start": min(page_values) if page_values else None,
            "page_end": max(end_values) if end_values else None,
            "section_path": list(section_path),
            "heading_level": heading_level,
            "section_hint": section_hint,
        },
        visibility_level=_resolve_row_visibility_level(narrative_rows[0]),
        metadata={
            "source_row_ids": [_row_id(row) for row in narrative_rows],
            "source_row_types": [str(row.get("row_type") or "") for row in narrative_rows],
        },
    )


def _build_table_unit(
    grouped_rows: list[dict[str, object]],
    *,
    section_path: list[str],
    lead_in_rows: tuple[dict[str, object], ...] = (),
) -> DerivedStructuredUnit:
    from campus_ingestion_core.curriculum_chunk_units_chunking import _serialize_table_chunk

    ordered_rows = sorted(
        grouped_rows,
        key=lambda row: (
            int(row.get("page_start")) if isinstance(row.get("page_start"), int) else 0,
            int(row.get("row_index")) if isinstance(row.get("row_index"), int) else 0,
            int(row.get("reading_order")) if isinstance(row.get("reading_order"), int) else 0,
        ),
    )
    table_rows = [row for row in ordered_rows if str(row.get("row_type") or "") == "table"]
    caption_lines = [
        str(row.get("clean_text") or "").strip()
        for row in lead_in_rows
        if str(row.get("clean_text") or "").strip()
    ]
    caption_lines.extend(
        str(row.get("clean_text") or "").strip()
        for row in ordered_rows
        if str(row.get("row_type") or "") == "table_caption"
        and str(row.get("clean_text") or "").strip()
    )
    caption_lines = _dedupe_consecutive_curriculum_lines(caption_lines)
    section_path = _resolve_curriculum_table_section_path(
        section_path=section_path, caption_lines=caption_lines
    )
    note_lines = [
        str(row.get("clean_text") or "").strip()
        for row in ordered_rows
        if str(row.get("row_type") or "") == "note" and str(row.get("clean_text") or "").strip()
    ]
    header_cells, row_lines = _coalesce_table_lines(table_rows)
    header_line = " | ".join(header_cells).strip()
    source_chunk_id = (
        _normalize_optional_text(table_rows[0].get("chunk_id")) if table_rows else None
    )
    root_unit_id = (
        _normalize_optional_text(table_rows[0].get("continuation_group_id"))
        or _row_id(table_rows[0])
        or source_chunk_id
        or "curriculum:table"
    )
    page_values = [
        int(row.get("page_start")) for row in ordered_rows if isinstance(row.get("page_start"), int)
    ]
    end_values = [
        int(row.get("page_end")) for row in ordered_rows if isinstance(row.get("page_end"), int)
    ]
    text = _serialize_table_chunk(
        caption_lines=tuple(caption_lines),
        header_line=header_line,
        row_lines=tuple(row_lines),
        note_lines=tuple(note_lines),
    )
    return DerivedStructuredUnit(
        unit_type="table_unit",
        root_unit_id=root_unit_id,
        source_chunk_id=source_chunk_id,
        text=text,
        anchor={
            "page_start": min(page_values) if page_values else None,
            "page_end": max(end_values) if end_values else None,
            "section_path": list(section_path),
            "table_group_id": root_unit_id,
        },
        visibility_level=_resolve_row_visibility_level(table_rows[0]) if table_rows else "public",
        metadata={
            "caption_lines": caption_lines,
            "note_lines": note_lines,
            "table_header_line": header_line,
            "table_row_lines": row_lines,
            "lead_in_row_ids": [_row_id(row) for row in lead_in_rows],
            "table_row_ids": [_row_id(row) for row in table_rows],
            "caption_row_ids": [
                _row_id(row)
                for row in ordered_rows
                if str(row.get("row_type") or "") == "table_caption"
            ],
            "note_row_ids": [
                _row_id(row) for row in ordered_rows if str(row.get("row_type") or "") == "note"
            ],
        },
    )


def _coalesce_table_lines(table_rows: list[dict[str, object]]) -> tuple[list[str], list[str]]:
    header_cells: list[str] = []
    row_lines: list[str] = []
    for index, row in enumerate(table_rows):
        cell_rows = _group_cells_by_row(row)
        if not cell_rows:
            continue
        current_header = cell_rows[0]
        if not header_cells:
            header_cells = current_header
        for row_offset, cell_values in enumerate(cell_rows):
            if index > 0 and row_offset == 0 and cell_values == header_cells:
                continue
            if index == 0 and row_offset == 0:
                continue
            row_lines.append(" | ".join(cell_values).strip())
    return header_cells, row_lines


def _group_cells_by_row(row: dict[str, object]) -> list[list[str]]:
    raw_cells = row.get("table_cells")
    if not isinstance(raw_cells, list) or not raw_cells:
        html = _normalize_optional_text(row.get("html"))
        raw_cells = _extract_table_cells_from_html(html or "")
    grouped: dict[int, dict[int, str]] = {}
    max_col = 0
    for cell in raw_cells:
        if not isinstance(cell, dict):
            continue
        row_index = cell.get("row")
        col_index = cell.get("col")
        if not isinstance(row_index, int) or not isinstance(col_index, int):
            continue
        text = str(cell.get("text") or "").strip()
        rowspan = int(cell.get("rowspan") or 1)
        colspan = int(cell.get("colspan") or 1)
        max_col = max(max_col, col_index + max(colspan - 1, 0))
        for expanded_row in range(row_index, row_index + max(rowspan, 1)):
            row_map = grouped.setdefault(expanded_row, {})
            row_map.setdefault(col_index, text)
            for expanded_col in range(col_index + 1, col_index + max(colspan, 1)):
                row_map.setdefault(expanded_col, "")
    lines: list[list[str]] = []
    for _, row_map in sorted(grouped.items()):
        values = [row_map.get(col_index, "") for col_index in range(1, max_col + 1)]
        while values and not values[-1]:
            values.pop()
        normalized = [value if value else "—" for value in values]
        lines.append(normalized)
    return lines


def _normalize_curriculum_units(
    units: tuple[DerivedStructuredUnit, ...],
) -> tuple[DerivedStructuredUnit, ...]:
    if not units:
        return ()
    normalized = list(units)
    for index in range(len(normalized) - 1):
        current = normalized[index]
        incoming = normalized[index + 1]
        if not _is_curriculum_course_map_placeholder_unit(incoming):
            continue
        trailing_title_line = _extract_trailing_curriculum_course_map_title_line(current)
        if trailing_title_line is None:
            continue
        trimmed_current_text = _trim_trailing_curriculum_course_map_title_line(current.text)
        if not trimmed_current_text:
            continue
        normalized[index] = _replace_derived_unit_text(current, trimmed_current_text)
        normalized[index + 1] = _replace_derived_unit_text(
            incoming,
            "\n\n".join([incoming.text.strip(), trailing_title_line]).strip(),
        )
    return tuple(unit for unit in normalized if unit.text.strip())


def _replace_derived_unit_text(unit: DerivedStructuredUnit, text: str) -> DerivedStructuredUnit:
    return DerivedStructuredUnit(
        unit_type=unit.unit_type,
        root_unit_id=unit.root_unit_id,
        source_chunk_id=unit.source_chunk_id,
        text=text.strip(),
        anchor=dict(unit.anchor),
        visibility_level=unit.visibility_level,
        metadata=dict(unit.metadata),
    )


def _extract_trailing_curriculum_course_map_title_line(unit: DerivedStructuredUnit) -> str | None:
    if unit.unit_type != "section_text":
        return None
    section_path = [
        str(item).strip()
        for item in list(unit.anchor.get("section_path") or [])
        if str(item).strip()
    ]
    if _is_curriculum_course_map_section_path(section_path):
        return None
    lines = [line.strip() for line in unit.text.splitlines() if line.strip()]
    if len(lines) < 2:
        return None
    trailing_line = lines[-1]
    if not _is_curriculum_course_map_title_line(trailing_line):
        return None
    return trailing_line


def _trim_trailing_curriculum_course_map_title_line(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        return text.strip()
    return "\n\n".join(lines[:-1]).strip()


def _resolve_curriculum_heading_level(row: dict[str, object]) -> int | None:
    raw_level = _normalize_heading_level(row.get("heading_level"))
    if raw_level is None:
        return None
    text = str(row.get("clean_text") or "").strip()
    semantic_level = _curriculum_structural_level(text)
    if semantic_level is not None:
        return semantic_level
    return raw_level


def _narrative_has_body_rows(narrative_rows: list[dict[str, object]]) -> bool:
    return any(str(row.get("row_type") or "") in {"paragraph", "note"} for row in narrative_rows)


def _should_flush_narrative_rows_before_next_heading(
    *,
    narrative_rows: list[dict[str, object]],
    incoming_row: dict[str, object],
) -> bool:
    if not narrative_rows:
        return False
    if _narrative_has_body_rows(narrative_rows):
        return True
    heading_rows = [
        row
        for row in narrative_rows
        if str(row.get("row_type") or "") == "heading"
        and _resolve_curriculum_heading_level(row) is not None
    ]
    if not heading_rows:
        return False
    heading_levels = [int(_resolve_curriculum_heading_level(row) or 0) for row in heading_rows]
    incoming_level = _resolve_curriculum_heading_level(incoming_row)
    if incoming_level is None:
        return False
    incoming_is_structural = _is_curriculum_structural_heading_row(incoming_row)
    if not incoming_is_structural and incoming_level == heading_levels[-1]:
        return False
    if incoming_level > heading_levels[-1]:
        return False
    if len(heading_levels) >= 2 and len(set(heading_levels)) == 1:
        return True
    if len(heading_rows) == 1:
        return (
            incoming_level <= heading_levels[0]
            and _is_curriculum_structural_heading_row(heading_rows[0])
            and incoming_is_structural
        )
    return incoming_is_structural


def _should_keep_curriculum_heading_out_of_section_path(
    *,
    heading_stack: list[tuple[int, str]],
    heading_level: int,
    row: dict[str, object],
) -> bool:
    heading_text = str(row.get("clean_text") or "").strip()
    if heading_text and _looks_like_curriculum_version_note(heading_text) and heading_stack:
        return True
    if (
        heading_text
        and _is_curriculum_course_map_title_line(heading_text)
        and any(text == _CURRICULUM_COURSE_MAP_HEADING for _, text in heading_stack)
    ):
        return True
    if not heading_stack:
        return False
    if heading_level != heading_stack[-1][0]:
        return False
    if "section_hint" not in row:
        return False
    section_hint = _normalize_optional_text(row.get("section_hint"))
    return section_hint is None


def _is_curriculum_structural_heading_row(row: dict[str, object]) -> bool:
    if str(row.get("row_type") or "") != "heading":
        return False
    section_hint = _normalize_optional_text(row.get("section_hint"))
    if section_hint is not None:
        return True
    return _looks_like_curriculum_structure_heading(str(row.get("clean_text") or ""))


def _should_keep_curriculum_narrative_text_row(row: dict[str, object]) -> bool:
    if str(row.get("row_type") or "") not in {"paragraph", "note"}:
        return True
    return not _looks_like_curriculum_page_marker_line(str(row.get("clean_text") or ""))


def _split_table_lead_in_rows(
    narrative_rows: list[dict[str, object]],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    if not narrative_rows:
        return [], []
    lead_in_rows: list[dict[str, object]] = []
    remaining = list(narrative_rows)
    if not _is_table_cue_row(str(remaining[-1].get("clean_text") or "")):
        return remaining, lead_in_rows

    lead_in_rows.insert(0, remaining.pop())
    while remaining:
        candidate = remaining[-1]
        if str(candidate.get("row_type") or "") not in {"paragraph", "note", "heading"}:
            break
        if not _is_table_intro_row(candidate):
            break
        lead_in_rows.insert(0, remaining.pop())
    intro_rows = _extract_short_table_intro_rows(remaining)
    if intro_rows:
        del remaining[-len(intro_rows) :]
        lead_in_rows = [*intro_rows, *lead_in_rows]
    return remaining, lead_in_rows


def _is_table_intro_row(row: dict[str, object]) -> bool:
    normalized = str(row.get("clean_text") or "").strip()
    if not normalized or len(normalized) > 120:
        return False
    row_type = str(row.get("row_type") or "")
    if row_type == "heading":
        return any(
            (
                re.match(r"^[（(]?\d+[)）]", normalized),
                normalized.endswith("课程"),
                "课程" in normalized and "清单" in normalized,
            )
        )
    if not re.match(r"^[（(]?\d+[)）]", normalized):
        return False
    if "课程" not in normalized:
        return False
    return any(token in normalized for token in ("学分", "必修", "选修", "修读"))


def _extract_short_table_intro_rows(
    narrative_rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    if len(narrative_rows) < 2:
        return []
    heading_row = narrative_rows[-2]
    paragraph_row = narrative_rows[-1]
    if str(heading_row.get("row_type") or "") != "heading":
        return []
    if str(paragraph_row.get("row_type") or "") not in {"paragraph", "note"}:
        return []
    heading_text = str(heading_row.get("clean_text") or "").strip()
    paragraph_text = str(paragraph_row.get("clean_text") or "").strip()
    if not heading_text or not paragraph_text:
        return []
    if len(paragraph_text) > 80:
        return []
    if "课程" not in paragraph_text:
        return []
    if not any(token in paragraph_text for token in ("学分", "必修", "选修", "修读")):
        return []
    if not _is_table_intro_row(heading_row):
        return []
    return [heading_row, paragraph_row]


def _should_emit_heading_residual_section_unit(
    *,
    narrative_rows: list[dict[str, object]],
    lead_in_rows: tuple[dict[str, object], ...],
) -> bool:
    if not narrative_rows:
        return False
    if not lead_in_rows:
        return True
    if _narrative_has_body_rows(narrative_rows):
        return True
    return not all(str(row.get("row_type") or "") == "heading" for row in narrative_rows)


def _trim_heading_stack_for_absorbed_table_lead_ins(
    *,
    heading_stack: list[tuple[int, str]],
    lead_in_rows: tuple[dict[str, object], ...],
    heading_stack_history: dict[str, list[tuple[int, str]]],
) -> list[tuple[int, str]]:
    trimmed = list(heading_stack)
    for row in reversed(lead_in_rows):
        if str(row.get("row_type") or "") != "heading":
            continue
        prior_stack = heading_stack_history.get(_row_id(row))
        if prior_stack is not None:
            trimmed = list(prior_stack)
            continue
        heading_text = str(row.get("clean_text") or "").strip()
        if not heading_text or not trimmed:
            continue
        if trimmed[-1][1] == heading_text:
            trimmed.pop()
    return trimmed


def _dedupe_consecutive_curriculum_lines(lines: list[str]) -> list[str]:
    deduped: list[str] = []
    for line in lines:
        if not line:
            continue
        if deduped and deduped[-1] == line:
            continue
        deduped.append(line)
    return deduped


def _resolve_curriculum_table_section_path(
    *, section_path: list[str], caption_lines: list[str]
) -> list[str]:
    if not caption_lines:
        return list(section_path)
    first_caption = caption_lines[0]
    caption_level = _curriculum_structural_level(first_caption)
    if caption_level is None:
        return list(section_path)
    if section_path and section_path[-1] == first_caption:
        return list(section_path)
    if not section_path:
        return [first_caption]
    current_level = _curriculum_structural_level(section_path[-1])
    if current_level is not None and caption_level > current_level:
        return [*section_path, first_caption]
    return [*section_path[:-1], first_caption]


def _is_curriculum_course_map_placeholder_unit(unit: DerivedStructuredUnit) -> bool:
    if unit.unit_type != "section_text":
        return False
    section_path = [
        str(item).strip()
        for item in list(unit.anchor.get("section_path") or [])
        if str(item).strip()
    ]
    return _is_curriculum_course_map_placeholder_text(text=unit.text, section_path=section_path)


def _is_curriculum_course_map_placeholder_text(*, text: str, section_path: list[str]) -> bool:
    if not _is_curriculum_course_map_section_path(section_path):
        return False
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    from campus_ingestion_core.curriculum_chunk_units_shared import (
        _leading_curriculum_heading_lines,
    )

    heading_lines = _leading_curriculum_heading_lines(lines, structural_path=section_path)
    remainder = lines[len(heading_lines) :]
    if not remainder:
        return True
    return all(_is_curriculum_course_map_title_line(line) for line in remainder)


def _looks_like_detached_table_note(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    if normalized.startswith(("备注", "备注：", "注：", "说明：")):
        return False
    if _is_table_cue_row(normalized) or _is_table_intro_row(
        {"clean_text": normalized, "row_type": "paragraph"}
    ):
        return True
    return False


_TABLE_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_TABLE_CELL_RE = re.compile(r"<(td|th)\b([^>]*)>(.*?)</\1>", re.IGNORECASE | re.DOTALL)
_TABLE_TAG_RE = re.compile(r"<[^>]+>")
_TABLE_SPAN_RE = re.compile(r"""\b(rowspan|colspan)\s*=\s*["']?(\d+)["']?""", re.IGNORECASE)


def _extract_table_cells_from_html(html: str) -> list[dict[str, object]]:
    if not html:
        return []
    cells: list[dict[str, object]] = []
    occupied: dict[int, int] = {}
    for row_number, row_match in enumerate(_TABLE_ROW_RE.finditer(html), start=1):
        current_occupied = {
            col: remaining - 1 for col, remaining in occupied.items() if remaining > 1
        }
        col_number = 1
        for cell_match in _TABLE_CELL_RE.finditer(row_match.group(1)):
            while col_number in current_occupied:
                col_number += 1
            spans = {
                match.group(1).lower(): int(match.group(2))
                for match in _TABLE_SPAN_RE.finditer(cell_match.group(2) or "")
            }
            rowspan = spans.get("rowspan", 1)
            colspan = spans.get("colspan", 1)
            text = " ".join(
                part for part in _TABLE_TAG_RE.sub(" ", cell_match.group(3) or "").split() if part
            )
            cells.append(
                {
                    "row": row_number,
                    "col": col_number,
                    "text": text,
                    "rowspan": rowspan,
                    "colspan": colspan,
                    "is_header": cell_match.group(1).lower() == "th" or row_number == 1,
                }
            )
            if rowspan > 1:
                for occupied_col in range(col_number, col_number + colspan):
                    current_occupied[occupied_col] = rowspan
            col_number += colspan
        occupied = current_occupied
    return cells


__all__ = ["build_curriculum_structured_units"]
