from __future__ import annotations

import re

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection
from campus_retrieval_core.evidence_ranking import query_targets_source_title

from .answer_shared import _normalize_snippet

_OFFICIAL_WEB_NOTICE_QUERY_HINTS = ("讲座", "预告", "通知", "公告", "活动")
_OFFICIAL_WEB_NOTICE_TIME_HINTS = ("讲座时间", "活动时间", "时间：")
_OFFICIAL_WEB_NOTICE_LOCATION_HINTS = ("讲座地点", "活动地点", "地点：")
_OFFICIAL_WEB_NOTICE_TOPIC_HINTS = ("讲座主题", "活动主题", "主题：", "聚焦", "围绕", "介绍")
_OFFICIAL_WEB_REFERENCE_QUERY_HINTS = ("简介", "概况", "介绍")
_OFFICIAL_WEB_ROSTER_QUERY_HINTS = ("现任领导", "领导班子")
_OFFICIAL_WEB_NEWS_QUERY_HINTS = ("解读", "专访")
_OFFICIAL_WEB_FEE_REFERENCE_QUERY_HINTS = (
    "收费公示",
    "教育收费",
    "收费",
    "学费",
    "住宿费",
)
_OFFICIAL_WEB_FEE_FACT_HINTS = (
    "学费",
    "住宿费",
    "元/生",
    "元／生",
    "生.学年",
    "生/学年",
)
_OFFICIAL_WEB_METADATA_LINE_PREFIXES = ("标题：", "章节：")
_OFFICIAL_WEB_DISCLAIMER_HINTS = ("Copyright@", "新闻网版权与免责声明", "投稿方式：", "版权均属于")
_OFFICIAL_WEB_SLOGAN_HINTS = ("高举习近平新时代中国特色社会主义思想", "阔步前行")
_OFFICIAL_WEB_SERVICE_TRIAD = "服务校友、服务母校、服务社会"
_OFFICIAL_WEB_IGNORED_CONTENT_ROLES = frozenset(
    {"source_attribution", "boilerplate", "media_caption"}
)
_OFFICIAL_WEB_REFERENCE_PAGE_TITLES = frozenset(
    {
        "学校简介",
        "教学和科研单位",
        "中央民族大学大学教育收费公示表",
    }
)


def _is_official_web_source(source: EvidenceSource) -> bool:
    return (
        source.source_channel == "official_web"
        and is_official_web_stable_reference_like_collection(source.collection)
    )


def _normalize_official_web_statement_line(*, line: str, title: str) -> str:
    normalized = _normalize_snippet(line)
    if not normalized:
        return ""
    if normalized.startswith(_OFFICIAL_WEB_METADATA_LINE_PREFIXES):
        return ""
    if _looks_like_official_web_low_value_tail(normalized):
        return ""
    if title and normalized.startswith(title):
        return _salvage_official_web_title_tail(normalized, title=title)
    return normalized


def _salvage_official_web_title_tail(line: str, *, title: str) -> str:
    segments = [
        _normalize_snippet(segment).strip(" /|｜")
        for segment in re.split(r"\s*[|｜/／]\s*", line)
        if _normalize_snippet(segment).strip(" /|｜")
    ]
    meaningful_segments = [
        segment
        for segment in segments
        if segment != title
        and segment not in {f"标题：{title}", f"章节：{title}"}
        and not segment.startswith("章节：")
    ]
    if meaningful_segments:
        return meaningful_segments[-1]
    suffix = line[len(title) :].strip(" /|｜:：-")
    if suffix and not _looks_like_official_web_low_value_tail(suffix):
        return suffix
    return ""


def _looks_like_official_web_low_value_tail(text: str) -> bool:
    normalized = _normalize_snippet(text)
    if not normalized:
        return False
    if any(token in normalized for token in ("二维码", "图书馆积分")):
        return True
    return normalized.startswith("请") and any(
        token in normalized for token in ("扫描", "扫码", "预约", "报名")
    )


def _score_official_web_statement(
    *,
    query_text: str,
    source: EvidenceSource,
    statement: str,
) -> int:
    normalized_query = _normalize_snippet(query_text)
    normalized_statement = _normalize_snippet(statement)
    score = 0
    if _is_official_web_notice_query(query_text=query_text, source=source):
        if any(token in normalized_statement for token in _OFFICIAL_WEB_NOTICE_TIME_HINTS):
            score += 8
        if any(token in normalized_statement for token in _OFFICIAL_WEB_NOTICE_LOCATION_HINTS):
            score += 7
        if any(token in normalized_statement for token in _OFFICIAL_WEB_NOTICE_TOPIC_HINTS):
            score += 5
        if _looks_like_official_web_low_value_tail(normalized_statement):
            score -= 12
    if any(term in normalized_query for term in ("简介", "概况", "介绍")):
        if any(
            token in normalized_statement
            for token in ("是一所", "是党和国家", "创建的一所", "特色鲜明")
        ):
            score += 8
        if re.search(r"20\d{2}年", normalized_statement) and any(
            token in normalized_statement for token in ("入选", "大事记")
        ):
            score -= 6
    if _is_official_web_fee_reference_query(query_text=query_text, source=source):
        if _looks_like_official_web_fee_table_header(normalized_statement):
            score -= 10
        if any(token in normalized_statement for token in _OFFICIAL_WEB_FEE_FACT_HINTS):
            score += 10
        if "批准收费的机关及文号" in normalized_statement:
            score -= 4
    return score


def _is_official_web_fee_reference_query(*, query_text: str, source: EvidenceSource) -> bool:
    normalized_query = _normalize_snippet(query_text)
    normalized_title = _normalize_snippet(source.source_title)
    return any(
        token in normalized_query or token in normalized_title
        for token in _OFFICIAL_WEB_FEE_REFERENCE_QUERY_HINTS
    )


def _looks_like_official_web_fee_table_header(statement: str) -> bool:
    normalized = _normalize_snippet(statement)
    return all(token in normalized for token in ("收费项目", "计费单位", "收费标准"))


def _is_official_web_notice_query(*, query_text: str, source: EvidenceSource) -> bool:
    normalized_query = _normalize_snippet(query_text)
    normalized_title = _normalize_snippet(source.source_title)
    return any(
        token in normalized_query or token in normalized_title
        for token in _OFFICIAL_WEB_NOTICE_QUERY_HINTS
    )


def _is_official_web_reference_query(*, query_text: str, source: EvidenceSource) -> bool:
    normalized_query = _normalize_snippet(query_text)
    normalized_title = _normalize_snippet(source.source_title)
    if any(
        token in normalized_query or token in normalized_title
        for token in _OFFICIAL_WEB_REFERENCE_QUERY_HINTS
    ):
        return True
    return normalized_title in _OFFICIAL_WEB_REFERENCE_PAGE_TITLES and query_targets_source_title(
        query_text=query_text,
        source=source,
    )


def _official_web_answer_mode(*, query_text: str, source: EvidenceSource) -> str:
    normalized_query = _normalize_snippet(query_text)
    normalized_title = _normalize_snippet(source.source_title)
    if _is_official_web_notice_query(query_text=query_text, source=source):
        return "notice"
    if any(
        token in normalized_query or token in normalized_title
        for token in _OFFICIAL_WEB_ROSTER_QUERY_HINTS
    ):
        return "roster"
    if _is_official_web_reference_query(query_text=query_text, source=source):
        return "reference"
    if any(
        token in normalized_query or token in normalized_title
        for token in _OFFICIAL_WEB_NEWS_QUERY_HINTS
    ):
        return "news"
    return "generic"
