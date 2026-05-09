from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile

from campus_retrieval_core.curriculum_query_resolution import (
    interpret_curriculum_query,
    matching_curriculum_doc_ids,
)
from campus_retrieval_core.evidence_ranking_text import (
    match_key,
    normalize_text,
    source_title_keys,
    title_match_priority,
)

_ASCII_QUERY_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_WEAK_CJK_QUERY_TOKENS = frozenset(
    {
        "办理",
        "校内",
        "学校",
        "学生",
        "规定",
        "办法",
        "管理",
        "申请",
        "条件",
        "流程",
        "程序",
        "手续",
        "处理",
        "服务",
        "问题",
        "研究",
        "究生",
        "博士",
        "招生",
    }
)
_LOW_SIGNAL_CJK_PHRASES = (
    "中央民族大学",
    "学校层面",
    "学校制度",
    "校级制度",
    "校级文件",
    "校级办法",
    "校级规定",
    "校级要求",
    "管理办法",
    "管理规定",
    "实施办法",
    "实施细则",
    "工作办法",
    "工作细则",
    "议事规则",
    "具体报销标准是什么",
    "属于校级制度吗",
    "本科第二学士学位人才培养方案",
    "本科专业第二学位人才培养方案",
    "本科第二学位人才培养方案",
    "第二学士学位人才培养方案",
    "第二学位人才培养方案",
    "本科人才培养方案",
    "人才培养方案",
    "课程教学计划",
    "教学计划",
    "课程地图",
)
_INSTITUTIONAL_RULE_TITLE_INTENT_CUES = (
    "哪份",
    "依据",
    "应该查",
    "应查",
    "应该看",
    "执行",
    "适用于",
    "属于校级制度",
    "校级制度",
    "校级文件",
    "学校制度",
    "管理办法",
    "管理规定",
    "实施办法",
    "实施细则",
    "议事规则",
    "工作办法",
    "工作细则",
    "办法",
    "规定",
    "细则",
    "规则",
    "制度",
    "文件",
    "规范",
    "规章",
)
_INSTITUTIONAL_RULE_TITLE_LOW_SIGNAL_PHRASES = (
    *_LOW_SIGNAL_CJK_PHRASES,
    "主要适用于什么管理事项",
    "适用于什么管理事项",
    "什么管理事项",
    "应该查哪份",
    "应该看哪份",
    "应查哪份",
    "依据哪份",
    "按照哪份",
    "校级制度",
    "学校制度",
    "校级文件",
    "学校文件",
    "学校办法",
    "学校规定",
    "学校规范",
    "校级管理办法",
    "校级办法",
    "校级规定",
    "校级要求",
    "管理事项",
    "管理要求",
    "具体",
)
_INSTITUTIONAL_RULE_SCOPE_DECISION_CUES = (
    "当前校级制度消费范围",
    "校级制度消费范围",
    "当前消费范围",
    "消费范围",
    "进入下游消费",
    "进入默认消费",
    "加入下游消费",
    "加入默认消费",
    "纳入下游消费",
    "纳入默认消费",
    "属于校级制度吗",
    "属于学校制度吗",
    "是否属于校级制度",
    "是否属于学校制度",
    "是不是校级制度",
    "是不是学校制度",
    "是否为校级制度",
    "是否为学校制度",
)
_INSTITUTIONAL_RULE_ANNUAL_OR_COHORT_RE = re.compile(r"20\d{2}\s*[届年]")
_INSTITUTIONAL_RULE_SCOPED_TITLE_CUES = (
    "实施办法",
    "实施细则",
    "实施方案",
    "工作方案",
    "工作实施细则",
)
_INSTITUTIONAL_RULE_NAMED_COLLEGE_RE = re.compile(
    r"(?:中央民族大学)?(?P<name>[\u4e00-\u9fff]{1,20})学院"
)
_INSTITUTIONAL_RULE_TITLE_ALIAS_TERMS = ((("助教", "助研", "助管"), "三助"),)
_INSTITUTIONAL_RULE_WEAK_TITLE_TOKENS = _WEAK_CJK_QUERY_TOKENS | frozenset(
    {
        "中央",
        "民族",
        "大学",
        "学校",
        "校级",
        "层面",
        "制度",
        "文件",
        "规定",
        "办法",
        "规则",
        "细则",
        "规范",
        "规章",
        "实施",
        "管理",
        "要求",
        "主要",
        "适用",
        "事项",
        "什么",
        "哪些",
        "哪份",
        "应该",
        "依据",
        "按照",
        "执行",
        "申请",
        "办理",
        "属于",
        "是否",
        "学院",
        "校区",
        "学生",
        "本科",
        "本科生",
        "研究生",
        "博士",
        "招生",
        "工作",
        "问题",
    }
)
_FORMAL_INSTITUTIONAL_RULE_TITLE_SUFFIXES = (
    "管理办法",
    "管理规定",
    "实施办法",
    "实施细则",
    "工作办法",
    "工作细则",
    "议事规则",
    "章程",
    "规定",
    "办法",
    "细则",
    "规则",
)


