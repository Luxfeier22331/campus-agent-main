from __future__ import annotations

from dataclasses import dataclass, field
import os
import re
from typing import Callable, Literal, Protocol


DEFAULT_CHUNK_SIZE = 240
DEFAULT_MAX_CHUNK_SIZE = 360
DEFAULT_CHUNK_OVERLAP = 48
DEFAULT_MIN_CHUNK_SIZE = 40
DEFAULT_SPLIT_STRATEGY: Literal["structure_first", "token_budget"] = "structure_first"
DEFAULT_CHUNK_POLICY_VERSION = "student_handbook_semantic_v1"
DEFAULT_CLEANING_POLICY_VERSION = "student_handbook_cleaning_v1"
DEFAULT_STRATEGY_NAME = "student_handbook_structure"
DEFAULT_TOKENIZER_NAME = "regex_approximation_v1"

HANDBOOK_V2_CHUNK_POLICY_VERSION = "student_handbook_semantic_v2"
HANDBOOK_V2_CHUNK_SIZE = 384
HANDBOOK_V2_MAX_CHUNK_SIZE = 512
HANDBOOK_V2_CHUNK_OVERLAP = 64
HANDBOOK_V2_MIN_CHUNK_SIZE = 96
HANDBOOK_V2_STRATEGY_NAME = "student_handbook_structure_v2"

TABLE_PLACEHOLDER = "[table omitted; see table evidence]"
PARENT_UNIT_TYPES = {"article_body", "policy_page", "section_text"}
TABLE_UNIT_TYPES = {"table", "table_row", "table_unit"}
TEXTUAL_UNIT_TYPES = {"article_body", "policy_page"}

_TABLE_HTML_RE = re.compile(r"<table\b[\s\S]*?</table>", re.IGNORECASE)
_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s]")
_CLAUSE_BOUNDARY_RE = re.compile(
    r"^(?:第[一二三四五六七八九十百千万〇零两0-9]+条|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十]+、|[0-9]+\.)"
)
_ROSTER_LINE_RE = re.compile(r"\d{5,}")
_ENUMERATED_LINE_RE = re.compile(
    r"^(?:第[一二三四五六七八九十百千万〇零两0-9]+条|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十]+、|[0-9]+\.)"
)
_PREAMBLE_LINE_RE = re.compile(r"[：:]$")


class TokenCounter(Protocol):
    @property
    def name(self) -> str: ...

    def count(self, text: str) -> int: ...


@dataclass(frozen=True, slots=True)
class RegexApproxTokenCounter:
    name: str = DEFAULT_TOKENIZER_NAME

    def count(self, text: str) -> int:
        return len(_TOKEN_RE.findall(text))


@dataclass(frozen=True, slots=True)
class TiktokenTokenCounter:
    model_name: str
    fallback_name: str = DEFAULT_TOKENIZER_NAME

    @property
    def name(self) -> str:
        return f"tiktoken:{self.model_name}"

    def count(self, text: str) -> int:
        try:
            import tiktoken
        except ImportError:
            return RegexApproxTokenCounter(name=self.fallback_name).count(text)
        try:
            encoding = tiktoken.encoding_for_model(self.model_name)
        except Exception:
            try:
                encoding = tiktoken.get_encoding("cl100k_base")
            except Exception:
                return RegexApproxTokenCounter(name=self.fallback_name).count(text)
        try:
            return len(encoding.encode(text))
        except Exception:
            return RegexApproxTokenCounter(name=self.fallback_name).count(text)


@dataclass(frozen=True, slots=True)
class StructuredUnitChunkInput:
    unit_type: str
    root_unit_id: str
    text: str


@dataclass(frozen=True, slots=True)
class StructuralSplitResult:
    segments: tuple[str, ...]
    boundary_rule: str


@dataclass(frozen=True, slots=True)
class SemanticChunkPiece:
    unit_type: str
    root_unit_id: str
    text: str
    segment_index: int = 1
    segment_total: int = 1
    split_reason: str | None = None
    boundary_rule: str | None = None


class ChunkingStrategy(Protocol):
    def split_structure_boundaries(
        self,
        *,
        unit_type: str,
        text: str,
        chunk_profile: ChunkProfile,
    ) -> StructuralSplitResult | None: ...


