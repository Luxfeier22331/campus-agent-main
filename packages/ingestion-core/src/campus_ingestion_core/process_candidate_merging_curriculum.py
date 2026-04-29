from __future__ import annotations

import re
from collections.abc import Sequence

from campus_ingestion_core.chunking import (
    ChunkProfile,
    SemanticChunkPiece,
    assemble_chunk_text,
    build_chunk_text_context,
)
from campus_ingestion_core.curriculum_chunk_units import _leading_curriculum_heading_lines
from campus_ingestion_core.process_candidate_aggregation import (
    build_aggregated_anchor,
    build_aggregated_metadata,
    build_curriculum_aggregated_display_text,
    normalize_section_path,
    strip_curriculum_common_path_prefix,
)
from campus_ingestion_core.process_candidate_merging_short_textual import (
    _NESTED_NUMBERED_LINE_RE,
    is_short_textual_candidate,
)
from campus_ingestion_core.process_shared import _ChunkCandidate

_CURRICULUM_TOP_LEVEL_HEADING_RE = re.compile(
    r"^(?:[一二三四五六七八九十]+、|第[一二三四五六七八九十百千万〇零两0-9]+[章节部分])"
)


def merge_adjacent_curriculum_table_candidates(
    *,
    chunk_candidates: Sequence[_ChunkCandidate],
    chunk_profile: ChunkProfile,
) -> tuple[_ChunkCandidate, ...]:
    if not chunk_candidates:
        return ()
    merged: list[_ChunkCandidate] = []
    index = 0
    while index < len(chunk_candidates):
        current = chunk_candidates[index]
        if index + 1 < len(chunk_candidates):
            incoming = chunk_candidates[index + 1]
            next_candidate = try_merge_curriculum_table_candidates(
                current=current,
                incoming=incoming,
                chunk_profile=chunk_profile,
            )
            if next_candidate is not None:
                merged.append(next_candidate)
                index += 2
                continue
        merged.append(current)
        index += 1
    return tuple(merged)


def merge_adjacent_curriculum_section_context_candidates(
    *,
    chunk_candidates: Sequence[_ChunkCandidate],
    section_chunk_profile: ChunkProfile,
    table_chunk_profile: ChunkProfile,
) -> tuple[_ChunkCandidate, ...]:
    absorbed = list(chunk_candidates)
    changed = True
    while changed:
        changed = False
        index = 0
        while index < len(absorbed):
            candidate = absorbed[index]
            if not is_absorbable_curriculum_section_candidate(candidate):
                index += 1
                continue
            if index + 1 < len(absorbed):
                merged_with_next = try_merge_curriculum_section_context_candidates(
                    current=candidate,
                    incoming=absorbed[index + 1],
                    chunk_profile=(
                        table_chunk_profile
                        if absorbed[index + 1].unit_type == "table_unit"
                        else section_chunk_profile
                    ),
                )
                if merged_with_next is not None:
                    absorbed[index] = merged_with_next
                    del absorbed[index + 1]
                    changed = True
                    continue
            if index > 0 and absorbed[index - 1].unit_type == "section_text":
                merged_with_previous = try_merge_curriculum_section_context_candidates(
                    current=absorbed[index - 1],
                    incoming=candidate,
                    chunk_profile=section_chunk_profile,
                )
                if merged_with_previous is not None:
                    absorbed[index - 1] = merged_with_previous
                    del absorbed[index]
                    changed = True
                    index = max(index - 1, 0)
                    continue
            index += 1
    return tuple(absorbed)


