from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

_WHITESPACE_RE = re.compile(r"\s+")
_DETAIL_LABEL_RE = re.compile(
    r"(第\s*(?P<number>\d+|[一二三四五六七八九十百零两〇]+)\s*(?P<unit>[条款项]))"
)
_FOCUS_TERM_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("论文", ("论文", "发表")),
    ("著作", ("著作", "专著", "出版")),
    ("专利", ("专利", "发明")),
    ("竞赛", ("竞赛", "比赛")),
)
_RANK_THRESHOLD_EXCEPTION_CUES = (
    "没前十",
    "没前10",
    "没进前十",
    "没进前10",
    "不在前十",
    "不在前10",
    "前十之外",
    "前10之外",
    "前十以外",
    "前10以外",
    "超出前十",
    "超出前10",
)


@dataclass(frozen=True, slots=True)
class PolicyQueryFocus:
    detail_labels: tuple[str, ...] = ()
    article_nos: tuple[str, ...] = ()
    clause_nos: tuple[str, ...] = ()
    focus_terms: tuple[str, ...] = ()
    focus_mode: Literal[
        "none",
        "anchor_only",
        "semantic_only",
        "anchor_and_semantic",
    ] = "none"


def extract_policy_query_focus(query_text: str) -> PolicyQueryFocus:
    normalized_query = _normalize_text(query_text)
    detail_labels: list[str] = []
    article_nos: list[str] = []
    clause_nos: list[str] = []
    for match in _DETAIL_LABEL_RE.finditer(normalized_query):
        detail_label = _normalize_text(match.group(1))
        if detail_label and detail_label not in detail_labels:
            detail_labels.append(detail_label)
        normalized_no = _normalize_clause_number(match.group("number"))
        if not normalized_no:
            continue
        if match.group("unit") == "条":
            if normalized_no not in article_nos:
                article_nos.append(normalized_no)
        else:
            if normalized_no not in clause_nos:
                clause_nos.append(normalized_no)
    focus_terms = list(_extract_focus_terms(normalized_query))
    if detail_labels and focus_terms:
        focus_mode: Literal["none", "anchor_only", "semantic_only", "anchor_and_semantic"] = (
            "anchor_and_semantic"
        )
    elif detail_labels:
        focus_mode = "anchor_only"
    elif focus_terms:
        focus_mode = "semantic_only"
    else:
        focus_mode = "none"
    return PolicyQueryFocus(
        detail_labels=tuple(detail_labels),
        article_nos=tuple(article_nos),
        clause_nos=tuple(clause_nos),
        focus_terms=tuple(focus_terms),
        focus_mode=focus_mode,
    )


def _extract_focus_terms(normalized_query: str) -> tuple[str, ...]:
    compact_query = _compact_text(normalized_query)
    focus_terms: list[str] = []
    for canonical_term, cues in _FOCUS_TERM_GROUPS:
        if any(_compact_text(cue) in compact_query for cue in cues):
            focus_terms.append(canonical_term)
    if _has_any_compact_cue(compact_query, _RANK_THRESHOLD_EXCEPTION_CUES):
        for term in ("前10", "前30"):
            if term not in focus_terms:
                focus_terms.append(term)
    return tuple(focus_terms)


def _normalize_clause_number(raw_number: str) -> str:
    number = _normalize_text(raw_number)
    if not number:
        return ""
    if number.isdigit():
        return str(int(number))
    parsed = _parse_simple_chinese_number(number)
    return str(parsed) if parsed is not None else ""


def _parse_simple_chinese_number(number_text: str) -> int | None:
    numerals = {
        "零": 0,
        "〇": 0,
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    units = {"十": 10, "百": 100}
    total = 0
    current_digit = 0
    for char in number_text:
        if char in numerals:
            current_digit = numerals[char]
            continue
        unit = units.get(char)
        if unit is None:
            return None
        if current_digit == 0:
            current_digit = 1
        total += current_digit * unit
        current_digit = 0
    return total + current_digit


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", text)).strip()


def _compact_text(text: str) -> str:
    normalized = _normalize_text(text).lower()
    return "".join(char for char in normalized if char.isalnum() or _is_cjk_char(char))


def _has_any_compact_cue(compact_query: str, cues: tuple[str, ...]) -> bool:
    return any(_compact_text(cue) in compact_query for cue in cues)


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )


__all__ = ["PolicyQueryFocus", "extract_policy_query_focus"]
