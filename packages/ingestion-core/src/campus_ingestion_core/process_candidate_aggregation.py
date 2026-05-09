from __future__ import annotations

from collections.abc import Iterable, Sequence

from campus_ingestion_core.curriculum_chunk_units import _normalize_curriculum_structural_path
from campus_ingestion_core.handbook_semantics import derive_handbook_semantic_metadata
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process_shared import (
    _SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD,
    _ChunkCandidate,
    _ChunkMember,
)
from campus_ingestion_core.regulation_answer_roles import (
    build_answer_role_metadata,
    build_table_answer_role_metadata,
    decide_answer_role,
)


def build_collection_semantic_metadata(
    *,
    record: DocumentRegistryRecord,
    unit_type: str,
    anchor: dict[str, object],
    metadata: dict[str, object],
    text: str,
) -> dict[str, object]:
    if record.corpus != "regulations":
        return {}
    semantics = derive_handbook_semantic_metadata(
        unit_type=unit_type,
        anchor=anchor,
        metadata=metadata,
        text=text,
    )
    release_metadata = build_handbook_answer_role_release_metadata(
        semantics=semantics,
        metadata=metadata,
        text=text,
    )
    semantic_metadata = {
        "content_kind": semantics.content_kind,
        "content_role": semantics.content_role,
        "detail_label": semantics.detail_label,
        "is_answer_bearing": semantics.is_answer_bearing,
        "semantic_role": semantics.semantic_role,
        "polarity": semantics.polarity,
        "action_type": semantics.action_type,
        "claim_type": semantics.claim_type,
        "audience_scope": semantics.audience_scope,
        "article_no": semantics.article_no,
        "clause_no": semantics.clause_no,
        "section_kind": semantics.section_kind,
    }
    if _shared_text(release_metadata.get("answer_role")) == "procedure_step":
        semantic_metadata.update(
            {
                "content_role": "procedure",
                "semantic_role": "procedure_step",
                "claim_type": "procedure",
                "is_answer_bearing": True,
            }
        )
    return {
        **semantic_metadata,
        **release_metadata,
    }


def build_handbook_answer_role_release_metadata(
    *,
    semantics,
    metadata: dict[str, object],
    text: str,
) -> dict[str, object]:
    explicit_answer_role = _shared_text(metadata.get("answer_role"))
    if explicit_answer_role:
        return {
            "answer_role": explicit_answer_role,
            "role_confidence": _shared_text(metadata.get("role_confidence")) or "high",
            "role_reason": _shared_text(metadata.get("role_reason"))
            or "explicit_answer_role_metadata",
        }
    if semantics.content_role == "procedure" or semantics.semantic_role == "procedure_step":
        role_metadata = build_answer_role_metadata(
            text=text,
            prefix_text=_release_role_prefix_text(metadata),
        )
        answer_role = _shared_text(role_metadata.get("answer_role"))
        if answer_role == "supporting_detail":
            hinted_role_metadata = build_answer_role_metadata(
                text=text,
                prefix_text=_release_role_prefix_text(metadata),
                role_hint="procedure_step",
            )
            hinted_answer_role = _shared_text(hinted_role_metadata.get("answer_role"))
            if hinted_answer_role == "eligibility_intro":
                role_metadata = hinted_role_metadata
                answer_role = hinted_answer_role
        if answer_role == "procedure_step":
            return {
                "answer_role": "procedure_step",
                "role_confidence": _shared_text(role_metadata.get("role_confidence")) or "high",
                "role_reason": _shared_text(role_metadata.get("role_reason"))
                or "derived_from_handbook_semantics:procedure",
            }
        if answer_role in {
            "exclusion_rule",
            "exception_rule",
            "eligibility_intro",
            "eligibility_condition",
        }:
            return role_metadata
    if semantics.content_role == "table_fact":
        role_metadata = build_table_answer_role_metadata(text=text, metadata=metadata)
        return {
            **role_metadata,
            "role_reason": _shared_text(role_metadata.get("role_reason"))
            or "derived_from_handbook_semantics:table_fact",
        }
    if not semantics.is_answer_bearing:
        return {
            "answer_role": "supporting_detail",
            "role_confidence": "low",
            "role_reason": "not_answer_bearing_from_handbook_semantics",
        }
    role = infer_answer_role_from_handbook_semantics(semantics)
    if role == "procedure_step":
        return {
            "answer_role": role,
            "role_confidence": "medium",
            "role_reason": (
                "derived_from_handbook_semantics:"
                f"{semantics.content_role or semantics.semantic_role or semantics.claim_type}"
            ),
        }
    if role in {"time_constraint", "material_requirement"} and _semantics_fast_path_is_leaf_clause(
        text
    ):
        return {
            "answer_role": role,
            "role_confidence": "medium",
            "role_reason": (
                "derived_from_handbook_semantics:"
                f"{semantics.content_role or semantics.semantic_role or semantics.claim_type}"
            ),
        }
    if role in {"definition", "table_fact"}:
        return {
            "answer_role": role,
            "role_confidence": "medium",
            "role_reason": (
                "derived_from_handbook_semantics:"
                f"{semantics.content_role or semantics.semantic_role or semantics.claim_type}"
            ),
        }
    parser_decision = decide_answer_role(text=text, prefix_text=_release_role_prefix_text(metadata))
    parser_answer_role = _shared_text(parser_decision.get("answer_role"))
    if _should_prefer_parser_answer_role(
        semantics=semantics,
        parser_answer_role=parser_answer_role,
    ):
        return {
            "answer_role": parser_answer_role,
            "role_confidence": _shared_text(parser_decision.get("role_confidence")) or "high",
            "role_reason": _shared_text(parser_decision.get("role_reason"))
            or "derived_from_answer_role_parser",
        }
    role_metadata = build_answer_role_metadata(text=text)
    answer_role = _shared_text(role_metadata.get("answer_role"))
    if answer_role and answer_role != "supporting_detail":
        return {
            "answer_role": answer_role,
            "role_confidence": _shared_text(role_metadata.get("role_confidence")) or "medium",
            "role_reason": _shared_text(role_metadata.get("role_reason"))
            or "derived_from_answer_role_parser",
        }
    if role:
        return {
            "answer_role": role,
            "role_confidence": "medium",
            "role_reason": (
                "derived_from_handbook_semantics:"
                f"{semantics.content_role or semantics.semantic_role or semantics.claim_type}"
            ),
        }
    return {
        "answer_role": "supporting_detail",
        "role_confidence": "low",
        "role_reason": "answer_bearing_without_specific_answer_role",
    }