def _apply_no_hit_policy(
    *,
    profile: CollectionRuntimeProfile,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
) -> tuple[EvidenceSource, ...]:
    if not sources:
        return ()
    if profile.no_hit_min_top_score is None or profile.no_hit_min_score_gap is None:
        return sources
    if _is_institutional_rules_profile(
        profile
    ) and _is_excluded_institutional_rule_scope_decision_query(query_text):
        return ()
    if _is_institutional_rules_profile(profile) and _is_formal_institutional_rule_title_query(
        query_text
    ):
        if _has_institutional_rule_title_support(query_text=query_text, sources=sources):
            return sources
        return ()
    top_source = sources[0]
    if top_source.score >= profile.no_hit_min_top_score:
        return sources
    runner_up_score = sources[1].score if len(sources) > 1 else top_source.score
    if (top_source.score - runner_up_score) >= profile.no_hit_min_score_gap:
        return sources
    if _is_institutional_rules_profile(profile) and _is_institutional_rule_title_intent_query(
        query_text
    ):
        if _has_institutional_rule_title_support(query_text=query_text, sources=sources):
            return sources
        return ()
    if (
        _is_student_rules_profile(profile)
        and _is_student_rule_title_intent_query(query_text)
        and _has_student_rule_title_support(query_text=query_text, sources=sources)
    ):
        return sources
    if _has_query_lexical_support(
        query_text=query_text,
        snippets=tuple(source.snippet for source in sources),
    ):
        return sources
    if _has_unique_curriculum_doc_match(query_text=query_text, sources=sources):
        return sources
    return ()


def _has_query_lexical_support(*, query_text: str, snippets: str | Sequence[str]) -> bool:
    normalized_query = unicodedata.normalize("NFKC", query_text).lower()
    normalized_snippets = _normalize_snippets(snippets)
    if not normalized_query or not normalized_snippets:
        return False
    for token in _ASCII_QUERY_TOKEN_RE.findall(normalized_query):
        if any(token in normalized_snippet for normalized_snippet in normalized_snippets):
            return True
    for segment in _query_support_segments(normalized_query):
        if _segment_has_strong_lexical_support(
            segment=segment, normalized_snippets=normalized_snippets
        ):
            return True
    return False


