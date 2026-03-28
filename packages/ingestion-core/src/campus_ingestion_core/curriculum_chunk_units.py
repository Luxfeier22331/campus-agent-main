from __future__ import annotations

from dataclasses import dataclass, field
import json
import re

from campus_ingestion_core.chunking import ChunkProfile, SemanticChunkPiece, StructuredUnitChunkInput, chunk_structured_unit, estimate_token_count
from campus_ingestion_core.models import DocumentRegistryRecord


@dataclass(frozen=True, slots=True)
class DerivedStructuredUnit:
    unit_type: str
    root_unit_id: str
    source_chunk_id: str | None
    text: str
    anchor: dict[str, object]
    acl_level: str
    metadata: dict[str, object] = field(default_factory=dict)


def build_curriculum_structured_units(
    *,
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
) -> tuple[DerivedStructuredUnit, ...]:
    rows = _load_curriculum_rows(record=record, structured_jsonl_bytes=structured_jsonl_bytes)
    table_row_ids = {
        _row_id(row)
        for row in rows
        if str(row.get("row_type") or "") == "table"
    }
    table_group_ids = {
        (
            str(row.get("continuation_group_id") or "").strip()
            or _row_id(row)
        )
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
        group_id = _table_group_id(row, table_row_ids=table_row_ids, table_group_ids=table_group_ids)
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
                            _build_section_unit(narrative_rows=narrative_rows, section_path=_section_path(heading_stack))
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
            if narrative_rows and _narrative_has_body_rows(narrative_rows):
                units.append(_build_section_unit(narrative_rows=narrative_rows, section_path=_section_path(heading_stack)))
                narrative_rows = []
            heading_level = _normalize_heading_level(row.get("heading_level"))
            if heading_level is None:
                raise ValueError("curriculum structured row_type=heading requires heading_level in document-units")
            heading_text = str(row.get("clean_text") or "").strip()
            previous_heading_stack = list(heading_stack)
            heading_stack = [item for item in heading_stack if item[0] < heading_level]
            if heading_text:
                heading_stack.append((heading_level, heading_text))
                heading_stack_history[_row_id(row)] = previous_heading_stack
            narrative_rows.append(row)
            continue
        if row_type in {"paragraph", "note"}:
            narrative_rows.append(row)
            continue
        if row_type == "toc_entry":
            continue

    if narrative_rows:
        units.append(_build_section_unit(narrative_rows=narrative_rows, section_path=_section_path(heading_stack)))
    return tuple(units)


def chunk_curriculum_unit(
    *,
    unit: DerivedStructuredUnit,
    chunk_profile: ChunkProfile,
) -> tuple[SemanticChunkPiece, ...]:
    if unit.unit_type != "table_unit":
        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=unit.text),
            chunk_profile=chunk_profile,
        )
        return tuple(
            _repair_curriculum_piece_context(piece=piece, unit=unit, chunk_profile=chunk_profile)
            for piece in pieces
        )

    header_line = str(unit.metadata.get("table_header_line") or "").strip()
    row_lines = tuple(str(item).strip() for item in list(unit.metadata.get("table_row_lines") or []) if str(item).strip())
    caption_lines = tuple(str(item).strip() for item in list(unit.metadata.get("caption_lines") or []) if str(item).strip())
    note_lines = tuple(str(item).strip() for item in list(unit.metadata.get("note_lines") or []) if str(item).strip())
    if not row_lines:
        text = _serialize_table_chunk(caption_lines=caption_lines, header_line=header_line, row_lines=(), note_lines=note_lines)
        piece = SemanticChunkPiece(unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=text)
        return (_repair_curriculum_piece_context(piece=piece, unit=unit, chunk_profile=chunk_profile),)

    prefix_lines = [*caption_lines]
    if header_line:
        prefix_lines.append(header_line)
    prefix_lines.extend(note_lines)
    context_reserve_tokens = _estimate_curriculum_table_context_reserve_tokens(
        unit=unit,
        caption_lines=caption_lines,
        chunk_profile=chunk_profile,
    )
    effective_max_tokens = max(
        chunk_profile.min_chunk_size,
        chunk_profile.max_chunk_size - context_reserve_tokens,
    )
    windows: list[list[str]] = []
    current_rows: list[str] = []

    for row_line in row_lines:
        candidate_rows = [*current_rows, row_line]
        candidate_text = _serialize_table_chunk(
            caption_lines=caption_lines,
            header_line=header_line,
            row_lines=tuple(candidate_rows),
            note_lines=note_lines,
        )
        if current_rows and estimate_token_count(candidate_text, chunk_profile=chunk_profile) > effective_max_tokens:
            windows.append(current_rows)
            current_rows = [row_line]
            continue
        current_rows.append(row_line)

    if current_rows:
        windows.append(current_rows)

    if len(windows) == 1:
        text = _serialize_table_chunk(
            caption_lines=caption_lines,
            header_line=header_line,
            row_lines=tuple(windows[0]),
            note_lines=note_lines,
        )
        piece = SemanticChunkPiece(unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=text)
        return (_repair_curriculum_piece_context(piece=piece, unit=unit, chunk_profile=chunk_profile),)

    total = len(windows)
    return tuple(
        _repair_curriculum_piece_context(
            piece=SemanticChunkPiece(
                unit_type=unit.unit_type,
                root_unit_id=unit.root_unit_id,
                text=_serialize_table_chunk(
                    caption_lines=caption_lines,
                    header_line=header_line,
                    row_lines=tuple(window_rows),
                    note_lines=note_lines,
                ),
                segment_index=index,
                segment_total=total,
                split_reason="table_row_window",
            ),
            unit=unit,
            chunk_profile=chunk_profile,
        )
        for index, window_rows in enumerate(windows, start=1)
    )


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
            raise ValueError(f"structured doc_id {doc_id!r} does not match registry document_id {record.document_id!r}")
        if version_id != record.version_id:
            raise ValueError(
                f"structured version_id {version_id!r} does not match registry version_id {record.version_id!r}"
            )
        _row_id(raw)
        rows.append(raw)
    return rows


