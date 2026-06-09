from __future__ import annotations

import re

from campus_contracts import EvidenceSource

from .answer_shared import _normalize_snippet
from .official_web_terms import (
    _OFFICIAL_WEB_DISCLAIMER_HINTS,
    _looks_like_official_web_low_value_tail,
)


def _split_official_web_sentences(text: str) -> tuple[str, ...]:
    normalized = _normalize_snippet(text)
    if not normalized:
        return ()
    sentences: list[str] = []
    for raw_line in re.split(r"[\r\n]+", normalized):
        line = _normalize_snippet(raw_line).strip("；;")
        if not line:
            continue
        parts = re.split(r"[。！？?!]", line)
        if len(parts) == 1:
            parts = [line]
        for part in parts:
            sentence = _normalize_snippet(part).strip("；;，, ")
            if sentence:
                sentences.append(sentence)
    return tuple(sentences)


def _looks_like_official_web_heading(sentence: str) -> bool:
    normalized = _normalize_snippet(sentence)
    if len(normalized) > 18:
        return False
    if any(
        token in normalized
        for token in (
            "中央民族大学",
            "现任",
            "服务",
            "电话",
            "公众号",
            "基金会",
            "校友会",
            "双一流",
            "民族团结进步促进法",
            "统战新语",
            "强世功",
            "查显友",
        )
    ):
        return False
    return "：" not in normalized and "，" not in normalized and "、" not in normalized


def _looks_like_official_web_prompt_sentence(sentence: str) -> bool:
    normalized = _normalize_snippet(sentence)
    return any(token in normalized for token in ("承载着怎样", "将如何", "何以", "为何"))


def _flatten_official_web_sentences(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    *,
    lead_title: str,
) -> tuple[str, ...]:
    normalized_title = _normalize_snippet(lead_title)
    ignored = {normalized_title}
    if normalized_title:
        ignored.add(f"中央民族大学{normalized_title}")
    flattened: list[str] = []
    seen: set[str] = set()
    for _, statements in selected_rows:
        for statement in statements:
            for sentence in _split_official_web_sentences(statement):
                normalized = _normalize_snippet(sentence)
                if (
                    not normalized
                    or normalized in ignored
                    or _looks_like_official_web_low_value_tail(normalized)
                    or _looks_like_official_web_prompt_sentence(normalized)
                    or _looks_like_official_web_heading(normalized)
                    or any(token in normalized for token in _OFFICIAL_WEB_DISCLAIMER_HINTS)
                ):
                    continue
                key = normalized.lower()
                if key in seen:
                    continue
                seen.add(key)
                flattened.append(normalized)
    return tuple(flattened)


def _first_matching_official_web_sentence(
    sentences: tuple[str, ...],
    predicate,
) -> str:
    for sentence in sentences:
        if predicate(sentence):
            return sentence
    return ""


__all__ = [
    "_first_matching_official_web_sentence",
    "_flatten_official_web_sentences",
    "_looks_like_official_web_heading",
    "_looks_like_official_web_prompt_sentence",
    "_split_official_web_sentences",
]
