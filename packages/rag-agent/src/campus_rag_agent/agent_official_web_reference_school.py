from __future__ import annotations

import re

from .agent_official_web_reference_sentences import _first_matching_official_web_sentence
from .agent_shared import _normalize_snippet


def _simplify_school_intro_sentence(sentence: str) -> str:
    if not sentence:
        return ""
    normalized = _normalize_snippet(sentence)
    if "中央民族大学" in normalized:
        normalized = normalized[normalized.find("中央民族大学") :]
    return normalized.replace("、促进中华民族大团结", "")


def _simplify_school_origin_sentence(sentence: str) -> str:
    if not sentence:
        return ""
    simplified = sentence.replace("学校前身是中国共产党", "前身是")
    simplified = simplified.replace("学校前身是", "前身是")
    return re.sub(
        r"前身是(\d{4})年\d{1,2}月在延安创办的延安民族学院",
        r"前身是\1年在延安创办的延安民族学院",
        simplified,
    )


def _build_official_web_school_reference_fragments(
    sentences: tuple[str, ...],
    *,
    prefer_prestige: bool = False,
) -> tuple[str, ...]:
    intro = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: (
            "中央民族大学" in sentence
            and any(token in sentence for token in ("中央民族大学是", "是一所", "高等院校"))
        ),
    )
    origin = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "前身" in sentence or "延安民族学院" in sentence,
    )
    prestige = _first_matching_official_web_sentence(
        sentences, lambda sentence: "双一流" in sentence
    )
    fragments: list[str] = []
    if prefer_prestige:
        if origin:
            fragments.append(_simplify_school_origin_sentence(origin))
        elif intro:
            fragments.append(_simplify_school_intro_sentence(intro))
        if prestige:
            fragments.append("中央民族大学现为国家“双一流”建设高校")
        elif intro and not fragments:
            fragments.append(_simplify_school_intro_sentence(intro))
    else:
        if intro:
            fragments.append(_simplify_school_intro_sentence(intro))
        if origin:
            fragments.append(_simplify_school_origin_sentence(origin))
        if prestige:
            fragments.append("中央民族大学现为国家“双一流”建设高校")
    return tuple(fragment for fragment in fragments if fragment)


__all__ = [
    "_build_official_web_school_reference_fragments",
    "_simplify_school_intro_sentence",
    "_simplify_school_origin_sentence",
]
