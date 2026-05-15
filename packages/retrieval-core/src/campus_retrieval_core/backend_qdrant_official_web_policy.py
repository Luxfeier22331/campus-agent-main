from __future__ import annotations

import re
from collections.abc import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import (
    CollectionRuntimeProfile,
    is_official_web_stable_reference_like_profile,
)

from campus_retrieval_core.evidence_ranking import query_targets_source_title

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
_OFFICIAL_WEB_UNANCHORED_STABLE_REFERENCE_SERVICE_TERMS = (
    "办理",
    "办理处",
    "办公室",
    "服务",
    "规章",
    "规则",
    "电话",
    "校区",
    "学院",
    "实验室",
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
    "教学和科研单位",
    "收费公示",
    "收费",
    "学费",
    "住宿费",
)
_OFFICIAL_WEB_STRICT_TITLE_TARGET_QUERY_TERMS = (
    "讲座",
    "预告",
    "专访",
    "解读",
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
    if _is_unanchored_stable_reference_service_query(
        normalized_query=normalized_query,
        query_text=query_text,
        sources=sources,
    ):
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
        keep_directory_reference_entries = _should_keep_official_web_directory_reference_entries(
            normalized_query=normalized_query,
            sources=title_targeting_sources,
        )
        if keep_directory_reference_entries:
            representative_title_sources = tuple(title_targeting_sources)
        else:
            representative_title_sources = _collapse_official_web_title_target_sources(
                query_text=query_text,
                sources=title_targeting_sources,
            )
        if (
            not keep_directory_reference_entries
            and any(term in normalized_query for term in _OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS)
        ):
            return representative_title_sources[:1]
        title_target_doc_ids = {source.doc_id for source in representative_title_sources}
        if any(term in normalized_query for term in _OFFICIAL_WEB_STRICT_TITLE_TARGET_QUERY_TERMS):
            sources = representative_title_sources
        else:
            sources = (
                *representative_title_sources,
                *(source for source in sources if source.doc_id not in title_target_doc_ids),
            )
    else:
        keep_directory_reference_entries = False
    deduped_sources: list[EvidenceSource] = []
    seen_source_keys: set[tuple[str, str]] = set()
    for source in sources:
        source_key = _official_web_document_diversity_key(
            keep_directory_reference_entries=keep_directory_reference_entries,
            source=source,
        )
        if source_key in seen_source_keys:
            continue
        seen_source_keys.add(source_key)
        deduped_sources.append(source)
    return tuple(deduped_sources)


def _official_web_document_diversity_key(
    *,
    keep_directory_reference_entries: bool,
    source: EvidenceSource,
) -> tuple[str, str]:
    if (
        keep_directory_reference_entries
        and source.content_role == "directory_reference"
        and source.content_kind == "directory_entry"
    ):
        return (source.doc_id, source.chunk_id)
    return (source.doc_id, "")


def _should_keep_official_web_directory_reference_entries(
    *,
    normalized_query: str,
    sources: Sequence[EvidenceSource],
) -> bool:
    if "哪些" not in normalized_query and "有哪些" not in normalized_query:
        return False
    return any(
        source.content_role == "directory_reference"
        and source.content_kind == "directory_entry"
        for source in sources
    )


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
    if "教学和科研单位" in normalized_query:
        if any(term in normalized_snippet for term in ("学院", "学部", "研究院")):
            fact_bonus += 220
    if "收费" in normalized_query or "学费" in normalized_query:
        if any(term in normalized_snippet for term in ("收费", "学费", "住宿费", "公示")):
            fact_bonus += 220
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


def _is_unanchored_stable_reference_service_query(
    *,
    normalized_query: str,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> bool:
    if any(term in normalized_query for term in _OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS):
        return False
    if any(term in normalized_query for term in _OFFICIAL_WEB_SPECIFICITY_HINT_TERMS):
        return False
    if any(query_targets_source_title(query_text=query_text, source=source) for source in sources):
        return False
    return any(
        term in normalized_query for term in _OFFICIAL_WEB_UNANCHORED_STABLE_REFERENCE_SERVICE_TERMS
    )


def _is_official_web_freshness_sensitive_query(query_text: str) -> bool:
    normalized_query = _normalize_low_signal_query(query_text)
    return any(term in normalized_query for term in _OFFICIAL_WEB_FRESHNESS_QUERY_TERMS)
