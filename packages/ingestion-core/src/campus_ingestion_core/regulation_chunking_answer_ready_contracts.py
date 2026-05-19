from __future__ import annotations

from collections.abc import Sequence

from campus_shared.regulation_semantic_registry import (
    resolve_regulation_action_type,
    resolve_regulation_group_intro_kind,
    resolve_regulation_group_subject,
    resolve_regulation_intro_list_role_hint,
    resolve_regulation_intro_subject,
)

from .regulation_chunking_answer_ready_support import (
    _answer_role,
    _inherited_scope_role,
    _inline_example_head_role,
    _is_terminal_supporting_detail,
    _single_item_context_prefix,
)
from .regulation_chunking_mixed_procedure import _mixed_procedure_split_pair
from .regulation_chunking_shared import (
    _ANSWER_READY_INTRO_TARGET_ROLE_WHITELIST,
    _INLINE_EXAMPLE_MEMBER_RE,
    _INLINE_EXAMPLE_TAIL_RE,
    _AnswerReadyGroupingState,
    _compose_list_segment_text,
    _RegulationGroupAnchor,
    _RegulationListBlock,
)


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
    target_roles = _normalize_intro_target_roles(target_roles)
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
        result["condition_group_subject_provenance"] = "chunker:answer_ready_group_anchor"
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
    target_roles = _normalize_intro_target_roles(target_roles)
    metadata: dict[str, object] = {}
    if target_roles:
        metadata["intro_target_roles"] = target_roles
        introduced_subject = resolve_regulation_intro_subject(
            intro_target_roles=target_roles,
            inherited_condition_subject=group_anchor.group_subject
            if group_anchor is not None
            else "",
        ).value
        if introduced_subject:
            metadata["introduced_condition_subject"] = introduced_subject
            metadata["condition_group_subject"] = introduced_subject
            metadata["condition_group_subject_provenance"] = "chunker:answer_ready_group_anchor"
    action_type = _action_type_for_segment(
        text=prefix_text,
        context_text=prefix_text,
        section_path=section_path,
        document_title=document_title,
    )
    if action_type:
        metadata["action_type"] = action_type
    if group_anchor is not None:
        metadata.setdefault("condition_group_subject", group_anchor.group_subject)
        metadata.setdefault(
            "condition_group_subject_provenance",
            "chunker:answer_ready_group_anchor",
        )
        introduced_subject = str(metadata.get("introduced_condition_subject") or "").strip()
        if introduced_subject and introduced_subject != group_anchor.group_subject:
            metadata["introduced_condition_group_key"] = introduced_subject
        else:
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
    result["condition_group_subject_provenance"] = "chunker:answer_ready_group_anchor"
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
    return _normalize_intro_target_roles(tuple(dict.fromkeys(role for role in roles if role)))


def _normalize_intro_target_roles(target_roles: Sequence[str]) -> tuple[str, ...]:
    normalized = tuple(
        role for role in target_roles if role in _ANSWER_READY_INTRO_TARGET_ROLE_WHITELIST
    )
    if any(role in normalized for role in ("exception_rule", "example_evidence")):
        normalized = tuple(role for role in normalized if role != "eligibility_condition")
    return tuple(dict.fromkeys(normalized))


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
    split_pair = _mixed_procedure_split_pair(
        text=block.text,
        prefix_text=block_prefix_text,
    )
    if split_pair is not None:
        head_text, tail_text = split_pair
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
    list_assignment = resolve_regulation_intro_list_role_hint(prefix_text)
    if list_assignment.value:
        return list_assignment.value
    group_intro_assignment = resolve_regulation_group_intro_kind(prefix_text)
    if group_intro_assignment.value == "condition_group_intro":
        return "eligibility_condition"
    if group_intro_assignment.value == "exclusion_group_intro":
        return "exclusion_rule"
    return None
