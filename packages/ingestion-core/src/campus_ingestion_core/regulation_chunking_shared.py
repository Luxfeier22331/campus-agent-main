from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, replace

from campus_ingestion_core.chunking import ChunkProfile, StructuredUnitChunkInput
from campus_ingestion_core.process_shared import StructuredUnit

_CHINESE_NUMBER = "一二三四五六七八九十百千万〇零两"
_NUMERIC_ITEM_RE = re.compile(r"^\s*(?P<label>\d+[.．、])")
_GENERIC_ITEM_RE = re.compile(
    rf"^\s*(?P<label>(?:\d+[.．、]|[（(]\d+[)）]|[（(][{_CHINESE_NUMBER}]+[)）][、.]?))"
)
_ARTICLE_PREFIXED_ITEM_RE = re.compile(
    rf"^\s*(?:第[{_CHINESE_NUMBER}0-9]+条)\s+"
    rf"(?P<label>(?:\d+[.．、]|[（(]\d+[)）]|[（(][{_CHINESE_NUMBER}]+[)）][、.]?))"
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
    r"(?P<head>.+?[；;。])"
    r"(?P<tail>(?:[^。；;\n]{0,80}?(?:提出[^。；;\n]{0,20}?申请|审定密级|"
    r"签署意见|核准后接入校园网)[^。；;\n]*[。；;]?)+)$"
)
_SHORT_ATOMIC_VALUE_MAX_CHARS = 24
_TEXTUAL_REGULATION_UNIT_TYPES = frozenset({"article_body", "policy_page", "regulation_body"})
_ANSWER_READY_INTRO_TARGET_ROLE_WHITELIST = frozenset(
    {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "procedure_step",
        "material_requirement",
        "time_constraint",
    }
)


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


def _compose_list_segment_text(
    *,
    prefix_text: str,
    blocks: Sequence[_RegulationListBlock],
) -> str:
    parts = [prefix_text.strip()] if prefix_text.strip() else []
    parts.extend(block.text.strip() for block in blocks if block.text.strip())
    return "\n".join(parts).strip()


def _first_item_line_index(
    lines: Sequence[str],
    first_label: str,
    first_text: str,
) -> int:
    normalized_first_text = first_text.strip()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if normalized_first_text and stripped == normalized_first_text:
            return index
        if first_label and stripped.startswith(first_label):
            return index
        match = _ARTICLE_PREFIXED_ITEM_RE.match(stripped) or _GENERIC_ITEM_RE.match(stripped)
        if match is not None and match.group("label").strip() == first_label:
            return index
    return 0


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
