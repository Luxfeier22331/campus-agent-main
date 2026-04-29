from __future__ import annotations

from .agent_official_web_reference_sentences import _first_matching_official_web_sentence
from .agent_official_web_terms import _OFFICIAL_WEB_SLOGAN_HINTS
from .agent_shared import _normalize_snippet


def _simplify_official_web_news_sentence(sentence: str) -> str:
    normalized = _normalize_snippet(sentence)
    if "“统战新语”" in normalized and "专访" in normalized:
        normalized = normalized[normalized.find("“统战新语”") :]
        normalized = normalized.replace("就此专访", "专访")
    return normalized


def _summarize_official_web_news_title(title: str) -> str:
    normalized = _normalize_snippet(title)
    if not normalized:
        return ""
    if "专访" in normalized and "解读" in normalized and "强世功" in normalized:
        simplified = normalized.replace("校长", "")
        if "接受" in simplified and " 解读" in simplified:
            left, right = simplified.split(" 解读", 1)
            return f"{left}，解读{right}"
    return ""


def _build_official_web_news_fragments(
    sentences: tuple[str, ...],
    *,
    lead_title: str,
) -> tuple[str, ...]:
    interview = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "专访" in sentence and "强世功" in sentence,
    )
    thesis = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "国家意志" in sentence or "法治保障" in sentence,
    )
    fragments: list[str] = []
    if interview:
        fragments.append(_simplify_official_web_news_sentence(interview))
    if thesis:
        fragments.append(_simplify_official_web_news_sentence(thesis))
    law_anchor = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "民族团结进步促进法" in sentence,
    )
    if law_anchor and not any("民族团结进步促进法" in fragment for fragment in fragments):
        fragments.insert(0, _simplify_official_web_news_sentence(law_anchor))
    title_fragment = _summarize_official_web_news_title(lead_title)
    if title_fragment and (
        not any("民族团结进步促进法" in fragment for fragment in fragments)
        or not any("统战新语" in fragment and "强世功" in fragment for fragment in fragments)
    ):
        fragments.insert(0, title_fragment)
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_generic_fragments(
    sentences: tuple[str, ...],
) -> tuple[str, ...]:
    fragments: list[str] = []
    for sentence in sentences:
        if any(token in sentence for token in _OFFICIAL_WEB_SLOGAN_HINTS):
            continue
        fragments.append(sentence)
        if len(fragments) >= 2:
            break
    return tuple(fragments)


__all__ = [
    "_build_official_web_generic_fragments",
    "_build_official_web_news_fragments",
    "_simplify_official_web_news_sentence",
    "_summarize_official_web_news_title",
]
