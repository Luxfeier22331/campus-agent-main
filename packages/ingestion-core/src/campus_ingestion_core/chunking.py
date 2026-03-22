from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal


DEFAULT_CHUNK_SIZE = 240
DEFAULT_MAX_CHUNK_SIZE = 360
DEFAULT_CHUNK_OVERLAP = 48
DEFAULT_MIN_CHUNK_SIZE = 40
DEFAULT_SPLIT_STRATEGY: Literal["structure_first", "token_budget"] = "structure_first"
DEFAULT_CHUNK_POLICY_VERSION = "student_handbook_semantic_v1"
DEFAULT_CLEANING_POLICY_VERSION = "student_handbook_cleaning_v1"

TABLE_PLACEHOLDER = "[table omitted; see table evidence]"
PARENT_UNIT_TYPES = {"article_body", "policy_page"}
TABLE_UNIT_TYPES = {"table", "table_row"}

_TABLE_HTML_RE = re.compile(r"<table\b[\s\S]*?</table>", re.IGNORECASE)
_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s]")


@dataclass(frozen=True, slots=True)
class StructuredUnitChunkInput:
    unit_type: str
    root_unit_id: str
    text: str


@dataclass(frozen=True, slots=True)
class SemanticChunkPiece:
    unit_type: str
    root_unit_id: str
    text: str
    segment_index: int = 1
    segment_total: int = 1
    split_reason: str | None = None


@dataclass(frozen=True, slots=True)
class ChunkProfile:
    chunk_size: int = DEFAULT_CHUNK_SIZE
    max_chunk_size: int = DEFAULT_MAX_CHUNK_SIZE
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP
    min_chunk_size: int = DEFAULT_MIN_CHUNK_SIZE
    split_strategy: Literal["structure_first", "token_budget"] = DEFAULT_SPLIT_STRATEGY
    chunk_policy_version: str = DEFAULT_CHUNK_POLICY_VERSION
    cleaning_policy_version: str = DEFAULT_CLEANING_POLICY_VERSION

    def __post_init__(self) -> None:
        if self.chunk_size <= 0:
            raise ValueError("chunk_size must be greater than zero")
        if self.max_chunk_size < self.chunk_size:
            raise ValueError("max_chunk_size must be greater than or equal to chunk_size")
        if self.chunk_overlap < 0:
            raise ValueError("chunk_overlap must not be negative")
        if self.chunk_overlap >= self.max_chunk_size:
            raise ValueError("chunk_overlap must be smaller than max_chunk_size")
        if self.min_chunk_size <= 0:
            raise ValueError("min_chunk_size must be greater than zero")
        if self.min_chunk_size >= self.max_chunk_size:
            raise ValueError("min_chunk_size must be smaller than max_chunk_size")
        if self.split_strategy not in {"structure_first", "token_budget"}:
            raise ValueError(f"unsupported split_strategy: {self.split_strategy}")


def clean_structured_text(*, unit_type: str, text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if unit_type in PARENT_UNIT_TYPES and "<table" in normalized.lower():
        normalized = _TABLE_HTML_RE.sub(f"\n{TABLE_PLACEHOLDER}\n", normalized)
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def chunk_structured_unit(
    *,
    unit: StructuredUnitChunkInput,
    chunk_profile: ChunkProfile,
) -> tuple[SemanticChunkPiece, ...]:
    cleaned_text = clean_structured_text(unit_type=unit.unit_type, text=unit.text)
    if not cleaned_text:
        return ()
    if unit.unit_type in TABLE_UNIT_TYPES:
        return (SemanticChunkPiece(unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=cleaned_text),)

    token_spans = list(_TOKEN_RE.finditer(cleaned_text))
    if len(token_spans) <= chunk_profile.max_chunk_size:
        return (SemanticChunkPiece(unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=cleaned_text),)

    windows = _split_token_windows(text=cleaned_text, token_spans=token_spans, chunk_profile=chunk_profile)
    windows = _merge_short_tail(windows, chunk_profile=chunk_profile)
    total = len(windows)
    return tuple(
        SemanticChunkPiece(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=piece_text,
            segment_index=index,
            segment_total=total,
            split_reason="token_guardrail",
        )
        for index, (_, _, piece_text) in enumerate(windows, start=1)
    )


def estimate_token_count(text: str) -> int:
    return len(_TOKEN_RE.findall(text))


def _split_token_windows(
    *,
    text: str,
    token_spans: list[re.Match[str]],
    chunk_profile: ChunkProfile,
) -> list[tuple[int, int, str]]:
    windows: list[tuple[int, int, str]] = []
    start_index = 0
    total_tokens = len(token_spans)
    while start_index < total_tokens:
        remaining = total_tokens - start_index
        window_size = remaining if remaining <= chunk_profile.max_chunk_size else chunk_profile.chunk_size
        window_size = min(window_size, chunk_profile.max_chunk_size)
        end_index = min(start_index + max(window_size, chunk_profile.min_chunk_size), total_tokens)
        start_char = token_spans[start_index].start()
        end_char = token_spans[end_index - 1].end()
        windows.append((start_index, end_index, text[start_char:end_char].strip()))
        if end_index >= total_tokens:
            break
        start_index = max(end_index - chunk_profile.chunk_overlap, start_index + 1)
    return windows


def _merge_short_tail(
    windows: list[tuple[int, int, str]],
    *,
    chunk_profile: ChunkProfile,
) -> list[tuple[int, int, str]]:
    if len(windows) < 2:
        return windows
    last_start, last_end, last_text = windows[-1]
    if estimate_token_count(last_text) >= chunk_profile.min_chunk_size:
        return windows
    prev_start, _, prev_text = windows[-2]
    merged_text = f"{prev_text} {last_text}".strip()
    if estimate_token_count(merged_text) > chunk_profile.max_chunk_size:
        return windows
    return [*windows[:-2], (prev_start, last_end, merged_text)]
