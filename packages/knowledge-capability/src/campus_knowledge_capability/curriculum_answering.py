from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource

from .answer_shared import (
    _answer_prefix,
    _lead_source_title,
    _normalize_snippet,
    _render_source_support,
    _source_context_label,
)
from .curriculum_tables import (
    _is_curriculum_course_row,
    _is_curriculum_table_heading,
    _split_curriculum_table_cells,
)
from .curriculum_terms import (
    _curriculum_semester_answer_label,
    _curriculum_semester_labels,
    _is_curriculum_lookup_query,
    _is_curriculum_semester_course_list_query,
)
from .curriculum_titles import (
    _extract_curriculum_semester_course_titles,
    _extract_program_semester_course_titles,
)

_CURRICULUM_TOTAL_CREDITS_FACT_RE = re.compile(r"总学分[^0-9]{0,12}([0-9]{2,3})(?:\s*学分)?")
_CURRICULUM_TOTAL_CREDITS_TABLE_FACT_RE = re.compile(
    r"(?:^|[|｜])\s*总学分\s*(?:[|｜][^0-9\r\n]*)*([0-9]{1,3}(?:\.\d+)?)"
)
_CURRICULUM_TOTAL_CREDITS_FACT_RE = re.compile(
    r"总学分[^0-9]{0,24}([0-9]{1,3}(?:\.\d+)?)(?:\s*学分)?"
)
_CURRICULUM_TOTAL_CREDITS_INLINE_TOTAL_RE = re.compile(
    r"(?:合计|共计(?:获得)?|共|总计)\s*([0-9]{1,3}(?:\.\d+)?)\s*学分"
)
_CURRICULUM_TOTAL_CREDITS_SUMMARY_ROW_RE = re.compile(
    r"(?:^|[|｜])\s*合计\s*(?:[|｜]\s*)+([0-9]{1,3}(?:\.\d+)?)\s*$"
)
_CURRICULUM_STUDY_YEARS_FACT_RE = re.compile(
    r"学制[^0-9一二三四五六七八九十两]{0,12}((?:\d+|[一二三四五六七八九十两]+)年)"
)
_CURRICULUM_EMPTY_TABLE_CATEGORY_CELLS = frozenset({"", "-", "—", "/", "／"})