def try_merge_curriculum_table_candidates(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    chunk_profile: ChunkProfile,
) -> _ChunkCandidate | None:
    if current.unit_type != "table_unit" or incoming.unit_type != "table_unit":
        return None
    if current.visibility_level != incoming.visibility_level:
        return None
    if not curriculum_table_section_paths_are_compatible(current=current, incoming=incoming):
        return None
    if current.metadata.get("title") != incoming.metadata.get("title"):
        return None
    if not is_weak_curriculum_table_candidate(current) and not is_weak_curriculum_table_candidate(
        incoming
    ):
        return None
    members = (*current.members, *incoming.members)
    aggregated_anchor = build_aggregated_anchor(members)
    aggregated_metadata = build_aggregated_metadata(current=current, members=members)
    aggregated_metadata["aggregation_mode"] = "adjacent_curriculum_table_context"
    aggregated_display_text = "\n".join(
        piece for piece in (current.piece.text.strip(), incoming.piece.text.strip()) if piece
    ).strip()
    chunk_assembly = assemble_chunk_text(
        display_text=aggregated_display_text,
        context_plan=build_chunk_text_context(
            anchor=aggregated_anchor, metadata=aggregated_metadata
        ),
        chunk_profile=chunk_profile,
    )
    if chunk_assembly.total_token_count > chunk_profile.max_chunk_size:
        return None
    return _ChunkCandidate(
        unit_type=current.unit_type,
        root_unit_id=current.root_unit_id,
        source_chunk_id=current.source_chunk_id,
        visibility_level=current.visibility_level,
        anchor=aggregated_anchor,
        metadata=aggregated_metadata,
        piece=SemanticChunkPiece(
            unit_type=current.piece.unit_type,
            root_unit_id=current.piece.root_unit_id,
            text=aggregated_display_text,
        ),
        chunk_assembly=chunk_assembly,
        members=members,
    )


def try_merge_curriculum_section_context_candidates(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    chunk_profile: ChunkProfile,
) -> _ChunkCandidate | None:
    if not curriculum_section_context_candidates_are_compatible(current=current, incoming=incoming):
        return None
    members = (*current.members, *incoming.members)
    base_candidate = select_curriculum_context_base_candidate(current=current, incoming=incoming)
    aggregated_anchor = build_curriculum_context_aggregated_anchor(
        current=current,
        incoming=incoming,
        members=members,
    )
    aggregated_metadata = build_aggregated_metadata(current=base_candidate, members=members)
    aggregated_metadata["aggregation_mode"] = resolve_curriculum_context_aggregation_mode(
        current=current,
        incoming=incoming,
    )
    aggregated_display_text = build_curriculum_aggregated_display_text(members)
    chunk_assembly = assemble_chunk_text(
        display_text=aggregated_display_text,
        context_plan=build_chunk_text_context(
            anchor=aggregated_anchor, metadata=aggregated_metadata
        ),
        chunk_profile=chunk_profile,
    )
    if chunk_assembly.total_token_count > chunk_profile.max_chunk_size:
        return None
    return _ChunkCandidate(
        unit_type=base_candidate.unit_type,
        root_unit_id=base_candidate.root_unit_id,
        source_chunk_id=base_candidate.source_chunk_id,
        visibility_level=base_candidate.visibility_level,
        anchor=aggregated_anchor,
        metadata=aggregated_metadata,
        piece=SemanticChunkPiece(
            unit_type=base_candidate.piece.unit_type,
            root_unit_id=base_candidate.piece.root_unit_id,
            text=aggregated_display_text,
        ),
        chunk_assembly=chunk_assembly,
        members=members,
    )


