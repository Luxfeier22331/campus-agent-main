from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, replace

from campus_ingestion_core.chunking import (
    ChunkProfile,
    SemanticChunkPiece,
    StructuredUnitChunkInput,
    chunk_structured_unit,
    chunk_table_unit,
    clean_structured_text,
    resolve_display_budget,
)
from campus_ingestion_core.chunking_context import resolve_display_budget as resolve_context_budget
from campus_ingestion_core.process_shared import StructuredUnit
from campus_ingestion_core.regulation_answer_roles import (
    build_answer_role_metadata,
    build_table_answer_role_metadata,
    decide_answer_role,
    is_answer_role_atomic,
    starts_example_list,
    starts_procedure_list,
)
from campus_ingestion_core.regulation_chunk_quality import is_regulation_body_role

_CHINESE_NUMBER = "一二三四五六七八九十百千万〇零两"
_NUMERIC_ITEM_RE = re.compile(r"^\s*(?P<label>\d+[.．、])")
_GENERIC_ITEM_RE = re.compile(
    rf"^\s*(?P<label>(?:\d+[.．、]|[（(]\d+[)）]|[（(][{_CHINESE_NUMBER}]+[)）][、.]?))"
)
_SECTION_LABEL_RE = re.compile(
    rf"^(?:第[{_CHINESE_NUMBER}0-9]+[章节条]|[{_CHINESE_NUMBER}0-9]+、|"
    rf"[（(][{_CHINESE_NUMBER}0-9]+[)）][、.]?)\s*"
)
_SHORT_ATOMIC_VALUE_MAX_CHARS = 24
_TEXTUAL_REGULATION_UNIT_TYPES = frozenset({"article_body", "policy_page", "regulation_body"})


@dataclass(frozen=True, slots=True)
class _RegulationListBlock:
    label: str
    text: str


@dataclass(frozen=True, slots=True)
class _RegulationSegment:
    text: str
    anchor: dict[str, object]
    metadata: dict[str, object]
    split_reason: str
    boundary_rule: str


@dataclass(slots=True)
class _AnswerReadyGroupingState:
    current_group: list[_RegulationListBlock]
    current_role: str | None
    example_list_context: bool
    pending_prefix_text: str


def build_regulation_unit_pieces(
    unit: StructuredUnit,
    chunk_profile: ChunkProfile,
    *,
    require_regulation_body_role: bool = True,
    answer_ready_roles: bool = False,
) -> tuple[SemanticChunkPiece, ...]:
    if unit.unit_type == "table_unit":
        return _build_table_unit_pieces(unit=unit, chunk_profile=chunk_profile)
    if not _should_use_regulation_chunking(
        unit=unit,
        require_regulation_body_role=require_regulation_body_role,
    ):
        return chunk_structured_unit(
            unit=_structured_unit_chunk_input(unit),
            chunk_profile=_without_overlap(chunk_profile),
        )

    cleaned_text = clean_structured_text(unit_type=unit.unit_type, text=unit.text)
    if not cleaned_text:
        return ()

    contextualized_text = _contextualize_short_subject_value(
        text=cleaned_text,
        section_path=_section_path(unit.anchor),
    )
    if contextualized_text is not None:
        return (
            SemanticChunkPiece(
                unit_type=unit.unit_type,
                root_unit_id=unit.root_unit_id,
                text=contextualized_text,
                metadata=_answer_role_metadata(
                    text=contextualized_text,
                    prefix_text="",
                    role_hint=None,
                )
                if answer_ready_roles
                else {},
            ),
        )

    if answer_ready_roles:
        answer_ready_segments = _build_answer_ready_regulation_segments(
            unit=unit,
            text=cleaned_text,
            chunk_profile=chunk_profile,
        )
        if answer_ready_segments:
            return _segments_to_pieces(
                unit=unit,
                segments=answer_ready_segments,
                chunk_profile=chunk_profile,
            )
        return chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type=unit.unit_type,
                root_unit_id=unit.root_unit_id,
                text=cleaned_text,
                anchor=unit.anchor,
                metadata=unit.metadata,
            ),
            chunk_profile=_without_overlap(chunk_profile),
        )

    list_segments = _build_regulation_list_segments(
        unit=unit,
        text=cleaned_text,
        chunk_profile=chunk_profile,
    )
    if list_segments:
        return _segments_to_pieces(
            unit=unit,
            segments=list_segments,
            chunk_profile=chunk_profile,
        )

    return chunk_structured_unit(
        unit=StructuredUnitChunkInput(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=cleaned_text,
            anchor=unit.anchor,
            metadata=unit.metadata,
        ),
        chunk_profile=_without_overlap(chunk_profile),
    )


