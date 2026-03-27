from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from functools import lru_cache
import os
import re
import threading
from typing import Any, Callable, Literal, Mapping, Protocol, Sequence

from campus_ingestion_core.handbook_article_structure import (
    article_structure_has_nested_subclauses,
    build_article_structure_groups,
)
from campus_ingestion_core.tokenizer_cache import resolve_prefetched_hf_tokenizer_path


DEFAULT_CHUNK_SIZE = 240
DEFAULT_MAX_CHUNK_SIZE = 360
DEFAULT_CHUNK_OVERLAP = 48
DEFAULT_MIN_CHUNK_SIZE = 40
DEFAULT_SPLIT_STRATEGY: Literal["structure_first", "token_budget"] = "structure_first"
DEFAULT_CHUNK_POLICY_VERSION = "student_handbook_semantic_v1"
DEFAULT_CLEANING_POLICY_VERSION = "student_handbook_cleaning_v1"
DEFAULT_STRATEGY_NAME = "student_handbook_structure"
DEFAULT_TOKENIZER_NAME = "regex_approximation_v1"
DEFAULT_SAFETY_MARGIN = 0

HANDBOOK_V2_CHUNK_POLICY_VERSION = "student_handbook_semantic_v2"
HANDBOOK_V2_CHUNK_SIZE = 384
HANDBOOK_V2_MAX_CHUNK_SIZE = 512
HANDBOOK_V2_CHUNK_OVERLAP = 64
HANDBOOK_V2_MIN_CHUNK_SIZE = 96
HANDBOOK_V2_STRATEGY_NAME = "student_handbook_structure_v2"

HANDBOOK_V3_CHUNK_POLICY_VERSION = "student_handbook_semantic_v3"
HANDBOOK_V3_CHUNK_SIZE = 384
HANDBOOK_V3_MAX_CHUNK_SIZE = 512
HANDBOOK_V3_CHUNK_OVERLAP = 64
HANDBOOK_V3_MIN_CHUNK_SIZE = 96
HANDBOOK_V3_SAFETY_MARGIN = 16
HANDBOOK_V3_STRATEGY_NAME = "student_handbook_structure_v3"
QWEN3_EMBEDDING_MODEL = "Qwen3-Embedding-4B"
QWEN3_EMBEDDING_REPO = "Qwen/Qwen3-Embedding-4B"
_HF_TOKENIZER_LOAD_LOCK = threading.Lock()

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
_TOP_LEVEL_CLAUSE_CONTEXT_RE = re.compile(r"^(?:[（(][一二三四五六七八九十百千万〇零两]+[)）]|[一二三四五六七八九十百千万〇零两]+、)")
_NUMERIC_SUBCLAUSE_CONTEXT_RE = re.compile(r"^[0-9]+[.、]")
_PAREN_NUMERIC_SUBCLAUSE_CONTEXT_RE = re.compile(r"^[（(][0-9]+[)）]")


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
class HuggingFaceTokenCounter:
    tokenizer_repo: str
    display_name: str

    @property
    def name(self) -> str:
        return f"hf:{self.display_name}"

    def count(self, text: str) -> int:
        tokenizer = _load_hf_tokenizer(self.tokenizer_repo)
        return len(tokenizer.encode(text, add_special_tokens=False))


@dataclass(frozen=True, slots=True)
class ChunkHeaderVariant:
    mode: str
    lines: tuple[str, ...]

    def joined_text(self) -> str:
        return "\n".join(line for line in self.lines if line).strip()


@dataclass(frozen=True, slots=True)
class ChunkTextContextPlan:
    required_variant: ChunkHeaderVariant | None = None
    preferred_variants: tuple[ChunkHeaderVariant, ...] = ()


@dataclass(frozen=True, slots=True)
class ResolvedDisplayBudget:
    max_tokens: int
    target_tokens: int
    min_tokens: int
    overlap_tokens: int
    header_token_count: int = 0


@dataclass(frozen=True, slots=True)
class ChunkTextAssembly:
    text: str
    header_mode: str
    header_token_count: int
    display_token_count: int
    total_token_count: int


@dataclass(frozen=True, slots=True)
class StructuredUnitChunkInput:
    unit_type: str
    root_unit_id: str
    text: str
    anchor: dict[str, object] = field(default_factory=dict)
    metadata: dict[str, object] = field(default_factory=dict)


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
        display_budget: ResolvedDisplayBudget,
    ) -> StructuralSplitResult | None: ...