def _has_unique_curriculum_doc_match(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> bool:
    interpretation = interpret_curriculum_query(query_text)
    if not interpretation.program_compact_key:
        return False
    return len(matching_curriculum_doc_ids(query_text=query_text, sources=sources)) == 1


def _is_institutional_rules_profile(profile: CollectionRuntimeProfile) -> bool:
    return profile.corpus == "regulations" and profile.collection == "institutional_rules"


def _is_student_rules_profile(profile: CollectionRuntimeProfile) -> bool:
    return profile.corpus == "regulations" and profile.collection == "student_rules"


def _is_institutional_rule_title_intent_query(query_text: str) -> bool:
    normalized_query = normalize_text(query_text)
    return any(cue in normalized_query for cue in _INSTITUTIONAL_RULE_TITLE_INTENT_CUES)


def _is_formal_institutional_rule_title_query(query_text: str) -> bool:
    normalized_query = normalize_text(query_text)
    if not normalized_query:
        return False
    if "《" in query_text and "》" in query_text:
        return True
    if "中央民族大学" not in normalized_query:
        return False
    return any(suffix in normalized_query for suffix in _FORMAL_INSTITUTIONAL_RULE_TITLE_SUFFIXES)


def _is_student_rule_title_intent_query(query_text: str) -> bool:
    normalized_query = normalize_text(query_text)
    return any(cue in normalized_query for cue in _INSTITUTIONAL_RULE_TITLE_INTENT_CUES)


def _is_excluded_institutional_rule_scope_decision_query(query_text: str) -> bool:
    normalized_query = normalize_text(query_text)
    if not any(cue in normalized_query for cue in _INSTITUTIONAL_RULE_SCOPE_DECISION_CUES):
        return False
    return _is_annual_or_cohort_scope_query(normalized_query) or _is_college_level_scope_query(
        normalized_query
    )


def _is_annual_or_cohort_scope_query(normalized_query: str) -> bool:
    if not _INSTITUTIONAL_RULE_ANNUAL_OR_COHORT_RE.search(normalized_query):
        return False
    return any(cue in normalized_query for cue in _INSTITUTIONAL_RULE_SCOPED_TITLE_CUES)


def _is_college_level_scope_query(normalized_query: str) -> bool:
    if not any(cue in normalized_query for cue in _INSTITUTIONAL_RULE_SCOPED_TITLE_CUES):
        return False
    for match in _INSTITUTIONAL_RULE_NAMED_COLLEGE_RE.finditer(normalized_query):
        college_name = match.group("name").removeprefix("中央民族大学")
        if college_name:
            return True
    return False


def _has_institutional_rule_title_support(
    *, query_text: str, sources: Sequence[EvidenceSource]
) -> bool:
    normalized_query = normalize_text(query_text)
    query_key = match_key(normalized_query)
    support_tokens = _institutional_rule_title_support_tokens(normalized_query)
    for source in sources:
        title_keys = source_title_keys(source)
        if title_match_priority(query_key=query_key, title_keys=title_keys) >= 2:
            return True
        if support_tokens and any(
            _title_key_has_institutional_support_token(
                title_key=title_key,
                support_tokens=support_tokens,
            )
            for title_key in title_keys
        ):
            return True
    return False


def _has_student_rule_title_support(*, query_text: str, sources: Sequence[EvidenceSource]) -> bool:
    normalized_query = normalize_text(query_text)
    query_key = match_key(normalized_query)
    return any(
        title_match_priority(query_key=query_key, title_keys=source_title_keys(source)) >= 2
        for source in sources
    )


def _title_key_has_institutional_support_token(
    *, title_key: str, support_tokens: Sequence[str]
) -> bool:
    return any(token in title_key for token in support_tokens)


def _institutional_rule_title_support_tokens(normalized_query: str) -> tuple[str, ...]:
    stripped_query = normalized_query
    for phrase in _INSTITUTIONAL_RULE_TITLE_LOW_SIGNAL_PHRASES:
        stripped_query = stripped_query.replace(phrase, " ")
    tokens: list[str] = []
    tokens.extend(_institutional_rule_title_alias_tokens(normalized_query))
    for segment in _cjk_segments(stripped_query):
        for token_size in (4, 3, 2):
            tokens.extend(
                token
                for token in _cjk_query_tokens(segment, token_size=token_size)
                if _is_institutional_rule_title_support_token(token)
            )
    return tuple(dict.fromkeys(tokens))


def _institutional_rule_title_alias_tokens(normalized_query: str) -> tuple[str, ...]:
    return tuple(
        alias
        for query_terms, alias in _INSTITUTIONAL_RULE_TITLE_ALIAS_TERMS
        if all(term in normalized_query for term in query_terms)
    )


def _is_institutional_rule_title_support_token(token: str) -> bool:
    return len(token) >= 2 and token not in _INSTITUTIONAL_RULE_WEAK_TITLE_TOKENS


def _normalize_snippets(snippets: str | Sequence[str]) -> tuple[str, ...]:
    values = (snippets,) if isinstance(snippets, str) else tuple(snippets)
    return tuple(
        normalized
        for normalized in (unicodedata.normalize("NFKC", value).lower() for value in values)
        if normalized
    )


def _segment_has_strong_lexical_support(
    *, segment: str, normalized_snippets: Sequence[str]
) -> bool:
    if len(segment) >= 4 and any(segment in snippet for snippet in normalized_snippets):
        return True
    matched_bigrams = {
        token
        for token in _cjk_query_tokens(segment, token_size=2)
        if token not in _WEAK_CJK_QUERY_TOKENS
        if any(token in snippet for snippet in normalized_snippets)
    }
    return len(matched_bigrams) >= 2


def _query_support_segments(normalized_query: str) -> tuple[str, ...]:
    stripped_query = normalized_query
    for phrase in _LOW_SIGNAL_CJK_PHRASES:
        stripped_query = stripped_query.replace(phrase, " ")
    stripped_segments = _cjk_segments(stripped_query)
    return stripped_segments or _cjk_segments(normalized_query)


def _cjk_segments(text: str) -> tuple[str, ...]:
    segments: list[str] = []
    current: list[str] = []
    for char in text:
        if _is_cjk_char(char):
            current.append(char)
            continue
        if current:
            segments.append("".join(current))
            current = []
    if current:
        segments.append("".join(current))
    return tuple(segments)


def _cjk_query_tokens(segment: str, *, token_size: int) -> tuple[str, ...]:
    if token_size <= 0 or len(segment) < token_size:
        return ()
    return tuple(
        dict.fromkeys(
            token
            for token in (
                segment[index : index + token_size]
                for index in range(len(segment) - token_size + 1)
            )
            if token.strip()
        )
    )


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )
