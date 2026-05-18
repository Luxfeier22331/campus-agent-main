from __future__ import annotations

import re

_WHITESPACE_RE = re.compile(r"\s+")
_CITATION_RE = re.compile(r"\[[^\]]+\]")
_MATCHING_PUNCTUATION_RE = re.compile(r"[“”\"'《》【】（）()，,；;：:。！？!?.、·\[\]]")
_NUMERIC_UNIT_SPACE_RE = re.compile(
    r"((?:\d+(?:\.\d+)?|[一二三四五六七八九十两零〇]+))\s+"
    r"(学分|学时|周学时|门|次|项|分|绩点|年|个月|月|日|天|周|小时|分钟)"
)
_CHINESE_NUMERIC_UNIT_RE = re.compile(
    r"([一二三四五六七八九十百千两零〇]{1,8})\s*(个)?\s*"
    r"(工作日|周学时|学分|学时|绩点|分钟|小时|个月|星期|年|月|日|天|周|门|次|项|分)"
)
_CHINESE_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
_CHINESE_UNITS = {"十": 10, "百": 100, "千": 1000}


def _sanitize_answer_text(answer_text: str) -> str:
    return _normalize_text(_CITATION_RE.sub(" ", answer_text))


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _normalize_matching_text(text: str) -> str:
    normalized = _normalize_text(text)
    normalized = _NUMERIC_UNIT_SPACE_RE.sub(r"\1\2", normalized)
    normalized = _CHINESE_NUMERIC_UNIT_RE.sub(_normalize_chinese_numeric_unit, normalized)
    normalized = _MATCHING_PUNCTUATION_RE.sub("", normalized)
    return normalized.lower()


def _normalize_chinese_numeric_unit(match: re.Match[str]) -> str:
    value = _parse_chinese_integer(match.group(1))
    if value is None:
        return match.group(0)
    measure = match.group(2) or ""
    unit = match.group(3)
    return f"{value}{measure}{unit}"


def _parse_chinese_integer(text: str) -> int | None:
    if not text:
        return None
    if any(char in text for char in ("零", "〇")) and not any(
        unit in text for unit in _CHINESE_UNITS
    ):
        digits = [_CHINESE_DIGITS.get(char) for char in text]
        if any(digit is None for digit in digits):
            return None
        return int("".join(str(digit) for digit in digits))

    total = 0
    section = 0
    pending_digit: int | None = None
    for char in text:
        if char in _CHINESE_DIGITS:
            pending_digit = _CHINESE_DIGITS[char]
            continue
        unit = _CHINESE_UNITS.get(char)
        if unit is None:
            return None
        section += (pending_digit if pending_digit is not None else 1) * unit
        pending_digit = None
    total += section
    if pending_digit is not None:
        total += pending_digit
    return total if total > 0 else None
