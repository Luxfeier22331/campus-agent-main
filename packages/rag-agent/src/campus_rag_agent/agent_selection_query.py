from __future__ import annotations

import re

from .agent_curriculum_terms import _is_curriculum_lookup_query
from .agent_shared import _normalize_snippet

_ASCII_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_CJK_SEGMENT_RE = re.compile(r"[\u4e00-\u9fff]+")
_PROCEDURE_QUERY_HINTS = (
    "怎么办",
    "如何",
    "怎么",
    "办理",
    "申请",
    "流程",
    "补办",
    "手续",
    "replace",
)
_NON_PROCEDURE_REQUIREMENT_QUERY_HINTS = ("怎么要求", "如何要求", "怎么规定", "如何规定")
_MATERIAL_QUERY_HINTS = ("什么材料", "哪些材料", "提交材料", "证明材料", "书面申请", "要交什么")
_TIME_QUERY_HINTS = (
    "时间",
    "几点",
    "多久",
    "几年",
    "哪天",
    "学制",
    "照明",
    "熄灯",
    "亮灯",
    "hours",
)
_LOW_SIGNAL_QUERY_TOKENS = frozenset(
    {
        "中央",
        "民族",
        "大学",
        "学生",
        "规定",
        "办法",
        "内容",
        "相关",
        "什么",
        "哪些",
        "如何",
        "怎么",
        "怎么办",
        "流程",
        "办理",
        "hours",
    }
)


def _query_mode(query_text: str) -> str:
    normalized = _normalize_snippet(query_text).lower()
    if _is_curriculum_lookup_query(query_text):
        return "curriculum_lookup"
    if any(hint in normalized for hint in _NON_PROCEDURE_REQUIREMENT_QUERY_HINTS):
        return "generic"
    if any(hint in normalized for hint in _MATERIAL_QUERY_HINTS):
        return "generic"
    if any(hint in normalized for hint in _PROCEDURE_QUERY_HINTS):
        return "procedure"
    if any(hint in normalized for hint in _TIME_QUERY_HINTS):
        return "time"
    return "generic"


def _query_keywords(query_text: str) -> tuple[str, ...]:
    normalized = _normalize_snippet(query_text).lower()
    keywords: list[str] = []
    for token in _ASCII_TOKEN_RE.findall(normalized):
        keywords.append(token)
    for segment in _CJK_SEGMENT_RE.findall(normalized):
        if len(segment) >= 4 and segment not in _LOW_SIGNAL_QUERY_TOKENS:
            keywords.append(segment)
        for token_size in (3, 2):
            if len(segment) < token_size:
                continue
            for index in range(len(segment) - token_size + 1):
                token = segment[index : index + token_size]
                if token in _LOW_SIGNAL_QUERY_TOKENS:
                    continue
                keywords.append(token)
    return tuple(dict.fromkeys(token for token in keywords if token))


__all__ = [
    "_ASCII_TOKEN_RE",
    "_CJK_SEGMENT_RE",
    "_LOW_SIGNAL_QUERY_TOKENS",
    "_MATERIAL_QUERY_HINTS",
    "_NON_PROCEDURE_REQUIREMENT_QUERY_HINTS",
    "_PROCEDURE_QUERY_HINTS",
    "_TIME_QUERY_HINTS",
    "_query_keywords",
    "_query_mode",
]
