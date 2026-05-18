from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection

_WHITESPACE_RE = re.compile(r"\s+")
_ASCII_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_TITLE_BRACKETED_SEGMENT_RE = re.compile(r"[（(][^（）()]+[）)]")
_LOW_SIGNAL_CJK_TOKENS = frozenset(
    {
        "中央",
        "民族",
        "大学",
        "本科",
        "人才",
        "培养",
        "方案",
        "要求",
        "多少",
        "几年",
        "怎么",
        "如何",
        "安排",
        "相关",
        "内容",
        "什么",
        "哪些",
        "规定",
        "办法",
        "流程",
    }
)
_QUERY_ASK_CUES = frozenset({"多少", "几年", "怎么", "如何", "安排", "什么", "哪些"})


def is_official_web_short_title_match(
    *,
    query_key: str,
    source: EvidenceSource,
    explicit_title_key: str,
) -> bool:
    if (
        source.source_channel != "official_web"
        or not is_official_web_stable_reference_like_collection(source.collection)
    ):
        return False
    if len(explicit_title_key) < 2 or len(explicit_title_key) > 3:
        return False
    if query_key == explicit_title_key:
        return True
    if not query_key.endswith(explicit_title_key):
        return False
    prefix = query_key[: -len(explicit_title_key)]
    return prefix in {"", "中央民族大学"}


def source_title_keys(source: EvidenceSource) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            title_key
            for title_key in (match_key(candidate) for candidate in source_title_candidates(source))
            if title_key
        )
    )


def source_title_candidates(source: EvidenceSource) -> tuple[str, ...]:
    base_candidates: list[str] = []
    explicit_title = source.source_title.strip()
    if explicit_title:
        base_candidates.append(explicit_title)

    doc_label = source.doc_id.split(":", 1)[-1].strip()
    if looks_like_title(doc_label):
        base_candidates.append(doc_label)

    for path_item in source.structural_path[:1]:
        if not should_include_structural_root_as_title_candidate(
            source=source,
            explicit_title=explicit_title,
            path_item=path_item,
        ):
            continue
        if looks_like_title(path_item):
            base_candidates.append(path_item)

    snippet = normalize_text(source.snippet)
    for separator in ("\n", " / "):
        if separator in snippet:
            prefix = snippet.split(separator, 1)[0].strip()
            if looks_like_title(prefix):
                base_candidates.append(prefix)

    candidates: list[str] = []
    for candidate in base_candidates:
        if _is_curriculum_source(source):
            normalized_candidate = normalize_text(candidate)
            if normalized_candidate and looks_like_title(normalized_candidate):
                candidates.append(normalized_candidate)
            continue
        candidates.extend(title_variants(candidate))
    return tuple(dict.fromkeys(candidates))


def _is_curriculum_source(source: EvidenceSource) -> bool:
    return source.collection == "curriculum_plan" or source.doc_id.startswith("curriculum:")


def should_include_structural_root_as_title_candidate(
    *,
    source: EvidenceSource,
    explicit_title: str,
    path_item: str,
) -> bool:
    if (
        source.source_channel == "official_web"
        and is_official_web_stable_reference_like_collection(source.collection)
        and explicit_title
    ):
        return match_key(explicit_title) == match_key(path_item)
    return True


def source_detail_text(source: EvidenceSource) -> str:
    parts = [source.detail_label, *source.structural_path]
    return " ".join(part for part in parts if part.strip())


def source_content_text(source: EvidenceSource) -> str:
    snippet = normalize_text(source.snippet)
    for candidate in source_title_candidates(source):
        normalized_candidate = normalize_text(candidate)
        if normalized_candidate:
            snippet = snippet.replace(normalized_candidate, " ")
    detail_text = source_detail_text(source)
    return " ".join(part for part in (detail_text, snippet) if part.strip())


def title_match_priority(*, query_key: str, title_keys: Sequence[str]) -> int:
    if any(title_key == query_key for title_key in title_keys):
        return 4
    if any(title_key and title_key in query_key for title_key in title_keys):
        return 3
    if any(title_key and query_key in title_key for title_key in title_keys):
        return 2
    return 0