def _should_use_regulation_chunking(
    *,
    unit: StructuredUnit,
    require_regulation_body_role: bool,
) -> bool:
    if require_regulation_body_role:
        return is_regulation_body_role(unit.metadata.get("content_role"))
    return unit.unit_type in _TEXTUAL_REGULATION_UNIT_TYPES


def _build_table_unit_pieces(
    *,
    unit: StructuredUnit,
    chunk_profile: ChunkProfile,
) -> tuple[SemanticChunkPiece, ...]:
    base_pieces = chunk_table_unit(
        unit=_structured_unit_chunk_input(unit),
        chunk_profile=_without_overlap(chunk_profile),
    )
    return tuple(
        SemanticChunkPiece(
            unit_type=piece.unit_type,
            root_unit_id=piece.root_unit_id,
            text=piece.text,
            segment_index=piece.segment_index,
            segment_total=piece.segment_total,
            split_reason=piece.split_reason,
            boundary_rule=piece.boundary_rule,
            anchor=piece.anchor,
            metadata={
                **piece.metadata,
                **build_table_answer_role_metadata(text=piece.text, metadata=unit.metadata),
            },
        )
        for piece in base_pieces
    )


def _build_answer_ready_regulation_segments(
    *,
    unit: StructuredUnit,
    text: str,
    chunk_profile: ChunkProfile,
) -> tuple[_RegulationSegment, ...]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    item_blocks = _extract_blocks_by_pattern(lines, _GENERIC_ITEM_RE)
    if len(item_blocks) < 2:
        return ()

    first_item_line_index = _first_item_line_index(lines, item_blocks[0].label)
    prefix_text = "\n".join(lines[:first_item_line_index]).strip()
    display_budget = resolve_display_budget(
        unit=StructuredUnitChunkInput(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=text,
            anchor=unit.anchor,
            metadata=unit.metadata,
        ),
        chunk_profile=chunk_profile,
    )
    segments: list[_RegulationSegment] = []
    if prefix_text:
        intro_role_hint = _intro_role_hint(prefix_text)
        segments.append(
            _build_answer_ready_segment(
                text=prefix_text,
                label="",
                prefix_text="",
                role_hint=intro_role_hint,
                boundary_rule="regulation_answer_ready_intro",
            )
        )

    state = _AnswerReadyGroupingState(
        current_group=[],
        current_role=None,
        example_list_context=False,
        pending_prefix_text=prefix_text,
    )
    for block in item_blocks:
        if starts_procedure_list(block.text):
            segments.extend(
                _flush_answer_ready_group(
                    state=state,
                    display_budget=display_budget,
                    chunk_profile=chunk_profile,
                )
            )
            state.example_list_context = False
            state.pending_prefix_text = block.text
            continue
        role_hint = (
            "example_evidence"
            if state.example_list_context and _is_numeric_list_label(block.label)
            else None
        )
        block_role = _answer_role(
            text=block.text,
            prefix_text=state.pending_prefix_text,
            role_hint=role_hint,
        )
        if is_answer_role_atomic(block_role):
            segments.extend(
                _flush_answer_ready_group(
                    state=state,
                    display_budget=display_budget,
                    chunk_profile=chunk_profile,
                )
            )
            segments.append(
                _build_answer_ready_segment(
                    text=block.text,
                    label=block.label,
                    prefix_text=state.pending_prefix_text,
                    role_hint=block_role,
                    boundary_rule="regulation_answer_ready_atomic_item",
                )
            )
            state.pending_prefix_text = ""
            if _starts_example_list(block.text):
                state.example_list_context = True
            continue
        if state.current_role is None:
            state.current_role = block_role
        if state.current_group and block_role != state.current_role:
            segments.extend(
                _flush_answer_ready_group(
                    state=state,
                    display_budget=display_budget,
                    chunk_profile=chunk_profile,
                )
            )
            state.current_role = block_role
            state.pending_prefix_text = ""
        state.current_group.append(block)
        if _starts_example_list(block.text):
            state.example_list_context = True

    segments.extend(
        _flush_answer_ready_group(
            state=state,
            display_budget=display_budget,
            chunk_profile=chunk_profile,
        )
    )
    if not any(bool(segment.metadata.get("is_answer_bearing")) for segment in segments):
        return ()
    return tuple(segments)


def _flush_answer_ready_group(
    *,
    state: _AnswerReadyGroupingState,
    display_budget,
    chunk_profile: ChunkProfile,
) -> tuple[_RegulationSegment, ...]:
    if not state.current_group:
        return ()
    segments = _grouped_answer_ready_segments(
        blocks=tuple(state.current_group),
        prefix_text=state.pending_prefix_text,
        display_budget=display_budget,
        chunk_profile=chunk_profile,
        role_hint=state.current_role,
    )
    state.current_group = []
    state.current_role = None
    return segments


