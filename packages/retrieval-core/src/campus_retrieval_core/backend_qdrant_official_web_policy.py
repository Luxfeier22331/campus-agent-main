from __future__ import annotations

import re
from collections.abc import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import (
    CollectionRuntimeProfile,
    is_official_web_stable_reference_like_profile,
)

from campus_retrieval_core.evidence_ranking import query_targets_source_title

from .backend_qdrant_source_metadata import _coerce_dict, _coerce_structural_path

_OFFICIAL_WEB_GENERIC_QUERY_TERMS = frozenset(
    {
        "中央民族大学",
        "民大",
        "学校",
        "官网",
    }
)
_OFFICIAL_WEB_UNANCHORED_LIFE_SERVICE_TERMS = (
    "食堂营业时间",
    "图书馆开放时间",
    "图书馆讲座",
    "校医院",
    "宿舍",
    "教务处电话",
)
_OFFICIAL_WEB_SPECIFICITY_HINT_TERMS = (
    "通知",
    "公告",
    "讲座",
    "专访",
    "解读",
    "促进法",
    "基地",
    "就业",
    "实习",
    "活动",
    "学院",
    "部门",
    "联系方式",
)
_OFFICIAL_WEB_FRESHNESS_QUERY_TERMS = (
    "今天",
    "今日",
    "最新",
    "最近",
    "近期",
    "刚刚",
    "本周",
    "这周",
    "本月",
)
_OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS = (
    "简介",
    "概况",
    "领导",
    "校友会",
    "基金会",
    "干部人事",
    "本科培养",
    "研究生培养",
    "博士后",
    "访问学者",
    "学术名流",
)
_OFFICIAL_WEB_STRICT_TITLE_TARGET_QUERY_TERMS = (
    "讲座",
    "预告",
    "专访",
    "解读",
)
_OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS = (
    ("history", ("历史学会", "新史学", "历史学", "中国史", "清史", "辽史", "元史", "考古")),
    ("social", ("社会学", "民族学", "人类学")),
    ("language", ("语言学", "藏学", "藏文", "突厥语", "彝语", "羌语", "语言文字")),
    ("arts", ("音乐", "二胡", "民乐", "艺术")),
)
_OFFICIAL_WEB_CHUNK_ORDINAL_PATTERN = re.compile(r"chunk[-_:]?0*(\d+)\b", re.IGNORECASE)