class StudentHandbookChunkingStrategy:
    def split_structure_boundaries(
        self,
        *,
        unit_type: str,
        text: str,
        chunk_profile: ChunkProfile,
    ) -> StructuralSplitResult | None:
        candidate_lines = [line.strip() for line in text.splitlines() if line.strip()]
        if len(candidate_lines) < 2:
            return None

        if unit_type == "article_body" and all(_looks_like_clause_line(line) for line in candidate_lines):
            grouped = _group_lines_by_token_budget(candidate_lines, chunk_profile=chunk_profile)
            if len(grouped) > 1 and _segments_within_budget(grouped, chunk_profile=chunk_profile):
                return StructuralSplitResult(segments=grouped, boundary_rule="clause_line")
            return None

        if unit_type == "policy_page" and all(_looks_like_roster_line(line) for line in candidate_lines):
            grouped = _group_lines_by_token_budget(candidate_lines, chunk_profile=chunk_profile)
            if len(grouped) > 1 and _segments_within_budget(grouped, chunk_profile=chunk_profile):
                return StructuralSplitResult(segments=grouped, boundary_rule="roster_line")
            return None

        return None


class StudentHandbookChunkingStrategyV2:
    def split_structure_boundaries(
        self,
        *,
        unit_type: str,
        text: str,
        chunk_profile: ChunkProfile,
    ) -> StructuralSplitResult | None:
        candidate_lines = [line.strip() for line in text.splitlines() if line.strip()]
        if len(candidate_lines) < 2:
            return None

        if unit_type == "article_body":
            grouped = _group_prefixed_blocks(
                _build_clause_groups(candidate_lines),
                chunk_profile=chunk_profile,
            )
            if len(grouped) > 1 and _segments_within_budget(grouped, chunk_profile=chunk_profile):
                return StructuralSplitResult(segments=grouped, boundary_rule="clause_block")
            return None

        if unit_type == "policy_page":
            grouped = _group_prefixed_blocks(
                _build_enumerated_groups(candidate_lines),
                chunk_profile=chunk_profile,
            )
            if len(grouped) > 1 and _segments_within_budget(grouped, chunk_profile=chunk_profile):
                return StructuralSplitResult(segments=grouped, boundary_rule="enumerated_list_block")
            if all(_looks_like_roster_line(line) for line in candidate_lines):
                roster = _group_lines_by_token_budget(candidate_lines, chunk_profile=chunk_profile)
                if len(roster) > 1 and _segments_within_budget(roster, chunk_profile=chunk_profile):
                    return StructuralSplitResult(segments=roster, boundary_rule="roster_line")
            return None

        return None


@dataclass(frozen=True, slots=True)
class ChunkProfile:
    chunk_size: int = DEFAULT_CHUNK_SIZE
    max_chunk_size: int = DEFAULT_MAX_CHUNK_SIZE
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP
    min_chunk_size: int = DEFAULT_MIN_CHUNK_SIZE
    split_strategy: Literal["structure_first", "token_budget"] = DEFAULT_SPLIT_STRATEGY
    chunk_policy_version: str = DEFAULT_CHUNK_POLICY_VERSION
    cleaning_policy_version: str = DEFAULT_CLEANING_POLICY_VERSION
    strategy_name: str = DEFAULT_STRATEGY_NAME
    strategy: ChunkingStrategy | None = field(default_factory=StudentHandbookChunkingStrategy)
    token_counter: TokenCounter = field(default_factory=RegexApproxTokenCounter)
    tokenizer_name: str = DEFAULT_TOKENIZER_NAME

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
        if not self.strategy_name.strip():
            raise ValueError("strategy_name must not be empty")
        if not self.tokenizer_name.strip():
            raise ValueError("tokenizer_name must not be empty")

    def count_tokens(self, text: str) -> int:
        return self.token_counter.count(text)