def _group_table_rows(rows: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    table_row_ids = {
        _row_id(row)
        for row in rows
        if str(row.get("row_type") or "") == "table"
    }
    table_group_ids = {
        (
            str(row.get("continuation_group_id") or "").strip()
            or _row_id(row)
        )
        for row in rows
        if str(row.get("row_type") or "") == "table"
    }
    groups: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        group_id = _table_group_id(row, table_row_ids=table_row_ids, table_group_ids=table_group_ids)
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
    text_parts = [str(row.get("clean_text") or "").strip() for row in narrative_rows if str(row.get("clean_text") or "").strip()]
    source_chunk_id = _normalize_optional_text(narrative_rows[0].get("chunk_id"))
    root_unit_id = _row_id(narrative_rows[0]) or source_chunk_id or "curriculum:section"
    page_values = [int(row.get("page_start")) for row in narrative_rows if isinstance(row.get("page_start"), int)]
    end_values = [int(row.get("page_end")) for row in narrative_rows if isinstance(row.get("page_end"), int)]
    heading_level = next(
        (_normalize_heading_level(row.get("heading_level")) for row in narrative_rows if str(row.get("row_type") or "") == "heading"),
        None,
    )
    section_hint = next(
        (str(row.get("section_hint") or "").strip() for row in narrative_rows if str(row.get("section_hint") or "").strip()),
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
        acl_level=_normalize_acl_level(narrative_rows[0].get("acl")),
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
        if str(row.get("row_type") or "") == "table_caption" and str(row.get("clean_text") or "").strip()
    )
    note_lines = [str(row.get("clean_text") or "").strip() for row in ordered_rows if str(row.get("row_type") or "") == "note" and str(row.get("clean_text") or "").strip()]
    header_cells, row_lines = _coalesce_table_lines(table_rows)
    header_line = " | ".join(header_cells).strip()
    source_chunk_id = _normalize_optional_text(table_rows[0].get("chunk_id")) if table_rows else None
    root_unit_id = (
        _normalize_optional_text(table_rows[0].get("continuation_group_id"))
        or _row_id(table_rows[0])
        or source_chunk_id
        or "curriculum:table"
    )
    page_values = [int(row.get("page_start")) for row in ordered_rows if isinstance(row.get("page_start"), int)]
    end_values = [int(row.get("page_end")) for row in ordered_rows if isinstance(row.get("page_end"), int)]
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
        acl_level=_normalize_acl_level(table_rows[0].get("acl")) if table_rows else "public",
        metadata={
            "caption_lines": caption_lines,
            "note_lines": note_lines,
            "table_header_line": header_line,
            "table_row_lines": row_lines,
            "lead_in_row_ids": [_row_id(row) for row in lead_in_rows],
            "table_row_ids": [_row_id(row) for row in table_rows],
            "caption_row_ids": [_row_id(row) for row in ordered_rows if str(row.get("row_type") or "") == "table_caption"],
            "note_row_ids": [_row_id(row) for row in ordered_rows if str(row.get("row_type") or "") == "note"],
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


def _serialize_table_chunk(
    *,
    caption_lines: tuple[str, ...],
    header_line: str,
    row_lines: tuple[str, ...],
    note_lines: tuple[str, ...],
) -> str:
    lines = [*caption_lines]
    if header_line:
        lines.append(header_line)
    lines.extend(row_lines)
    lines.extend(note_lines)
    return "\n".join(line for line in lines if line).strip()


def _section_path(heading_stack: list[tuple[int, str]]) -> list[str]:
    return [text for _, text in heading_stack]


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _row_id(row: dict[str, object]) -> str:
    row_id = _normalize_optional_text(row.get("row_id"))
    if row_id is None:
        raise ValueError("curriculum structured row is missing row_id")
    return row_id


def _normalize_acl_level(value: object) -> str:
    if not isinstance(value, dict):
        return "public"
    acl_level = value.get("level")
    if not isinstance(acl_level, str) or not acl_level.strip():
        return "public"
    return acl_level.strip()


def _normalize_heading_level(value: object) -> int | None:
    if not isinstance(value, int):
        return None
    return value


def _narrative_has_body_rows(narrative_rows: list[dict[str, object]]) -> bool:
    return any(str(row.get("row_type") or "") in {"paragraph", "note"} for row in narrative_rows)


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
        del remaining[-len(intro_rows):]
        lead_in_rows = [*intro_rows, *lead_in_rows]
    return remaining, lead_in_rows


def _is_table_cue_row(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    return any(token in normalized for token in ("课程清单如下", "建议课程清单", "清单如下", "见下表", "如下表", "如下:"))


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


def _extract_short_table_intro_rows(narrative_rows: list[dict[str, object]]) -> list[dict[str, object]]:
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


def _repair_curriculum_piece_context(
    *,
    piece: SemanticChunkPiece,
    unit: DerivedStructuredUnit,
    chunk_profile: ChunkProfile,
) -> SemanticChunkPiece:
    if unit.unit_type not in {"section_text", "table_unit"}:
        return piece
    section_path = [
        str(item).strip()
        for item in list(unit.anchor.get("section_path") or [])
        if str(item).strip()
    ]
    if not section_path:
        return piece
    repaired_text = _build_curriculum_contextual_text(
        unit_type=unit.unit_type,
        section_path=section_path,
        piece_text=piece.text,
        chunk_profile=chunk_profile,
    )
    if not repaired_text or repaired_text == piece.text.strip():
        return piece
    return SemanticChunkPiece(
        unit_type=piece.unit_type,
        root_unit_id=piece.root_unit_id,
        text=repaired_text,
        segment_index=piece.segment_index,
        segment_total=piece.segment_total,
        split_reason=piece.split_reason,
        boundary_rule=piece.boundary_rule,
    )


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


def _looks_like_subsection_heading(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    return bool(
        re.match(r"^[（(][一二三四五六七八九十]+[)）]", normalized)
        or re.match(r"^[（(]?\d+[)）.、]", normalized)
    )


def _looks_like_curriculum_structure_heading(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    return bool(
        re.match(r"^[一二三四五六七八九十]+、", normalized)
        or _looks_like_subsection_heading(normalized)
        or re.match(r"^第[一二三四五六七八九十百千万〇零两0-9]+[章节部分]", normalized)
    )


def _select_curriculum_context_prefix_lines(
    *,
    section_path: list[str],
    piece_text: str,
    chunk_profile: ChunkProfile,
) -> list[str]:
    contextual_text = _build_curriculum_contextual_text(
        unit_type="section_text",
        section_path=section_path,
        piece_text=piece_text,
        chunk_profile=chunk_profile,
    )
    if contextual_text == piece_text.strip():
        return []
    piece_lines = [line.strip() for line in piece_text.splitlines() if line.strip()]
    contextual_lines = [line.strip() for line in contextual_text.splitlines() if line.strip()]
    if len(contextual_lines) <= len(piece_lines):
        return []
    return contextual_lines[:-len(piece_lines)]


def _build_curriculum_contextual_text(
    *,
    unit_type: str,
    section_path: list[str],
    piece_text: str,
    chunk_profile: ChunkProfile,
) -> str:
    structural_path = [item for item in section_path if item]
    if len(structural_path) > 1 and not _looks_like_curriculum_structure_heading(structural_path[0]):
        structural_path = structural_path[1:]
    if not structural_path:
        return piece_text.strip()
    piece_lines = [line.strip() for line in piece_text.splitlines() if line.strip()]
    if not piece_lines:
        return piece_text.strip()
    if len(structural_path) == 1:
        only_heading = structural_path[0]
        if any(line == only_heading for line in piece_lines):
            return piece_text.strip()
        candidate_text = "\n\n".join([only_heading, piece_text.strip()]).strip()
        if estimate_token_count(candidate_text, chunk_profile=chunk_profile) <= chunk_profile.max_chunk_size:
            return candidate_text
        return piece_text.strip()
    heading_prefix = _leading_curriculum_heading_lines(piece_lines, structural_path=structural_path)
    if heading_prefix == structural_path:
        return piece_text.strip()
    content_lines = piece_lines[len(heading_prefix):] if heading_prefix else piece_lines
    content_text = "\n".join(content_lines).strip()
    if not content_text:
        return piece_text.strip()
    prefix_variants = _curriculum_context_prefix_variants(structural_path)
    for candidate_prefix in prefix_variants:
        candidate_text = "\n\n".join([*candidate_prefix, content_text]).strip()
        if estimate_token_count(candidate_text, chunk_profile=chunk_profile) <= chunk_profile.max_chunk_size:
            return candidate_text
    if unit_type != "table_unit":
        return piece_text.strip()
    compact_lines = [line for line in content_lines if not _is_table_cue_row(line)]
    if len(compact_lines) == len(content_lines):
        return piece_text.strip()
    compact_text = "\n".join(compact_lines).strip()
    for candidate_prefix in prefix_variants:
        candidate_text = "\n\n".join([*candidate_prefix, compact_text]).strip()
        if estimate_token_count(candidate_text, chunk_profile=chunk_profile) <= chunk_profile.max_chunk_size:
            return candidate_text
    return piece_text.strip()


def _leading_curriculum_heading_lines(
    lines: list[str],
    *,
    structural_path: list[str] | None = None,
) -> list[str]:
    prefix: list[str] = []
    expected_prefix = list(structural_path or [])
    for line in lines:
        if not _looks_like_curriculum_structure_heading(line):
            break
        if expected_prefix and len(prefix) < len(expected_prefix) and line != expected_prefix[len(prefix)]:
            break
        prefix.append(line)
    return prefix


def _curriculum_context_prefix_variants(structural_path: list[str]) -> list[list[str]]:
    variants: list[list[str]] = []
    _append_unique_curriculum_prefix_variant(variants, structural_path)
    if len(structural_path) > 2:
        _append_unique_curriculum_prefix_variant(variants, [structural_path[0], structural_path[-1]])
    if len(structural_path) > 1:
        _append_unique_curriculum_prefix_variant(variants, [structural_path[0]])
    for index in range(1, len(structural_path)):
        _append_unique_curriculum_prefix_variant(variants, structural_path[index:])
    return variants


def _estimate_curriculum_table_context_reserve_tokens(
    *,
    unit: DerivedStructuredUnit,
    caption_lines: tuple[str, ...],
    chunk_profile: ChunkProfile,
) -> int:
    required_lines = _required_curriculum_table_context_lines(
        section_path=[
            str(item).strip()
            for item in list(unit.anchor.get("section_path") or [])
            if str(item).strip()
        ],
        caption_lines=caption_lines,
    )
    if not required_lines:
        return 0
    return estimate_token_count("\n\n".join(required_lines), chunk_profile=chunk_profile) + (2 * len(required_lines))


def _required_curriculum_table_context_lines(
    *,
    section_path: list[str],
    caption_lines: tuple[str, ...],
) -> list[str]:
    structural_path = [item for item in section_path if item]
    if len(structural_path) > 1 and not _looks_like_curriculum_structure_heading(structural_path[0]):
        structural_path = structural_path[1:]
    if not structural_path:
        return []
    existing_headings = [
        line
        for line in caption_lines
        if _looks_like_curriculum_structure_heading(line)
    ]
    return [
        heading
        for heading in structural_path
        if heading not in existing_headings
    ]


def _append_unique_curriculum_prefix_variant(
    variants: list[list[str]],
    candidate: list[str],
) -> None:
    normalized = [item for item in candidate if item]
    if not normalized:
        return
    if normalized in variants:
        return
    variants.append(normalized)


def _looks_like_detached_table_note(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    if normalized.startswith(("备注", "备注：", "注：", "说明：")):
        return False
    if _is_table_cue_row(normalized) or _is_table_intro_row({"clean_text": normalized, "row_type": "paragraph"}):
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
        current_occupied = {col: remaining - 1 for col, remaining in occupied.items() if remaining > 1}
        col_number = 1
        for cell_match in _TABLE_CELL_RE.finditer(row_match.group(1)):
            while col_number in current_occupied:
                col_number += 1
            spans = {match.group(1).lower(): int(match.group(2)) for match in _TABLE_SPAN_RE.finditer(cell_match.group(2) or "")}
            rowspan = spans.get("rowspan", 1)
            colspan = spans.get("colspan", 1)
            text = " ".join(part for part in _TABLE_TAG_RE.sub(" ", cell_match.group(3) or "").split() if part)
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