class StudentHandbookChunkingStrategy:
    def split_structure_boundaries(
        self,
        *,
        unit_type: str,
        text: str,
        chunk_profile: ChunkProfile,
        display_budget: ResolvedDisplayBudget,
    ) -> StructuralSplitResult | None:
        candidate_lines = [line.strip() for line in text.splitlines() if line.strip()]
        if len(candidate_lines) < 2:
            return None

        if unit_type == "article_body" and all(_looks_like_clause_line(line) for line in candidate_lines):
            grouped = _group_lines_by_token_budget(
                candidate_lines,
                chunk_profile=chunk_profile,
                display_budget=display_budget,
            )
            if len(grouped) > 1 and _segments_within_budget(
                grouped,
                chunk_profile=chunk_profile,
                display_budget=display_budget,
            ):
                return StructuralSplitResult(segments=grouped, boundary_rule="clause_line")
            return None

        if unit_type == "policy_page" and all(_looks_like_roster_line(line) for line in candidate_lines):
            grouped = _group_lines_by_token_budget(
                candidate_lines,
                chunk_profile=chunk_profile,
                display_budget=display_budget,
            )
            if len(grouped) > 1 and _segments_within_budget(
                grouped,
                chunk_profile=chunk_profile,
                display_budget=display_budget,
            ):
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
        display_budget: ResolvedDisplayBudget,
    ) -> StructuralSplitResult | None:
        candidate_lines = [line.strip() for line in text.splitlines() if line.strip()]
        if len(candidate_lines) < 2:
            return None

        if unit_type == "article_body":
            if article_structure_has_nested_subclauses(candidate_lines):
                structured = _group_article_structure_blocks(
                    candidate_lines,
                    chunk_profile=chunk_profile,
                    display_budget=display_budget,
                )
                structured = _repair_article_subclause_boundary_context(
                    structured,
                    chunk_profile=chunk_profile,
                    display_budget=display_budget,
                )
                if len(structured) > 1 and _segments_within_budget(
                    structured,
                    chunk_profile=chunk_profile,
                    display_budget=display_budget,
                ):
                    return StructuralSplitResult(segments=structured, boundary_rule="article_structure_block")
            grouped = _group_prefixed_blocks(
                _build_clause_groups(candidate_lines),
                chunk_profile=chunk_profile,
                display_budget=display_budget,
            )
            grouped = _repair_article_subclause_boundary_context(
                grouped,
                chunk_profile=chunk_profile,
                display_budget=display_budget,
            )
            if len(grouped) > 1 and _segments_within_budget(
                grouped,
                chunk_profile=chunk_profile,
                display_budget=display_budget,
            ):
                return StructuralSplitResult(segments=grouped, boundary_rule="clause_block")
            return None

        if unit_type == "policy_page":
            grouped = _group_prefixed_blocks(
                _build_enumerated_groups(candidate_lines),
                chunk_profile=chunk_profile,
                display_budget=display_budget,
            )
            if len(grouped) > 1 and _segments_within_budget(
                grouped,
                chunk_profile=chunk_profile,
                display_budget=display_budget,
            ):
                return StructuralSplitResult(segments=grouped, boundary_rule="enumerated_list_block")
            if all(_looks_like_roster_line(line) for line in candidate_lines):
                roster = _group_lines_by_token_budget(
                    candidate_lines,
                    chunk_profile=chunk_profile,
                    display_budget=display_budget,
                )
                if len(roster) > 1 and _segments_within_budget(
                    roster,
                    chunk_profile=chunk_profile,
                    display_budget=display_budget,
                ):
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
    final_text_aware: bool = False
    safety_margin: int = DEFAULT_SAFETY_MARGIN

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
        if self.safety_margin < 0:
            raise ValueError("safety_margin must not be negative")
        if self.final_text_aware and self.safety_margin >= self.max_chunk_size:
            raise ValueError("safety_margin must be smaller than max_chunk_size")

    def count_tokens(self, text: str) -> int:
        return self.token_counter.count(text)

    def resolve_display_budget(self, *, header_token_count: int = 0) -> ResolvedDisplayBudget:
        reserved_tokens = 0
        if self.final_text_aware:
            reserved_tokens = header_token_count + self.safety_margin
        effective_max_tokens = self.max_chunk_size - reserved_tokens
        if effective_max_tokens <= 0:
            raise ValueError("required contextual header exceeds max_chunk_size budget")
        effective_target_tokens = min(self.chunk_size, effective_max_tokens)
        effective_min_tokens = min(self.min_chunk_size, effective_max_tokens)
        effective_overlap_tokens = min(
            self.chunk_overlap,
            max(effective_max_tokens - 1, 0),
            max(effective_target_tokens - 1, 0),
        )
        return ResolvedDisplayBudget(
            max_tokens=effective_max_tokens,
            target_tokens=effective_target_tokens,
            min_tokens=effective_min_tokens,
            overlap_tokens=effective_overlap_tokens,
            header_token_count=header_token_count if self.final_text_aware else 0,
        )


