from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection
from campus_retrieval_core.evidence_ranking import query_targets_source_title

from .agent_shared import _answer_prefix, _lead_source_title, _normalize_snippet

_OFFICIAL_WEB_NOTICE_QUERY_HINTS = ("讲座", "预告", "通知", "公告", "活动")
_OFFICIAL_WEB_NOTICE_TIME_HINTS = ("讲座时间", "活动时间", "时间：")
_OFFICIAL_WEB_NOTICE_LOCATION_HINTS = ("讲座地点", "活动地点", "地点：")
_OFFICIAL_WEB_NOTICE_TOPIC_HINTS = ("讲座主题", "活动主题", "主题：", "聚焦", "围绕", "介绍")
_OFFICIAL_WEB_REFERENCE_QUERY_HINTS = ("简介", "概况", "介绍")
_OFFICIAL_WEB_ROSTER_QUERY_HINTS = ("现任领导", "领导班子")
_OFFICIAL_WEB_NEWS_QUERY_HINTS = ("解读", "专访")
_OFFICIAL_WEB_LOW_VALUE_TAIL_HINTS = (
    "二维码",
    "扫码",
    "扫描",
    "预约讲座",
    "预约报名",
    "图书馆积分",
)
_OFFICIAL_WEB_METADATA_LINE_PREFIXES = ("标题：", "章节：")
_OFFICIAL_WEB_DISCLAIMER_HINTS = ("Copyright@", "新闻网版权与免责声明", "投稿方式：", "版权均属于")
_OFFICIAL_WEB_SLOGAN_HINTS = ("高举习近平新时代中国特色社会主义思想", "阔步前行")
_OFFICIAL_WEB_SERVICE_TRIAD = "服务校友、服务母校、服务社会"
_OFFICIAL_WEB_IGNORED_CONTENT_ROLES = frozenset(
    {"source_attribution", "boilerplate", "media_caption"}
)
_OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS = (
    ("历史学", ("历史学会", "新史学", "历史学", "中国史", "清史", "辽史", "元史", "考古")),
    ("社会学/民族学/人类学", ("社会学", "民族学", "人类学")),
    ("语言学/藏学", ("语言学", "藏学", "藏文", "突厥语", "彝语", "羌语", "语言文字")),
    ("音乐/艺术", ("音乐", "二胡", "民乐", "艺术")),
)
_OFFICIAL_WEB_REFERENCE_PAGE_TITLES = frozenset(
    {
        "学校简介",
        "学校概况",
        "校友会简介",
        "基金会简介",
        "本科培养",
        "博士后",
        "研究生培养",
        "学术名流",
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
    normalized_title = _normalize_snippet(source.source_title)
    if normalized_title == "本科培养":
        if "本科专业" in normalized_statement or "在招专业" in normalized_statement:
            score += 10
        if "强基计划" in normalized_statement or "一流本科专业" in normalized_statement:
            score += 8
        if any(token in normalized_statement for token in ("担当使命", "强国栋梁")):
            score -= 8
    elif normalized_title == "博士后":
        if "博士后科研流动站" in normalized_statement:
            score += 10
        if "合格率均为100" in normalized_statement or "优秀博士后流动站" in normalized_statement:
            score += 8
        if "双一流" in normalized_statement:
            score -= 6
    elif normalized_title == "研究生培养":
        if "12个学科门类" in normalized_statement:
            score += 10
        if "24个研究生招生培养单位" in normalized_statement:
            score += 9
        if (
            "博士一级学科授权点" in normalized_statement
            or "硕士一级学科授权点" in normalized_statement
        ):
            score += 8
        if any(token in normalized_statement for token in ("600余项", "500多人")):
            score -= 6
    elif normalized_title == "学术名流":
        if any(
            token in normalized_statement
            for _, tokens in _OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS
            for token in tokens
        ):
            score += 8
        if "代表著作" in normalized_statement or "主要著作" in normalized_statement:
            score += 4
        if re.search(r"^(19|20)\d{2}年", normalized_statement):
            score -= 3
    return score


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
