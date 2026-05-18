from __future__ import annotations

import re

from campus_contracts import EvidenceSource

from .agent_shared import _normalize_snippet

_TUITION_NOTICE_TITLE = "中央民族大学大学教育收费公示表"
_TEACHING_UNITS_TITLE = "教学和科研单位"
_FEE_TABLE_REQUIRED_COLUMNS = (
    "收费项目",
    "计费单位",
    "收费标准",
)
_FEE_TABLE_DISPLAY_COLUMNS = "收费项目、计费单位、收费标准、收费范围/对象、批准机关及文号"


def build_official_web_structured_reference_fragments(
    *,
    normalized_title: str,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    if _TEACHING_UNITS_TITLE in normalized_title:
        return _build_teaching_units_directory_fragments(selected_rows)
    if _TUITION_NOTICE_TITLE in normalized_title:
        return _build_fee_table_overview_fragments(selected_rows)
    return ()


def _build_teaching_units_directory_fragments(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    entries: list[str] = []
    seen: set[str] = set()
    for source, statements in selected_rows:
        if source.content_kind != "directory_entry":
            continue
        for statement in statements:
            entry = _normalize_directory_entry(statement, source=source)
            if not entry or entry in seen:
                continue
            entries.append(entry)
            seen.add(entry)
    if not entries:
        return ()
    return ("教学和科研单位包括" + "、".join(entries),)


def _normalize_directory_entry(statement: str, *, source: EvidenceSource) -> str:
    normalized = _normalize_snippet(statement)
    if not normalized:
        return ""
    normalized = re.sub(r"(?:^|\s*[|｜]\s*)标题[:：][^|｜\n\r]+", "", normalized)
    normalized = re.sub(r"(?:^|\s*[|｜]\s*)章节[:：]([^|｜\n\r]+)", r" \1 ", normalized)
    candidates = [
        _normalize_snippet(item).strip(" |｜:：，,。 ")
        for item in re.split(r"[\r\n|｜]+", normalized)
        if _normalize_snippet(item).strip(" |｜:：，,。 ")
    ]
    for candidate in reversed(candidates):
        if candidate != _normalize_snippet(source.source_title):
            return candidate
    labels = tuple(_normalize_snippet(item) for item in source.structural_path if item.strip())
    return labels[-1] if labels else ""


def _build_fee_table_overview_fragments(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    table_sources = tuple(
        source for source, _ in selected_rows if source.content_kind == "table_unit"
    )
    statements = tuple(
        _normalize_snippet(text)
        for text in (
            *(statement for _, row_statements in selected_rows for statement in row_statements),
            *(source.snippet for source in table_sources),
        )
        if _normalize_snippet(text)
    )
    if not statements:
        return ()
    if not any(_looks_like_fee_table_header(statement) for statement in statements):
        return ()
    covered_items = _fee_table_charge_items(statements)
    if not covered_items:
        return (f"收费公示表列明{_FEE_TABLE_DISPLAY_COLUMNS}",)
    return (f"收费公示表列明{_FEE_TABLE_DISPLAY_COLUMNS}，表中列有{'、'.join(covered_items)}项目",)


def _looks_like_fee_table_header(statement: str) -> bool:
    normalized = _normalize_snippet(statement)
    return all(column in normalized for column in _FEE_TABLE_REQUIRED_COLUMNS)


def _fee_table_charge_items(statements: tuple[str, ...]) -> tuple[str, ...]:
    items: list[str] = []
    if any("学费" in statement for statement in statements):
        items.append("学费")
    if any("住宿费" in statement for statement in statements):
        items.append("住宿费")
    return tuple(items)


__all__ = ["build_official_web_structured_reference_fragments"]
