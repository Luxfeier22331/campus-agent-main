from __future__ import annotations

import re
from collections.abc import Sequence
from types import SimpleNamespace

from campus_ingestion_core.chunking import (
    TEXTUAL_UNIT_TYPES,
    ChunkProfile,
    SemanticChunkPiece,
    assemble_chunk_text,
    build_chunk_text_context,
)
from campus_ingestion_core.process_candidate_aggregation import (
    build_aggregated_anchor,
    build_aggregated_display_text,
    build_aggregated_metadata,
    build_institutional_regulation_aggregated_anchor,
    header_ratio,
    infer_answer_role_from_handbook_semantics,
    normalize_anchor_label,
    normalize_section_path,
    short_textual_group_is_satisfied,
)
from campus_ingestion_core.process_shared import (
    _SHORT_TEXTUAL_DISPLAY_TOKEN_THRESHOLD,
    _SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD,
    _SHORT_TEXTUAL_MAX_MEMBER_COUNT,
    _ChunkCandidate,
)
from campus_ingestion_core.regulation_answer_roles import (
    decide_answer_role as _decide_answer_role,
)
from campus_ingestion_core.regulation_answer_roles import (
    is_answer_role_atomic,
)

_NESTED_NUMBERED_LINE_RE = re.compile(
    r"^(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）])"
)
_SHORT_TEXTUAL_MERGE_UNIT_TYPES = frozenset((*TEXTUAL_UNIT_TYPES, "institutional_regulation_block"))


def decide_answer_role(*, text: str, prefix_text: str = "", role_hint: str | None = None):
    return _decide_answer_role(text=text, prefix_text=prefix_text, role_hint=role_hint)


def merge_adjacent_short_textual_candidates(
    *,
    chunk_candidates: Sequence[_ChunkCandidate],
    chunk_profile: ChunkProfile,
) -> tuple[_ChunkCandidate, ...]:
    merged: list[_ChunkCandidate] = []
    pending: _ChunkCandidate | None = None

    for candidate in chunk_candidates:
        if not is_short_textual_merge_eligible(candidate):
            if pending is not None:
                merged.append(pending)
                pending = None
            merged.append(candidate)
            continue
        if pending is None:
            if is_short_textual_candidate(candidate):
                pending = candidate
                continue
            merged.append(candidate)
            continue
        if not is_short_textual_candidate(candidate):
            merged.append(pending)
            pending = None
            merged.append(candidate)
            continue
        next_candidate = try_merge_short_textual_candidates(
            current=pending,
            incoming=candidate,
            chunk_profile=chunk_profile,
        )
        if next_candidate is None:
            merged.append(pending)
            pending = candidate
            continue
        pending = next_candidate
        if short_textual_group_is_satisfied(pending):
            merged.append(pending)
            pending = None

    if pending is not None:
        merged.append(pending)
    return absorb_short_textual_candidates(
        chunk_candidates=tuple(merged),
        chunk_profile=chunk_profile,
    )


def absorb_short_textual_candidates(
    *,
    chunk_candidates: Sequence[_ChunkCandidate],
    chunk_profile: ChunkProfile,
) -> tuple[_ChunkCandidate, ...]:
    absorbed = list(chunk_candidates)
    changed = True
    while changed:
        changed = False
        index = 0
        while index < len(absorbed):
            candidate = absorbed[index]
            if not is_absorbable_short_textual_candidate(candidate):
                index += 1
                continue
            if index > 0:
                merged_with_previous = try_merge_short_textual_candidates(
                    current=absorbed[index - 1],
                    incoming=candidate,
                    chunk_profile=chunk_profile,
                    enforce_member_limit=False,
                )
                if merged_with_previous is not None:
                    absorbed[index - 1] = merged_with_previous
                    del absorbed[index]
                    changed = True
                    index = max(index - 1, 0)
                    continue
            if index + 1 < len(absorbed):
                merged_with_next = try_merge_short_textual_candidates(
                    current=candidate,
                    incoming=absorbed[index + 1],
                    chunk_profile=chunk_profile,
                    enforce_member_limit=False,
                )
                if merged_with_next is not None:
                    absorbed[index] = merged_with_next
                    del absorbed[index + 1]
                    changed = True
                    continue
            index += 1
    return tuple(absorbed)


def try_merge_short_textual_candidates(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    chunk_profile: ChunkProfile,
    enforce_member_limit: bool = True,
) -> _ChunkCandidate | None:
    if not short_textual_candidates_are_compatible(current, incoming):
        return None
    if enforce_member_limit and len(current.members) >= _SHORT_TEXTUAL_MAX_MEMBER_COUNT:
        return None

    members = (*current.members, *incoming.members)
    aggregated_anchor = (
        build_institutional_regulation_aggregated_anchor(
            current=current,
            incoming=incoming,
            members=members,
        )
        if current.unit_type == "institutional_regulation_block"
        else build_aggregated_anchor(members)
    )
    aggregated_metadata = build_aggregated_metadata(current=current, members=members)
    aggregated_display_text = build_aggregated_display_text(members)
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