def infer_answer_role_from_handbook_semantics(semantics) -> str:
    if semantics.semantic_role == "exception":
        return "exception_rule"
    if (
        semantics.claim_type == "cannot_do"
        or semantics.polarity == "negative"
        or semantics.semantic_role in {"exclusion", "prohibition"}
    ):
        return "exclusion_rule"
    if semantics.content_role in {"deadline", "time_rule"} or semantics.claim_type in {
        "time_constraint",
        "timeline_or_deadline",
    }:
        return "time_constraint"
    if semantics.content_role == "requirement" and semantics.claim_type == "material_requirement":
        return "material_requirement"
    if semantics.content_role == "definition" or semantics.semantic_role == "definition":
        return "definition"
    if semantics.content_role in {"eligibility", "requirement"} or semantics.semantic_role in {
        "condition",
        "intro",
        "example",
    }:
        return "eligibility_condition"
    if semantics.content_role == "table_fact":
        return "table_fact"
    return ""


def _should_prefer_parser_answer_role(*, semantics, parser_answer_role: str) -> bool:
    if parser_answer_role in {"exception_rule", "exclusion_rule", "example_evidence"}:
        return True
    if parser_answer_role != "procedure_step":
        return False
    if semantics.content_role == "procedure" or semantics.semantic_role == "procedure_step":
        return True
    return semantics.content_role in {"deadline", "time_rule", "eligibility", "requirement"} or (
        semantics.semantic_role in {"condition", "intro", "example", "time_constraint"}
    )


def _semantics_fast_path_is_leaf_clause(text: str) -> bool:
    non_empty_lines = [line.strip() for line in text.splitlines() if line.strip()]
    return len(non_empty_lines) <= 1


def _release_role_prefix_text(metadata: dict[str, object]) -> str:
    section_path = metadata.get("section_path")
    if isinstance(section_path, Sequence) and not isinstance(section_path, (str, bytes)):
        values = [str(item).strip() for item in section_path if str(item).strip()]
        return " ".join(values)
    return ""


def header_ratio(chunk_assembly) -> float:
    if chunk_assembly.total_token_count <= 0:
        return 0.0
    return chunk_assembly.header_token_count / chunk_assembly.total_token_count


def short_textual_group_is_satisfied(candidate: _ChunkCandidate) -> bool:
    if len(candidate.members) >= 4:
        return True
    if header_ratio(candidate.chunk_assembly) >= _SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD:
        return False
    return candidate.chunk_assembly.display_token_count >= 120


def build_aggregated_anchor(members: Sequence[_ChunkMember]) -> dict[str, object]:
    aggregated_anchor = build_member_anchor(members[0])
    page_starts = [
        value
        for value in (as_int(build_member_anchor(member).get("page_start")) for member in members)
        if value is not None
    ]
    page_ends = [
        value
        for value in (as_int(build_member_anchor(member).get("page_end")) for member in members)
        if value is not None
    ]
    if page_starts:
        aggregated_anchor["page_start"] = min(page_starts)
    if page_ends:
        aggregated_anchor["page_end"] = max(page_ends)
    common_section_path = common_section_path_tuple(
        normalize_section_path(build_member_anchor(member)) for member in members
    )
    if common_section_path:
        aggregated_anchor["section_path"] = list(common_section_path)
    else:
        aggregated_anchor.pop("section_path", None)

    article_labels = collect_member_labels(members, "article_label")
    provision_labels = collect_member_labels(members, "provision_label")
    if article_labels:
        aggregated_anchor["article_label"] = collapse_label_range(article_labels)
    else:
        aggregated_anchor.pop("article_label", None)
    if provision_labels:
        aggregated_anchor["provision_label"] = collapse_label_range(provision_labels)
    else:
        aggregated_anchor.pop("provision_label", None)
    return aggregated_anchor


def build_institutional_regulation_aggregated_anchor(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    members: Sequence[_ChunkMember],
) -> dict[str, object]:
    aggregated_anchor = build_aggregated_anchor(members)
    current_path = normalize_section_path(current.anchor)
    incoming_path = normalize_section_path(incoming.anchor)
    resolved_path: tuple[str, ...] = ()
    if current_path == incoming_path:
        resolved_path = current_path
    elif current_path and incoming_path and incoming_path[: len(current_path)] == current_path:
        resolved_path = (
            incoming_path
            if institutional_regulation_candidate_is_heading_only(current)
            else current_path
        )
    elif current_path and incoming_path and current_path[: len(incoming_path)] == incoming_path:
        resolved_path = (
            current_path
            if institutional_regulation_candidate_is_heading_only(incoming)
            else incoming_path
        )
    if resolved_path:
        aggregated_anchor["section_path"] = list(resolved_path)
    aggregated_anchor.pop("article_label", None)
    aggregated_anchor.pop("provision_label", None)
    return aggregated_anchor


def build_aggregated_metadata(
    *,
    current: _ChunkCandidate,
    members: Sequence[_ChunkMember],
) -> dict[str, object]:
    aggregated_metadata = dict(current.metadata)
    for field_name in ("title", "policy_doc_no", "preface_text"):
        shared_value = shared_metadata_text(members, field_name)
        if shared_value is None:
            aggregated_metadata.pop(field_name, None)
        else:
            aggregated_metadata[field_name] = shared_value
    aggregated_metadata["aggregation_mode"] = "adjacent_short_textual_units"
    aggregated_metadata["member_unit_count"] = len(members)
    aggregated_metadata["member_root_unit_ids"] = [member.piece.root_unit_id for member in members]
    aggregated_metadata["member_source_chunk_ids"] = [
        member.unit.source_chunk_id for member in members if member.unit.source_chunk_id is not None
    ]
    aggregated_metadata["member_segment_lineage"] = [
        {
            "root_unit_id": member.piece.root_unit_id,
            "segment_index": member.piece.segment_index,
            "segment_total": member.piece.segment_total,
        }
        for member in members
    ]
    article_labels = collect_member_labels(members, "article_label")
    if article_labels:
        aggregated_metadata["member_article_labels"] = article_labels
    provision_labels = collect_member_labels(members, "provision_label")
    if provision_labels:
        aggregated_metadata["member_provision_labels"] = provision_labels
    return aggregated_metadata


def build_table_release_metadata(metadata: dict[str, object]) -> dict[str, object]:
    release_metadata: dict[str, object] = {}
    header_line = str(metadata.get("table_header_line") or "").strip()
    column_paths = _string_list(metadata.get("table_column_paths"))
    header_cells = column_paths or _split_table_line(header_line)
    if header_line and not metadata.get("table_headers"):
        release_metadata["table_headers"] = header_cells or [header_line]
    if header_cells and not metadata.get("table_columns"):
        release_metadata["table_columns"] = header_cells
    return release_metadata


def build_aggregated_display_text(members: Sequence[_ChunkMember]) -> str:
    return "\n\n".join(build_member_display_text(member) for member in members).strip()


def build_curriculum_aggregated_display_text(members: Sequence[_ChunkMember]) -> str:
    if not members:
        return ""
    common_path = common_section_path_tuple(
        normalize_section_path(member.unit.anchor) for member in members
    )
    parts: list[str] = []
    first_text = members[0].piece.text.strip()
    if first_text:
        parts.append(first_text)
    for member in members[1:]:
        contribution = build_curriculum_member_display_text(member, common_path=common_path)
        if contribution:
            parts.append(contribution)
    return "\n\n".join(parts).strip()


def build_curriculum_member_display_text(
    member: _ChunkMember, *, common_path: tuple[str, ...]
) -> str:
    return strip_curriculum_common_path_prefix(member.piece.text, common_path=common_path)


def strip_curriculum_common_path_prefix(text: str, *, common_path: tuple[str, ...]) -> str:
    text = text.strip()
    if not text:
        return ""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return ""
    prefix = _normalize_curriculum_structural_path(list(common_path))
    strip_count = 0
    for expected in prefix:
        if strip_count < len(lines) and lines[strip_count] == expected:
            strip_count += 1
            continue
        break
    if strip_count <= 0:
        return text
    remaining_lines = lines[strip_count:]
    if remaining_lines:
        return "\n".join(remaining_lines).strip()
    return text


def build_member_display_text(member: _ChunkMember) -> str:
    text = member.piece.text.strip()
    label = resolve_member_label(member)
    if not label or text.startswith(label):
        return text
    separator = " " if not text.startswith(("：", ":")) else ""
    return f"{label}{separator}{text}".strip()


def resolve_member_label(member: _ChunkMember) -> str | None:
    anchor = build_member_anchor(member)
    for field_name in ("article_label", "provision_label"):
        label = normalize_anchor_label(anchor, field_name)
        if label is not None:
            return label
    return None


def collect_member_labels(members: Sequence[_ChunkMember], field_name: str) -> list[str]:
    labels: list[str] = []
    for member in members:
        value = build_member_anchor(member).get(field_name)
        if isinstance(value, str):
            normalized = value.strip()
            if normalized:
                labels.append(normalized)
    return labels


def build_member_anchor(member: _ChunkMember) -> dict[str, object]:
    return {**dict(member.unit.anchor), **dict(member.piece.anchor)}


def collapse_label_range(labels: Sequence[str]) -> str:
    distinct_labels: list[str] = []
    for label in labels:
        if not distinct_labels or distinct_labels[-1] != label:
            distinct_labels.append(label)
    if not distinct_labels:
        return ""
    if len(distinct_labels) == 1:
        return distinct_labels[0]
    return f"{distinct_labels[0]}-{distinct_labels[-1]}"


def normalize_section_path(anchor: dict[str, object]) -> tuple[str, ...]:
    section_path = anchor.get("section_path")
    if not isinstance(section_path, list):
        return ()
    return tuple(str(item).strip() for item in section_path if str(item).strip())


def normalize_anchor_label(anchor: dict[str, object], field_name: str) -> str | None:
    value = anchor.get(field_name)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def shared_metadata_text(members: Sequence[_ChunkMember], field_name: str) -> str | None:
    sentinel = object()
    shared_value: str | None | object = sentinel
    for member in members:
        value = member.unit.metadata.get(field_name)
        normalized = value.strip() if isinstance(value, str) and value.strip() else None
        if shared_value is sentinel:
            shared_value = normalized
            continue
        if shared_value != normalized:
            return None
    return shared_value if isinstance(shared_value, str) else None


def _shared_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list | tuple):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _split_table_line(value: str) -> list[str]:
    return [part.strip() for part in value.split("|") if part.strip()]


def common_section_path_tuple(paths: Iterable[tuple[str, ...]]) -> tuple[str, ...]:
    normalized_paths = [path for path in paths if path]
    if not normalized_paths:
        return ()
    common = list(normalized_paths[0])
    for path in normalized_paths[1:]:
        limit = min(len(common), len(path))
        index = 0
        while index < limit and common[index] == path[index]:
            index += 1
        common = common[:index]
        if not common:
            return ()
    return tuple(common)


def as_int(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def institutional_regulation_candidate_is_heading_only(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "institutional_regulation_block":
        return False
    section_path = normalize_section_path(candidate.anchor)
    if not section_path:
        return False
    lines = [line.strip() for line in candidate.piece.text.splitlines() if line.strip()]
    if len(lines) != 1:
        return False
    return lines[0] == section_path[-1]


__all__ = [
    "as_int",
    "build_aggregated_anchor",
    "build_aggregated_display_text",
    "build_aggregated_metadata",
    "build_collection_semantic_metadata",
    "build_curriculum_aggregated_display_text",
    "build_curriculum_member_display_text",
    "build_institutional_regulation_aggregated_anchor",
    "build_member_anchor",
    "build_table_release_metadata",
    "collect_member_labels",
    "common_section_path_tuple",
    "header_ratio",
    "infer_answer_role_from_handbook_semantics",
    "institutional_regulation_candidate_is_heading_only",
    "normalize_anchor_label",
    "normalize_section_path",
    "shared_metadata_text",
    "short_textual_group_is_satisfied",
    "strip_curriculum_common_path_prefix",
]
