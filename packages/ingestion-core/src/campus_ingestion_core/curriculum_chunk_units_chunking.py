from __future__ import annotations

from campus_ingestion_core.chunking import (
    ChunkProfile,
    SemanticChunkPiece,
    StructuredUnitChunkInput,
    chunk_structured_unit,
    estimate_token_count,
)
from campus_ingestion_core.curriculum_chunk_units_shared import (
    DerivedStructuredUnit,
    _is_table_cue_row,
    _leading_curriculum_heading_lines,
    _looks_like_curriculum_structure_heading,
    _normalize_curriculum_structural_path,
)


def chunk_curriculum_unit(
    *,
    unit: DerivedStructuredUnit,
    chunk_profile: ChunkProfile,
) -> tuple[SemanticChunkPiece, ...]:
    if unit.unit_type != "table_unit":
        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=unit.text
            ),
            chunk_profile=chunk_profile,
        )
        return tuple(
            _repair_curriculum_piece_context(piece=piece, unit=unit, chunk_profile=chunk_profile)
            for piece in pieces
        )

    header_line = str(unit.metadata.get("table_header_line") or "").strip()
    row_lines = tuple(
        str(item).strip()
        for item in list(unit.metadata.get("table_row_lines") or [])
        if str(item).strip()
    )
    caption_lines = tuple(
        str(item).strip()
        for item in list(unit.metadata.get("caption_lines") or [])
        if str(item).strip()
    )
    note_lines = tuple(
        str(item).strip()
        for item in list(unit.metadata.get("note_lines") or [])
        if str(item).strip()
    )
    if not row_lines:
        text = _serialize_table_chunk(
            caption_lines=caption_lines,
            header_line=header_line,
            row_lines=(),
            note_lines=note_lines,
        )
        piece = SemanticChunkPiece(
            unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=text
        )
        return (
            _repair_curriculum_piece_context(piece=piece, unit=unit, chunk_profile=chunk_profile),
        )

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
        if (
            current_rows
            and estimate_token_count(candidate_text, chunk_profile=chunk_profile)
            > effective_max_tokens
        ):
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
        piece = SemanticChunkPiece(
            unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=text
        )
        return (
            _repair_curriculum_piece_context(piece=piece, unit=unit, chunk_profile=chunk_profile),
        )

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


def _build_curriculum_contextual_text(
    *,
    unit_type: str,
    section_path: list[str],
    piece_text: str,
    chunk_profile: ChunkProfile,
) -> str:
    structural_path = _normalize_curriculum_structural_path(section_path)
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
        if (
            estimate_token_count(candidate_text, chunk_profile=chunk_profile)
            <= chunk_profile.max_chunk_size
        ):
            return candidate_text
        return piece_text.strip()
    overlap_prefix = _resolve_curriculum_missing_prefix(
        structural_path=structural_path, piece_lines=piece_lines
    )
    if overlap_prefix is not None:
        if not overlap_prefix:
            return piece_text.strip()
        candidate_text = "\n\n".join([*overlap_prefix, piece_text.strip()]).strip()
        if (
            estimate_token_count(candidate_text, chunk_profile=chunk_profile)
            <= chunk_profile.max_chunk_size
        ):
            return candidate_text
        return piece_text.strip()
    heading_prefix = _leading_curriculum_heading_lines(piece_lines, structural_path=structural_path)
    if heading_prefix == structural_path:
        return piece_text.strip()
    content_lines = piece_lines[len(heading_prefix) :] if heading_prefix else piece_lines
    content_text = "\n".join(content_lines).strip()
    if not content_text:
        return piece_text.strip()
    prefix_variants = _curriculum_context_prefix_variants(structural_path)
    for candidate_prefix in prefix_variants:
        candidate_text = "\n\n".join([*candidate_prefix, content_text]).strip()
        if (
            estimate_token_count(candidate_text, chunk_profile=chunk_profile)
            <= chunk_profile.max_chunk_size
        ):
            return candidate_text
    if unit_type != "table_unit":
        return piece_text.strip()
    compact_lines = [line for line in content_lines if not _is_table_cue_row(line)]
    if len(compact_lines) == len(content_lines):
        return piece_text.strip()
    compact_text = "\n".join(compact_lines).strip()
    for candidate_prefix in prefix_variants:
        candidate_text = "\n\n".join([*candidate_prefix, compact_text]).strip()
        if (
            estimate_token_count(candidate_text, chunk_profile=chunk_profile)
            <= chunk_profile.max_chunk_size
        ):
            return candidate_text
    return piece_text.strip()


def _resolve_curriculum_missing_prefix(
    *,
    structural_path: list[str],
    piece_lines: list[str],
) -> list[str] | None:
    heading_lines = _leading_curriculum_heading_lines(piece_lines)
    if not heading_lines:
        return None
    if (
        len(heading_lines) >= len(structural_path)
        and heading_lines[: len(structural_path)] == structural_path
    ):
        return []
    if _is_ordered_heading_subsequence(structural_path, heading_lines):
        return []

    best_overlap: tuple[int, int] | None = None
    for heading_index in range(len(heading_lines)):
        max_overlap = min(len(structural_path), len(heading_lines) - heading_index)
        for overlap_length in range(max_overlap, 0, -1):
            candidate_lines = heading_lines[heading_index : heading_index + overlap_length]
            if candidate_lines != structural_path[-overlap_length:]:
                continue
            candidate_overlap = (overlap_length, heading_index)
            if best_overlap is None or candidate_overlap > best_overlap:
                best_overlap = candidate_overlap
            break
    if best_overlap is None:
        return None
    overlap_length, _ = best_overlap
    return structural_path[:-overlap_length]


def _is_ordered_heading_subsequence(structural_path: list[str], heading_lines: list[str]) -> bool:
    heading_index = 0
    for expected_heading in structural_path:
        while (
            heading_index < len(heading_lines) and heading_lines[heading_index] != expected_heading
        ):
            heading_index += 1
        if heading_index >= len(heading_lines):
            return False
        heading_index += 1
    return True


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
    return contextual_lines[: -len(piece_lines)]


def _curriculum_context_prefix_variants(structural_path: list[str]) -> list[list[str]]:
    variants: list[list[str]] = []
    _append_unique_curriculum_prefix_variant(variants, structural_path)
    if len(structural_path) > 2:
        _append_unique_curriculum_prefix_variant(
            variants, [structural_path[0], structural_path[-1]]
        )
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
    return estimate_token_count("\n\n".join(required_lines), chunk_profile=chunk_profile) + (
        2 * len(required_lines)
    )


def _required_curriculum_table_context_lines(
    *,
    section_path: list[str],
    caption_lines: tuple[str, ...],
) -> list[str]:
    structural_path = [item for item in section_path if item]
    if len(structural_path) > 1 and not _looks_like_curriculum_structure_heading(
        structural_path[0]
    ):
        structural_path = structural_path[1:]
    if not structural_path:
        return []
    existing_headings = [
        line for line in caption_lines if _looks_like_curriculum_structure_heading(line)
    ]
    return [heading for heading in structural_path if heading not in existing_headings]


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


__all__ = [
    "_build_curriculum_contextual_text",
    "_serialize_table_chunk",
    "chunk_curriculum_unit",
]
