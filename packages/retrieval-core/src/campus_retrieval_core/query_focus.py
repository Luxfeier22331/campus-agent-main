from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

from campus_contracts import EvidenceSource

_WHITESPACE_RE = re.compile(r"\s+")
_DETAIL_LABEL_RE = re.compile(
    r"(第\s*(?P<number>\d+|[一二三四五六七八九十百零两〇]+)\s*(?P<unit>[条款项]))"
)
_COHORT_YEAR_RE = re.compile(r"(?P<year>20\d{2})\s*届")
_FOCUS_TERM_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("论文", ("论文", "发表")),
    ("著作", ("著作", "专著", "出版")),
    ("专利", ("专利", "发明")),
    ("竞赛", ("竞赛", "比赛")),
    ("旷课", ("旷课", "缺勤", "考勤")),
    ("学时", ("学时", "课时")),
    ("节", ("节",)),
    ("解除处分", ("解除处分", "处分解除", "解除纪律处分")),
    ("考察期", ("考察期", "期满", "届满")),
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
_RANK_THRESHOLD_GROUPS: tuple[tuple[str, ...], ...] = (
    ("前10", "前十"),
    ("前30", "前三十"),
)
_AFTER_COHORT_CUES = ("及以后", "以后", "之后", "起")


@dataclass(frozen=True, slots=True)
class QueryFocus:
    detail_labels: tuple[str, ...] = ()
    article_nos: tuple[str, ...] = ()
    clause_nos: tuple[str, ...] = ()
    focus_terms: tuple[str, ...] = ()


def extract_query_focus(query_text: str) -> QueryFocus:
    normalized_query = normalize_text(query_text)
    detail_labels: list[str] = []
    article_nos: list[str] = []
    clause_nos: list[str] = []
    for match in _DETAIL_LABEL_RE.finditer(normalized_query):
        detail_label = normalize_text(match.group(1))
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
    return QueryFocus(
        detail_labels=tuple(detail_labels),
        article_nos=tuple(article_nos),
        clause_nos=tuple(clause_nos),
        focus_terms=_extract_focus_terms(normalized_query),
    )


def build_focus_groups(query_text: str) -> tuple[tuple[str, ...], ...]:
    focus = extract_query_focus(query_text)
    groups: list[tuple[str, ...]] = []
    for article_no in focus.article_nos:
        terms = [f"第{article_no}条"]
        terms.extend(
            detail_label for detail_label in focus.detail_labels if detail_label.endswith("条")
        )
        groups.append(tuple(dict.fromkeys(terms)))
    for clause_no in focus.clause_nos:
        terms = [f"第{clause_no}款"]
        terms.extend(
            detail_label
            for detail_label in focus.detail_labels
            if detail_label.endswith(("款", "项"))
        )
        groups.append(tuple(dict.fromkeys(terms)))
    for detail_label in focus.detail_labels:
        if detail_label.endswith(("条", "款", "项")):
            continue
        groups.append((detail_label,))
    for focus_term in focus.focus_terms:
        if focus_term == "论文":
            groups.append(("论文", "发表"))
        elif focus_term == "著作":
            groups.append(("著作", "专著", "出版"))
        elif focus_term == "专利":
            groups.append(("专利", "发明"))
        elif focus_term == "竞赛":
            groups.append(("竞赛", "比赛"))
        elif focus_term == "旷课":
            groups.append(("旷课", "缺勤", "考勤"))
        elif focus_term == "学时":
            groups.append(("学时", "课时", "节"))
        elif focus_term == "节":
            groups.append(("学时", "课时", "节"))
        elif focus_term == "解除处分":
            groups.append(("解除处分", "处分解除", "解除纪律处分"))
        elif focus_term == "考察期":
            groups.append(("考察期", "期满", "届满"))
        elif focus_term == "前10":
            groups.append(_RANK_THRESHOLD_GROUPS[0])
        elif focus_term == "前30" and _query_explicitly_mentions_threshold(query_text, "前30"):
            groups.append(_RANK_THRESHOLD_GROUPS[1])
        elif _is_cohort_focus_term(focus_term):
            groups.append(_cohort_focus_group(focus_term))
    return tuple(groups)


def source_focus_match_score(*, query_text: str, source: EvidenceSource) -> int:
    focus = extract_query_focus(query_text)
    if (
        not focus.detail_labels
        and not focus.article_nos
        and not focus.clause_nos
        and not focus.focus_terms
    ):
        return 0
    score = 0
    if source.detail_label and source.detail_label in focus.detail_labels:
        score += 4
    if source.article_no and source.article_no in focus.article_nos:
        score += 4
    if source.clause_no and source.clause_no in focus.clause_nos:
        score += 2
    if focus.focus_terms:
        normalized_source = normalize_text(
            " ".join(
                fragment
                for fragment in (
                    source.source_title,
                    source.detail_label,
                    source.snippet,
                )
                if fragment
            )
        )
        for group in build_focus_groups(query_text):
            if any(term in normalized_source for term in group):
                score += 2
    return score


def source_covers_query_focus(*, query_text: str, source: EvidenceSource) -> bool:
    groups = build_focus_groups(query_text)
    if not groups:
        return True
    return source_covers_focus_groups(source=source, groups=groups)


