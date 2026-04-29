from __future__ import annotations

import re
from dataclasses import dataclass, field

_CURRICULUM_COURSE_MAP_HEADING = "六、课程地图"
_CURRICULUM_COURSE_MAP_TITLE_RE = re.compile(r".*课程(?:结构|结果)?拓扑图$")
_CURRICULUM_PAGE_MARKER_RE = re.compile(r"^\d{1,4}$")
_CURRICULUM_VERSION_NOTE_RE = re.compile(r"^[（(]?\d{4}版[)）]?$")


@dataclass(frozen=True, slots=True)
class DerivedStructuredUnit:
    unit_type: str
    root_unit_id: str
    source_chunk_id: str | None
    text: str
    anchor: dict[str, object]
    visibility_level: str
    metadata: dict[str, object] = field(default_factory=dict)

    @property
    def acl_level(self) -> str:
        return self.visibility_level


def _section_path(heading_stack: list[tuple[int, str]]) -> list[str]:
    return [text for _, text in heading_stack]


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _row_id(row: dict[str, object]) -> str:
    row_id = _normalize_optional_text(row.get("row_id"))
    if row_id is None:
        raise ValueError("curriculum structured row is missing row_id")
    return row_id


def _resolve_row_visibility_level(row: dict[str, object]) -> str:
    visibility_level = _normalize_optional_text(row.get("visibility_level"))
    if visibility_level is not None:
        return visibility_level
    entitlement_groups = row.get("entitlement_groups")
    if isinstance(entitlement_groups, list) and any(
        isinstance(item, str) and item.strip() for item in entitlement_groups
    ):
        return "restricted"
    return "public"


def _normalize_heading_level(value: object) -> int | None:
    if not isinstance(value, int):
        return None
    return value


def _is_table_cue_row(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    return any(
        token in normalized
        for token in ("课程清单如下", "建议课程清单", "清单如下", "见下表", "如下表", "如下:")
    )


def _curriculum_structural_level(text: str) -> int | None:
    normalized = text.strip()
    if not normalized:
        return None
    if re.match(r"^[一二三四五六七八九十]+、", normalized) or re.match(
        r"^第[一二三四五六七八九十百千万〇零两0-9]+[章节部分]",
        normalized,
    ):
        return 2
    if re.match(r"^[（(][一二三四五六七八九十]+[)）]", normalized):
        return 3
    if re.match(r"^[（(]?\d+[)）.、]", normalized):
        return 4
    return None


def _looks_like_subsection_heading(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    return bool(
        re.match(r"^[（(][一二三四五六七八九十]+[)）]", normalized)
        or re.match(r"^[（(]?\d+[)）.、]", normalized)
    )


def _looks_like_curriculum_structure_heading(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    return bool(
        re.match(r"^[一二三四五六七八九十]+、", normalized)
        or _looks_like_subsection_heading(normalized)
        or re.match(r"^第[一二三四五六七八九十百千万〇零两0-9]+[章节部分]", normalized)
    )


def _normalize_curriculum_structural_path(section_path: list[str]) -> list[str]:
    structural_path = [item for item in section_path if item]
    if len(structural_path) > 1 and not _looks_like_curriculum_structure_heading(
        structural_path[0]
    ):
        return structural_path[1:]
    return structural_path


def _leading_curriculum_heading_lines(
    lines: list[str],
    *,
    structural_path: list[str] | None = None,
) -> list[str]:
    prefix: list[str] = []
    expected_prefix = list(structural_path or [])
    for line in lines:
        if not _looks_like_curriculum_structure_heading(line):
            break
        if (
            expected_prefix
            and len(prefix) < len(expected_prefix)
            and line != expected_prefix[len(prefix)]
        ):
            break
        prefix.append(line)
    return prefix


def _is_curriculum_course_map_section_path(section_path: list[str]) -> bool:
    return bool(section_path) and section_path[-1] == _CURRICULUM_COURSE_MAP_HEADING


def _is_curriculum_course_map_title_line(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    if _looks_like_curriculum_structure_heading(normalized):
        return False
    return bool(_CURRICULUM_COURSE_MAP_TITLE_RE.match(normalized))


def _looks_like_curriculum_page_marker_line(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    return bool(_CURRICULUM_PAGE_MARKER_RE.fullmatch(normalized))


def _looks_like_curriculum_version_note(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    return bool(_CURRICULUM_VERSION_NOTE_RE.fullmatch(normalized))


__all__ = [
    "_CURRICULUM_COURSE_MAP_HEADING",
    "DerivedStructuredUnit",
    "_curriculum_structural_level",
    "_is_curriculum_course_map_section_path",
    "_is_curriculum_course_map_title_line",
    "_is_table_cue_row",
    "_leading_curriculum_heading_lines",
    "_looks_like_curriculum_page_marker_line",
    "_looks_like_curriculum_structure_heading",
    "_looks_like_curriculum_version_note",
    "_looks_like_subsection_heading",
    "_normalize_curriculum_structural_path",
    "_normalize_heading_level",
    "_normalize_optional_text",
    "_resolve_row_visibility_level",
    "_row_id",
    "_section_path",
]