def _apply_official_web_low_signal_policy(
    *,
    profile: CollectionRuntimeProfile,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    if not is_official_web_stable_reference_like_profile(profile):
        return tuple(sources)
    normalized_query = _normalize_low_signal_query(query_text)
    if not normalized_query or not sources:
        return tuple(sources)
    if (
        not profile.supports_freshness_sensitive_queries
        and _is_official_web_freshness_sensitive_query(normalized_query)
    ):
        return ()
    if normalized_query in _OFFICIAL_WEB_GENERIC_QUERY_TERMS:
        return ()
    if any(
        term in normalized_query for term in _OFFICIAL_WEB_UNANCHORED_LIFE_SERVICE_TERMS
    ) and not any(term in normalized_query for term in _OFFICIAL_WEB_SPECIFICITY_HINT_TERMS):
        return ()
    return tuple(sources)


def _apply_document_diversity_policy(
    *,
    profile: CollectionRuntimeProfile,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    if not is_official_web_stable_reference_like_profile(profile):
        return tuple(sources)
    title_targeting_sources = tuple(
        source
        for source in sources
        if query_targets_source_title(query_text=query_text, source=source)
    )
    normalized_query = _normalize_low_signal_query(query_text)
    if title_targeting_sources:
        if "学校概况" in normalized_query:
            school_overview_sources = _select_official_web_school_overview_support_sources(
                sources=title_targeting_sources,
            )
            if school_overview_sources:
                return school_overview_sources
        if "学术名流" in normalized_query:
            scholar_sources = _select_official_web_scholar_support_sources(
                sources=title_targeting_sources,
            )
            if scholar_sources:
                return scholar_sources
        representative_title_sources = _collapse_official_web_title_target_sources(
            query_text=query_text,
            sources=title_targeting_sources,
        )
        if any(term in normalized_query for term in _OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS):
            return representative_title_sources[:1]
        title_target_doc_ids = {source.doc_id for source in representative_title_sources}
        if any(term in normalized_query for term in _OFFICIAL_WEB_STRICT_TITLE_TARGET_QUERY_TERMS):
            sources = representative_title_sources
        else:
            sources = (
                *representative_title_sources,
                *(source for source in sources if source.doc_id not in title_target_doc_ids),
            )
    deduped_sources: list[EvidenceSource] = []
    seen_doc_ids: set[str] = set()
    for source in sources:
        if source.doc_id in seen_doc_ids:
            continue
        seen_doc_ids.add(source.doc_id)
        deduped_sources.append(source)
    return tuple(deduped_sources)


def _collapse_official_web_title_target_sources(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    grouped_sources: dict[str, list[EvidenceSource]] = {}
    for source in sources:
        grouped_sources.setdefault(source.doc_id, []).append(source)
    return tuple(
        _select_official_web_representative_source(
            query_text=query_text,
            sources=doc_sources,
        )
        for doc_sources in grouped_sources.values()
    )


def _select_official_web_school_overview_support_sources(
    *,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    grouped_sources: dict[str, list[EvidenceSource]] = {}
    for source in sources:
        grouped_sources.setdefault(source.doc_id, []).append(source)
    selected_sources: list[EvidenceSource] = []
    for doc_sources in grouped_sources.values():
        campus_source = _select_official_web_school_overview_campus_source(doc_sources)
        discipline_source = _select_official_web_school_overview_discipline_source(doc_sources)
        if campus_source is not None:
            selected_sources.append(campus_source)
        if discipline_source is not None and all(
            discipline_source.chunk_id != existing.chunk_id for existing in selected_sources
        ):
            selected_sources.append(discipline_source)
    return tuple(selected_sources)


def _select_official_web_school_overview_campus_source(
    sources: Sequence[EvidenceSource],
) -> EvidenceSource | None:
    campus_sources = [
        source
        for source in sources
        if any(
            term in _normalize_low_signal_query(source.snippet)
            for term in ("三个校区", "海淀", "丰台")
        )
    ]
    if not campus_sources:
        return None
    return max(campus_sources, key=lambda source: source.score)


def _select_official_web_school_overview_discipline_source(
    sources: Sequence[EvidenceSource],
) -> EvidenceSource | None:
    discipline_sources = [
        source
        for source in sources
        if any(
            term in _normalize_low_signal_query(source.snippet)
            for term in ("12个学科门类", "71个本科专业")
        )
    ]
    if not discipline_sources:
        return None
    return max(
        discipline_sources,
        key=lambda source: (
            _official_web_source_chunk_ordinal(source) or 0,
            source.score,
        ),
    )


def _select_official_web_scholar_support_sources(
    *,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    grouped_sources: dict[str, list[EvidenceSource]] = {}
    for source in sources:
        grouped_sources.setdefault(source.doc_id, []).append(source)

    selected_sources: list[EvidenceSource] = []
    for doc_sources in grouped_sources.values():
        ranked_sources = sorted(
            doc_sources,
            key=_official_web_scholar_support_sort_key,
            reverse=True,
        )
        doc_selected: list[EvidenceSource] = []
        used_people: set[str] = set()
        used_domains: set[str] = set()
        for source in ranked_sources:
            person = _official_web_scholar_person_label(source)
            source_domains = _official_web_scholar_source_domains(source)
            if person and person in used_people:
                continue
            if doc_selected and source_domains and source_domains.issubset(used_domains):
                continue
            doc_selected.append(source)
            if person:
                used_people.add(person)
            used_domains.update(source_domains)
            if len(doc_selected) >= 3:
                break
        if len(doc_selected) < 3:
            for source in ranked_sources:
                if any(existing.chunk_id == source.chunk_id for existing in doc_selected):
                    continue
                doc_selected.append(source)
                if len(doc_selected) >= 3:
                    break
        selected_sources.extend(doc_selected[:3])
    return tuple(selected_sources)


def _official_web_scholar_support_sort_key(source: EvidenceSource) -> tuple[int, int, int, float]:
    domains = _official_web_scholar_source_domains(source)
    normalized_snippet = _normalize_low_signal_query(source.snippet)
    contribution_bonus = 0
    if any(
        term in normalized_snippet
        for term in ("贡献", "创始", "首创", "培养", "代表著作", "主要著作", "研究")
    ):
        contribution_bonus += 1
    chunk_ordinal = _official_web_source_chunk_ordinal(source)
    lead_bonus = 100 - min(chunk_ordinal, 100) if chunk_ordinal is not None else 0
    return (
        len(domains),
        contribution_bonus,
        lead_bonus,
        source.score,
    )


def _official_web_scholar_person_label(source: EvidenceSource) -> str:
    anchor = _coerce_dict(source.anchor)
    section_path = _coerce_structural_path(anchor.get("section_path"))
    title = source.source_title.strip()
    if section_path:
        candidate = section_path[-1].strip()
        if candidate and candidate != title:
            return candidate
    for item in reversed(source.structural_path):
        candidate = item.strip()
        if candidate and candidate != title:
            return candidate
    return ""


def _official_web_scholar_source_domains(source: EvidenceSource) -> set[str]:
    normalized_snippet = _normalize_low_signal_query(source.snippet)
    return {
        label
        for label, hints in _OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS
        if any(hint in normalized_snippet for hint in hints)
    }


def _select_official_web_representative_source(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> EvidenceSource:
    if not sources:
        raise ValueError("sources must not be empty")
    return max(
        sources,
        key=lambda source: _official_web_representative_source_sort_key(
            query_text=query_text,
            source=source,
        ),
    )


def _official_web_representative_source_sort_key(
    *,
    query_text: str,
    source: EvidenceSource,
) -> tuple[int, int, int, int, float]:
    normalized_query = _normalize_low_signal_query(query_text)
    normalized_snippet = _normalize_low_signal_query(source.snippet)
    notice_bonus = 0
    fact_bonus = 0
    intro_bonus = 0
    if any(term in normalized_query for term in _OFFICIAL_WEB_STRICT_TITLE_TARGET_QUERY_TERMS):
        if any(
            term in normalized_snippet
            for term in ("讲座时间", "时间：", "讲座地点", "地点：", "讲座主题", "主题：")
        ):
            notice_bonus += 40
        if any(
            term in normalized_snippet
            for term in ("二维码", "扫码", "扫描", "预约", "报名", "图书馆积分")
        ):
            notice_bonus -= 40
    if "学校概况" in normalized_query:
        if any(term in normalized_snippet for term in ("12个学科门类", "71个本科专业")):
            fact_bonus += 300
        if any(term in normalized_snippet for term in ("三个校区", "海淀", "丰台")):
            fact_bonus += 120
    if "本科培养" in normalized_query:
        if any(
            term in normalized_snippet for term in ("本科专业71个", "在招专业61个", "11个学科门类")
        ):
            fact_bonus += 260
        if any(term in normalized_snippet for term in ("强基计划", "一流本科专业")):
            fact_bonus += 180
    if "博士后" in normalized_query:
        if "博士后科研流动站" in normalized_snippet:
            fact_bonus += 320
        if any(term in normalized_snippet for term in ("合格率均为100", "优秀博士后流动站")):
            fact_bonus += 200
        if "双一流" in normalized_snippet:
            fact_bonus -= 140
    if "研究生培养" in normalized_query:
        if "12个学科门类" in normalized_snippet:
            fact_bonus += 280
        if any(
            term in normalized_snippet
            for term in ("24个研究生招生培养单位", "博士一级学科授权点", "硕士一级学科授权点")
        ):
            fact_bonus += 180
    if any(term in normalized_query for term in _OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS):
        if any(
            term in source.snippet for term in ("是一所", "是党和国家", "创建的一所", "特色鲜明")
        ):
            intro_bonus += 30
        if re.search(r"20\d{2}年", source.snippet) and any(
            term in source.snippet for term in ("入选", "大事记")
        ):
            intro_bonus -= 20
    chunk_ordinal = _official_web_source_chunk_ordinal(source)
    lead_bonus = 200 - min(chunk_ordinal, 200) if chunk_ordinal is not None else 0
    return (
        notice_bonus,
        fact_bonus,
        lead_bonus,
        intro_bonus,
        1 if source.is_answer_bearing else 0,
        source.score,
    )


def _official_web_source_chunk_ordinal(source: EvidenceSource) -> int | None:
    anchor = source.anchor if isinstance(source.anchor, dict) else {}
    for key in ("segment_index", "segment_ord", "segmentOrdinal"):
        value = anchor.get(key)
        if isinstance(value, int) and value > 0:
            return value
        if isinstance(value, str) and value.isdigit() and int(value) > 0:
            return int(value)
    match = _OFFICIAL_WEB_CHUNK_ORDINAL_PATTERN.search(source.chunk_id)
    if match is None:
        return None
    ordinal = int(match.group(1))
    return ordinal if ordinal > 0 else None


def _normalize_low_signal_query(query_text: str) -> str:
    return "".join(character for character in query_text.strip() if not character.isspace())


def _is_official_web_freshness_sensitive_query(query_text: str) -> bool:
    normalized_query = _normalize_low_signal_query(query_text)
    return any(term in normalized_query for term in _OFFICIAL_WEB_FRESHNESS_QUERY_TERMS)