def curriculum_table_section_paths_are_compatible(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    current_path = normalize_section_path(current.anchor)
    incoming_path = normalize_section_path(incoming.anchor)
    if current_path == incoming_path:
        return True
    if not current_path or not incoming_path:
        return False
    if current_path[: len(incoming_path)] == incoming_path:
        return True
    return incoming_path[: len(current_path)] == current_path


def curriculum_section_context_candidates_are_compatible(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    if current.unit_type != "section_text":
        return False
    if incoming.unit_type not in {"section_text", "table_unit"}:
        return False
    if current.visibility_level != incoming.visibility_level:
        return False
    current_path = normalize_section_path(current.anchor)
    incoming_path = normalize_section_path(incoming.anchor)
    if incoming.unit_type == "table_unit":
        return curriculum_section_to_table_candidates_are_compatible(
            current=current,
            incoming=incoming,
            current_path=current_path,
            incoming_path=incoming_path,
        )
    if current_path == incoming_path:
        return True
    if curriculum_candidate_is_title_only(current) and incoming_path:
        return True
    if (
        current_path
        and len(incoming_path) == len(current_path) + 1
        and incoming_path[: len(current_path)] == current_path
        and curriculum_candidate_has_structural_continuation_beyond_anchor(current)
        and curriculum_candidate_has_explicit_leaf_item(incoming)
    ):
        return True
    if (
        current_path
        and len(incoming_path) == len(current_path) + 1
        and incoming_path[: len(current_path)] == current_path
        and is_short_textual_candidate(current)
        and not curriculum_candidate_is_heading_only(current)
        and (
            not curriculum_candidate_has_explicit_leaf_item(current)
            or curriculum_candidate_has_short_parent_intro_body(current)
        )
    ):
        return True
    if not current_path or not incoming_path:
        return False
    if current_path[:-1] != incoming_path[:-1]:
        return False
    if curriculum_candidate_leaf_is_top_level_heading(
        current
    ) or curriculum_candidate_leaf_is_top_level_heading(incoming):
        return False
    if curriculum_candidate_is_heading_only(current):
        return True
    return curriculum_candidate_has_explicit_leaf_item(
        current
    ) and curriculum_candidate_has_explicit_leaf_item(incoming)


def curriculum_section_to_table_candidates_are_compatible(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    current_path: tuple[str, ...],
    incoming_path: tuple[str, ...],
) -> bool:
    if not curriculum_candidate_is_heading_only(current) and not curriculum_candidate_is_title_only(
        current
    ):
        return False
    if current_path and current_path == incoming_path:
        return True
    if (
        current_path
        and incoming_path
        and current_path[:-1] == incoming_path[:-1]
        and curriculum_candidate_is_heading_only(current)
    ):
        return not (
            curriculum_path_leaf_is_top_level_heading(current_path)
            or curriculum_path_leaf_is_top_level_heading(incoming_path)
        )
    return bool(curriculum_candidate_is_title_only(current) and incoming_path)


def is_absorbable_curriculum_section_candidate(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    if candidate.piece.split_reason is not None:
        return False
    if candidate.piece.segment_total != 1:
        return False
    return is_short_textual_candidate(candidate)


def is_weak_curriculum_table_candidate(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "table_unit":
        return False
    caption_lines = tuple(
        str(item).strip()
        for item in list(candidate.metadata.get("caption_lines") or ())
        if str(item).strip()
    )
    row_lines = tuple(
        str(item).strip()
        for item in list(candidate.metadata.get("table_row_lines") or ())
        if str(item).strip()
    )
    header_line = str(candidate.metadata.get("table_header_line") or "").strip()
    if caption_lines or row_lines:
        return False
    if not header_line:
        return True
    return not looks_like_table_header_line(header_line)


def looks_like_table_header_line(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    return any(
        token in normalized
        for token in (
            "课程号",
            "课程名称",
            "学分",
            "学时",
            "修读学期",
            "开设学期",
            "备注",
            "类别",
            "培养阶段",
            "板块名称",
            "课程类",
            "专业名称",
        )
    )


def select_curriculum_context_base_candidate(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> _ChunkCandidate:
    if incoming.unit_type == "table_unit":
        return incoming
    if curriculum_candidate_is_title_only(current):
        return incoming
    return current


def build_curriculum_context_aggregated_anchor(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    members: Sequence,
) -> dict[str, object]:
    aggregated_anchor = build_aggregated_anchor(members)
    if normalize_section_path(aggregated_anchor):
        return aggregated_anchor
    incoming_path = normalize_section_path(incoming.anchor)
    if curriculum_candidate_is_title_only(current) and incoming_path:
        aggregated_anchor["section_path"] = list(incoming_path)
        return aggregated_anchor
    current_path = normalize_section_path(current.anchor)
    if (
        current_path
        and incoming_path
        and current_path[:-1] == incoming_path[:-1]
        and curriculum_candidate_is_heading_only(current)
    ):
        aggregated_anchor["section_path"] = list(current_path)
    return aggregated_anchor


def resolve_curriculum_context_aggregation_mode(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> str:
    if incoming.unit_type == "table_unit":
        return "adjacent_curriculum_section_table_context"
    return "adjacent_curriculum_section_context"


def curriculum_candidate_is_heading_only(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    lines = [line.strip() for line in candidate.piece.text.splitlines() if line.strip()]
    if not lines:
        return False
    return len(_leading_curriculum_heading_lines(lines)) == len(lines)


def curriculum_candidate_is_title_only(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    if normalize_section_path(candidate.anchor):
        return False
    lines = [line.strip() for line in candidate.piece.text.splitlines() if line.strip()]
    return len(lines) == 1


def curriculum_candidate_has_explicit_leaf_item(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    section_path = normalize_section_path(candidate.anchor)
    if not section_path:
        return False
    text = strip_curriculum_common_path_prefix(
        candidate.piece.text,
        common_path=section_path[:-1],
    )
    contribution_lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not contribution_lines:
        return False
    return contribution_lines[0] == section_path[-1]


def curriculum_candidate_has_short_parent_intro_body(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    section_path = normalize_section_path(candidate.anchor)
    if not section_path:
        return False
    text = strip_curriculum_common_path_prefix(
        candidate.piece.text,
        common_path=section_path[:-1],
    )
    contribution_lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(contribution_lines) < 2:
        return False
    if contribution_lines[0] != section_path[-1]:
        return False
    first_body_line = contribution_lines[1]
    return not (
        _CURRICULUM_TOP_LEVEL_HEADING_RE.match(first_body_line)
        or _NESTED_NUMBERED_LINE_RE.match(first_body_line)
    )


def curriculum_candidate_has_structural_continuation_beyond_anchor(
    candidate: _ChunkCandidate,
) -> bool:
    if candidate.unit_type != "section_text":
        return False
    section_path = normalize_section_path(candidate.anchor)
    if not section_path:
        return False
    text = strip_curriculum_common_path_prefix(candidate.piece.text, common_path=section_path)
    continuation_lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not continuation_lines:
        return False
    return bool(
        _CURRICULUM_TOP_LEVEL_HEADING_RE.match(continuation_lines[0])
        or _NESTED_NUMBERED_LINE_RE.match(continuation_lines[0])
    )


def curriculum_candidate_leaf_is_top_level_heading(candidate: _ChunkCandidate) -> bool:
    section_path = normalize_section_path(candidate.anchor)
    if not section_path:
        return False
    return curriculum_path_leaf_is_top_level_heading(section_path)


def curriculum_path_leaf_is_top_level_heading(section_path: tuple[str, ...]) -> bool:
    if not section_path:
        return False
    return bool(_CURRICULUM_TOP_LEVEL_HEADING_RE.match(section_path[-1]))


__all__ = [
    "build_curriculum_context_aggregated_anchor",
    "curriculum_candidate_has_explicit_leaf_item",
    "curriculum_candidate_has_short_parent_intro_body",
    "curriculum_candidate_has_structural_continuation_beyond_anchor",
    "curriculum_candidate_is_heading_only",
    "curriculum_candidate_is_title_only",
    "curriculum_candidate_leaf_is_top_level_heading",
    "curriculum_path_leaf_is_top_level_heading",
    "curriculum_section_context_candidates_are_compatible",
    "curriculum_section_to_table_candidates_are_compatible",
    "curriculum_table_section_paths_are_compatible",
    "is_absorbable_curriculum_section_candidate",
    "is_weak_curriculum_table_candidate",
    "looks_like_table_header_line",
    "merge_adjacent_curriculum_section_context_candidates",
    "merge_adjacent_curriculum_table_candidates",
    "resolve_curriculum_context_aggregation_mode",
    "select_curriculum_context_base_candidate",
    "try_merge_curriculum_section_context_candidates",
    "try_merge_curriculum_table_candidates",
]
