from __future__ import annotations

import re

from .agent_shared import _normalize_snippet


def finalize_answer_text(answer_text: str) -> str:
    normalized = _normalize_snippet(answer_text)
    if not normalized:
        return ""
    normalized = _strip_metadata_artifacts(normalized)
    normalized = _trim_non_answer_tail(normalized)
    normalized = _cleanup_punctuation(normalized)
    return normalized.strip()


def _strip_metadata_artifacts(text: str) -> str:
    normalized = _normalize_snippet(text)
    if not normalized:
        return ""
    normalized = re.sub(
        r"(?:^|[；;]\s*)(?:标题|章节|条款)[:：][^；;。!?！？]+",
        "",
        normalized,
    )
    normalized = re.sub(
        r"(?:^|[；;]\s*)《[^》]+》\s*(?:标题|章节|条款)[:：][^；;。!?！？]+",
        "",
        normalized,
    )
    return _normalize_snippet(normalized)


def _cleanup_punctuation(text: str) -> str:
    normalized = text
    replacements = (
        ("。。", "。"),
        ("；。", "。"),
        ("。；", "。"),
        ("，，", "，"),
        ("；；", "；"),
    )
    for before, after in replacements:
        while before in normalized:
            normalized = normalized.replace(before, after)
    normalized = re.sub(r"[；;]\s*$", "。", normalized)
    return normalized


def _trim_non_answer_tail(text: str) -> str:
    normalized = text
    for cue in ("具体表现如下", "按以下程序进行评选"):
        if cue in normalized:
            normalized = normalized.split(cue, 1)[0].rstrip("：:；;，,。 ")
    return normalized


__all__ = ["finalize_answer_text"]
