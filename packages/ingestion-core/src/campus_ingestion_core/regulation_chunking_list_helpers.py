from __future__ import annotations

import re
from collections.abc import Sequence

from campus_regulation_semantics.regulation_semantic_registry import (
    resolve_regulation_group_intro_kind,
    resolve_regulation_heading_role_hint,
    resolve_regulation_intro_list_role_hint,
)

from campus_ingestion_core.chunking import ChunkProfile, resolve_display_budget
from campus_ingestion_core.process_shared import StructuredUnit
from campus_ingestion_core.regulation_answer_roles import starts_procedure_list

from .regulation_chunking_shared import (
    _ARTICLE_PREFIXED_ITEM_RE,
    _GENERIC_ITEM_RE,
    _NUMERIC_ITEM_RE,
    _compose_list_segment_text,
    _first_item_line_index,
    _label_overrides,
    _label_range,
    _RegulationListBlock,
    _RegulationSegment,
    _structured_unit_chunk_input,
)


def _looks_like_group_intro(text: str) -> bool:
    assignment = resolve_regulation_group_intro_kind(text)
    return bool(assignment.value)


def _contiguous_intro_item_blocks(
    item_blocks: Sequence[_RegulationListBlock],
    *,
    start_index: int,
) -> tuple[_RegulationListBlock, ...]:
    contiguous_blocks: list[_RegulationListBlock] = []
    for block in item_blocks[start_index:]:
        if _looks_like_group_intro(block.text) or starts_procedure_list(block.text):
            if contiguous_blocks:
                break
            continue
        contiguous_blocks.append(block)
    return tuple(contiguous_blocks)


def _should_emit_prefix_as_intro(prefix_text: str) -> bool:
    normalized = prefix_text.strip()
    if not normalized:
        return False
    if normalized.endswith((":", "：")):
        return True
    if _looks_like_group_intro(normalized):
        return True
    if resolve_regulation_intro_list_role_hint(normalized).value:
        return True
    return bool(resolve_regulation_heading_role_hint(normalized).value)


def _extract_list_blocks(lines: Sequence[str]) -> tuple[_RegulationListBlock, ...]:
    numeric_blocks = _extract_blocks_by_pattern(lines, _NUMERIC_ITEM_RE)
    if len(numeric_blocks) >= 2:
        return numeric_blocks
    article_prefixed_blocks = _extract_blocks_by_pattern(lines, _ARTICLE_PREFIXED_ITEM_RE)
    if len(article_prefixed_blocks) >= 2:
        return article_prefixed_blocks
    generic_blocks = _extract_blocks_by_pattern(lines, _GENERIC_ITEM_RE)
    return generic_blocks if len(generic_blocks) >= 2 else ()


def _extract_answer_ready_item_blocks(lines: Sequence[str]) -> tuple[_RegulationListBlock, ...]:
    article_prefixed_blocks = _extract_blocks_by_pattern(lines, _ARTICLE_PREFIXED_ITEM_RE)
    if any(block.label for block in article_prefixed_blocks):
        return article_prefixed_blocks
    return _extract_blocks_by_pattern(lines, _GENERIC_ITEM_RE)


def _extract_blocks_by_pattern(
    lines: Sequence[str],
    pattern: re.Pattern[str],
) -> tuple[_RegulationListBlock, ...]:
    blocks: list[_RegulationListBlock] = []
    current_label: str | None = None
    current_lines: list[str] = []
    for line in lines:
        if _looks_like_group_intro(line):
            if current_label is not None and current_lines:
                blocks.append(
                    _RegulationListBlock(
                        label=current_label,
                        text="\n".join(current_lines).strip(),
                    )
                )
            blocks.append(
                _RegulationListBlock(
                    label="",
                    text=line.strip(),
                )
            )
            current_label = None
            current_lines = []
            continue
        match = pattern.match(line)
        if match is not None:
            if current_label is not None and current_lines:
                blocks.append(
                    _RegulationListBlock(
                        label=current_label,
                        text="\n".join(current_lines).strip(),
                    )
                )
            current_label = match.group("label").strip()
            current_lines = [line]
            continue
        if current_label is not None:
            current_lines.append(line)
    if current_label is not None and current_lines:
        blocks.append(
            _RegulationListBlock(
                label=current_label,
                text="\n".join(current_lines).strip(),
            )
        )
    return tuple(blocks)


def _build_regulation_list_segments(
    *,
    unit: StructuredUnit,
    text: str,
    chunk_profile: ChunkProfile,
) -> tuple[_RegulationSegment, ...]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    item_blocks = _extract_list_blocks(lines)
    if len(item_blocks) < 2:
        return ()

    first_item_line_index = _first_item_line_index(
        lines,
        item_blocks[0].label,
        item_blocks[0].text,
    )
    prefix_lines = lines[:first_item_line_index]
    prefix_text = "\n".join(prefix_lines).strip()
    display_budget = resolve_display_budget(
        unit=_structured_unit_chunk_input(unit),
        chunk_profile=chunk_profile,
    )
    max_items_per_piece = 2 if prefix_text else 3
    groups = _regulation_list_groups(
        item_blocks=item_blocks,
        prefix_text=prefix_text,
        chunk_profile=chunk_profile,
        max_tokens=display_budget.max_tokens,
        min_tokens=display_budget.min_tokens,
        max_items_per_piece=max_items_per_piece,
    )
    return tuple(
        _RegulationSegment(
            text=_compose_list_segment_text(
                prefix_text=prefix_text if index == 0 else "",
                blocks=group,
            ),
            anchor=_label_overrides(_label_range([block.label for block in group])),
            metadata=_label_overrides(_label_range([block.label for block in group])),
            split_reason="structure_boundary",
            boundary_rule="regulation_enumerated_list_block",
        )
        for index, group in enumerate(groups)
    )


def _regulation_list_groups(
    *,
    item_blocks: Sequence[_RegulationListBlock],
    prefix_text: str,
    chunk_profile: ChunkProfile,
    max_tokens: int,
    min_tokens: int,
    max_items_per_piece: int,
) -> list[list[_RegulationListBlock]]:
    groups: list[list[_RegulationListBlock]] = []
    current_group: list[_RegulationListBlock] = []
    for block in item_blocks:
        candidate_group = [*current_group, block]
        candidate_text = _compose_list_segment_text(
            prefix_text=prefix_text if not groups else "",
            blocks=candidate_group,
        )
        candidate_tokens = chunk_profile.count_tokens(candidate_text)
        current_text = _compose_list_segment_text(
            prefix_text=prefix_text if not groups else "",
            blocks=current_group,
        )
        current_tokens = chunk_profile.count_tokens(current_text) if current_group else 0
        should_split = current_group and (
            candidate_tokens > max_tokens
            or (len(current_group) >= max_items_per_piece and current_tokens >= min_tokens)
        )
        if should_split:
            groups.append(current_group)
            current_group = [block]
            continue
        current_group.append(block)
    if current_group:
        groups.append(current_group)
    return groups
