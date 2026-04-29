from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource

from .agent_official_web_reference_news import (
    _build_official_web_generic_fragments,
    _build_official_web_news_fragments,
)
from .agent_official_web_reference_people import (
    _build_official_web_roster_fragments,
    _build_official_web_scholar_reference_fragments,
)
from .agent_official_web_reference_school import (
    _build_official_web_alumni_reference_fragments,
    _build_official_web_foundation_reference_fragments,
    _build_official_web_graduate_reference_fragments,
    _build_official_web_postdoctoral_reference_fragments,
    _build_official_web_school_overview_fragments,
    _build_official_web_school_reference_fragments,
    _build_official_web_undergraduate_reference_fragments,
)
from .agent_official_web_reference_sentences import (
    _flatten_official_web_sentences,
)
from .agent_official_web_terms import (
    _OFFICIAL_WEB_NOTICE_LOCATION_HINTS,
    _OFFICIAL_WEB_NOTICE_TIME_HINTS,
    _OFFICIAL_WEB_NOTICE_TOPIC_HINTS,
    _looks_like_official_web_low_value_tail,
    _official_web_answer_mode,
)
from .agent_shared import _answer_prefix, _lead_source_title, _normalize_snippet


def _compose_official_web_reference_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    lead_title = _lead_source_title(tuple(source for source, _ in selected_rows))
    normalized_title = _normalize_snippet(lead_title)
    if normalized_title == "学术名流":
        fragments = _build_official_web_scholar_reference_fragments(selected_rows)
    else:
        sentences = _flatten_official_web_sentences(selected_rows, lead_title=lead_title)
        if not sentences:
            return ""
        if "学校简介" in normalized_title:
            fragments = _build_official_web_school_reference_fragments(sentences)
        elif "学校概况" in normalized_title:
            fragments = _build_official_web_school_overview_fragments(sentences)
        elif normalized_title == "本科培养":
            fragments = _build_official_web_undergraduate_reference_fragments(sentences)
        elif normalized_title == "博士后":
            fragments = _build_official_web_postdoctoral_reference_fragments(sentences)
        elif normalized_title == "研究生培养":
            fragments = _build_official_web_graduate_reference_fragments(sentences)
        elif "校友会" in normalized_title:
            fragments = _build_official_web_alumni_reference_fragments(sentences)
        elif "基金会" in normalized_title:
            fragments = _build_official_web_foundation_reference_fragments(sentences)
        else:
            fragments = _build_official_web_generic_fragments(sentences)

    if not fragments:
        return ""

    body = "；".join(fragments)
    return f"{_answer_prefix(evidence)}，{body}"


def _compose_official_web_roster_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    fragments = _build_official_web_roster_fragments(selected_rows)
    if not fragments:
        return ""
    body = "；".join(fragments)
    return f"{_answer_prefix(evidence)}，{body}"


def _compose_official_web_news_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    lead_title = _lead_source_title(tuple(source for source, _ in selected_rows))
    sentences = _flatten_official_web_sentences(selected_rows, lead_title=lead_title)
    fragments = _build_official_web_news_fragments(sentences, lead_title=lead_title)
    if not fragments:
        fragments = _build_official_web_generic_fragments(sentences)
    if not fragments:
        return ""
    body = "；".join(fragments)
    return f"{_answer_prefix(evidence)}，{body}"


def _extract_official_web_labeled_value(statement: str) -> str:
    normalized = _normalize_snippet(statement)
    if "：" in normalized:
        normalized = normalized.split("：", 1)[-1]
    normalized = re.sub(r"\b时间[:：]\s*", "", normalized)
    normalized = normalized.replace("——", "—")
    return _normalize_snippet(normalized)


def _compose_official_web_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    lead_source = selected_rows[0][0]
    mode = _official_web_answer_mode(query_text=evidence.query_text, source=lead_source)
    if mode == "roster":
        return _compose_official_web_roster_answer(evidence=evidence, selected_rows=selected_rows)
    if mode == "reference":
        return _compose_official_web_reference_answer(
            evidence=evidence, selected_rows=selected_rows
        )
    if mode == "news":
        return _compose_official_web_news_answer(evidence=evidence, selected_rows=selected_rows)
    if mode != "notice":
        return ""

    topic = ""
    time_statement = ""
    location_statement = ""
    extra_statements: list[str] = []
    for _, statements in selected_rows:
        for statement in statements:
            normalized = _normalize_snippet(statement)
            if not normalized or _looks_like_official_web_low_value_tail(normalized):
                continue
            if not time_statement and any(
                token in normalized for token in _OFFICIAL_WEB_NOTICE_TIME_HINTS
            ):
                time_statement = normalized
                continue
            if not location_statement and any(
                token in normalized for token in _OFFICIAL_WEB_NOTICE_LOCATION_HINTS
            ):
                location_statement = normalized
                continue
            if not topic and any(token in normalized for token in _OFFICIAL_WEB_NOTICE_TOPIC_HINTS):
                topic = _normalize_official_web_topic(normalized)
                continue
            if normalized not in extra_statements:
                extra_statements.append(normalized)

    fragments: list[str] = []
    if topic:
        fragments.append(f"讲座主题为{topic}")
    elif extra_statements:
        fragments.append(extra_statements[0])
    if time_statement:
        value = _extract_official_web_labeled_value(time_statement)
        fragments.append(f"讲座时间为{value}" if value else time_statement)
    else:
        fragments.append("当前片段未提供讲座时间")
    if location_statement:
        value = _extract_official_web_labeled_value(location_statement)
        fragments.append(f"讲座地点为{value}" if value else location_statement)

    body = "；".join(fragment for fragment in fragments if fragment)
    if not body:
        return ""
    return f"{_answer_prefix(evidence)}，{body}"


def _normalize_official_web_topic(statement: str) -> str:
    normalized = _normalize_snippet(statement)
    if normalized.startswith(("讲座主题：", "活动主题：", "主题：")):
        return normalized.split("：", 1)[-1].strip() or normalized
    return normalized
