from __future__ import annotations

from dataclasses import dataclass

from .answer_shared import _normalize_snippet


@dataclass(frozen=True, slots=True)
class SummaryQueryFacet:
    label: str
    terms: tuple[str, ...]
    preferred_terms: tuple[str, ...] = ()


_GENERAL_SUMMARY_FACETS: tuple[SummaryQueryFacet, ...] = (
    SummaryQueryFacet(
        label="学籍",
        terms=("学籍", "学生身份", "在校身份", "正式学籍"),
        preferred_terms=("仍属于", "属于", "保留", "保持"),
    ),
    SummaryQueryFacet(
        label="成绩",
        terms=("成绩", "成绩单", "成绩认定", "百分制", "绩点"),
        preferred_terms=("成绩认定", "成绩单", "百分制", "绩点"),
    ),
    SummaryQueryFacet(
        label="学分",
        terms=("学分", "学分转换", "转换和承认"),
        preferred_terms=("学分", "转换", "承认"),
    ),
    SummaryQueryFacet(
        label="课程",
        terms=("课程", "修读课程", "所修课程"),
        preferred_terms=("课程", "修读", "所修"),
    ),
    SummaryQueryFacet(
        label="材料",
        terms=("材料", "证明材料", "申请材料"),
        preferred_terms=("材料", "证明", "申请表"),
    ),
    SummaryQueryFacet(
        label="时间",
        terms=("时间", "期限", "截止", "多久", "何时"),
        preferred_terms=("期限", "截止", "期满", "日内", "个月"),
    ),
)

_OFF_NOMINAL_CONTEXT_CUES = (
    "触犯",
    "违反",
    "违规",
    "违纪",
    "校纪",
    "法律法规",
    "处分",
    "处罚",
)
_OFF_NOMINAL_QUERY_CUES = (
    "触犯",
    "违反",
    "违规",
    "违纪",
    "校纪",
    "法律法规",
    "处分",
    "处罚",
    "责任",
    "处理",
)


def general_summary_query_facets(query_text: str) -> tuple[SummaryQueryFacet, ...]:
    normalized = _normalize_snippet(query_text)
    if not normalized:
        return ()
    return tuple(
        facet
        for facet in _GENERAL_SUMMARY_FACETS
        if any(term in normalized for term in facet.terms)
    )


def general_summary_text_facet_indexes(
    text: str,
    facets: tuple[SummaryQueryFacet, ...],
) -> frozenset[int]:
    normalized = _normalize_snippet(text)
    if not normalized:
        return frozenset()
    return frozenset(
        index
        for index, facet in enumerate(facets)
        if any(term in normalized for term in facet.terms)
    )


def general_summary_preferred_term_score(
    text: str,
    facets: tuple[SummaryQueryFacet, ...],
) -> int:
    normalized = _normalize_snippet(text)
    if not normalized:
        return 0
    return sum(
        4 for facet in facets for term in facet.preferred_terms if term and term in normalized
    )


def order_general_summary_fragments_by_query_facets(
    *,
    query_text: str,
    fragments: tuple[str, ...],
) -> tuple[str, ...]:
    facets = general_summary_query_facets(query_text)
    if not facets or not fragments:
        return fragments
    remaining = list(fragments)
    ordered: list[str] = []
    for facet_index in range(len(facets)):
        match_index = next(
            (
                index
                for index, fragment in enumerate(remaining)
                if facet_index in general_summary_text_facet_indexes(fragment, facets)
            ),
            None,
        )
        if match_index is None:
            continue
        ordered.append(remaining.pop(match_index))
    ordered.extend(remaining)
    return tuple(ordered)


def general_summary_off_nominal_penalty(*, query_text: str, text: str) -> int:
    normalized_text = _normalize_snippet(text)
    if not normalized_text:
        return 0
    has_off_nominal_context = any(cue in normalized_text for cue in _OFF_NOMINAL_CONTEXT_CUES)
    has_generic_behavior_context = (
        "维护国家利益" in normalized_text or "学校声誉" in normalized_text
    )
    if not has_off_nominal_context and not has_generic_behavior_context:
        return 0
    normalized_query = _normalize_snippet(query_text)
    if has_off_nominal_context and any(cue in normalized_query for cue in _OFF_NOMINAL_QUERY_CUES):
        return 0
    return -18


def general_summary_is_off_nominal(*, query_text: str, text: str) -> bool:
    return general_summary_off_nominal_penalty(query_text=query_text, text=text) < 0


__all__ = [
    "SummaryQueryFacet",
    "general_summary_is_off_nominal",
    "general_summary_off_nominal_penalty",
    "general_summary_preferred_term_score",
    "general_summary_query_facets",
    "general_summary_text_facet_indexes",
    "order_general_summary_fragments_by_query_facets",
]