def build_student_handbook_chunk_profile(
    *,
    profile_version: str = DEFAULT_CHUNK_POLICY_VERSION,
    model_name: str | None = None,
) -> ChunkProfile:
    resolved_model_name = (model_name or os.environ.get("INGESTION_EMBEDDING_MODEL") or os.environ.get("EMBEDDING_MODEL") or "").strip()
    token_counter = _build_token_counter(resolved_model_name)
    if profile_version == HANDBOOK_V2_CHUNK_POLICY_VERSION:
        return ChunkProfile(
            chunk_size=HANDBOOK_V2_CHUNK_SIZE,
            max_chunk_size=HANDBOOK_V2_MAX_CHUNK_SIZE,
            chunk_overlap=HANDBOOK_V2_CHUNK_OVERLAP,
            min_chunk_size=HANDBOOK_V2_MIN_CHUNK_SIZE,
            split_strategy="structure_first",
            chunk_policy_version=HANDBOOK_V2_CHUNK_POLICY_VERSION,
            cleaning_policy_version=DEFAULT_CLEANING_POLICY_VERSION,
            strategy_name=HANDBOOK_V2_STRATEGY_NAME,
            strategy=StudentHandbookChunkingStrategyV2(),
            token_counter=token_counter,
            tokenizer_name=token_counter.name,
        )
    return ChunkProfile(
        token_counter=token_counter,
        tokenizer_name=token_counter.name,
    )


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

    token_count = estimate_token_count(cleaned_text, chunk_profile=chunk_profile)
    token_spans = _tokenize_text(cleaned_text)
    if token_count <= chunk_profile.max_chunk_size:
        return (SemanticChunkPiece(unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=cleaned_text),)

    structural_split = _split_structure_boundaries(
        unit_type=unit.unit_type,
        text=cleaned_text,
        chunk_profile=chunk_profile,
    )
    if structural_split is not None:
        total = len(structural_split.segments)
        return tuple(
            SemanticChunkPiece(
                unit_type=unit.unit_type,
                root_unit_id=unit.root_unit_id,
                text=piece_text,
                segment_index=index,
                segment_total=total,
                split_reason="structure_boundary",
                boundary_rule=structural_split.boundary_rule,
            )
            for index, piece_text in enumerate(structural_split.segments, start=1)
        )

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
            boundary_rule=None,
        )
        for index, (_, _, piece_text) in enumerate(windows, start=1)
    )


def estimate_token_count(text: str, *, chunk_profile: ChunkProfile | None = None) -> int:
    if chunk_profile is not None:
        return chunk_profile.count_tokens(text)
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
        piece_text = _slice_token_window(text=text, token_spans=token_spans, start_index=start_index, end_index=end_index)
        while end_index - start_index > 1 and estimate_token_count(piece_text, chunk_profile=chunk_profile) > chunk_profile.max_chunk_size:
            end_index -= 1
            piece_text = _slice_token_window(text=text, token_spans=token_spans, start_index=start_index, end_index=end_index)
        windows.append((start_index, end_index, piece_text))
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
    if estimate_token_count(last_text, chunk_profile=chunk_profile) >= chunk_profile.min_chunk_size:
        return windows
    prev_start, _, prev_text = windows[-2]
    merged_text = f"{prev_text} {last_text}".strip()
    if estimate_token_count(merged_text, chunk_profile=chunk_profile) > chunk_profile.max_chunk_size:
        return windows
    return [*windows[:-2], (prev_start, last_end, merged_text)]


def _split_structure_boundaries(
    *,
    unit_type: str,
    text: str,
    chunk_profile: ChunkProfile,
) -> StructuralSplitResult | None:
    if chunk_profile.split_strategy != "structure_first":
        return None
    strategy = chunk_profile.strategy
    if strategy is None:
        return None
    return strategy.split_structure_boundaries(
        unit_type=unit_type,
        text=text,
        chunk_profile=chunk_profile,
    )


def _group_lines_by_token_budget(
    lines: list[str],
    *,
    chunk_profile: ChunkProfile,
    prefix_text: str | None = None,
) -> tuple[str, ...]:
    normalized_prefix = (prefix_text or "").strip()
    prefix_tokens = estimate_token_count(normalized_prefix, chunk_profile=chunk_profile) if normalized_prefix else 0

    def group_token_count(group: list[str]) -> int:
        parts = [*([normalized_prefix] if normalized_prefix else []), *group]
        return estimate_token_count("\n".join(parts), chunk_profile=chunk_profile)

    groups: list[list[str]] = []
    current_group: list[str] = []

    for line in lines:
        candidate_group = [*current_group, line]
        if current_group and group_token_count(candidate_group) > chunk_profile.max_chunk_size:
            groups.append(current_group)
            current_group = [line]
            continue
        current_group.append(line)

    if current_group:
        groups.append(current_group)

    merged_groups: list[list[str]] = []
    for group in groups:
        if (
            merged_groups
            and group_token_count(group) < chunk_profile.min_chunk_size
            and group_token_count(merged_groups[-1] + group) <= chunk_profile.max_chunk_size
        ):
            merged_groups[-1].extend(group)
        else:
            merged_groups.append(list(group))

    return tuple(
        "\n".join([*([normalized_prefix] if normalized_prefix else []), *group]).strip()
        for group in merged_groups
    )


def _segments_within_budget(
    segments: tuple[str, ...],
    *,
    chunk_profile: ChunkProfile,
) -> bool:
    return all(estimate_token_count(segment, chunk_profile=chunk_profile) <= chunk_profile.max_chunk_size for segment in segments)


