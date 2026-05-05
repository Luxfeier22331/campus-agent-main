from __future__ import annotations

import re

_WHITESPACE_RE = re.compile(r"\s+")
_CITATION_RE = re.compile(r"\[[^\]]+\]")
_MATCHING_PUNCTUATION_RE = re.compile(r"[“”\"'《》【】（）()，,；;：:。！？!?.、·\[\]]")
_NUMERIC_UNIT_SPACE_RE = re.compile(
    r"((?:\d+(?:\.\d+)?|[一二三四五六七八九十两零〇]+))\s+"
    r"(学分|学时|周学时|门|次|项|分|绩点|年|个月|月|日|天|周|小时|分钟)"
)


def _sanitize_answer_text(answer_text: str) -> str:
    return _normalize_text(_CITATION_RE.sub(" ", answer_text))


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _normalize_matching_text(text: str) -> str:
    normalized = _normalize_text(text)
    normalized = _NUMERIC_UNIT_SPACE_RE.sub(r"\1\2", normalized)
    normalized = _MATCHING_PUNCTUATION_RE.sub("", normalized)
    return normalized.lower()
