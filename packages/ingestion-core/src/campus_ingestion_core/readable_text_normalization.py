from __future__ import annotations

import re
import unicodedata

_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_PROTECTED_SPAN_RE = re.compile(
    r"https?://[^\s<>'\"，,。；;：:！）)]+"
    r"|www\.[^\s<>'\"，,。；;：:！）)]+"
    r"|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    r"|\b(?:doc_id|sha256|source_artifact_id|source_pdf|version_id|rawAssetId|rawVersionId)"
    r":[A-Za-z0-9_./:-]+"
)
_ENUM_PAREN_RE = re.compile(r"\(([一二三四五六七八九十百千万〇零]{1,6}|\d{1,2})\)")
_ANY_SHORT_PAREN_RE = re.compile(r"\(([^()\n]{1,160})\)")
_INLINE_DECIMAL_ENUM_RE = re.compile(r"(^|[^\w.])(\d{1,2})\.(?=[\u3400-\u9fff])")
_INLINE_ALPHA_ENUM_RE = re.compile(r"(^|[^\w.])([A-Z])\.(?=[\u3400-\u9fff])")
_BIBLIOGRAPHY_MARKER_RE = re.compile(r"(\[[A-Za-z]{1,4}\])\.(?=[\u3400-\u9fff])")
_SPACE_BEFORE_CJK_PUNCT_RE = re.compile(r"([\u3400-\u9fff])\s+([，。；：？！])")
_SPACE_AFTER_CJK_PUNCT_RE = re.compile(r"([，。；：？！])\s+([\u3400-\u9fff])")
_CJK_CONTEXT_SCAN_DISTANCE = 12

_PUNCTUATION_MAP = {
    ",": "，",
    ":": "：",
    ";": "；",
    "?": "？",
    "!": "！",
}


def normalize_readable_text(value: str) -> str:
    """Normalize publication-facing Chinese text without changing protected machine tokens."""

    if not value:
        return ""
    text = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))
    protected, spans = _protect_spans(text)
    normalized = _ENUM_PAREN_RE.sub(r"（\1）", protected)
    normalized = _normalize_readable_parentheses(normalized)
    normalized = _normalize_cjk_context_punctuation(normalized)
    normalized = _INLINE_DECIMAL_ENUM_RE.sub(r"\1\2. ", normalized)
    normalized = _INLINE_ALPHA_ENUM_RE.sub(r"\1\2. ", normalized)
    normalized = _BIBLIOGRAPHY_MARKER_RE.sub(r"\1. ", normalized)
    normalized = _SPACE_BEFORE_CJK_PUNCT_RE.sub(r"\1\2", normalized)
    normalized = _SPACE_AFTER_CJK_PUNCT_RE.sub(r"\1\2", normalized)
    return _restore_spans(normalized, spans)


def _protect_spans(text: str) -> tuple[str, list[str]]:
    spans: list[str] = []

    def replace(match: re.Match[str]) -> str:
        spans.append(match.group(0))
        return f"\ue000{len(spans) - 1}\ue001"

    return _PROTECTED_SPAN_RE.sub(replace, text), spans


def _restore_spans(text: str, spans: list[str]) -> str:
    restored = text
    for index, value in enumerate(spans):
        restored = restored.replace(f"\ue000{index}\ue001", value)
    return restored


def _normalize_cjk_context_punctuation(text: str) -> str:
    output: list[str] = []
    length = len(text)
    for index, char in enumerate(text):
        if char == ".":
            output.append("。" if _should_convert_period(text, index, length) else char)
            continue
        replacement = _PUNCTUATION_MAP.get(char)
        if replacement and _has_cjk_context(text, index, length):
            output.append(replacement)
            continue
        output.append(char)
    return "".join(output)


def _normalize_readable_parentheses(text: str) -> str:
    current = text
    for _ in range(4):
        changed = False
        source = current

        def replace(match: re.Match[str], source: str = source) -> str:
            nonlocal changed
            content = match.group(1)
            if _should_convert_parentheses(source, match.start(), match.end(), content):
                changed = True
                return f"（{content}）"
            return match.group(0)

        current = _ANY_SHORT_PAREN_RE.sub(replace, source)
        if not changed:
            break
    return current


def _should_convert_parentheses(text: str, start: int, end: int, content: str) -> bool:
    if _looks_like_markdown_link_destination(text, start, content):
        return False
    if _CJK_RE.search(content):
        return True
    return _has_nearby_cjk(text, start, end)


def _looks_like_markdown_link_destination(text: str, start: int, content: str) -> bool:
    if start > 0 and text[start - 1] == "]":
        return True
    return bool(re.match(r"(?:[./#]|https?:)", content))


def _should_convert_period(text: str, index: int, length: int) -> bool:
    previous = _previous_non_space(text, index)
    following = _next_non_space(text, index, length)
    if _looks_like_bibliography_marker_period(text, index):
        return False
    if previous is None or previous.isdigit():
        return False
    if following is not None and following.isdigit():
        return False
    return _is_cjk(previous) and (following is None or _is_cjk(following))


def _has_cjk_context(text: str, index: int, length: int) -> bool:
    previous = _previous_non_space(text, index)
    following = _next_non_space(text, index, length)
    if previous is not None and _is_cjk(previous):
        return True
    if following is not None and _is_cjk(following):
        return True
    return _has_nearby_cjk(text, index, index + 1)


def _has_nearby_cjk(text: str, start: int, end: int) -> bool:
    left = text[max(0, start - _CJK_CONTEXT_SCAN_DISTANCE) : start]
    right = text[end : min(len(text), end + _CJK_CONTEXT_SCAN_DISTANCE)]
    return bool(_CJK_RE.search(left) or _CJK_RE.search(right))


def _looks_like_bibliography_marker_period(text: str, index: int) -> bool:
    prefix = text[max(0, index - 6) : index]
    return bool(re.search(r"\[[A-Za-z]{1,4}\]$", prefix))


def _previous_non_space(text: str, index: int) -> str | None:
    cursor = index - 1
    while cursor >= 0:
        char = text[cursor]
        if not char.isspace():
            return char
        cursor -= 1
    return None


def _next_non_space(text: str, index: int, length: int) -> str | None:
    cursor = index + 1
    while cursor < length:
        char = text[cursor]
        if not char.isspace():
            return char
        cursor += 1
    return None


def _is_cjk(char: str) -> bool:
    return bool(_CJK_RE.fullmatch(char))


__all__ = ["normalize_readable_text"]