def _build_token_counter(model_name: str) -> TokenCounter:
    if model_name:
        return TiktokenTokenCounter(model_name=model_name)
    return RegexApproxTokenCounter()


def _tokenize_text(text: str) -> list[re.Match[str]]:
    return list(_TOKEN_RE.finditer(text))


def _slice_token_window(
    *,
    text: str,
    token_spans: list[re.Match[str]],
    start_index: int,
    end_index: int,
) -> str:
    start_char = token_spans[start_index].start()
    end_char = token_spans[end_index - 1].end()
    return text[start_char:end_char].strip()


def _looks_like_clause_line(line: str) -> bool:
    return bool(_CLAUSE_BOUNDARY_RE.match(line.strip()))


def _looks_like_roster_line(line: str) -> bool:
    normalized = line.strip()
    return bool(normalized and _ROSTER_LINE_RE.search(normalized))


def _looks_like_enumerated_line(line: str) -> bool:
    return bool(_ENUMERATED_LINE_RE.match(line.strip()))


def _looks_like_preamble_line(line: str) -> bool:
    normalized = line.strip()
    return bool(normalized and (_PREAMBLE_LINE_RE.search(normalized) or not _looks_like_enumerated_line(normalized)))


def _build_clause_groups(lines: list[str]) -> list[tuple[str, list[str]]]:
    enumerated_indices = [index for index, line in enumerate(lines) if _looks_like_clause_line(line)]
    if len(enumerated_indices) < 2:
        return [("", lines)]
    return _build_prefixed_groups(
        lines=lines,
        is_block_start=_looks_like_clause_line,
    )


def _build_enumerated_groups(lines: list[str]) -> list[tuple[str, list[str]]]:
    enumerated_indices = [index for index, line in enumerate(lines) if _looks_like_enumerated_line(line)]
    if len(enumerated_indices) < 2:
        return [("", lines)]
    return _build_prefixed_groups(
        lines=lines,
        is_block_start=_starts_new_enumerated_block,
    )


def _starts_new_enumerated_block(line: str) -> bool:
    normalized = line.strip()
    return bool(normalized and re.match(r"^(?:[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十]+、)", normalized))


def _group_prefixed_blocks(
    groups: list[tuple[str, list[str]]],
    *,
    chunk_profile: ChunkProfile,
) -> tuple[str, ...]:
    segments: list[str] = []
    for prefix_text, blocks in groups:
        grouped = _group_lines_by_token_budget(
            blocks,
            chunk_profile=chunk_profile,
            prefix_text=prefix_text,
        )
        segments.extend(grouped)
    return tuple(segments)


def _build_prefixed_groups(
    *,
    lines: list[str],
    is_block_start: Callable[[str], bool],
) -> list[tuple[str, list[str]]]:
    groups: list[tuple[str, list[str]]] = []
    current_prefix: list[str] = []
    current_blocks: list[str] = []
    current_block: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if is_block_start(stripped):
            if current_block:
                current_blocks.append("\n".join(current_block))
            current_block = [stripped]
            continue
        if current_block and stripped.endswith(("：", ":")):
            current_blocks.append("\n".join(current_block))
            groups.append(("\n".join(current_prefix).strip(), current_blocks))
            current_prefix = [stripped]
            current_blocks = []
            current_block = []
            continue
        if current_block:
            current_block.append(stripped)
        else:
            current_prefix.append(stripped)

    if current_block:
        current_blocks.append("\n".join(current_block))
    if current_blocks:
        groups.append(("\n".join(current_prefix).strip(), current_blocks))
    return groups


__all__ = [
    "DEFAULT_CHUNK_OVERLAP",
    "DEFAULT_CHUNK_POLICY_VERSION",
    "DEFAULT_CHUNK_SIZE",
    "DEFAULT_CLEANING_POLICY_VERSION",
    "DEFAULT_MAX_CHUNK_SIZE",
    "DEFAULT_MIN_CHUNK_SIZE",
    "DEFAULT_SPLIT_STRATEGY",
    "DEFAULT_STRATEGY_NAME",
    "TABLE_PLACEHOLDER",
    "TABLE_UNIT_TYPES",
    "ChunkProfile",
    "RegexApproxTokenCounter",
    "SemanticChunkPiece",
    "StructuredUnitChunkInput",
    "StudentHandbookChunkingStrategy",
    "StudentHandbookChunkingStrategyV2",
    "TiktokenTokenCounter",
    "build_student_handbook_chunk_profile",
    "chunk_structured_unit",
    "clean_structured_text",
    "estimate_token_count",
]
