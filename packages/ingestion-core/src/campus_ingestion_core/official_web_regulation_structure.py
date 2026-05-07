from __future__ import annotations

import re
from dataclasses import dataclass

from campus_ingestion_core.official_web_regulation_titles import (
    NormalizedOfficialWebRegulationTitle,
    normalize_official_web_regulation_title,
)

_REGULATION_FORMAL_TITLE_RE = re.compile(
    r"(?P<title>中央民族大学[^\n]{0,80}?(?:办法|规定|章程|细则|规程|制度|规划|条例)"
    r"(?:[（(](?:试行|暂行|修订|最新)[）)])?)"
)
_STRUCTURE_MARKER_RE = re.compile(
    r"(第[一二三四五六七八九十百千万〇零两0-9]+[章节条]|"
    r"[一二三四五六七八九十百千万〇零两0-9]+、|"
    r"[（(][一二三四五六七八九十百千万〇零两0-9]+[)）])"
)
_WRAPPER_HEADING_RE = re.compile(
    r"^(学生工作|教学工作|教务工作|科研工作|人事工作|资产管理|信息公开|校园服务|办事指南)$"
)
_SOURCE_TITLE_FORMAL_HINT_RE = re.compile(r"(办法|规定|章程|细则|规程|制度|规划|条例)")
_NON_BODY_RE = re.compile(
    r"(copyright|all rights reserved|发布时间|更新时间|作者[:：]|来源[:：]|上一篇|下一篇|上一条|下一条)",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class OfficialWebRegulationStructure:
    title_info: NormalizedOfficialWebRegulationTitle
    regulation_text: str
    regulation_lines: tuple[str, ...]
    answer_bearing_lines: tuple[str, ...]


def build_official_web_regulation_structure(
    *,
    source_title: str,
    lines: list[str],
) -> OfficialWebRegulationStructure:
    answer_bearing_lines = tuple(_regulation_answer_bearing_lines(lines))
    recovered_title = _recover_formal_title(source_title=source_title, lines=answer_bearing_lines)
    title_info = normalize_official_web_regulation_title(recovered_title or source_title)
    regulation_lines = _normalize_regulation_lines(
        lines=answer_bearing_lines,
        source_title=source_title,
        title_info=title_info,
    )
    regulation_text = regulation_body_text_for_materialization(
        title=title_info.display_title,
        regulation_lines=regulation_lines,
    )
    return OfficialWebRegulationStructure(
        title_info=title_info,
        regulation_text=regulation_text,
        regulation_lines=regulation_lines,
        answer_bearing_lines=answer_bearing_lines,
    )


def build_regulation_content_summary(lines: tuple[str, ...] | list[str]) -> str:
    normalized_lines = [line.strip() for line in lines if line.strip()]
    if not normalized_lines:
        return ""
    summary = " ".join(normalized_lines[:3]).strip()
    return re.sub(r"\s+", " ", summary)[:500]


def regulation_body_text_for_materialization(
    *,
    title: str,
    regulation_lines: tuple[str, ...] | list[str],
) -> str:
    runtime_lines = [line.strip() for line in regulation_lines if line.strip()]
    if not runtime_lines:
        return ""
    filtered_lines = [
        line
        for line in runtime_lines
        if not _WRAPPER_HEADING_RE.match(line) and _line_key(line) != _line_key(title)
    ]
    return "\n".join(filtered_lines).strip()


def _line_key(value: str) -> str:
    return normalize_official_web_regulation_title(value).display_title.replace(" ", "")


def _recover_formal_title(*, source_title: str, lines: tuple[str, ...]) -> str | None:
    normalized_source_title = normalize_official_web_regulation_title(source_title).display_title
    if _looks_like_formal_regulation_title(normalized_source_title):
        return normalized_source_title
    if _looks_like_source_article_title(normalized_source_title):
        return normalized_source_title
    for line in lines:
        if _is_reference_line(line):
            continue
        match = _REGULATION_FORMAL_TITLE_RE.search(line)
        if match is None:
            continue
        return normalize_official_web_regulation_title(match.group("title")).display_title
    return None


def _looks_like_source_article_title(title: str) -> bool:
    if _WRAPPER_HEADING_RE.match(title):
        return False
    return _SOURCE_TITLE_FORMAL_HINT_RE.search(title) is not None


def _is_reference_line(line: str) -> bool:
    return bool(re.search(r"(根据|依据|按照).{0,24}《", line))


def _looks_like_formal_regulation_title(title: str) -> bool:
    return _REGULATION_FORMAL_TITLE_RE.fullmatch(title) is not None


def _regulation_answer_bearing_lines(lines: list[str]) -> list[str]:
    candidates = [
        line.strip() for line in lines if line.strip() and not _NON_BODY_RE.search(line.strip())
    ]
    if not any(_STRUCTURE_MARKER_RE.search(line) for line in candidates):
        return []
    return candidates


def _normalize_regulation_lines(
    *,
    lines: tuple[str, ...],
    source_title: str,
    title_info: NormalizedOfficialWebRegulationTitle,
) -> tuple[str, ...]:
    normalized_lines: list[str] = []
    source_title_key = _line_key(source_title)
    formal_title_key = _line_key(title_info.display_title)
    for line in lines:
        current = line.strip()
        if not current:
            continue
        if (
            not normalized_lines
            and _line_key(current) == source_title_key
            and source_title_key != formal_title_key
        ):
            continue
        if not normalized_lines and current.startswith(title_info.display_title):
            normalized_lines.append(title_info.display_title)
            remainder = current[len(title_info.display_title) :].strip()
            if remainder:
                normalized_lines.append(remainder)
            continue
        if normalized_lines or current != title_info.display_title:
            normalized_lines.append(current)
            continue
        normalized_lines.append(current)
    return tuple(normalized_lines)


__all__ = [
    "OfficialWebRegulationStructure",
    "build_official_web_regulation_structure",
    "build_regulation_content_summary",
    "regulation_body_text_for_materialization",
]