def short_textual_candidates_are_compatible(
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    if current.unit_type != incoming.unit_type:
        return False
    if current.visibility_level != incoming.visibility_level:
        return False
    if current.unit_type == "policy_page" and policy_page_label_shape_conflicts(
        current=current, incoming=incoming
    ):
        return False
    if current.unit_type == "institutional_regulation_block":
        if not institutional_regulation_block_section_paths_are_compatible(
            current=current,
            incoming=incoming,
        ):
            return False
    elif not short_textual_section_paths_are_compatible(current=current, incoming=incoming):
        return False
    if answer_ready_atomic_roles_conflict(current=current, incoming=incoming):
        return False
    for field_name in ("title", "policy_doc_no"):
        if current.metadata.get(field_name) != incoming.metadata.get(field_name):
            return False
    return True


def answer_ready_atomic_roles_conflict(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    current_role = candidate_answer_role(current)
    incoming_role = candidate_answer_role(incoming)
    return is_answer_role_atomic(current_role) or is_answer_role_atomic(incoming_role)


def candidate_answer_role(candidate: _ChunkCandidate) -> str:
    for value in (
        candidate.metadata.get("answer_role"),
        candidate.piece.metadata.get("answer_role"),
    ):
        role = str(value or "").strip()
        if role:
            return role
    if _candidate_has_semantic_contract(candidate):
        inferred_semantics = SimpleNamespace(
            content_role=str(candidate.metadata.get("content_role") or "").strip(),
            semantic_role=str(candidate.metadata.get("semantic_role") or "").strip(),
            claim_type=str(candidate.metadata.get("claim_type") or "").strip(),
            polarity=str(candidate.metadata.get("polarity") or "").strip(),
        )
        inferred_role = infer_answer_role_from_handbook_semantics(inferred_semantics)
        if inferred_role in {
            "procedure_step",
            "time_constraint",
            "material_requirement",
            "definition",
            "table_fact",
        }:
            return inferred_role
    parsed_role = str(
        decide_answer_role(
            text=candidate.piece.text,
            prefix_text=" ".join(
                part for part in normalize_section_path(candidate.anchor) if part
            ),
        ).get("answer_role")
        or ""
    ).strip()
    if is_answer_role_atomic(parsed_role):
        return parsed_role
    return ""


def _candidate_has_semantic_contract(candidate: _ChunkCandidate) -> bool:
    return any(
        str(candidate.metadata.get(field_name) or "").strip()
        for field_name in ("content_role", "semantic_role", "claim_type")
    )


def policy_page_label_shape_conflicts(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    current_has_label = candidate_has_explicit_member_label(current)
    incoming_has_label = candidate_has_explicit_member_label(incoming)
    if current_has_label == incoming_has_label:
        return False
    unlabeled = current if not current_has_label else incoming
    labeled = incoming if unlabeled is current else current
    if normalize_anchor_label(labeled.anchor, "provision_label") is None:
        return False
    return candidate_contains_nested_numbered_items(unlabeled)


def candidate_contains_nested_numbered_items(candidate: _ChunkCandidate) -> bool:
    match_count = 0
    for member in candidate.members:
        for line in member.piece.text.splitlines():
            if _NESTED_NUMBERED_LINE_RE.match(line.strip()):
                match_count += 1
                if match_count >= 2:
                    return True
    return False


def short_textual_section_paths_are_compatible(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    current_path = normalize_section_path(current.anchor)
    incoming_path = normalize_section_path(incoming.anchor)
    if current_path == incoming_path:
        return True
    if (
        current.unit_type == "policy_page"
        and not candidate_has_explicit_member_label(current)
        and not candidate_has_explicit_member_label(incoming)
    ):
        return policy_page_section_paths_are_compatible(
            current_path=current_path, incoming_path=incoming_path
        )
    return False


def candidate_has_explicit_member_label(candidate: _ChunkCandidate) -> bool:
    return (
        normalize_anchor_label(candidate.anchor, "article_label") is not None
        or normalize_anchor_label(candidate.anchor, "provision_label") is not None
    )


def policy_page_section_paths_are_compatible(
    *,
    current_path: tuple[str, ...],
    incoming_path: tuple[str, ...],
) -> bool:
    if not current_path or not incoming_path:
        return False
    if len(current_path) >= 2 and incoming_path[: len(current_path)] == current_path:
        return True
    if len(incoming_path) >= 2 and current_path[: len(incoming_path)] == incoming_path:
        return True
    current_parent = current_path[:-1]
    incoming_parent = incoming_path[:-1]
    if len(current_parent) < 2 or len(incoming_parent) < 2:
        return False
    return current_parent == incoming_parent


def institutional_regulation_block_section_paths_are_compatible(
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
    if incoming_path[: len(current_path)] == current_path:
        return True
    return current_path[: len(incoming_path)] == incoming_path


def is_short_textual_merge_eligible(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type not in _SHORT_TEXTUAL_MERGE_UNIT_TYPES:
        return False
    if candidate.piece.split_reason is not None:
        return False
    return candidate.piece.segment_total == 1


def is_short_textual_candidate(candidate: _ChunkCandidate) -> bool:
    if candidate.chunk_assembly.display_token_count < _SHORT_TEXTUAL_DISPLAY_TOKEN_THRESHOLD:
        return True
    return header_ratio(candidate.chunk_assembly) >= _SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD


def is_absorbable_short_textual_candidate(candidate: _ChunkCandidate) -> bool:
    if not is_short_textual_merge_eligible(candidate):
        return False
    return is_short_textual_candidate(candidate)


__all__ = [
    "_NESTED_NUMBERED_LINE_RE",
    "absorb_short_textual_candidates",
    "answer_ready_atomic_roles_conflict",
    "candidate_answer_role",
    "candidate_contains_nested_numbered_items",
    "candidate_has_explicit_member_label",
    "institutional_regulation_block_section_paths_are_compatible",
    "is_absorbable_short_textual_candidate",
    "is_short_textual_candidate",
    "is_short_textual_merge_eligible",
    "merge_adjacent_short_textual_candidates",
    "policy_page_label_shape_conflicts",
    "policy_page_section_paths_are_compatible",
    "short_textual_candidates_are_compatible",
    "short_textual_section_paths_are_compatible",
    "try_merge_short_textual_candidates",
]