def _grouped_answer_ready_segments(
    *,
    blocks: Sequence[_RegulationListBlock],
    prefix_text: str,
    display_budget,
    chunk_profile: ChunkProfile,
    role_hint: str | None,
) -> tuple[_RegulationSegment, ...]:
    groups: list[list[_RegulationListBlock]] = []
    current_group: list[_RegulationListBlock] = []
    for block in blocks:
        candidate_group = [*current_group, block]
        candidate_text = _compose_list_segment_text(
            prefix_text=prefix_text if not groups else "",
            blocks=candidate_group,
        )
        should_split = current_group and (
            chunk_profile.count_tokens(candidate_text) > display_budget.max_tokens
            or len(current_group) >= 2
        )
        if should_split:
            groups.append(current_group)
            current_group = [block]
            continue
        current_group.append(block)
    if current_group:
        groups.append(current_group)

    return tuple(
        _build_answer_ready_segment(
            text=_compose_list_segment_text(
                prefix_text=prefix_text if index == 0 else "",
                blocks=group,
            ),
            label=_label_range([block.label for block in group]),
            prefix_text=prefix_text,
            role_hint=role_hint,
            boundary_rule="regulation_answer_ready_role_block",
        )
        for index, group in enumerate(groups)
    )


def _build_answer_ready_segment(
    *,
    text: str,
    label: str,
    prefix_text: str,
    role_hint: str | None,
    boundary_rule: str,
) -> _RegulationSegment:
    label_metadata = _label_overrides(label)
    role_metadata = _answer_role_metadata(
        text=text,
        prefix_text=prefix_text,
        role_hint=role_hint,
    )
    metadata = {**label_metadata, **role_metadata}
    return _RegulationSegment(
        text=text,
        anchor=label_metadata,
        metadata=metadata,
        split_reason="structure_boundary",
        boundary_rule=boundary_rule,
    )


def _answer_role_metadata(
    *,
    text: str,
    prefix_text: str,
    role_hint: str | None,
) -> dict[str, object]:
    return build_answer_role_metadata(text=text, prefix_text=prefix_text, role_hint=role_hint)


def _answer_role(
    *,
    text: str,
    prefix_text: str,
    role_hint: str | None,
) -> str:
    return str(
        decide_answer_role(text=text, prefix_text=prefix_text, role_hint=role_hint)["answer_role"]
    )


def _starts_example_list(text: str) -> bool:
    return starts_example_list(text)


def _is_numeric_list_label(label: str) -> bool:
    return bool(re.match(r"^\s*(?:\d+[.．、]|[（(]\d+[)）])\s*$", label or ""))


def _intro_role_hint(text: str) -> str | None:
    answer_role = _answer_role(text=text, prefix_text="", role_hint=None)
    if answer_role in {"procedure_step", "exclusion_rule", "exception_rule"}:
        return answer_role
    return "intro"


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

    first_item_line_index = _first_item_line_index(lines, item_blocks[0].label)
    prefix_lines = lines[:first_item_line_index]
    prefix_text = "\n".join(prefix_lines).strip()
    display_budget = resolve_display_budget(
        unit=StructuredUnitChunkInput(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=text,
            anchor=unit.anchor,
            metadata=unit.metadata,
        ),
        chunk_profile=chunk_profile,
    )
    max_items_per_piece = 2 if prefix_text else 3
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
            candidate_tokens > display_budget.max_tokens
            or (
                len(current_group) >= max_items_per_piece
                and current_tokens >= display_budget.min_tokens
            )
        )
        if should_split:
            groups.append(current_group)
            current_group = [block]
            continue
        current_group.append(block)

    if current_group:
        groups.append(current_group)

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


