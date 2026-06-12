from __future__ import annotations

import re

from .answer_shared import _normalize_snippet

_RELIEF_DURATION_TARGET_CUES = ("解除处分", "处分解除", "解除纪律处分")
_DURATION_LOOKUP_CUES = ("多久", "多长时间", "何时", "什么时候", "考察期")
_RELIEF_APPLICATION_CUES = (
    "申请解除处分",
    "可申请解除处分",
    "可以申请解除处分",
    "方可申请解除处分",
    "申请解除纪律处分",
    "可申请解除纪律处分",
    "可以申请解除纪律处分",
    "方可申请解除纪律处分",
)
_PERIOD_COMPLETION_CUES = ("考察期满", "期满", "届满", "满考察期")
_MONTH_DURATION = r"(?:\d+|[一二三四五六七八九十百]+)\s*(?:个)?月"
_RELIEF_APPLICATION_PATTERN = (
    r"(?:申请解除处分|可申请解除处分|可以申请解除处分|方可申请解除处分|"
    r"申请解除纪律处分|可申请解除纪律处分|可以申请解除纪律处分|方可申请解除纪律处分)"
)


def query_asks_condition_duration_lookup(query_text: str) -> bool:
    normalized = _normalize_snippet(query_text)
    if not normalized:
        return False
    return any(cue in normalized for cue in _DURATION_LOOKUP_CUES) and any(
        cue in normalized for cue in _RELIEF_DURATION_TARGET_CUES
    )


def extract_condition_duration_parts(statement: str) -> tuple[str, ...]:
    normalized = _normalize_snippet(statement)
    if not normalized:
        return ()
    parts: list[str] = []
    patterns = (
        rf"[^。；;]*?(?:考察期满|满)\s*{_MONTH_DURATION}(?:后)?[^。；;]*?"
        rf"{_RELIEF_APPLICATION_PATTERN}",
        rf"[^。；;]*?(?:经过|经|须经过)?\s*{_MONTH_DURATION}\s*考察期(?:后|期满|届满)?"
        rf"[^。；;]*?{_RELIEF_APPLICATION_PATTERN}",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, normalized):
            fragment = match.group(0).strip(" ，,。；;")
            if fragment and fragment not in parts:
                parts.append(fragment)
    if parts:
        return tuple(parts)
    if any(cue in normalized for cue in _PERIOD_COMPLETION_CUES) and any(
        cue in normalized for cue in _RELIEF_APPLICATION_CUES
    ):
        return (normalized.rstrip("。；; "),)
    return ()


def statement_has_condition_duration_answer(statement: str) -> bool:
    return bool(extract_condition_duration_parts(statement))


def condition_duration_subject_label(query_text: str) -> str:
    normalized = _normalize_snippet(query_text)
    if "解除处分" in normalized or "处分解除" in normalized:
        if "被处分后" in normalized or "受处分后" in normalized:
            return "被处分后申请解除处分的等待期"
        return "申请解除处分的等待期"
    return "等待期"


__all__ = [
    "condition_duration_subject_label",
    "extract_condition_duration_parts",
    "query_asks_condition_duration_lookup",
    "statement_has_condition_duration_answer",
]
