from __future__ import annotations

import re

from .agent_official_web_reference_sentences import _first_matching_official_web_sentence
from .agent_official_web_terms import _OFFICIAL_WEB_SERVICE_TRIAD
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
        elif prestige:
            fragments.append("中央民族大学现为国家“双一流”建设高校")
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_school_overview_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    campus = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "三个校区" in sentence or ("海淀" in sentence and "丰台" in sentence),
    )
    discipline = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "12个学科门类" in sentence or "71个本科专业" in sentence,
    )
    if not discipline:
        discipline = _first_matching_official_web_sentence(
            sentences,
            lambda sentence: "多学科门类齐全" in sentence or "综合性大学" in sentence,
        )

    fragments: list[str] = []
    if campus:
        fragments.append(campus)
    if discipline:
        if "12个学科门类" in discipline and "71个本科专业" in discipline:
            fragments.append("学校现有覆盖12个学科门类的71个本科专业")
        else:
            fragments.append(discipline)
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_undergraduate_reference_fragments(
    sentences: tuple[str, ...],
) -> tuple[str, ...]:
    scale = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "本科专业" in sentence and "在招专业" in sentence,
    )
    excellence = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "强基计划" in sentence or "一流本科专业" in sentence,
    )
    fragments: list[str] = []
    if scale:
        fragments.append("学校现有本科专业71个，在招专业61个，涵盖11个学科门类")
    if excellence:
        fragments.append(excellence.replace("，覆盖了全校所有学院", ""))
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_postdoctoral_reference_fragments(
    sentences: tuple[str, ...],
) -> tuple[str, ...]:
    stations = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "6个博士后科研流动站" in sentence,
    )
    assessment = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "合格率均为100" in sentence or "优秀博士后流动站" in sentence,
    )
    fragments: list[str] = []
    if stations:
        fragments.append(
            "学校现有6个博士后科研流动站，覆盖民族学、社会学、中国少数民族语言文学、中国史、哲学、教育学"
        )
    if assessment:
        fragments.append("历次流动站评估合格率均为100％，其中民族学流动站获评“优秀博士后流动站”")
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_graduate_reference_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    discipline = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "12个学科门类" in sentence,
    )
    authorization = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "24个研究生招生培养单位" in sentence,
    )
    fragments: list[str] = []
    if discipline:
        fragments.append("学校研究生教育涵盖12个学科门类")
    if authorization:
        fragments.append(
            "现有24个研究生招生培养单位，10个博士一级学科授权点、4个博士专业学位授权类别、28个硕士一级学科授权点和26个硕士专业学位授权类别"
        )
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_alumni_reference_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    service = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: _OFFICIAL_WEB_SERVICE_TRIAD in sentence,
    )
    if not service:
        return ()
    return ("中央民族大学校友会简介以服务校友、服务母校、服务社会为主要方向",)


def _build_official_web_foundation_reference_fragments(
    sentences: tuple[str, ...],
) -> tuple[str, ...]:
    governance = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "理事长" in sentence and "秘书长" in sentence,
    )
    fragments: list[str] = []
    if governance:
        simplified = re.sub(r"（[^）]+）", "", governance)
        if not simplified.startswith("中央民族大学教育基金会"):
            simplified = f"中央民族大学教育基金会{simplified}"
        fragments.append(simplified)
    public_account = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "官方微信公众号" in sentence,
    )
    if public_account:
        value = public_account.split("：", 1)[-1].strip()
        if value:
            fragments.append(f"官方微信公众号为{value}")
    return tuple(fragment for fragment in fragments if fragment)


__all__ = [
    "_build_official_web_alumni_reference_fragments",
    "_build_official_web_foundation_reference_fragments",
    "_build_official_web_graduate_reference_fragments",
    "_build_official_web_postdoctoral_reference_fragments",
    "_build_official_web_school_overview_fragments",
    "_build_official_web_school_reference_fragments",
    "_build_official_web_undergraduate_reference_fragments",
    "_simplify_school_intro_sentence",
    "_simplify_school_origin_sentence",
]