def _segments_to_pieces(
    *,
    unit: StructuredUnit,
    segments: Sequence[_RegulationSegment],
    chunk_profile: ChunkProfile,
) -> tuple[SemanticChunkPiece, ...]:
    expanded_segments: list[_RegulationSegment] = []
    fallback_profile = _without_overlap(chunk_profile)
    for segment in segments:
        segment_unit = StructuredUnitChunkInput(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=segment.text,
            anchor={**dict(unit.anchor), **segment.anchor},
            metadata={**dict(unit.metadata), **segment.metadata},
        )
        display_budget = (
            resolve_context_budget(unit=segment_unit, chunk_profile=chunk_profile)
            if _requires_context_aware_segment_budget(unit=unit)
            else chunk_profile.resolve_display_budget()
        )
        if chunk_profile.count_tokens(segment.text) <= display_budget.max_tokens:
            expanded_segments.append(segment)
            continue
        fallback_pieces = chunk_structured_unit(
            unit=segment_unit,
            chunk_profile=fallback_profile,
        )
        expanded_segments.extend(
            _RegulationSegment(
                text=piece.text,
                anchor=segment.anchor,
                metadata=segment.metadata,
                split_reason=piece.split_reason or segment.split_reason,
                boundary_rule=piece.boundary_rule or segment.boundary_rule,
            )
            for piece in fallback_pieces
        )

    total = len(expanded_segments)
    return tuple(
        SemanticChunkPiece(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=segment.text,
            segment_index=index,
            segment_total=total,
            split_reason=segment.split_reason,
            boundary_rule=segment.boundary_rule,
            anchor=segment.anchor,
            metadata=segment.metadata,
        )
        for index, segment in enumerate(expanded_segments, start=1)
    )


def _requires_context_aware_segment_budget(*, unit: StructuredUnit) -> bool:
    return (
        str(unit.metadata.get("source_channel") or "").strip() == "official_web"
        and str(unit.metadata.get("page_family") or "").strip() in {"article_detail"}
        and str(unit.metadata.get("promotion_class") or "").strip() == "formal_regulation"
    )


def _extract_list_blocks(lines: Sequence[str]) -> tuple[_RegulationListBlock, ...]:
    numeric_blocks = _extract_blocks_by_pattern(lines, _NUMERIC_ITEM_RE)
    if len(numeric_blocks) >= 2:
        return numeric_blocks
    generic_blocks = _extract_blocks_by_pattern(lines, _GENERIC_ITEM_RE)
    return generic_blocks if len(generic_blocks) >= 2 else ()


def _extract_blocks_by_pattern(
    lines: Sequence[str],
    pattern: re.Pattern[str],
) -> tuple[_RegulationListBlock, ...]:
    blocks: list[_RegulationListBlock] = []
    current_label: str | None = None
    current_lines: list[str] = []
    for line in lines:
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


def _first_item_line_index(lines: Sequence[str], first_label: str) -> int:
    for index, line in enumerate(lines):
        if line.strip().startswith(first_label):
            return index
    return 0


def _compose_list_segment_text(
    *,
    prefix_text: str,
    blocks: Sequence[_RegulationListBlock],
) -> str:
    parts = [prefix_text.strip()] if prefix_text.strip() else []
    parts.extend(block.text.strip() for block in blocks if block.text.strip())
    return "\n".join(parts).strip()


def _label_range(labels: Sequence[str]) -> str:
    distinct_labels: list[str] = []
    for label in labels:
        normalized = label.strip()
        if normalized and (not distinct_labels or distinct_labels[-1] != normalized):
            distinct_labels.append(normalized)
    if not distinct_labels:
        return ""
    if len(distinct_labels) == 1:
        return distinct_labels[0]
    return f"{distinct_labels[0]}-{distinct_labels[-1]}"


def _label_overrides(label: str) -> dict[str, object]:
    return {"provision_label": label} if label else {}


def _contextualize_short_subject_value(
    *,
    text: str,
    section_path: tuple[str, ...],
) -> str | None:
    normalized = text.strip()
    if (
        not normalized
        or "\n" in normalized
        or len(normalized) > _SHORT_ATOMIC_VALUE_MAX_CHARS
        or any(mark in normalized for mark in "，。；;：:、")
    ):
        return None
    if not section_path:
        return None
    leaf = _strip_section_label(section_path[-1])
    if leaf == "招生专业":
        return f"招生专业：{normalized}"
    return None


def _strip_section_label(value: str) -> str:
    return _SECTION_LABEL_RE.sub("", value.strip()).strip()


def _section_path(anchor: dict[str, object]) -> tuple[str, ...]:
    value = anchor.get("section_path")
    if not isinstance(value, list):
        return ()
    return tuple(str(item).strip() for item in value if str(item).strip())


def _without_overlap(chunk_profile: ChunkProfile) -> ChunkProfile:
    if chunk_profile.chunk_overlap == 0:
        return chunk_profile
    return replace(chunk_profile, chunk_overlap=0)


def _structured_unit_chunk_input(unit: StructuredUnit) -> StructuredUnitChunkInput:
    return StructuredUnitChunkInput(
        unit_type=unit.unit_type,
        root_unit_id=unit.root_unit_id,
        text=unit.text,
        anchor=unit.anchor,
        metadata=unit.metadata,
    )


__all__ = ["build_regulation_unit_pieces"]
