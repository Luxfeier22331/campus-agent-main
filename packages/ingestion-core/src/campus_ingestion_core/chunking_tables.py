from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

from campus_ingestion_core.chunking_token_windows import (
    collect_soft_boundary_indexes,
    merge_short_tail,
    split_token_windows,
    tokenize_text,
)


@dataclass(frozen=True, slots=True)
class TablePieceSpec:
    text: str
    split_reason: str | None


class StructuredUnitLike(Protocol):
    unit_type: str
    text: str
    metadata: Mapping[str, object]


class ChunkProfileLike(Protocol):
    max_chunk_size: int


class DisplayBudgetLike(Protocol):
    max_tokens: int
    target_tokens: int
    min_tokens: int
    overlap_tokens: int


def serialize_table_unit_text(
    *,
    caption_lines: tuple[str, ...] = (),
    header_line: str = "",
    row_lines: tuple[str, ...] = (),
    note_lines: tuple[str, ...] = (),
) -> str:
    parts: list[str] = []
    parts.extend(line.strip() for line in caption_lines if line and line.strip())
    if header_line.strip():
        parts.append(header_line.strip())
    parts.extend(line.rstrip() for line in row_lines if line and line.strip())
    parts.extend(line.strip() for line in note_lines if line and line.strip())
    return "\n".join(parts).strip()


def build_table_piece_specs(
    *,
    unit: StructuredUnitLike,
    chunk_profile: ChunkProfileLike,
    count_tokens: Callable[[str], int],
    clean_text: Callable[[str, str], str],
    resolve_display_budget: Callable[[StructuredUnitLike, ChunkProfileLike], DisplayBudgetLike],
) -> tuple[TablePieceSpec, ...]:
    caption_lines = tuple(
        str(item).strip()
        for item in list(unit.metadata.get("caption_lines") or [])
        if str(item).strip()
    )
    header_line = str(unit.metadata.get("table_header_line") or "").strip()
    row_lines = tuple(
        str(item).rstrip()
        for item in list(unit.metadata.get("table_row_lines") or [])
        if str(item).strip()
    )
    note_lines = tuple(
        str(item).strip()
        for item in list(unit.metadata.get("note_lines") or [])
        if str(item).strip()
    )

    if not row_lines:
        text = serialize_table_unit_text(
            caption_lines=caption_lines,
            header_line=header_line,
            row_lines=(),
            note_lines=note_lines,
        )
        if not text:
            text = clean_text(unit.unit_type, unit.text)
        if not text:
            return ()
        return _build_piece_specs(
            unit=unit,
            chunk_profile=chunk_profile,
            texts=(text,),
            split_reason=None,
            count_tokens=count_tokens,
            clean_text=clean_text,
            resolve_display_budget=resolve_display_budget,
        )

    prefix_lines = [*caption_lines]
    if header_line:
        prefix_lines.append(header_line)
    suffix_lines = [*note_lines]
    fixed_token_count = count_tokens("\n".join([*prefix_lines, *suffix_lines]))

    windows: list[list[str]] = []
    current_rows: list[str] = []
    current_tokens = fixed_token_count
    for row_line in row_lines:
        row_tokens = count_tokens(row_line)
        if current_rows and current_tokens + row_tokens > chunk_profile.max_chunk_size:
            windows.append(current_rows)
            current_rows = [row_line]
            current_tokens = fixed_token_count + row_tokens
            continue
        current_rows.append(row_line)
        current_tokens += row_tokens

    if current_rows:
        windows.append(current_rows)

    texts = tuple(
        serialize_table_unit_text(
            caption_lines=caption_lines,
            header_line=header_line,
            row_lines=tuple(window_rows),
            note_lines=note_lines,
        )
        for window_rows in windows
    )
    split_reason = "table_row_window" if len(texts) > 1 else None
    return _build_piece_specs(
        unit=unit,
        chunk_profile=chunk_profile,
        texts=texts,
        split_reason=split_reason,
        count_tokens=count_tokens,
        clean_text=clean_text,
        resolve_display_budget=resolve_display_budget,
    )