def focused_query_key(*, query_key: str, title_keys: Sequence[str]) -> str:
    for title_key in sorted(
        (key for key in title_keys if key and key in query_key), key=len, reverse=True
    ):
        remainder = query_key.replace(title_key, "", 1)
        if remainder:
            return remainder
    return query_key


def title_compactness(*, query_key: str, title_keys: Sequence[str]) -> int:
    if not is_short_title_fragment_query(query_key):
        return 0
    extra_chars = min(
        (
            len(title_key) - len(query_key)
            for title_key in title_keys
            if title_key and query_key and query_key in title_key
        ),
        default=None,
    )
    if extra_chars is None:
        return 0
    return -max(extra_chars, 0)


def semantic_title_coverage(*, query_key: str, title_key: str) -> float:
    query_tokens = semantic_query_tokens(query_key)
    if not query_tokens or not title_key:
        return 0.0
    matched_tokens = sum(1 for token in query_tokens if token in title_key)
    return matched_tokens / len(query_tokens)


def query_lexical_support_count(
    *,
    normalized_query: str,
    query_key: str,
    search_key: str,
) -> int:
    if not search_key:
        return 0
    count = sum(1 for token in _ASCII_TOKEN_RE.findall(normalized_query) if token in search_key)
    for segment in cjk_segments(query_key):
        if len(segment) >= 4 and segment in search_key:
            count += 2
            continue
        count += sum(
            1
            for token in cjk_tokens(segment, token_size=3)
            if token not in _LOW_SIGNAL_CJK_TOKENS and token in search_key
        )
        count += sum(
            1
            for token in cjk_tokens(segment, token_size=2)
            if token not in _LOW_SIGNAL_CJK_TOKENS and token in search_key
        )
    return count


def looks_like_title(text: str) -> bool:
    normalized = normalize_text(text)
    if len(normalized) < 4:
        return False
    if any(is_cjk_char(char) for char in normalized):
        return True
    return len(normalized.split()) >= 3


def title_variants(text: str) -> tuple[str, ...]:
    normalized_text = normalize_text(text)
    if not normalized_text:
        return ()
    without_bracketed_segment = normalize_text(_TITLE_BRACKETED_SEGMENT_RE.sub("", normalized_text))
    return tuple(
        dict.fromkeys(
            candidate
            for candidate in (normalized_text, without_bracketed_segment)
            if candidate and looks_like_title(candidate)
        )
    )


def semantic_query_tokens(query_key: str) -> tuple[str, ...]:
    tokens: list[str] = []
    for segment in cjk_segments(query_key):
        for token_size in (3, 2):
            tokens.extend(
                token
                for token in cjk_tokens(segment, token_size=token_size)
                if token not in _LOW_SIGNAL_CJK_TOKENS and token not in _QUERY_ASK_CUES
            )
    return tuple(dict.fromkeys(tokens))


def normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", text)).strip().lower()


def match_key(text: str) -> str:
    return "".join(char for char in normalize_text(text) if char.isalnum() or is_cjk_char(char))


def cjk_segments(text: str) -> tuple[str, ...]:
    segments: list[str] = []
    current: list[str] = []
    for char in text:
        if is_cjk_char(char):
            current.append(char)
            continue
        if current:
            segments.append("".join(current))
            current = []
    if current:
        segments.append("".join(current))
    return tuple(segments)


def cjk_tokens(segment: str, *, token_size: int) -> tuple[str, ...]:
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


def is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )


def is_short_semantic_query(query_key: str) -> bool:
    return sum(len(segment) for segment in cjk_segments(query_key)) <= 10


def is_short_title_fragment_query(query_key: str) -> bool:
    if not is_short_semantic_query(query_key):
        return False
    cjk_length = sum(len(segment) for segment in cjk_segments(query_key))
    if cjk_length == 0 or cjk_length > 6:
        return False
    return not any(cue in query_key for cue in _QUERY_ASK_CUES)