def _compose_curriculum_semester_course_list_answer(
    *,
    evidence: EvidenceBundle,
    query_text: str = "",
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    if evidence.collection not in {"curriculum_plan", "program_semester_facts"}:
        return ""
    semester_labels = _curriculum_semester_labels(evidence.query_text)
    if len(semester_labels) != 1:
        return ""
    semester_answer_label = _curriculum_semester_answer_label(query_text or evidence.query_text)
    if not semester_answer_label:
        return ""

    if evidence.collection == "program_semester_facts":
        lead_title = _program_semester_source_title(selected_rows)
        course_titles = list(
            _extract_program_semester_course_titles(
                query_text=evidence.query_text,
                selected_rows=selected_rows,
            )
        )
        if not course_titles:
            return ""
        title_prefix = f"《{lead_title}》" if lead_title else ""
        return (
            f"{_answer_prefix(evidence)}，{title_prefix}{semester_answer_label}有"
            f"{'、'.join(course_titles)}。"
        )

    course_titles: list[str] = []
    seen_titles: set[str] = set()
    for source, statements in selected_rows:
        for course_title in _extract_curriculum_semester_course_titles(
            query_text=evidence.query_text,
            source=source,
            statements=statements,
        ):
            normalized = _normalize_snippet(course_title).lower()
            if not normalized or normalized in seen_titles:
                continue
            seen_titles.add(normalized)
            course_titles.append(course_title)
    if not course_titles:
        return ""

    lead_title = _lead_source_title(tuple(source for source, _ in selected_rows))
    title_prefix = f"《{lead_title}》" if lead_title else ""
    return f"{title_prefix}{semester_answer_label}有{'、'.join(course_titles)}。"


def _compose_curriculum_lookup_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    statements = _flatten_curriculum_statements(selected_rows)
    if not statements:
        return ""
    lead_title = _lead_source_title(tuple(source for source, _ in selected_rows))
    normalized_query = _normalize_snippet(evidence.query_text)
    if any(token in normalized_query for token in ("学制", "几年")):
        years = _extract_curriculum_study_years(statements)
        if years:
            return _curriculum_fact_sentence(lead_title, f"学制为{years}")
        return ""
    if _query_asks_curriculum_total_credits(normalized_query):
        credits = _extract_curriculum_total_credits(statements)
        if credits:
            return _curriculum_total_credits_sentence(
                lead_title=lead_title,
                credits=credits,
                normalized_query=normalized_query,
            )
        return ""
    if _query_asks_curriculum_course_settings(normalized_query):
        course_settings_answer = _compose_curriculum_course_settings_answer(
            lead_title=lead_title,
            selected_rows=selected_rows,
        )
        if course_settings_answer:
            return course_settings_answer
        return ""
    if selected_rows:
        source = selected_rows[0][0]
        context_label = _source_context_label(evidence=evidence, source=source)
        if context_label:
            return f"{_answer_prefix(evidence)}，{context_label}明确：{'；'.join(statements[:3])}"
    return ""


def _compose_curriculum_identity_answer(
    *,
    evidence: EvidenceBundle,
    query_text: str = "",
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    document_reference_only: bool = False,
) -> str:
    lead_title = _lead_source_title(tuple(source for source, _ in selected_rows))
    if document_reference_only:
        if not lead_title:
            return ""
        return _curriculum_document_reference_sentence(
            lead_title=lead_title,
            query_text=query_text or evidence.query_text,
        )
    statements = _flatten_curriculum_statements(selected_rows)
    if not statements:
        return ""
    first_fact = _curriculum_identity_summary(_normalize_snippet(statements[0]))
    if not first_fact:
        return ""
    if lead_title:
        return f"《{lead_title}》明确：{first_fact}"
    return f"{_answer_prefix(evidence)}，{first_fact}"


def _flatten_curriculum_statements(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    statements: list[str] = []
    for source, row_statements in selected_rows:
        if row_statements:
            statements.extend(statement for statement in row_statements if statement)
            continue
        source_support = _render_source_support(source)
        if source_support:
            statements.append(source_support)
    return tuple(statements)


def _extract_curriculum_study_years(statements: tuple[str, ...]) -> str:
    for statement in statements:
        normalized = _normalize_snippet(statement)
        match = _CURRICULUM_STUDY_YEARS_FACT_RE.search(normalized)
        if match:
            return match.group(1)
        if "学制" in normalized:
            tail = normalized.split("学制", 1)[-1]
            year_match = re.search(r"((?:\d+|[一二三四五六七八九十两]+)年)", tail)
            if year_match:
                return year_match.group(1)
    return ""


def _extract_curriculum_total_credits(statements: tuple[str, ...]) -> str:
    for statement in statements:
        normalized = _normalize_snippet(statement)
        if "总学分" in normalized:
            match = _CURRICULUM_TOTAL_CREDITS_TABLE_FACT_RE.search(normalized)
            if match:
                return f"{match.group(1)}学分"
            match = _CURRICULUM_TOTAL_CREDITS_FACT_RE.search(normalized)
            if match:
                return f"{match.group(1)}学分"
        match = _CURRICULUM_TOTAL_CREDITS_SUMMARY_ROW_RE.search(normalized)
        if match:
            return f"{match.group(1)}学分"
        match = _CURRICULUM_TOTAL_CREDITS_INLINE_TOTAL_RE.search(normalized)
        if match:
            return f"{match.group(1)}学分"
    return ""


def _query_asks_curriculum_total_credits(normalized_query: str) -> bool:
    if "总学分" in normalized_query or "学分要求" in normalized_query:
        return True
    if "多少学分" not in normalized_query:
        return False
    return any(cue in normalized_query for cue in ("一共", "共", "总共", "总计", "合计"))


def _query_asks_curriculum_course_settings(normalized_query: str) -> bool:
    return any(token in normalized_query for token in ("课程设置", "修读建议"))


def _query_requires_curriculum_typed_lookup(query_text: str) -> bool:
    normalized_query = _normalize_snippet(query_text)
    return (
        any(token in normalized_query for token in ("学制", "几年"))
        or _query_asks_curriculum_total_credits(normalized_query)
        or _query_asks_curriculum_course_settings(normalized_query)
    )


def _compose_curriculum_course_settings_answer(
    *,
    lead_title: str,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    categories = _extract_curriculum_course_setting_categories(selected_rows)
    facts = _extract_curriculum_course_setting_facts(selected_rows)
    course_titles = (
        ()
        if categories or facts
        else _extract_curriculum_course_setting_course_titles(selected_rows)
    )
    if not categories and not facts and not course_titles:
        return ""
    title_prefix = f"《{lead_title}》" if lead_title else "该培养方案"
    fragments: list[str] = []
    if categories:
        fragments.append(f"{title_prefix}课程设置按以下模块安排：{'、'.join(categories)}")
    else:
        fragments.append(f"{title_prefix}课程设置和修读建议")
    fragments.extend(facts)
    if course_titles:
        fragments.append(f"涉及课程包括：{'、'.join(course_titles)}")
    fragments.append("依据课程设置和修读建议")
    return "；".join(fragments) + "。"


def _extract_curriculum_course_setting_categories(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    categories: list[str] = []
    seen: set[str] = set()
    for source, _ in selected_rows:
        if source.collection != "curriculum_plan" or source.content_role != "table_fact":
            continue
        for category in _course_setting_categories_from_structural_path(source):
            key = _normalize_snippet(category).lower()
            if not key or key in seen:
                continue
            seen.add(key)
            categories.append(category)
        for category in _course_setting_categories_from_source(source):
            key = _normalize_snippet(category).lower()
            if not key or key in seen:
                continue
            seen.add(key)
            categories.append(category)
    return tuple(categories)


def _extract_curriculum_course_setting_facts(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    facts: list[str] = []
    seen: set[str] = set()
    for source, statements in selected_rows:
        if source.collection != "curriculum_plan" or source.content_role != "table_fact":
            continue
        for fact in _course_setting_facts_from_source(source, statements):
            key = _normalize_snippet(fact).lower()
            if not key or key in seen:
                continue
            seen.add(key)
            facts.append(fact)
    return tuple(facts[:6])


def _extract_curriculum_course_setting_course_titles(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    course_titles: list[str] = []
    seen: set[str] = set()
    for source, statements in selected_rows:
        if source.collection != "curriculum_plan" or source.content_role != "table_fact":
            continue
        for raw_line in statements or tuple(re.split(r"[\r\n]+", source.snippet)):
            line = _normalize_snippet(raw_line)
            if not _is_curriculum_course_row(source, line):
                continue
            title = _course_title_from_course_setting_row(line)
            key = _normalize_snippet(title).lower()
            if not key or key in seen:
                continue
            seen.add(key)
            course_titles.append(title)
    return tuple(course_titles[:6])


def _course_setting_facts_from_source(
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> tuple[str, ...]:
    lines = statements or tuple(re.split(r"[\r\n]+", source.snippet))
    candidate_lines = lines or statements
    facts: list[str] = []
    ignored_lines = _curriculum_ignored_source_lines(source)
    for raw_line in candidate_lines:
        line = _normalize_snippet(raw_line)
        if _is_curriculum_course_row(source, line):
            continue
        if not _is_curriculum_course_setting_fact_line(
            source=source,
            line=line,
            ignored_lines=ignored_lines,
        ):
            continue
        facts.append(_normalize_course_setting_fact(line))
    return tuple(facts)


def _course_title_from_course_setting_row(line: str) -> str:
    cells = _split_curriculum_table_cells(line)
    if len(cells) < 2:
        return ""
    if cells[0] in _CURRICULUM_EMPTY_TABLE_CATEGORY_CELLS:
        return ""
    if cells[0].isdigit() or re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z.\\-]*", cells[0]):
        return cells[1]
    if len(cells) >= 3 and (
        cells[1] in _CURRICULUM_EMPTY_TABLE_CATEGORY_CELLS
        or re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z.\\-]*", cells[1])
    ):
        return cells[2]
    return cells[1]


def _is_curriculum_course_setting_fact_line(
    *,
    source: EvidenceSource,
    line: str,
    ignored_lines: set[str],
) -> bool:
    if not line or line in ignored_lines:
        return False
    if line.startswith("文号：") or "课程清单如下" in line:
        return False
    has_fact_signal = _course_setting_fact_signal(line)
    if _normalize_course_setting_category_label(line) and not has_fact_signal:
        return False
    if _is_curriculum_table_heading(source, line) or _is_curriculum_course_row(source, line):
        return False
    return has_fact_signal


def _course_setting_fact_signal(line: str) -> bool:
    return "学分" in line or any(token in line for token in ("至少", "应修", "完成"))


def _normalize_course_setting_fact(line: str) -> str:
    if "|" in line:
        cells = _split_curriculum_table_cells(line)
        if len(cells) >= 3:
            course_name = cells[1]
            credits = cells[2]
            semester = cells[-1]
            fragments = [course_name]
            if credits and credits not in _CURRICULUM_EMPTY_TABLE_CATEGORY_CELLS:
                fragments.append(f"{credits}学分")
            if semester and semester not in _CURRICULUM_EMPTY_TABLE_CATEGORY_CELLS:
                fragments.append(f"修读学期{semester}")
            return "，".join(fragments)
    return _normalize_snippet(line).rstrip("。；;，, ")


def _course_setting_categories_from_structural_path(source: EvidenceSource) -> tuple[str, ...]:
    categories: list[str] = []
    for raw_label in source.structural_path[1:]:
        label = _normalize_course_setting_category_label(raw_label)
        if label:
            categories.append(label)
    return tuple(categories)


def _course_setting_categories_from_source(source: EvidenceSource) -> tuple[str, ...]:
    ignored_lines = _curriculum_ignored_source_lines(source)
    category_index = -1
    categories: list[str] = []
    for raw_line in re.split(r"[\r\n]+", source.snippet):
        line = _normalize_snippet(raw_line)
        if not line or line in ignored_lines or line.startswith("文号："):
            continue
        cells = _split_curriculum_table_cells(line)
        resolved_category_index = _course_setting_category_header_index(cells)
        if resolved_category_index >= 0:
            category_index = resolved_category_index
            continue
        if _is_curriculum_table_heading(source, line) or not _is_curriculum_course_row(
            source,
            line,
        ):
            continue
        if category_index < 0:
            continue
        if category_index >= len(cells):
            continue
        category = _normalize_snippet(cells[category_index])
        if category not in _CURRICULUM_EMPTY_TABLE_CATEGORY_CELLS:
            categories.append(category)
    return tuple(categories)


def _normalize_course_setting_category_label(label: str) -> str:
    normalized = _normalize_snippet(label).strip()
    if not normalized:
        return ""
    normalized = re.sub(r"^[（(]?[一二三四五六七八九十0-9]+[)）.、]\s*", "", normalized)
    normalized = normalized.strip(" ：:，,。；;")
    if normalized in {
        "课程设置和修读建议",
        "大类培养",
        "专业教育",
        "课程清单如下",
    }:
        return ""
    if len(normalized) > 24:
        return ""
    if any(token in normalized for token in ("课程", "教育", "素养", "基础")):
        if re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z.\\-]*", normalized):
            return ""
        return normalized
    return ""


def _course_setting_category_header_index(cells: tuple[str, ...]) -> int:
    for index, cell in enumerate(cells):
        if cell in {"类别", "课程类别", "课程模块", "课程性质"}:
            return index
    return -1


def _curriculum_ignored_source_lines(source: EvidenceSource) -> set[str]:
    ignored_lines = {
        _normalize_snippet(source.source_title),
        *(_normalize_snippet(item) for item in source.structural_path if item.strip()),
    }
    if source.detail_label.strip():
        ignored_lines.add(_normalize_snippet(source.detail_label))
    return ignored_lines


def _curriculum_fact_sentence(lead_title: str, body: str) -> str:
    if lead_title:
        return f"《{lead_title}》{body}。"
    return f"{body}。"


def _curriculum_total_credits_sentence(
    *,
    lead_title: str,
    credits: str,
    normalized_query: str,
) -> str:
    if any(cue in normalized_query for cue in ("一共", "共", "总共", "总计", "合计")):
        return _curriculum_fact_sentence(lead_title, f"一共{credits}")
    return _curriculum_fact_sentence(lead_title, f"总学分为{credits}")


def _curriculum_document_reference_sentence(*, lead_title: str, query_text: str) -> str:
    if _query_requests_curriculum_document_view(query_text):
        return f"可以查看《{lead_title}》。"
    return f"相关培养方案为《{lead_title}》。"


def _query_requests_curriculum_document_view(query_text: str) -> bool:
    normalized = _normalize_snippet(query_text)
    return any(
        cue in normalized
        for cue in (
            "想看",
            "要看",
            "我要看",
            "查看",
            "看一下",
            "看下",
            "看看",
            "在哪看",
            "哪里看",
        )
    )


def _first_sentence(text: str) -> str:
    for terminator in ("。", "！", "？", "!", "?"):
        if terminator in text:
            return text.split(terminator, 1)[0].strip()
    return text.strip()


def _curriculum_identity_summary(text: str) -> str:
    normalized = _normalize_snippet(text)
    if not normalized:
        return ""
    if "培养目标" in normalized:
        return "该培养方案包含培养目标等内容"
    first_sentence = _first_sentence(normalized)
    if len(first_sentence) > 80:
        return first_sentence[:80].rstrip("，,；;:： ") + "等内容"
    return first_sentence


def _program_semester_source_title(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    if not selected_rows:
        return ""
    source = selected_rows[0][0]
    for label in source.structural_path:
        normalized = _normalize_snippet(label)
        if normalized and "课程事实" not in normalized:
            return normalized
    title = _lead_source_title((source,))
    return re.sub(r"\s*第[一二三四五六七八九十0-9]+学期课程事实$", "", title).strip()


__all__ = [
    "_compose_curriculum_identity_answer",
    "_compose_curriculum_lookup_answer",
    "_compose_curriculum_semester_course_list_answer",
    "_curriculum_fact_sentence",
    "_extract_curriculum_study_years",
    "_extract_curriculum_total_credits",
    "_flatten_curriculum_statements",
    "_is_curriculum_lookup_query",
    "_is_curriculum_semester_course_list_query",
    "_query_requires_curriculum_typed_lookup",
]