def _build_piece_specs(
    *,
    unit: StructuredUnitLike,
    chunk_profile: ChunkProfileLike,
    texts: tuple[str, ...],
    split_reason: str | None,
    count_tokens: Callable[[str], int],
    clean_text: Callable[[str, str], str],
    resolve_display_budget: Callable[[StructuredUnitLike, ChunkProfileLike], DisplayBudgetLike],
) -> tuple[TablePieceSpec, ...]:
    specs: list[TablePieceSpec] = []
    for text in texts:
        normalized_text = clean_text(unit.unit_type, text)
        if not normalized_text:
            continue
        if count_tokens(normalized_text) <= chunk_profile.max_chunk_size:
            specs.append(TablePieceSpec(text=normalized_text, split_reason=split_reason))
            continue
        specs.extend(
            TablePieceSpec(text=piece_text, split_reason="token_guardrail")
            for piece_text in _split_table_text_to_budget(
                text=normalized_text,
                unit=unit,
                chunk_profile=chunk_profile,
                count_tokens=count_tokens,
                resolve_display_budget=resolve_display_budget,
            )
        )
    return tuple(specs)


def _split_table_text_to_budget(
    *,
    text: str,
    unit: StructuredUnitLike,
    chunk_profile: ChunkProfileLike,
    count_tokens: Callable[[str], int],
    resolve_display_budget: Callable[[StructuredUnitLike, ChunkProfileLike], DisplayBudgetLike],
) -> tuple[str, ...]:
    display_budget = resolve_display_budget(unit, chunk_profile)
    token_spans = tokenize_text(text)
    windows = split_token_windows(
        text=text,
        token_spans=token_spans,
        display_budget=display_budget,
        count_tokens=count_tokens,
    )
    windows = merge_short_tail(
        windows,
        text=text,
        token_spans=token_spans,
        boundary_indexes=collect_soft_boundary_indexes(text=text, token_spans=token_spans),
        display_budget=display_budget,
        count_tokens=count_tokens,
    )
    pieces = tuple(piece_text for _, _, piece_text in windows if piece_text.strip())
    if pieces and all(
        count_tokens(piece_text) <= display_budget.max_tokens for piece_text in pieces
    ):
        return pieces
    return _split_text_by_character_budget(
        text=text,
        display_budget=display_budget,
        count_tokens=count_tokens,
    )


def _split_text_by_character_budget(
    *,
    text: str,
    display_budget: DisplayBudgetLike,
    count_tokens: Callable[[str], int],
) -> tuple[str, ...]:
    segments: list[str] = []
    start = 0
    text_length = len(text)
    while start < text_length:
        while start < text_length and text[start].isspace():
            start += 1
        if start >= text_length:
            break
        low = start + 1
        high = text_length
        best_end: int | None = None
        while low <= high:
            mid = (low + high) // 2
            candidate = text[start:mid].strip()
            if not candidate:
                low = mid + 1
                continue
            if count_tokens(candidate) <= display_budget.max_tokens:
                best_end = mid
                low = mid + 1
            else:
                high = mid - 1
        if best_end is None or best_end <= start:
            raise ValueError("unable to split oversized table text within chunk budget")
        newline_boundary = text.rfind("\n", start + 1, best_end)
        if newline_boundary > start:
            newline_candidate = text[start:newline_boundary].strip()
            if newline_candidate and count_tokens(newline_candidate) <= display_budget.max_tokens:
                best_end = newline_boundary
        piece_text = text[start:best_end].strip()
        if not piece_text:
            raise ValueError("table text split produced empty segment")
        segments.append(piece_text)
        start = best_end
    return tuple(segments)


__all__ = [
    "TablePieceSpec",
    "build_table_piece_specs",
    "serialize_table_unit_text",
]
