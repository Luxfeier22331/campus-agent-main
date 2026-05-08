from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, replace

from campus_shared.regulation_semantic_registry import (
    build_regulation_condition_group_id,
    resolve_regulation_action_type,
    resolve_regulation_group_intro_kind,
    resolve_regulation_group_subject,
    resolve_regulation_intro_list_role_hint,
)

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
    compact_for_role,
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
_INLINE_EXAMPLE_TAIL_RE = re.compile(
    r"[，,]?(?P<tail>且在[^。；;\n]{0,80}取得显著成绩[^。；;\n]*)[。；;]?$"
)
_INLINE_EXAMPLE_MEMBER_RE = re.compile(r"(?:且)?在[^,，。；;\n]{0,60}?取得显著成绩")
_PROCEDURE_TAIL_SPLIT_RE = re.compile(
    r"(?P<head>.+?[；;。])(?P<tail>(?:[^。；;\n]{0,80}?(?:提出[^。；;\n]{0,20}?申请|审定密级|签署意见|核准后接入校园网)[^。；;\n]*[。；;]?)+)$"
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


@dataclass(frozen=True, slots=True)
class _RegulationGroupAnchor:
    group_subject: str
    group_key: str
    group_index: int | None = None


@dataclass(slots=True)
class _AnswerReadyGroupingState:
    current_group: list[_RegulationListBlock]
    current_role: str | None
    example_list_context: bool
    pending_prefix_text: str
    pending_prefix_emitted: bool
    current_group_anchor: _RegulationGroupAnchor | None
    next_group_index: int
    force_condition_group_keys: bool


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
    if not item_blocks:
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
    document_title = str(unit.metadata.get("title") or "").strip()
    section_path = _section_path(unit.anchor)
    segments: list[_RegulationSegment] = []
    repeated_group_intro_count = sum(
        1 for block in item_blocks if _looks_like_group_intro(block.text)
    )
    if prefix_text:
        intro_role_hint = _intro_role_hint(prefix_text)
        prefix_anchor_state = _AnswerReadyGroupingState(
            current_group=[],
            current_role=None,
            example_list_context=False,
            pending_prefix_text=prefix_text,
            pending_prefix_emitted=True,
            current_group_anchor=None,
            next_group_index=1,
            force_condition_group_keys=repeated_group_intro_count > 1,
        )
        intro_anchor = _intro_group_anchor(
            prefix_text=prefix_text,
            item_blocks=_contiguous_intro_item_blocks(item_blocks, start_index=0),
            state=prefix_anchor_state,
            section_path=section_path,
            document_title=document_title,
        )
        segments.append(
            _build_answer_ready_segment(
                text=prefix_text,
                label="",
                prefix_text="",
                role_hint=intro_role_hint,
                extra_metadata=_intro_contract_metadata(
                    prefix_text=prefix_text,
                    item_blocks=_contiguous_intro_item_blocks(item_blocks, start_index=0),
                    group_anchor=intro_anchor,
                    section_path=section_path,
                    document_title=document_title,
                ),
                boundary_rule="regulation_answer_ready_intro",
            )
        )

    state = _AnswerReadyGroupingState(
        current_group=[],
        current_role=None,
        example_list_context=False,
        pending_prefix_text=prefix_text,
        pending_prefix_emitted=bool(prefix_text),
        current_group_anchor=None,
        next_group_index=1,
        force_condition_group_keys=repeated_group_intro_count > 1,
    )
    for block_index, block in enumerate(item_blocks):
        if _looks_like_group_intro(block.text):
            segments.extend(
                _flush_answer_ready_group(
                    state=state,
                    display_budget=display_budget,
                    chunk_profile=chunk_profile,
                    section_path=section_path,
                    document_title=document_title,
                )
            )
            state.example_list_context = False
            state.pending_prefix_text = block.text
            state.pending_prefix_emitted = False
            state.current_group_anchor = None
            continue
        if starts_procedure_list(block.text):
            segments.extend(
                _flush_answer_ready_group(
                    state=state,
                    display_budget=display_budget,
                    chunk_profile=chunk_profile,
                    section_path=section_path,
                    document_title=document_title,
                )
            )
            state.example_list_context = False
            state.pending_prefix_text = block.text
            state.pending_prefix_emitted = False
            state.current_group_anchor = None
            continue
        if state.pending_prefix_text and not state.pending_prefix_emitted:
            intro_anchor = _intro_group_anchor(
                prefix_text=state.pending_prefix_text,
                item_blocks=_contiguous_intro_item_blocks(
                    item_blocks,
                    start_index=block_index,
                ),
                state=state,
                section_path=section_path,
                document_title=document_title,
            )
            segments.append(
                _build_answer_ready_segment(
                    text=state.pending_prefix_text,
                    label="",
                    prefix_text="",
                    role_hint=_intro_role_hint(state.pending_prefix_text),
                    extra_metadata=_intro_contract_metadata(
                        prefix_text=state.pending_prefix_text,
                        item_blocks=_contiguous_intro_item_blocks(
                            item_blocks,
                            start_index=block_index,
                        ),
                        group_anchor=intro_anchor,
                        section_path=section_path,
                        document_title=document_title,
                    ),
                    boundary_rule="regulation_answer_ready_intro",
                )
            )
            state.current_group_anchor = intro_anchor
            state.pending_prefix_emitted = True
        role_hint = (
            "example_evidence"
            if state.example_list_context and _is_numeric_list_label(block.label)
            else _scope_child_role_hint(state.pending_prefix_text)
        )
        block_prefix_text = state.pending_prefix_text or _single_item_context_prefix(
            block=block,
            section_path=_section_path(unit.anchor),
        )
        inline_example_segments = _inline_example_tail_segments(
            block=block,
            prefix_text=block_prefix_text,
            role_hint=_inline_example_head_role(
                text=block.text,
                prefix_text=block_prefix_text,
            ),
            state=state,
            section_path=section_path,
            document_title=document_title,
        )
        if inline_example_segments:
            segments.extend(
                _flush_answer_ready_group(
                    state=state,
                    display_budget=display_budget,
                    chunk_profile=chunk_profile,
                    section_path=section_path,
                    document_title=document_title,
                )
            )
            segments.extend(inline_example_segments)
            continue
        mixed_procedure_segments = _single_clause_mixed_procedure_segments(
            block=block,
            prefix_text=block_prefix_text,
            state=state,
            section_path=section_path,
            document_title=document_title,
        )
        if mixed_procedure_segments:
            segments.extend(
                _flush_answer_ready_group(
                    state=state,
                    display_budget=display_budget,
                    chunk_profile=chunk_profile,
                    section_path=section_path,
                    document_title=document_title,
                )
            )
            segments.extend(mixed_procedure_segments)
            continue
        block_role = _answer_role(
            text=block.text,
            prefix_text=block_prefix_text,
            role_hint=role_hint,
        )
        if (
            block_role == "supporting_detail"
            and role_hint is None
            and block.label.strip()
            and not _is_terminal_supporting_detail(text=block.text)
        ):
            inherited_role = _inherited_scope_role(prefix_text=block_prefix_text)
            if inherited_role is not None:
                block_role = inherited_role
        if is_answer_role_atomic(block_role):
            segments.extend(
                _flush_answer_ready_group(
                    state=state,
                    display_budget=display_budget,
                    chunk_profile=chunk_profile,
                    section_path=section_path,
                    document_title=document_title,
                )
            )
            segments.append(
                _build_answer_ready_segment(
                    text=block.text,
                    label=block.label,
                    prefix_text=block_prefix_text,
                    role_hint=(
                        None
                        if _atomic_item_should_reparse(
                            role=block_role, prefix_text=block_prefix_text
                        )
                        else block_role
                    ),
                    extra_metadata=_atomic_group_contract_metadata(
                        state=state,
                        role=block_role,
                        text=block.text,
                        prefix_text=block_prefix_text,
                        section_path=section_path,
                        document_title=document_title,
                    ),
                    boundary_rule="regulation_answer_ready_atomic_item",
                )
            )
            if _starts_example_list(block.text):
                state.example_list_context = True
                state.current_group_anchor = _resolve_or_reuse_group_anchor(
                    state=state,
                    role=block_role,
                    text=block.text,
                    prefix_text=block_prefix_text,
                    section_path=section_path,
                    document_title=document_title,
                )
            continue
        if state.current_role is None:
            state.current_role = block_role
        if state.current_group and block_role != state.current_role:
            segments.extend(
                _flush_answer_ready_group(
                    state=state,
                    display_budget=display_budget,
                    chunk_profile=chunk_profile,
                    section_path=section_path,
                    document_title=document_title,
                )
            )
            state.current_role = block_role
            state.pending_prefix_text = ""
        state.current_group.append(block)
        if _starts_example_list(block.text):
            state.example_list_context = True
            state.current_group_anchor = _resolve_or_reuse_group_anchor(
                state=state,
                role=block_role,
                text=block.text,
                prefix_text=block_prefix_text,
                section_path=section_path,
                document_title=document_title,
            )

    segments.extend(
        _flush_answer_ready_group(
            state=state,
            display_budget=display_budget,
            chunk_profile=chunk_profile,
            section_path=section_path,
            document_title=document_title,
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
    section_path: tuple[str, ...],
    document_title: str,
) -> tuple[_RegulationSegment, ...]:
    if not state.current_group:
        return ()
    group_anchor = _resolve_or_reuse_group_anchor(
        state=state,
        role=state.current_role,
        text=_compose_list_segment_text(
            prefix_text=state.pending_prefix_text,
            blocks=tuple(state.current_group),
        ),
        prefix_text=state.pending_prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    segments = _grouped_answer_ready_segments(
        blocks=tuple(state.current_group),
        prefix_text=state.pending_prefix_text,
        display_budget=display_budget,
        chunk_profile=chunk_profile,
        role_hint=state.current_role,
        group_anchor=group_anchor,
        section_path=section_path,
        document_title=document_title,
    )
    state.current_group = []
    state.current_role = None
    state.current_group_anchor = None
    return segments


def _grouped_answer_ready_segments(
    *,
    blocks: Sequence[_RegulationListBlock],
    prefix_text: str,
    display_budget,
    chunk_profile: ChunkProfile,
    role_hint: str | None,
    group_anchor: _RegulationGroupAnchor | None,
    section_path: tuple[str, ...] = (),
    document_title: str = "",
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
            extra_metadata=_group_contract_metadata(
                group=group,
                role_hint=role_hint,
                prefix_text=prefix_text,
                group_anchor=group_anchor,
                section_path=section_path,
                document_title=document_title,
            ),
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
    extra_metadata: dict[str, object] | None = None,
    boundary_rule: str,
) -> _RegulationSegment:
    label_metadata = _label_overrides(label)
    role_metadata = _answer_role_metadata(
        text=text,
        prefix_text=prefix_text,
        role_hint=role_hint,
    )
    metadata = {**label_metadata, **role_metadata, **dict(extra_metadata or {})}
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


def _inline_example_tail_segments(
    *,
    block: _RegulationListBlock,
    prefix_text: str,
    role_hint: str | None,
    state: _AnswerReadyGroupingState,
    section_path: tuple[str, ...] = (),
    document_title: str = "",
) -> tuple[_RegulationSegment, ...]:
    if role_hint not in {"eligibility_condition", "exception_rule"}:
        return ()
    match = _INLINE_EXAMPLE_TAIL_RE.search(block.text)
    if match is None:
        return ()

    tail_text = match.group("tail").strip()
    head_text = block.text[: match.start("tail")].rstrip("，,；;、 ")
    if not head_text or not tail_text:
        return ()
    if _answer_role(text=tail_text, prefix_text=prefix_text, role_hint=None) != "example_evidence":
        return ()
    tail_members = tuple(
        item.strip().rstrip("，,；;、 ")
        for item in _INLINE_EXAMPLE_MEMBER_RE.findall(tail_text)
        if item.strip().rstrip("，,；;、 ")
    )
    if not tail_members:
        tail_members = (tail_text,)

    group_anchor = _resolve_or_reuse_group_anchor(
        state=state,
        role=role_hint,
        text=head_text,
        prefix_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    action_type = _action_type_for_segment(
        text=head_text,
        context_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    extra_metadata: dict[str, object] = {}
    if action_type:
        extra_metadata["action_type"] = action_type
    if group_anchor is not None:
        extra_metadata["condition_group_subject"] = group_anchor.group_subject
        extra_metadata["condition_group_key"] = group_anchor.group_key
    return (
        _build_answer_ready_segment(
            text=head_text,
            label=block.label,
            prefix_text=prefix_text,
            role_hint=role_hint,
            extra_metadata=extra_metadata,
            boundary_rule="regulation_answer_ready_inline_head",
        ),
        *tuple(
            _build_answer_ready_segment(
                text=member_text,
                label=block.label,
                prefix_text=prefix_text,
                role_hint="example_evidence",
                extra_metadata=extra_metadata,
                boundary_rule="regulation_answer_ready_inline_example_tail",
            )
            for member_text in tail_members
        ),
    )


def _inline_example_head_role(*, text: str, prefix_text: str) -> str | None:
    match = _INLINE_EXAMPLE_TAIL_RE.search(text)
    if match is None:
        return None
    head_text = text[: match.start("tail")].rstrip("，,；;、 ")
    if not head_text:
        return None
    head_role = _answer_role(text=head_text, prefix_text=prefix_text, role_hint=None)
    if head_role in {"eligibility_condition", "exception_rule"}:
        return head_role
    return None


def _single_clause_mixed_procedure_segments(
    *,
    block: _RegulationListBlock,
    prefix_text: str,
    state: _AnswerReadyGroupingState,
    section_path: tuple[str, ...] = (),
    document_title: str = "",
) -> tuple[_RegulationSegment, ...]:
    match = _PROCEDURE_TAIL_SPLIT_RE.search(block.text)
    if match is None:
        return ()
    head_text = match.group("head").strip().rstrip("；;")
    tail_text = match.group("tail").strip()
    if not head_text or not tail_text:
        return ()
    head_role = _answer_role(text=head_text, prefix_text=prefix_text, role_hint=None)
    if head_role == "procedure_step":
        return ()
    if _answer_role(text=tail_text, prefix_text=prefix_text, role_hint=None) != "procedure_step":
        return ()
    group_anchor = _resolve_or_reuse_group_anchor(
        state=state,
        role=head_role or "eligibility_condition",
        text=head_text,
        prefix_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    action_type = _action_type_for_segment(
        text=block.text,
        context_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    extra_metadata: dict[str, object] = {}
    if group_anchor is not None:
        extra_metadata["condition_group_subject"] = group_anchor.group_subject
        extra_metadata["condition_group_key"] = group_anchor.group_key
    if action_type:
        extra_metadata["action_type"] = action_type
    return (
        _build_answer_ready_segment(
            text=head_text,
            label=block.label,
            prefix_text=prefix_text,
            role_hint="eligibility_condition",
            extra_metadata=extra_metadata,
            boundary_rule="regulation_answer_ready_mixed_condition_head",
        ),
        _build_answer_ready_segment(
            text=tail_text,
            label=block.label,
            prefix_text=prefix_text,
            role_hint="procedure_step",
            extra_metadata=extra_metadata,
            boundary_rule="regulation_answer_ready_mixed_procedure_tail",
        ),
    )


def _answer_role(
    *,
    text: str,
    prefix_text: str,
    role_hint: str | None,
) -> str:
    return str(
        decide_answer_role(text=text, prefix_text=prefix_text, role_hint=role_hint)["answer_role"]
    )


def _inherited_scope_role(*, prefix_text: str) -> str | None:
    if not prefix_text.strip():
        return None
    scope_role = _answer_role(text=prefix_text, prefix_text="", role_hint=None)
    if scope_role in {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "procedure_step",
        "material_requirement",
        "time_constraint",
    }:
        return scope_role
    return None


def _is_terminal_supporting_detail(*, text: str) -> bool:
    compact = compact_for_role(text)
    return any(
        marker in compact
        for marker in (
            "负责解释",
            "负责施行",
            "自发布之日起实施",
            "自发布之日起施行",
            "自印发之日起实施",
            "自印发之日起施行",
            "自公布之日起实施",
            "自公布之日起施行",
            "同时废止",
        )
    )


def _starts_example_list(text: str) -> bool:
    return starts_example_list(text)


def _is_numeric_list_label(label: str) -> bool:
    return bool(re.match(r"^\s*(?:\d+[.．、]|[（(]\d+[)）])\s*$", label or ""))


def _single_item_context_prefix(
    *,
    block: _RegulationListBlock,
    section_path: tuple[str, ...],
) -> str:
    if not block.label.strip():
        return ""
    if not section_path:
        return ""
    for raw_part in reversed(section_path):
        part = _strip_section_label(raw_part)
        if any(marker in part for marker in ("程序", "流程", "步骤", "办理")):
            return part
    return ""


def _atomic_item_should_reparse(*, role: str, prefix_text: str) -> bool:
    del prefix_text
    return False


def _intro_role_hint(text: str) -> str | None:
    answer_role = _answer_role(text=text, prefix_text="", role_hint=None)
    if answer_role in {
        "procedure_step",
        "exclusion_rule",
        "exception_rule",
        "material_requirement",
        "time_constraint",
    }:
        return answer_role
    return "intro"


def _group_contract_metadata(
    *,
    group: Sequence[_RegulationListBlock],
    role_hint: str | None,
    prefix_text: str,
    group_anchor: _RegulationGroupAnchor | None,
    section_path: tuple[str, ...],
    document_title: str,
) -> dict[str, object]:
    target_roles = _target_roles_for_item_blocks(
        prefix_text=prefix_text,
        item_blocks=group,
        section_path=section_path,
        document_title=document_title,
    )
    if any(role in target_roles for role in ("exception_rule", "example_evidence")):
        target_roles = tuple(
            role
            for role in target_roles
            if role not in {"eligibility_condition", "supporting_detail"}
        )
    result: dict[str, object] = {}
    if target_roles:
        result["intro_target_roles"] = target_roles
    action_type = _action_type_for_segment(
        text=_compose_list_segment_text(prefix_text=prefix_text, blocks=group),
        context_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    if action_type:
        result["action_type"] = action_type
    if group_anchor is not None:
        result["condition_group_subject"] = group_anchor.group_subject
        result["condition_group_key"] = group_anchor.group_key
    return result


def _intro_contract_metadata(
    *,
    prefix_text: str,
    item_blocks: Sequence[_RegulationListBlock],
    group_anchor: _RegulationGroupAnchor | None,
    section_path: tuple[str, ...],
    document_title: str,
) -> dict[str, object]:
    target_roles = _target_roles_for_item_blocks(
        prefix_text=prefix_text,
        item_blocks=item_blocks,
        section_path=section_path,
        document_title=document_title,
    )
    if any(
        role in target_roles
        for role in (
            "exception_rule",
            "example_evidence",
            "material_requirement",
            "time_constraint",
        )
    ):
        target_roles = tuple(
            role
            for role in target_roles
            if role not in {"eligibility_condition", "supporting_detail"}
        )
    metadata: dict[str, object] = {}
    if target_roles:
        metadata["intro_target_roles"] = target_roles
    action_type = _action_type_for_segment(
        text=prefix_text,
        context_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    if action_type:
        metadata["action_type"] = action_type
    if group_anchor is not None:
        metadata["introduced_condition_subject"] = group_anchor.group_subject
        metadata["condition_group_subject"] = group_anchor.group_subject
        metadata["introduced_condition_group_key"] = group_anchor.group_key
    return metadata


def _atomic_group_contract_metadata(
    *,
    state: _AnswerReadyGroupingState,
    role: str,
    text: str,
    prefix_text: str,
    section_path: tuple[str, ...],
    document_title: str,
) -> dict[str, object]:
    action_type = _action_type_for_segment(
        text=text,
        context_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    group_anchor = _resolve_or_reuse_group_anchor(
        state=state,
        role=role,
        text=text,
        prefix_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    if group_anchor is None:
        return {"action_type": action_type} if action_type else {}
    result = {"condition_group_subject": group_anchor.group_subject}
    if action_type:
        result["action_type"] = action_type
    if group_anchor.group_key:
        result["condition_group_key"] = group_anchor.group_key
    return result


def _resolve_or_reuse_group_anchor(
    *,
    state: _AnswerReadyGroupingState,
    role: str | None,
    text: str,
    prefix_text: str,
    section_path: tuple[str, ...],
    document_title: str,
) -> _RegulationGroupAnchor | None:
    if state.current_group_anchor is not None:
        return state.current_group_anchor
    group_subject = _group_subject_for_role_block(
        role=role,
        text=text,
        context_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    if not group_subject:
        return None
    group_anchor = _new_group_anchor(
        group_subject=group_subject,
        force_condition_group_keys=state.force_condition_group_keys,
        group_index=state.next_group_index if state.force_condition_group_keys else None,
    )
    if state.force_condition_group_keys:
        state.next_group_index += 1
    state.current_group_anchor = group_anchor
    return group_anchor


def _new_group_anchor(
    *,
    group_subject: str,
    force_condition_group_keys: bool,
    group_index: int | None,
) -> _RegulationGroupAnchor:
    if force_condition_group_keys and group_index is not None:
        return _RegulationGroupAnchor(
            group_subject=group_subject,
            group_key=f"group-{group_index:02d}:{group_subject}",
            group_index=group_index,
        )
    return _RegulationGroupAnchor(
        group_subject=group_subject,
        group_key=group_subject,
        group_index=group_index,
    )


def _intro_group_anchor(
    *,
    prefix_text: str,
    item_blocks: Sequence[_RegulationListBlock],
    state: _AnswerReadyGroupingState,
    section_path: tuple[str, ...],
    document_title: str,
) -> _RegulationGroupAnchor | None:
    if state.current_group_anchor is not None:
        return state.current_group_anchor
    if not item_blocks:
        return None
    scoped_role_hint = _scope_child_role_hint(prefix_text)
    first_child_roles = _simulate_split_segments_for_block(
        block=item_blocks[0],
        prefix_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
        scoped_role_hint=scoped_role_hint,
    )
    if first_child_roles:
        first_role, first_text = first_child_roles[0]
    else:
        first_role = _answer_role(
            text=item_blocks[0].text,
            prefix_text=prefix_text,
            role_hint=scoped_role_hint,
        )
        first_text = item_blocks[0].text
    group_subject = _group_subject_for_role_block(
        role=first_role,
        text=first_text,
        context_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    if not group_subject:
        return None
    group_anchor = _new_group_anchor(
        group_subject=group_subject,
        force_condition_group_keys=state.force_condition_group_keys,
        group_index=state.next_group_index if state.force_condition_group_keys else None,
    )
    if state.force_condition_group_keys:
        state.next_group_index += 1
    return group_anchor


def _target_roles_for_item_blocks(
    *,
    prefix_text: str,
    item_blocks: Sequence[_RegulationListBlock],
    section_path: tuple[str, ...],
    document_title: str,
) -> tuple[str, ...]:
    roles: list[str] = []
    scoped_role_hint = _scope_child_role_hint(prefix_text)
    for block in item_blocks:
        roles.extend(
            role
            for role, _ in _simulate_split_segments_for_block(
                block=block,
                prefix_text=prefix_text,
                section_path=section_path,
                document_title=document_title,
                scoped_role_hint=scoped_role_hint,
            )
        )
    return tuple(dict.fromkeys(role for role in roles if role))


def _simulate_split_segments_for_block(
    *,
    block: _RegulationListBlock,
    prefix_text: str,
    section_path: tuple[str, ...],
    document_title: str,
    scoped_role_hint: str | None = None,
) -> tuple[tuple[str, str], ...]:
    del document_title
    block_prefix_text = prefix_text or _single_item_context_prefix(
        block=block,
        section_path=section_path,
    )
    inline_head_role = _inline_example_head_role(text=block.text, prefix_text=block_prefix_text)
    if inline_head_role is not None:
        match = _INLINE_EXAMPLE_TAIL_RE.search(block.text)
        if match is not None:
            head_text = block.text[: match.start("tail")].rstrip("，,；;、 ")
            tail_members = tuple(
                item.strip().rstrip("，,；;、 ")
                for item in _INLINE_EXAMPLE_MEMBER_RE.findall(match.group("tail").strip())
                if item.strip().rstrip("，,；;、 ")
            )
            if head_text and tail_members:
                return (
                    (inline_head_role, head_text),
                    *tuple(("example_evidence", member_text) for member_text in tail_members),
                )
    mixed_match = _PROCEDURE_TAIL_SPLIT_RE.search(block.text)
    if mixed_match is not None:
        head_text = mixed_match.group("head").strip().rstrip("；;")
        tail_text = mixed_match.group("tail").strip()
        head_role = _answer_role(text=head_text, prefix_text=block_prefix_text, role_hint=None)
        tail_role = _answer_role(text=tail_text, prefix_text=block_prefix_text, role_hint=None)
        if (
            head_text
            and tail_text
            and head_role != "procedure_step"
            and tail_role == "procedure_step"
        ):
            return (
                ("eligibility_condition", head_text),
                ("procedure_step", tail_text),
            )
    block_role = _answer_role(
        text=block.text,
        prefix_text=block_prefix_text,
        role_hint=scoped_role_hint,
    )
    if (
        block_role == "supporting_detail"
        and block.label.strip()
        and not _is_terminal_supporting_detail(text=block.text)
    ):
        inherited_role = (
            scoped_role_hint
            if scoped_role_hint is not None
            else _inherited_scope_role(prefix_text=block_prefix_text)
        )
        if inherited_role is not None:
            block_role = inherited_role
    return ((block_role, block.text),)


def _group_subject_for_role_block(
    *,
    role: str | None,
    text: str,
    context_text: str = "",
    section_path: tuple[str, ...] = (),
    document_title: str = "",
) -> str:
    normalized_role = (role or "").strip()
    action_type = _action_type_for_segment(
        text=text,
        context_text=context_text,
        section_path=section_path,
        document_title=document_title,
    )
    assignment = resolve_regulation_group_subject(
        text=text,
        answer_role=normalized_role,
        action_type=action_type,
        section_path=section_path,
        context_text=context_text,
        document_title=document_title,
    )
    return assignment.value


def _action_type_for_segment(
    *,
    text: str,
    context_text: str = "",
    section_path: tuple[str, ...] = (),
    document_title: str = "",
) -> str:
    return resolve_regulation_action_type(
        text=text,
        context_text=context_text,
        section_path=section_path,
        document_title=document_title,
    ).value


def _scope_child_role_hint(prefix_text: str) -> str | None:
    assignment = resolve_regulation_intro_list_role_hint(prefix_text)
    return assignment.value or None


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
            metadata=_finalize_answer_ready_segment_metadata(
                metadata=segment.metadata,
                root_unit_id=unit.root_unit_id,
            ),
        )
        for index, segment in enumerate(expanded_segments, start=1)
    )


def _finalize_answer_ready_segment_metadata(
    *,
    metadata: dict[str, object],
    root_unit_id: str,
) -> dict[str, object]:
    if not root_unit_id:
        return metadata
    finalized = dict(metadata)
    condition_group_key = str(finalized.get("condition_group_key") or "").strip()
    if condition_group_key and not str(finalized.get("condition_group_id") or "").strip():
        finalized["condition_group_id"] = build_regulation_condition_group_id(
            parent_unit_id=root_unit_id,
            group_key=condition_group_key,
        ).value
    introduced_group_key = str(finalized.get("introduced_condition_group_key") or "").strip()
    if (
        introduced_group_key
        and not str(finalized.get("introduced_condition_group_id") or "").strip()
    ):
        finalized["introduced_condition_group_id"] = build_regulation_condition_group_id(
            parent_unit_id=root_unit_id,
            group_key=introduced_group_key,
        ).value
    finalized.pop("condition_group_key", None)
    finalized.pop("introduced_condition_group_key", None)
    return finalized


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
