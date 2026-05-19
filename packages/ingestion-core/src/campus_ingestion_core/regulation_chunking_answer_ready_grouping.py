from __future__ import annotations

from collections.abc import Sequence

from campus_ingestion_core.chunking import ChunkProfile, resolve_display_budget
from campus_ingestion_core.process_shared import StructuredUnit
from campus_ingestion_core.regulation_answer_roles import (
    is_answer_role_atomic,
    starts_procedure_list,
)

from .regulation_chunking_answer_ready_contracts import (
    _action_type_for_segment,
    _atomic_group_contract_metadata,
    _group_contract_metadata,
    _group_subject_for_role_block,
    _intro_contract_metadata,
    _intro_group_anchor,
    _resolve_or_reuse_group_anchor,
    _scope_child_role_hint,
)
from .regulation_chunking_answer_ready_support import (
    _answer_role,
    _atomic_item_should_reparse,
    _forced_role_metadata,
    _inherited_scope_role,
    _inline_example_head_role,
    _intro_role_hint,
    _is_numeric_list_label,
    _is_terminal_supporting_detail,
    _single_item_context_prefix,
    _starts_example_list,
)
from .regulation_chunking_list_helpers import (
    _contiguous_intro_item_blocks,
    _extract_answer_ready_item_blocks,
    _looks_like_group_intro,
    _should_emit_prefix_as_intro,
)
from .regulation_chunking_mixed_procedure import _mixed_procedure_split_pair
from .regulation_chunking_segment_builder import _build_answer_ready_segment
from .regulation_chunking_shared import (
    _INLINE_EXAMPLE_MEMBER_RE,
    _INLINE_EXAMPLE_TAIL_RE,
    _AnswerReadyGroupingState,
    _compose_list_segment_text,
    _first_item_line_index,
    _label_range,
    _RegulationGroupAnchor,
    _RegulationListBlock,
    _RegulationSegment,
    _section_path,
    _structured_unit_chunk_input,
)


def _build_answer_ready_regulation_segments(
    *,
    unit: StructuredUnit,
    text: str,
    chunk_profile: ChunkProfile,
) -> tuple[_RegulationSegment, ...]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    item_blocks = _extract_answer_ready_item_blocks(lines)
    if not item_blocks:
        return ()

    first_item_line_index = _first_item_line_index(
        lines,
        item_blocks[0].label,
        item_blocks[0].text,
    )
    prefix_text = "\n".join(lines[:first_item_line_index]).strip()
    display_budget = resolve_display_budget(
        unit=_structured_unit_chunk_input(unit),
        chunk_profile=chunk_profile,
    )
    document_title = str(unit.metadata.get("title") or "").strip()
    section_path = _section_path(unit.anchor)
    segments: list[_RegulationSegment] = []
    repeated_group_intro_count = sum(
        1 for block in item_blocks if _looks_like_group_intro(block.text)
    )
    initial_prefix_is_intro = _should_emit_prefix_as_intro(prefix_text)
    if prefix_text:
        if initial_prefix_is_intro:
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
        else:
            segments.append(
                _build_answer_ready_segment(
                    text=prefix_text,
                    label="",
                    prefix_text="",
                    role_hint="supporting_detail",
                    boundary_rule="regulation_answer_ready_prefix_detail",
                )
            )

    state = _AnswerReadyGroupingState(
        current_group=[],
        current_role=None,
        example_list_context=False,
        pending_prefix_text=prefix_text if initial_prefix_is_intro else "",
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
                            role=block_role, text=block.text, prefix_text=block_prefix_text
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
        extra_metadata["condition_group_subject_provenance"] = "chunker:answer_ready_group_anchor"
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


def _single_clause_mixed_procedure_segments(
    *,
    block: _RegulationListBlock,
    prefix_text: str,
    state: _AnswerReadyGroupingState,
    section_path: tuple[str, ...] = (),
    document_title: str = "",
) -> tuple[_RegulationSegment, ...]:
    split_pair = _mixed_procedure_split_pair(
        text=block.text,
        prefix_text=prefix_text,
    )
    if split_pair is None:
        return ()
    head_text, tail_text = split_pair
    overall_role = _answer_role(text=block.text, prefix_text=prefix_text, role_hint=None)
    head_role = _answer_role(text=head_text, prefix_text=prefix_text, role_hint=None)
    if head_role == "procedure_step":
        return ()
    if overall_role == "procedure_step":
        head_subject = _group_subject_for_role_block(
            role=head_role or "eligibility_condition",
            text=head_text,
            context_text=prefix_text,
            section_path=section_path,
            document_title=document_title,
        )
        if head_subject in {"", "application_procedure"}:
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
        extra_metadata["condition_group_subject_provenance"] = "chunker:answer_ready_group_anchor"
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
            extra_metadata={
                **extra_metadata,
                **_forced_role_metadata(
                    answer_role="procedure_step",
                    reason="structural_mixed_procedure_tail",
                ),
            },
            boundary_rule="regulation_answer_ready_mixed_procedure_tail",
        ),
    )
