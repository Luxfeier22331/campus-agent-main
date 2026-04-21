from __future__ import annotations

import re

_WHITESPACE_RE = re.compile(r"\s+")
_CITATION_RE = re.compile(r"\[[^\]]+\]")
_MATCHING_PUNCTUATION_RE = re.compile(r"[“”\"'《》【】（）()，,；;：:。！？!?.、·\[\]]")


def _sanitize_answer_text(answer_text: str) -> str:
    return _normalize_text(_CITATION_RE.sub(" ", answer_text))


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _normalize_matching_text(text: str) -> str:
    normalized = _normalize_text(text)
    normalized = _MATCHING_PUNCTUATION_RE.sub("", normalized)
    return normalized.lower()