def source_covers_focus_groups(
    *,
    source: EvidenceSource,
    groups: tuple[tuple[str, ...], ...],
) -> bool:
    normalized_source = normalize_text(
        " ".join(
            fragment
            for fragment in (
                source.source_title,
                source.detail_label,
                f"第{source.article_no}条" if source.article_no else "",
                f"第{source.clause_no}款" if source.clause_no else "",
                source.snippet,
            )
            if fragment
        )
    )
    if not normalized_source:
        return False
    for group in groups:
        if _source_text_covers_focus_group(
            normalized_source=normalized_source,
            detail_label=source.detail_label,
            group=group,
        ):
            continue
        return False
    return True


def select_sources_covering_query_focus(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    groups = build_focus_groups(query_text)
    if not groups:
        return tuple(sources)
    individually_aligned = tuple(
        source for source in sources if source_covers_focus_groups(source=source, groups=groups)
    )
    if individually_aligned:
        return individually_aligned
    return _select_same_document_sources_covering_focus_groups(
        sources=sources,
        groups=groups,
    )


def query_has_focus_constraints(query_text: str) -> bool:
    focus = extract_query_focus(query_text)
    return bool(focus.detail_labels or focus.article_nos or focus.clause_nos or focus.focus_terms)


def normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", text)).strip().lower()


def _extract_focus_terms(normalized_query: str) -> tuple[str, ...]:
    compact_query = _compact_text(normalized_query)
    focus_terms: list[str] = []
    for canonical_term, cues in _FOCUS_TERM_GROUPS:
        if any(_compact_text(cue) in compact_query for cue in cues):
            focus_terms.append(canonical_term)
    if any(_compact_text(cue) in compact_query for cue in _RANK_THRESHOLD_EXCEPTION_CUES):
        focus_terms.extend(term for term in ("前10", "前30") if term not in focus_terms)
    for match in _COHORT_YEAR_RE.finditer(normalized_query):
        year = match.group("year")
        term = f"{year}届"
        if term not in focus_terms:
            focus_terms.append(term)
        if any(cue in compact_query[match.end() :] for cue in _AFTER_COHORT_CUES):
            after_term = f"{year}届及以后"
            if after_term not in focus_terms:
                focus_terms.append(after_term)
    return tuple(focus_terms)


def _is_cohort_focus_term(focus_term: str) -> bool:
    return bool(re.fullmatch(r"20\d{2}届(?:及以后)?", focus_term))


def _cohort_focus_group(focus_term: str) -> tuple[str, ...]:
    year = focus_term[:4]
    if focus_term.endswith("及以后"):
        return (
            f"{year}届及以后",
            f"{year}届及其以后",
            f"{year}届以后",
            f"{year}届之后",
            f"{year}届起",
            year,
        )
    return (f"{year}届", year)


def _query_explicitly_mentions_threshold(query_text: str, threshold: str) -> bool:
    compact_query = _compact_text(query_text)
    if threshold == "前10":
        return "前10" in compact_query or "前十" in compact_query
    if threshold == "前30":
        return "前30" in compact_query or "前三十" in compact_query
    return threshold in compact_query


def _normalize_clause_number(raw_number: str) -> str:
    number = normalize_text(raw_number)
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


def _select_same_document_sources_covering_focus_groups(
    *,
    sources: Sequence[EvidenceSource],
    groups: tuple[tuple[str, ...], ...],
) -> tuple[EvidenceSource, ...]:
    grouped_sources: dict[str, list[EvidenceSource]] = {}
    for source in sources:
        if not source.doc_id:
            continue
        grouped_sources.setdefault(source.doc_id, []).append(source)
    for document_sources in grouped_sources.values():
        if _sources_cover_focus_groups(sources=document_sources, groups=groups):
            return tuple(document_sources)
    return ()


def _sources_cover_focus_groups(
    *,
    sources: Sequence[EvidenceSource],
    groups: tuple[tuple[str, ...], ...],
) -> bool:
    normalized_sources = tuple(
        (
            normalize_text(
                " ".join(
                    fragment
                    for fragment in (
                        source.source_title,
                        source.detail_label,
                        f"第{source.article_no}条" if source.article_no else "",
                        f"第{source.clause_no}款" if source.clause_no else "",
                        source.snippet,
                    )
                    if fragment
                )
            ),
            source.detail_label,
        )
        for source in sources
    )
    return all(
        any(
            _source_text_covers_focus_group(
                normalized_source=normalized_source,
                detail_label=detail_label,
                group=group,
            )
            for normalized_source, detail_label in normalized_sources
            if normalized_source
        )
        for group in groups
    )


def _source_text_covers_focus_group(
    *,
    normalized_source: str,
    detail_label: str,
    group: tuple[str, ...],
) -> bool:
    if any(normalize_text(term) in normalized_source for term in group):
        return True
    if (
        len(group) == 1
        and group[0].startswith("第")
        and group[0].endswith("条")
        and normalize_text(detail_label) == normalize_text(group[0])
    ):
        return True
    return (
        len(group) == 1
        and group[0].startswith("第")
        and group[0].endswith("款")
        and normalize_text(detail_label) == normalize_text(group[0])
    )


def _compact_text(text: str) -> str:
    normalized = normalize_text(text)
    return "".join(char for char in normalized if char.isalnum() or _is_cjk_char(char))


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )


__all__ = [
    "QueryFocus",
    "build_focus_groups",
    "extract_query_focus",
    "normalize_text",
    "query_has_focus_constraints",
    "select_sources_covering_query_focus",
    "source_covers_focus_groups",
    "source_covers_query_focus",
    "source_focus_match_score",
]
