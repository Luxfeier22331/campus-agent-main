from __future__ import annotations

import re

from campus_contracts import EvidenceSource

from .agent_official_web_terms import (
    _OFFICIAL_WEB_DISCLAIMER_HINTS,
    _OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS,
    _OFFICIAL_WEB_SERVICE_TRIAD,
    _OFFICIAL_WEB_SLOGAN_HINTS,
    _looks_like_official_web_low_value_tail,
)
from .agent_shared import _normalize_snippet


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


def _simplify_school_intro_sentence(sentence: str) -> str:
    if not sentence:
        return ""
    simplified = sentence.replace("中央民族大学是党和国家为", "中央民族大学是一所为")
    simplified = simplified.replace("、促进中华民族大团结", "")
    return simplified.replace("的一所特色鲜明的高等院校", "创建的特色鲜明高等院校")


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


def _build_official_web_school_reference_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    intro = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "中央民族大学" in sentence and "是一所" in sentence,
    )
    origin = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "前身" in sentence or "延安民族学院" in sentence,
    )
    prestige = _first_matching_official_web_sentence(
        sentences, lambda sentence: "双一流" in sentence
    )
    fragments: list[str] = []
    if intro:
        fragments.append(_simplify_school_intro_sentence(intro))
    if origin:
        fragments.append(_simplify_school_origin_sentence(origin))
    if prestige:
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


def _official_web_section_path(source: EvidenceSource) -> tuple[str, ...]:
    raw_section_path = (
        source.anchor.get("section_path") if isinstance(source.anchor, dict) else None
    )
    if not isinstance(raw_section_path, (list, tuple)):
        return ()
    return tuple(
        _normalize_snippet(str(item)) for item in raw_section_path if _normalize_snippet(str(item))
    )


def _extract_official_web_scholar_name(
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> str:
    title = _normalize_snippet(source.source_title)
    section_path = _official_web_section_path(source)
    if section_path:
        leaf = section_path[-1]
        if leaf and leaf != title:
            return leaf
    for item in reversed(source.structural_path):
        candidate = _normalize_snippet(item)
        if candidate and candidate != title:
            return candidate
    for statement in statements:
        name = _extract_leading_person_name(statement)
        if name:
            return name
    return ""


def _extract_official_web_scholar_domains(statements: tuple[str, ...]) -> tuple[str, ...]:
    combined = _normalize_snippet(" ".join(statements))
    if not combined:
        return ()
    domains: list[str] = []
    for label, tokens in _OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS:
        if any(token in combined for token in tokens):
            domains.append(label)
    return tuple(domains)


def _build_official_web_scholar_reference_fragments(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    names: list[str] = []
    domains: list[str] = []
    for source, statements in selected_rows:
        name = _extract_official_web_scholar_name(source, statements)
        if name and name not in names:
            names.append(name)
        for domain in _extract_official_web_scholar_domains(statements):
            if domain not in domains:
                domains.append(domain)

    fragments: list[str] = []
    if names:
        fragments.append(f"“学术名流”页列有{'、'.join(names[:3])}等代表学者")
    if domains:
        fragments.append(f"涵盖{'、'.join(domains[:3])}等方向")
    return tuple(fragment for fragment in fragments if fragment)


def _extract_leading_person_name(text: str) -> str:
    candidate = _normalize_snippet(text)
    candidate = candidate.split("，", 1)[0]
    candidate = candidate.split("。", 1)[0]
    candidate = candidate.split("/", 1)[-1].strip()
    match = re.match(r"(?P<name>[\u4e00-\u9fff·]{2,4})(?:\s+(?P=name))?$", candidate)
    return match.group("name") if match else ""


def _simplify_official_web_school_role(role_text: str) -> str:
    normalized = _normalize_snippet(role_text)
    if "中央民族大学" in normalized:
        normalized = normalized[normalized.rfind("中央民族大学") + len("中央民族大学") :]
    return normalized.strip("，,、 ")


def _extract_official_web_roster_entry(statement: str) -> str:
    normalized = _normalize_snippet(statement)
    if "现任" not in normalized:
        return ""
    leading_sentence = normalized.split("。", 1)[0]
    name = _extract_leading_person_name(leading_sentence)
    role_text = _simplify_official_web_school_role(
        normalized.split("现任", 1)[-1].split("。", 1)[0].strip()
    )
    if not name or not role_text:
        return ""
    return f"{role_text}{name}"


def _build_official_web_roster_fragments(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    entries: list[str] = []
    for _, statements in selected_rows:
        for statement in statements:
            entry = _extract_official_web_roster_entry(statement)
            if not entry or entry in entries:
                continue
            entries.append(entry)
            if len(entries) >= 3:
                break
        if len(entries) >= 3:
            break
    if not entries:
        return ()
    return (f"现任领导包括{'、'.join(entries)}",)


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