def build_student_handbook_chunk_profile(
    *,
    profile_version: str = DEFAULT_CHUNK_POLICY_VERSION,
    model_name: str | None = None,
) -> ChunkProfile:
    resolved_model_name = (
        model_name
        or os.environ.get("INGESTION_EMBEDDING_MODEL")
        or os.environ.get("EMBEDDING_MODEL")
        or ""
    ).strip()
    if profile_version == HANDBOOK_V2_CHUNK_POLICY_VERSION:
        token_counter = _build_token_counter(resolved_model_name)
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
    if profile_version == HANDBOOK_V3_CHUNK_POLICY_VERSION:
        token_counter = _build_student_handbook_v3_token_counter(resolved_model_name)
        return ChunkProfile(
            chunk_size=HANDBOOK_V3_CHUNK_SIZE,
            max_chunk_size=HANDBOOK_V3_MAX_CHUNK_SIZE,
            chunk_overlap=HANDBOOK_V3_CHUNK_OVERLAP,
            min_chunk_size=HANDBOOK_V3_MIN_CHUNK_SIZE,
            split_strategy="structure_first",
            chunk_policy_version=HANDBOOK_V3_CHUNK_POLICY_VERSION,
            cleaning_policy_version=DEFAULT_CLEANING_POLICY_VERSION,
            strategy_name=HANDBOOK_V3_STRATEGY_NAME,
            strategy=StudentHandbookChunkingStrategyV2(),
            token_counter=token_counter,
            tokenizer_name=token_counter.name,
            final_text_aware=True,
            safety_margin=HANDBOOK_V3_SAFETY_MARGIN,
        )
    token_counter = _build_token_counter(resolved_model_name)
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
    if unit.unit_type == "table_unit":
        return chunk_table_unit(unit=unit, chunk_profile=chunk_profile)
    cleaned_text = clean_structured_text(unit_type=unit.unit_type, text=unit.text)
    if not cleaned_text:
        return ()
    if unit.unit_type in TABLE_UNIT_TYPES:
        return (SemanticChunkPiece(unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=cleaned_text),)

    display_budget = resolve_display_budget(unit=unit, chunk_profile=chunk_profile)
    token_count = estimate_token_count(cleaned_text, chunk_profile=chunk_profile)
    if token_count <= display_budget.max_tokens:
        return (SemanticChunkPiece(unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=cleaned_text),)

    structural_split = _split_structure_boundaries(
        unit_type=unit.unit_type,
        text=cleaned_text,
        chunk_profile=chunk_profile,
        display_budget=display_budget,
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

    token_spans = _tokenize_text(cleaned_text)
    windows = _split_token_windows(
        text=cleaned_text,
        token_spans=token_spans,
        chunk_profile=chunk_profile,
        display_budget=display_budget,
    )
    windows = _merge_short_tail(
        windows,
        chunk_profile=chunk_profile,
        display_budget=display_budget,
    )
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


def serialize_table_unit_text(
    *,
    caption_lines: tuple[str, ...] = (),
    header_line: str = "",
    row_lines: tuple[str, ...] = (),
    note_lines: tuple[str, ...] = (),
) -> str:
    parts: list[str] = []
    parts.extend(line.strip() for line in caption_lines if line and line.strip())
    if header_line.strip():
        parts.append(header_line.strip())
    parts.extend(line.rstrip() for line in row_lines if line and line.strip())
    parts.extend(line.strip() for line in note_lines if line and line.strip())
    return "\n".join(parts).strip()


def chunk_table_unit(
    *,
    unit: StructuredUnitChunkInput,
    chunk_profile: ChunkProfile,
) -> tuple[SemanticChunkPiece, ...]:
    caption_lines = tuple(
        str(item).strip()
        for item in list(unit.metadata.get("caption_lines") or [])
        if str(item).strip()
    )
    header_line = str(unit.metadata.get("table_header_line") or "").strip()
    row_lines = tuple(
        str(item).rstrip()
        for item in list(unit.metadata.get("table_row_lines") or [])
        if str(item).strip()
    )
    note_lines = tuple(
        str(item).strip()
        for item in list(unit.metadata.get("note_lines") or [])
        if str(item).strip()
    )

    if not row_lines:
        text = serialize_table_unit_text(
            caption_lines=caption_lines,
            header_line=header_line,
            row_lines=(),
            note_lines=note_lines,
        )
        if not text:
            text = clean_structured_text(unit_type=unit.unit_type, text=unit.text)
        if not text:
            return ()
        return (SemanticChunkPiece(unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=text),)

    prefix_lines = [*caption_lines]
    if header_line:
        prefix_lines.append(header_line)
    suffix_lines = [*note_lines]
    fixed_token_count = estimate_token_count("\n".join([*prefix_lines, *suffix_lines]), chunk_profile=chunk_profile)

    windows: list[list[str]] = []
    current_rows: list[str] = []
    current_tokens = fixed_token_count
    for row_line in row_lines:
        row_tokens = estimate_token_count(row_line, chunk_profile=chunk_profile)
        if current_rows and current_tokens + row_tokens > chunk_profile.max_chunk_size:
            windows.append(current_rows)
            current_rows = [row_line]
            current_tokens = fixed_token_count + row_tokens
            continue
        current_rows.append(row_line)
        current_tokens += row_tokens

    if current_rows:
        windows.append(current_rows)

    if len(windows) == 1:
        text = serialize_table_unit_text(
            caption_lines=caption_lines,
            header_line=header_line,
            row_lines=tuple(windows[0]),
            note_lines=note_lines,
        )
        return (SemanticChunkPiece(unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=text),)

    total = len(windows)
    return tuple(
        SemanticChunkPiece(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=serialize_table_unit_text(
                caption_lines=caption_lines,
                header_line=header_line,
                row_lines=tuple(window_rows),
                note_lines=note_lines,
            ),
            segment_index=index,
            segment_total=total,
            split_reason="table_row_window",
        )
        for index, window_rows in enumerate(windows, start=1)
    )


def estimate_token_count(text: str, *, chunk_profile: ChunkProfile | None = None) -> int:
    if chunk_profile is not None:
        return chunk_profile.count_tokens(text)
    return len(_TOKEN_RE.findall(text))


def build_chunk_text_context(
    *,
    anchor: Mapping[str, object] | None = None,
    metadata: Mapping[str, object] | None = None,
) -> ChunkTextContextPlan:
    resolved_anchor = anchor or {}
    resolved_metadata = metadata or {}
    title_text = _normalize_context_text(resolved_metadata.get("title"))
    policy_doc_no = _normalize_context_text(resolved_metadata.get("policy_doc_no"))
    preface_text = _normalize_context_text(resolved_metadata.get("preface_text"))
    has_document_context = any(value for value in (title_text, policy_doc_no, preface_text))
    if not has_document_context:
        return ChunkTextContextPlan()

    section_path = resolved_anchor.get("section_path")
    normalized_section_path = (
        tuple(str(item).strip() for item in section_path if str(item).strip())
        if isinstance(section_path, list)
        else ()
    )
    article_text = _normalize_context_text(resolved_anchor.get("article_label"))
    provision_text = _normalize_context_text(resolved_anchor.get("provision_label"))
    table_text = _normalize_context_text(resolved_anchor.get("table_context"))
    detail_label = _resolve_detail_label(
        article_text=article_text,
        provision_text=provision_text,
        table_text=table_text,
    )

    full_parts: list[str] = []
    if title_text:
        full_parts.append(f"标题：{title_text}")
    if normalized_section_path:
        full_parts.append(f"章节：{' > '.join(normalized_section_path)}")
    if detail_label:
        full_parts.append(detail_label)
    full_header = " | ".join(full_parts).strip()

    compact_parts: list[str] = []
    if title_text:
        compact_parts.append(f"标题：{title_text}")
    if normalized_section_path:
        compact_parts.append(f"章节：{normalized_section_path[-1]}")
    if detail_label:
        compact_parts.append(detail_label)
    compact_header = " | ".join(compact_parts).strip()

    compact_identity_parts: list[str] = []
    if title_text:
        compact_identity_parts.append(title_text)
    if normalized_section_path:
        compact_identity_parts.append(normalized_section_path[-1])
    if article_text:
        compact_identity_parts.append(article_text)
    elif provision_text:
        compact_identity_parts.append(provision_text)
    elif table_text:
        compact_identity_parts.append(table_text)
    compact_identity = " / ".join(compact_identity_parts).strip()

    required_header = compact_header or title_text or compact_identity or full_header
    if not required_header:
        return ChunkTextContextPlan()

    doc_no_line = f"文号：{policy_doc_no}" if policy_doc_no else None
    variants: list[ChunkHeaderVariant] = []
    _append_header_variant(variants, mode="full_path", base_line=full_header, doc_no_line=doc_no_line)
    _append_header_variant(variants, mode="compact_path", base_line=compact_header, doc_no_line=doc_no_line)
    _append_header_variant(variants, mode="compact_identity", base_line=compact_identity, doc_no_line=doc_no_line)
    _append_header_variant(
        variants,
        mode="title_only",
        base_line=title_text or None,
        doc_no_line=doc_no_line,
    )
    required_variant = ChunkHeaderVariant(mode="required", lines=(required_header,))
    _append_existing_variant(variants, required_variant)
    return ChunkTextContextPlan(
        required_variant=required_variant,
        preferred_variants=tuple(variants),
    )


def assemble_chunk_text(
    *,
    display_text: str,
    context_plan: ChunkTextContextPlan,
    chunk_profile: ChunkProfile,
) -> ChunkTextAssembly:
    normalized_display_text = display_text.strip()
    if not normalized_display_text:
        return ChunkTextAssembly(
            text="",
            header_mode="none",
            header_token_count=0,
            display_token_count=0,
            total_token_count=0,
        )
    display_token_count = estimate_token_count(normalized_display_text, chunk_profile=chunk_profile)
    if context_plan.required_variant is None:
        return ChunkTextAssembly(
            text=normalized_display_text,
            header_mode="none",
            header_token_count=0,
            display_token_count=display_token_count,
            total_token_count=display_token_count,
        )

    fitting_variants: list[tuple[ChunkHeaderVariant, str, int, int]] = []
    for variant in context_plan.preferred_variants:
        candidate_text, header_token_count = _compose_contextual_chunk_text(
            display_text=normalized_display_text,
            variant=variant,
            chunk_profile=chunk_profile,
        )
        total_token_count = estimate_token_count(candidate_text, chunk_profile=chunk_profile)
        if total_token_count <= chunk_profile.max_chunk_size:
            fitting_variants.append((variant, candidate_text, header_token_count, total_token_count))
    selected_variant = _select_header_variant_for_display(
        fitting_variants=fitting_variants,
        display_token_count=display_token_count,
    )
    if selected_variant is not None:
        variant, candidate_text, header_token_count, total_token_count = selected_variant
        return ChunkTextAssembly(
            text=candidate_text,
            header_mode=variant.mode,
            header_token_count=header_token_count,
            display_token_count=display_token_count,
            total_token_count=total_token_count,
        )

    fallback_text, header_token_count = _compose_contextual_chunk_text(
        display_text=normalized_display_text,
        variant=context_plan.required_variant,
        chunk_profile=chunk_profile,
    )
    total_token_count = estimate_token_count(fallback_text, chunk_profile=chunk_profile)
    return ChunkTextAssembly(
        text=fallback_text,
        header_mode=context_plan.required_variant.mode,
        header_token_count=header_token_count,
        display_token_count=display_token_count,
        total_token_count=total_token_count,
    )


def _select_header_variant_for_display(
    *,
    fitting_variants: list[tuple[ChunkHeaderVariant, str, int, int]],
    display_token_count: int,
) -> tuple[ChunkHeaderVariant, str, int, int] | None:
    if not fitting_variants:
        return None
    if display_token_count >= 120:
        return fitting_variants[0]

    short_display_mode_order = {
        "compact_identity": 0,
        "compact_path": 1,
        "full_path": 2,
        "title_only": 3,
        "required": 4,
    }
    return min(
        fitting_variants,
        key=lambda item: (
            short_display_mode_order.get(item[0].mode, 99),
            item[2],
            item[3],
        ),
    )


def resolve_display_budget(
    *,
    unit: StructuredUnitChunkInput,
    chunk_profile: ChunkProfile,
) -> ResolvedDisplayBudget:
    context_plan = build_chunk_text_context(anchor=unit.anchor, metadata=unit.metadata)
    header_token_count = 0
    if chunk_profile.final_text_aware and context_plan.required_variant is not None:
        header_token_count = estimate_token_count(
            context_plan.required_variant.joined_text(),
            chunk_profile=chunk_profile,
        )
    return chunk_profile.resolve_display_budget(header_token_count=header_token_count)


def _split_token_windows(
    *,
    text: str,
    token_spans: list[re.Match[str]],
    chunk_profile: ChunkProfile,
    display_budget: ResolvedDisplayBudget,
) -> list[tuple[int, int, str]]:
    windows: list[tuple[int, int, str]] = []
    boundary_indexes = _collect_soft_boundary_indexes(text=text, token_spans=token_spans)
    start_index = 0
    total_tokens = len(token_spans)
    while start_index < total_tokens:
        remaining = total_tokens - start_index
        window_size = remaining if remaining <= display_budget.max_tokens else display_budget.target_tokens
        window_size = min(window_size, display_budget.max_tokens)
        target_end_index = min(start_index + max(window_size, display_budget.min_tokens), total_tokens)
        end_index = _resolve_window_end_index(
            start_index=start_index,
            target_end_index=target_end_index,
            total_tokens=total_tokens,
            display_budget=display_budget,
            boundary_indexes=boundary_indexes,
        )
        piece_text = _slice_token_window(
            text=text,
            token_spans=token_spans,
            start_index=start_index,
            end_index=end_index,
        )
        while (
            end_index - start_index > 1
            and estimate_token_count(piece_text, chunk_profile=chunk_profile) > display_budget.max_tokens
        ):
            aligned_end_index = _previous_boundary_index(
                boundary_indexes=boundary_indexes,
                upper_bound=end_index - 1,
                lower_bound=max(start_index + 1, start_index + display_budget.min_tokens),
            )
            end_index = aligned_end_index if aligned_end_index is not None else end_index - 1
            piece_text = _slice_token_window(
                text=text,
                token_spans=token_spans,
                start_index=start_index,
                end_index=end_index,
            )
        windows.append((start_index, end_index, piece_text))
        if end_index >= total_tokens:
            break
        restart_index = max(end_index - display_budget.overlap_tokens, start_index + 1)
        aligned_restart_index = _resolve_window_restart_index(
            boundary_indexes=boundary_indexes,
            restart_index=restart_index,
            end_index=end_index,
        )
        start_index = aligned_restart_index if aligned_restart_index is not None else restart_index
    return windows


def _merge_short_tail(
    windows: list[tuple[int, int, str]],
    *,
    chunk_profile: ChunkProfile,
    display_budget: ResolvedDisplayBudget,
) -> list[tuple[int, int, str]]:
    if len(windows) < 2:
        return windows
    last_start, last_end, last_text = windows[-1]
    if estimate_token_count(last_text, chunk_profile=chunk_profile) >= display_budget.min_tokens:
        return windows
    prev_start, _, prev_text = windows[-2]
    merged_text = f"{prev_text} {last_text}".strip()
    if estimate_token_count(merged_text, chunk_profile=chunk_profile) > display_budget.max_tokens:
        return windows
    return [*windows[:-2], (prev_start, last_end, merged_text)]


def _split_structure_boundaries(
    *,
    unit_type: str,
    text: str,
    chunk_profile: ChunkProfile,
    display_budget: ResolvedDisplayBudget,
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
        display_budget=display_budget,
    )


def _group_lines_by_token_budget(
    lines: list[str],
    *,
    chunk_profile: ChunkProfile,
    display_budget: ResolvedDisplayBudget,
    prefix_text: str | None = None,
    prefer_target_split: bool = False,
) -> tuple[str, ...]:
    normalized_prefix = (prefix_text or "").strip()
    soft_target_tokens = min(
        display_budget.max_tokens,
        display_budget.target_tokens + max((display_budget.max_tokens - display_budget.target_tokens) // 2, 0),
    )

    def group_token_count(group: list[str]) -> int:
        parts = [*([normalized_prefix] if normalized_prefix else []), *group]
        return estimate_token_count("\n".join(parts), chunk_profile=chunk_profile)

    groups: list[list[str]] = []
    current_group: list[str] = []

    for line in lines:
        candidate_group = [*current_group, line]
        candidate_count = group_token_count(candidate_group)
        current_count = group_token_count(current_group) if current_group else 0
        if current_group and (
            candidate_count > display_budget.max_tokens
            or (
                prefer_target_split
                and
                candidate_count > soft_target_tokens
                and current_count >= display_budget.min_tokens
            )
        ):
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
            and group_token_count(group) < display_budget.min_tokens
            and group_token_count(merged_groups[-1] + group) <= display_budget.max_tokens
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
    display_budget: ResolvedDisplayBudget,
) -> bool:
    return all(
        estimate_token_count(segment, chunk_profile=chunk_profile) <= display_budget.max_tokens
        for segment in segments
    )


def _build_token_counter(model_name: str) -> TokenCounter:
    if model_name:
        return TiktokenTokenCounter(model_name=model_name)
    return RegexApproxTokenCounter()


def _build_student_handbook_v3_token_counter(model_name: str) -> TokenCounter:
    normalized_model_name = _normalize_embedding_model_name(model_name)
    if normalized_model_name != QWEN3_EMBEDDING_MODEL:
        raise ValueError(
            "student_handbook_semantic_v3 requires embedding model "
            f"{QWEN3_EMBEDDING_MODEL}, got {model_name or '<empty>'}"
        )
    return HuggingFaceTokenCounter(
        tokenizer_repo=QWEN3_EMBEDDING_REPO,
        display_name=QWEN3_EMBEDDING_REPO,
    )


def _load_hf_tokenizer(repo_id: str) -> Any:
    with _HF_TOKENIZER_LOAD_LOCK:
        return _load_hf_tokenizer_cached(repo_id)


@lru_cache(maxsize=4)
def _load_hf_tokenizer_cached(repo_id: str) -> Any:
    from transformers import AutoTokenizer

    local_tokenizer_path = resolve_prefetched_hf_tokenizer_path(repo_id)
    return AutoTokenizer.from_pretrained(local_tokenizer_path, local_files_only=True)


_load_hf_tokenizer.cache_clear = _load_hf_tokenizer_cached.cache_clear


def _tokenize_text(text: str) -> list[re.Match[str]]:
    return list(_TOKEN_RE.finditer(text))


def _collect_soft_boundary_indexes(
    *,
    text: str,
    token_spans: list[re.Match[str]],
) -> tuple[int, ...]:
    if not token_spans:
        return (0,)
    boundaries = {0, len(token_spans)}
    for index, span in enumerate(token_spans):
        if index == 0:
            continue
        previous_char = _previous_nonspace_char(text=text, char_index=span.start())
        if previous_char in {"\n", "。", "！", "？", "；", ":", "："}:
            boundaries.add(index)
    return tuple(sorted(boundaries))


def _previous_nonspace_char(*, text: str, char_index: int) -> str | None:
    probe = char_index - 1
    while probe >= 0:
        candidate = text[probe]
        if not candidate.isspace():
            return candidate
        probe -= 1
    return None


def _resolve_window_end_index(
    *,
    start_index: int,
    target_end_index: int,
    total_tokens: int,
    display_budget: ResolvedDisplayBudget,
    boundary_indexes: tuple[int, ...],
) -> int:
    max_end_index = min(start_index + display_budget.max_tokens, total_tokens)
    forward_boundary = _next_boundary_index(
        boundary_indexes=boundary_indexes,
        lower_bound=target_end_index,
        upper_bound=max_end_index,
    )
    if forward_boundary is not None and forward_boundary > start_index:
        return forward_boundary
    backward_boundary = _previous_boundary_index(
        boundary_indexes=boundary_indexes,
        upper_bound=target_end_index,
        lower_bound=max(start_index + 1, start_index + display_budget.min_tokens),
    )
    if backward_boundary is not None and backward_boundary > start_index:
        return backward_boundary
    return target_end_index


def _resolve_window_restart_index(
    *,
    boundary_indexes: tuple[int, ...],
    restart_index: int,
    end_index: int,
) -> int | None:
    terminal_boundary = _next_boundary_index(
        boundary_indexes=boundary_indexes,
        lower_bound=end_index,
        upper_bound=end_index,
    )
    if terminal_boundary is not None:
        return terminal_boundary

    latest_overlap_boundary = _previous_boundary_index(
        boundary_indexes=boundary_indexes,
        upper_bound=end_index - 1,
        lower_bound=restart_index,
    )
    if latest_overlap_boundary is not None:
        return latest_overlap_boundary

    return None


def _next_boundary_index(
    *,
    boundary_indexes: tuple[int, ...],
    lower_bound: int,
    upper_bound: int,
) -> int | None:
    start = bisect_left(boundary_indexes, lower_bound)
    for boundary_index in boundary_indexes[start:]:
        if boundary_index > upper_bound:
            return None
        if boundary_index >= lower_bound:
            return boundary_index
    return None


def _previous_boundary_index(
    *,
    boundary_indexes: tuple[int, ...],
    upper_bound: int,
    lower_bound: int,
) -> int | None:
    end = bisect_right(boundary_indexes, upper_bound)
    for boundary_index in reversed(boundary_indexes[:end]):
        if boundary_index < lower_bound:
            return None
        if boundary_index <= upper_bound:
            return boundary_index
    return None


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
    return bool(
        normalized
        and re.match(
            r"^(?:[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十]+、|[0-9]+\.)",
            normalized,
        )
    )


def _group_prefixed_blocks(
    groups: list[tuple[str, list[str]]],
    *,
    chunk_profile: ChunkProfile,
    display_budget: ResolvedDisplayBudget,
) -> tuple[str, ...]:
    segments: list[str] = []
    for prefix_text, blocks in groups:
        grouped = _group_lines_by_token_budget(
            blocks,
            chunk_profile=chunk_profile,
            display_budget=display_budget,
            prefix_text=prefix_text,
            prefer_target_split=True,
        )
        segments.extend(grouped)
    return tuple(segments)


def _group_article_structure_blocks(
    lines: list[str],
    *,
    chunk_profile: ChunkProfile,
    display_budget: ResolvedDisplayBudget,
) -> tuple[str, ...]:
    groups = build_article_structure_groups(lines)
    segments: list[str] = []
    for group in groups:
        prefix_text = "\n".join(group.prefix_lines).strip()
        blocks = ["\n".join(block).strip() for block in group.blocks if any(item.strip() for item in block)]
        if not blocks:
            continue
        grouped = _group_lines_by_token_budget(
            blocks,
            chunk_profile=chunk_profile,
            display_budget=display_budget,
            prefix_text=prefix_text,
            prefer_target_split=True,
        )
        segments.extend(grouped)
    return tuple(segments)


def _repair_article_subclause_boundary_context(
    segments: tuple[str, ...],
    *,
    chunk_profile: ChunkProfile,
    display_budget: ResolvedDisplayBudget,
) -> tuple[str, ...]:
    if len(segments) < 2:
        return segments

    repaired: list[str] = []
    for segment in segments:
        normalized_lines = [line.strip() for line in segment.splitlines() if line.strip()]
        if not normalized_lines or not repaired:
            repaired.append("\n".join(normalized_lines).strip())
            continue

        repair_target = _find_article_repair_target(normalized_lines)
        if repair_target is None:
            repaired.append("\n".join(normalized_lines).strip())
            continue

        target_index, first_line = repair_target
        parent_context = _infer_article_parent_context(first_line=first_line, previous_segment=repaired[-1])
        if not parent_context:
            repaired.append("\n".join(normalized_lines).strip())
            continue

        prefixed_lines = [
            *normalized_lines[:target_index],
            *parent_context,
            *normalized_lines[target_index:],
        ]
        prefixed_segment = "\n".join(prefixed_lines).strip()
        if estimate_token_count(prefixed_segment, chunk_profile=chunk_profile) > display_budget.max_tokens:
            repaired.append("\n".join(normalized_lines).strip())
            continue
        repaired.append(prefixed_segment)

    return tuple(repaired)


def _find_article_repair_target(lines: Sequence[str]) -> tuple[int, str] | None:
    for index, line in enumerate(lines):
        if _PAREN_NUMERIC_SUBCLAUSE_CONTEXT_RE.match(line):
            return index, line
        if _NUMERIC_SUBCLAUSE_CONTEXT_RE.match(line):
            return index, line
        if _looks_like_clause_line(line):
            return None
    return None


def _infer_article_parent_context(*, first_line: str, previous_segment: str) -> tuple[str, ...]:
    previous_lines = [line.strip() for line in previous_segment.splitlines() if line.strip()]
    if not previous_lines:
        return ()

    parent_lines: list[str] = []
    if _PAREN_NUMERIC_SUBCLAUSE_CONTEXT_RE.match(first_line):
        top_level_clause = _last_matching_line(previous_lines, _TOP_LEVEL_CLAUSE_CONTEXT_RE)
        numeric_clause = _last_matching_line(previous_lines, _NUMERIC_SUBCLAUSE_CONTEXT_RE)
        if top_level_clause is not None:
            parent_lines.append(top_level_clause)
        if numeric_clause is not None:
            parent_lines.append(numeric_clause)
        return tuple(parent_lines)

    if _NUMERIC_SUBCLAUSE_CONTEXT_RE.match(first_line):
        top_level_clause = _last_matching_line(previous_lines, _TOP_LEVEL_CLAUSE_CONTEXT_RE)
        if top_level_clause is not None:
            return (top_level_clause,)
    return ()


def _last_matching_line(lines: Sequence[str], pattern: re.Pattern[str]) -> str | None:
    for line in reversed(lines):
        if pattern.match(line):
            return line
    return None


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


def _normalize_embedding_model_name(model_name: str) -> str:
    normalized = model_name.strip()
    if normalized in {QWEN3_EMBEDDING_MODEL, QWEN3_EMBEDDING_REPO}:
        return QWEN3_EMBEDDING_MODEL
    return normalized


def _normalize_context_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _resolve_detail_label(
    *,
    article_text: str | None,
    provision_text: str | None,
    table_text: str | None,
) -> str | None:
    if article_text:
        return f"条款：{article_text}"
    if provision_text:
        return f"款项：{provision_text}"
    if table_text:
        return f"表格：{table_text}"
    return None


def _append_header_variant(
    variants: list[ChunkHeaderVariant],
    *,
    mode: str,
    base_line: str | None,
    doc_no_line: str | None = None,
) -> None:
    lines = tuple(
        line.strip()
        for line in (base_line, doc_no_line)
        if isinstance(line, str) and line.strip()
    )
    if not lines:
        return
    _append_existing_variant(variants, ChunkHeaderVariant(mode=mode, lines=lines))


def _append_existing_variant(
    variants: list[ChunkHeaderVariant],
    variant: ChunkHeaderVariant,
) -> None:
    variant_text = variant.joined_text()
    if not variant_text:
        return
    if any(existing.joined_text() == variant_text for existing in variants):
        return
    variants.append(variant)


def _compose_contextual_chunk_text(
    *,
    display_text: str,
    variant: ChunkHeaderVariant,
    chunk_profile: ChunkProfile,
) -> tuple[str, int]:
    header_text = variant.joined_text()
    if not header_text:
        return display_text, 0
    candidate_text = "\n".join([header_text, display_text]).strip()
    header_token_count = estimate_token_count(header_text, chunk_profile=chunk_profile)
    return candidate_text, header_token_count


__all__ = [
    "DEFAULT_CHUNK_OVERLAP",
    "DEFAULT_CHUNK_POLICY_VERSION",
    "DEFAULT_CHUNK_SIZE",
    "DEFAULT_CLEANING_POLICY_VERSION",
    "DEFAULT_MAX_CHUNK_SIZE",
    "DEFAULT_MIN_CHUNK_SIZE",
    "DEFAULT_SAFETY_MARGIN",
    "DEFAULT_SPLIT_STRATEGY",
    "DEFAULT_STRATEGY_NAME",
    "HANDBOOK_V3_CHUNK_POLICY_VERSION",
    "TABLE_PLACEHOLDER",
    "TABLE_UNIT_TYPES",
    "ChunkProfile",
    "ChunkTextAssembly",
    "ChunkTextContextPlan",
    "HuggingFaceTokenCounter",
    "RegexApproxTokenCounter",
    "ResolvedDisplayBudget",
    "SemanticChunkPiece",
    "StructuredUnitChunkInput",
    "StudentHandbookChunkingStrategy",
    "StudentHandbookChunkingStrategyV2",
    "TiktokenTokenCounter",
    "assemble_chunk_text",
    "build_chunk_text_context",
    "build_student_handbook_chunk_profile",
    "chunk_table_unit",
    "chunk_structured_unit",
    "clean_structured_text",
    "estimate_token_count",
    "resolve_display_budget",
    "serialize_table_unit_text",
]
