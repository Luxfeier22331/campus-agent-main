from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Literal, Protocol

from campus_ingestion_core.chunking_context import (
    ChunkTextAssembly,
    ChunkTextContextPlan,
    ResolvedDisplayBudget,
    _dedupe_context_section_path,
    _normalize_context_text,
    assemble_chunk_text,
    build_chunk_text_context,
    resolve_display_budget,
)
from campus_ingestion_core.chunking_structure import (
    build_clause_groups as _build_clause_groups,
)
from campus_ingestion_core.chunking_structure import (
    build_enumerated_groups as _build_enumerated_groups,
)
from campus_ingestion_core.chunking_structure import (
    group_article_structure_blocks as _group_article_structure_blocks,
)
from campus_ingestion_core.chunking_structure import (
    group_lines_by_token_budget as _group_lines_by_token_budget,
)
from campus_ingestion_core.chunking_structure import (
    group_prefixed_blocks as _group_prefixed_blocks,
)
from campus_ingestion_core.chunking_structure import (
    looks_like_clause_line as _looks_like_clause_line,
)
from campus_ingestion_core.chunking_structure import (
    looks_like_roster_line as _looks_like_roster_line,
)
from campus_ingestion_core.chunking_structure import (
    repair_article_subclause_boundary_context as _repair_article_subclause_boundary_context,
)
from campus_ingestion_core.chunking_structure import (
    segments_within_budget as _segments_within_budget,
)
from campus_ingestion_core.chunking_tables import (
    build_table_piece_specs as _build_table_piece_specs,
)
from campus_ingestion_core.chunking_tables import (
    serialize_table_unit_text,
)
from campus_ingestion_core.chunking_token_windows import (
    collect_soft_boundary_indexes as _collect_soft_boundary_indexes,
)
from campus_ingestion_core.chunking_token_windows import (
    merge_short_tail as _merge_short_tail,
)
from campus_ingestion_core.chunking_token_windows import (
    split_token_windows as _split_token_windows,
)
from campus_ingestion_core.chunking_token_windows import (
    tokenize_text as _tokenize_text,
)
from campus_ingestion_core.chunking_tokenizers import (
    DEFAULT_TOKENIZER_NAME,
    HuggingFaceTokenCounter,
    RegexApproxTokenCounter,
    TiktokenTokenCounter,
    TokenCounter,
)
from campus_ingestion_core.chunking_tokenizers import (
    build_curriculum_token_counter as _build_curriculum_token_counter,
)
from campus_ingestion_core.chunking_tokenizers import (
    build_student_handbook_v3_token_counter as _build_student_handbook_v3_token_counter,
)
from campus_ingestion_core.chunking_tokenizers import (
    build_token_counter as _build_token_counter,
)
from campus_ingestion_core.handbook_article_structure import (
    article_structure_has_nested_subclauses,
)

__all__ = ("_dedupe_context_section_path", "_normalize_context_text")

DEFAULT_CHUNK_SIZE = 240
DEFAULT_MAX_CHUNK_SIZE = 360
DEFAULT_CHUNK_OVERLAP = 48
DEFAULT_MIN_CHUNK_SIZE = 40
DEFAULT_SPLIT_STRATEGY: Literal["structure_first", "token_budget"] = "structure_first"
DEFAULT_CHUNK_POLICY_VERSION = "structure_first_semantic_v1"
DEFAULT_CLEANING_POLICY_VERSION = "generic_cleaning_v1"
DEFAULT_STRATEGY_NAME = "structure_first_default_v1"
DEFAULT_SAFETY_MARGIN = 0

HANDBOOK_V1_CHUNK_POLICY_VERSION = "student_handbook_semantic_v1"
HANDBOOK_CLEANING_POLICY_VERSION = "student_handbook_cleaning_v1"
HANDBOOK_V1_STRATEGY_NAME = "student_handbook_structure_v1"
CURRICULUM_V1_CHUNK_POLICY_VERSION = "curriculum_plan_semantic_v1"
CURRICULUM_V1_CHUNK_SIZE = 360
CURRICULUM_V1_MAX_CHUNK_SIZE = 540
CURRICULUM_V1_CHUNK_OVERLAP = 72
CURRICULUM_V1_MIN_CHUNK_SIZE = 50
CURRICULUM_V1_STRATEGY_NAME = "curriculum_plan_structure_v1"
CURRICULUM_V2_CHUNK_POLICY_VERSION = "curriculum_plan_semantic_v2"
CURRICULUM_V2_CHUNK_SIZE = 360
CURRICULUM_V2_MAX_CHUNK_SIZE = 540
CURRICULUM_V2_CHUNK_OVERLAP = 72
CURRICULUM_V2_MIN_CHUNK_SIZE = 50
CURRICULUM_V2_TABLE_CHUNK_SIZE = 420
CURRICULUM_V2_TABLE_MAX_CHUNK_SIZE = 640
CURRICULUM_V2_TABLE_CHUNK_OVERLAP = 72
CURRICULUM_V2_TABLE_MIN_CHUNK_SIZE = 64
CURRICULUM_V2_STRATEGY_NAME = "curriculum_plan_structure_v2"
CURRICULUM_CLEANING_POLICY_VERSION = "curriculum_plan_cleaning_v1"
OFFICIAL_WEB_V2_CHUNK_POLICY_VERSION = "official_web_semantic_v2"
OFFICIAL_WEB_CLEANING_POLICY_VERSION = "official_web_cleaning_v2"
OFFICIAL_WEB_V2_CHUNK_SIZE = 288
OFFICIAL_WEB_V2_MAX_CHUNK_SIZE = 384
OFFICIAL_WEB_V2_CHUNK_OVERLAP = 48
OFFICIAL_WEB_V2_MIN_CHUNK_SIZE = 72
OFFICIAL_WEB_V2_STRATEGY_NAME = "official_web_structure_v2"

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

TABLE_PLACEHOLDER = "[table omitted; see table evidence]"
PARENT_UNIT_TYPES = {"article_body", "policy_page", "section_text"}
TABLE_UNIT_TYPES = {"table", "table_row", "table_unit"}
TEXTUAL_UNIT_TYPES = {"article_body", "policy_page"}

_TABLE_HTML_RE = re.compile(r"<table\b[\s\S]*?</table>", re.IGNORECASE)
_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s]")


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

        if unit_type == "article_body" and all(
            _looks_like_clause_line(line) for line in candidate_lines
        ):
            grouped = _group_lines_by_token_budget(
                candidate_lines,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            )
            if len(grouped) > 1 and _segments_within_budget(
                grouped,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            ):
                return StructuralSplitResult(segments=grouped, boundary_rule="clause_line")
            return None

        if unit_type == "policy_page" and all(
            _looks_like_roster_line(line) for line in candidate_lines
        ):
            grouped = _group_lines_by_token_budget(
                candidate_lines,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            )
            if len(grouped) > 1 and _segments_within_budget(
                grouped,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
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
                    display_budget=display_budget,
                    count_tokens=lambda text: estimate_token_count(
                        text, chunk_profile=chunk_profile
                    ),
                )
                structured = _repair_article_subclause_boundary_context(
                    structured,
                    display_budget=display_budget,
                    count_tokens=lambda text: estimate_token_count(
                        text, chunk_profile=chunk_profile
                    ),
                )
                if len(structured) > 1 and _segments_within_budget(
                    structured,
                    display_budget=display_budget,
                    count_tokens=lambda text: estimate_token_count(
                        text, chunk_profile=chunk_profile
                    ),
                ):
                    return StructuralSplitResult(
                        segments=structured, boundary_rule="article_structure_block"
                    )
            grouped = _group_prefixed_blocks(
                _build_clause_groups(candidate_lines),
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            )
            grouped = _repair_article_subclause_boundary_context(
                grouped,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            )
            if len(grouped) > 1 and _segments_within_budget(
                grouped,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            ):
                return StructuralSplitResult(segments=grouped, boundary_rule="clause_block")
            return None

        if unit_type == "policy_page":
            grouped = _group_prefixed_blocks(
                _build_enumerated_groups(candidate_lines),
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            )
            if len(grouped) > 1 and _segments_within_budget(
                grouped,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            ):
                return StructuralSplitResult(
                    segments=grouped, boundary_rule="enumerated_list_block"
                )
            if all(_looks_like_roster_line(line) for line in candidate_lines):
                roster = _group_lines_by_token_budget(
                    candidate_lines,
                    display_budget=display_budget,
                    count_tokens=lambda text: estimate_token_count(
                        text, chunk_profile=chunk_profile
                    ),
                )
                if len(roster) > 1 and _segments_within_budget(
                    roster,
                    display_budget=display_budget,
                    count_tokens=lambda text: estimate_token_count(
                        text, chunk_profile=chunk_profile
                    ),
                ):
                    return StructuralSplitResult(segments=roster, boundary_rule="roster_line")
            return None

        return None


class CurriculumChunkingStrategy:
    def split_structure_boundaries(
        self,
        *,
        unit_type: str,
        text: str,
        chunk_profile: ChunkProfile,
        display_budget: ResolvedDisplayBudget,
    ) -> StructuralSplitResult | None:
        candidate_lines = [line.strip() for line in text.splitlines() if line.strip()]
        if unit_type != "section_text" or len(candidate_lines) < 2:
            return None
        if article_structure_has_nested_subclauses(candidate_lines):
            structured = _group_article_structure_blocks(
                candidate_lines,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            )
            structured = _repair_article_subclause_boundary_context(
                structured,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            )
            if len(structured) > 1 and _segments_within_budget(
                structured,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            ):
                return StructuralSplitResult(
                    segments=structured, boundary_rule="curriculum_structure_block"
                )
        grouped = _group_prefixed_blocks(
            _build_enumerated_groups(candidate_lines),
            display_budget=display_budget,
            count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
        )
        if len(grouped) > 1 and _segments_within_budget(
            grouped,
            display_budget=display_budget,
            count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
        ):
            return StructuralSplitResult(
                segments=grouped, boundary_rule="curriculum_enumerated_block"
            )
        return None


class OfficialWebChunkingStrategy:
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
        if unit_type in {"section_text", "directory_entry"}:
            grouped = _group_lines_by_token_budget(
                candidate_lines,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
                prefer_target_split=True,
            )
            if len(grouped) > 1 and _segments_within_budget(
                grouped,
                display_budget=display_budget,
                count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
            ):
                return StructuralSplitResult(
                    segments=grouped, boundary_rule="official_web_line_budget"
                )
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
    profile_version: str = HANDBOOK_V1_CHUNK_POLICY_VERSION,
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
            cleaning_policy_version=HANDBOOK_CLEANING_POLICY_VERSION,
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
            cleaning_policy_version=HANDBOOK_CLEANING_POLICY_VERSION,
            strategy_name=HANDBOOK_V3_STRATEGY_NAME,
            strategy=StudentHandbookChunkingStrategyV2(),
            token_counter=token_counter,
            tokenizer_name=token_counter.name,
            final_text_aware=True,
            safety_margin=HANDBOOK_V3_SAFETY_MARGIN,
        )
    token_counter = _build_token_counter(resolved_model_name)
    return ChunkProfile(
        chunk_policy_version=HANDBOOK_V1_CHUNK_POLICY_VERSION,
        cleaning_policy_version=HANDBOOK_CLEANING_POLICY_VERSION,
        strategy_name=HANDBOOK_V1_STRATEGY_NAME,
        strategy=StudentHandbookChunkingStrategy(),
        token_counter=token_counter,
        tokenizer_name=token_counter.name,
    )


def build_curriculum_chunk_profile(
    *,
    profile_version: str = CURRICULUM_V2_CHUNK_POLICY_VERSION,
    model_name: str | None = None,
    unit_type: str | None = None,
) -> ChunkProfile:
    resolved_model_name = (
        model_name
        or os.environ.get("INGESTION_EMBEDDING_MODEL")
        or os.environ.get("EMBEDDING_MODEL")
        or ""
    ).strip()
    token_counter = _build_curriculum_token_counter(resolved_model_name)
    if profile_version == CURRICULUM_V1_CHUNK_POLICY_VERSION:
        return ChunkProfile(
            chunk_size=CURRICULUM_V1_CHUNK_SIZE,
            max_chunk_size=CURRICULUM_V1_MAX_CHUNK_SIZE,
            chunk_overlap=CURRICULUM_V1_CHUNK_OVERLAP,
            min_chunk_size=CURRICULUM_V1_MIN_CHUNK_SIZE,
            split_strategy="structure_first",
            chunk_policy_version=CURRICULUM_V1_CHUNK_POLICY_VERSION,
            cleaning_policy_version=CURRICULUM_CLEANING_POLICY_VERSION,
            strategy_name=CURRICULUM_V1_STRATEGY_NAME,
            strategy=CurriculumChunkingStrategy(),
            token_counter=token_counter,
            tokenizer_name=token_counter.name,
        )
    if profile_version == CURRICULUM_V2_CHUNK_POLICY_VERSION:
        chunk_size = CURRICULUM_V2_CHUNK_SIZE
        max_chunk_size = CURRICULUM_V2_MAX_CHUNK_SIZE
        chunk_overlap = CURRICULUM_V2_CHUNK_OVERLAP
        min_chunk_size = CURRICULUM_V2_MIN_CHUNK_SIZE
        if unit_type == "table_unit":
            chunk_size = CURRICULUM_V2_TABLE_CHUNK_SIZE
            max_chunk_size = CURRICULUM_V2_TABLE_MAX_CHUNK_SIZE
            chunk_overlap = CURRICULUM_V2_TABLE_CHUNK_OVERLAP
            min_chunk_size = CURRICULUM_V2_TABLE_MIN_CHUNK_SIZE
        return ChunkProfile(
            chunk_size=chunk_size,
            max_chunk_size=max_chunk_size,
            chunk_overlap=chunk_overlap,
            min_chunk_size=min_chunk_size,
            split_strategy="structure_first",
            chunk_policy_version=CURRICULUM_V2_CHUNK_POLICY_VERSION,
            cleaning_policy_version=CURRICULUM_CLEANING_POLICY_VERSION,
            strategy_name=CURRICULUM_V2_STRATEGY_NAME,
            strategy=CurriculumChunkingStrategy(),
            token_counter=token_counter,
            tokenizer_name=token_counter.name,
        )
    raise ValueError(f"unsupported curriculum chunk profile version: {profile_version}")


def build_official_web_chunk_profile(
    *,
    profile_version: str = OFFICIAL_WEB_V2_CHUNK_POLICY_VERSION,
) -> ChunkProfile:
    if profile_version != OFFICIAL_WEB_V2_CHUNK_POLICY_VERSION:
        raise ValueError(f"unsupported official_web chunk profile version: {profile_version}")
    return ChunkProfile(
        chunk_size=OFFICIAL_WEB_V2_CHUNK_SIZE,
        max_chunk_size=OFFICIAL_WEB_V2_MAX_CHUNK_SIZE,
        chunk_overlap=OFFICIAL_WEB_V2_CHUNK_OVERLAP,
        min_chunk_size=OFFICIAL_WEB_V2_MIN_CHUNK_SIZE,
        split_strategy="structure_first",
        chunk_policy_version=OFFICIAL_WEB_V2_CHUNK_POLICY_VERSION,
        cleaning_policy_version=OFFICIAL_WEB_CLEANING_POLICY_VERSION,
        strategy_name=OFFICIAL_WEB_V2_STRATEGY_NAME,
        strategy=OfficialWebChunkingStrategy(),
        token_counter=RegexApproxTokenCounter(),
        tokenizer_name=DEFAULT_TOKENIZER_NAME,
        final_text_aware=True,
        safety_margin=8,
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
        return (
            SemanticChunkPiece(
                unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=cleaned_text
            ),
        )

    display_budget = resolve_display_budget(unit=unit, chunk_profile=chunk_profile)
    token_count = estimate_token_count(cleaned_text, chunk_profile=chunk_profile)
    if token_count <= display_budget.max_tokens:
        return (
            SemanticChunkPiece(
                unit_type=unit.unit_type, root_unit_id=unit.root_unit_id, text=cleaned_text
            ),
        )

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
    boundary_indexes = _collect_soft_boundary_indexes(text=cleaned_text, token_spans=token_spans)
    windows = _split_token_windows(
        text=cleaned_text,
        token_spans=token_spans,
        display_budget=display_budget,
        count_tokens=lambda piece_text: estimate_token_count(
            piece_text, chunk_profile=chunk_profile
        ),
    )
    windows = _merge_short_tail(
        windows,
        text=cleaned_text,
        token_spans=token_spans,
        boundary_indexes=boundary_indexes,
        display_budget=display_budget,
        count_tokens=lambda piece_text: estimate_token_count(
            piece_text, chunk_profile=chunk_profile
        ),
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


def chunk_table_unit(
    *,
    unit: StructuredUnitChunkInput,
    chunk_profile: ChunkProfile,
) -> tuple[SemanticChunkPiece, ...]:
    piece_specs = _build_table_piece_specs(
        unit=unit,
        chunk_profile=chunk_profile,
        count_tokens=lambda text: estimate_token_count(text, chunk_profile=chunk_profile),
        clean_text=lambda unit_type, text: clean_structured_text(unit_type=unit_type, text=text),
        resolve_display_budget=lambda unit, chunk_profile: resolve_display_budget(
            unit=unit,
            chunk_profile=chunk_profile,
        ),
    )
    total = len(piece_specs)
    return tuple(
        SemanticChunkPiece(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=spec.text,
            segment_index=index,
            segment_total=total,
            split_reason=spec.split_reason,
        )
        for index, spec in enumerate(piece_specs, start=1)
    )


def estimate_token_count(text: str, *, chunk_profile: ChunkProfile | None = None) -> int:
    if chunk_profile is not None:
        return chunk_profile.count_tokens(text)
    return len(_TOKEN_RE.findall(text))


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
    "OfficialWebChunkingStrategy",
    "TiktokenTokenCounter",
    "assemble_chunk_text",
    "build_official_web_chunk_profile",
    "build_chunk_text_context",
    "build_student_handbook_chunk_profile",
    "chunk_table_unit",
    "chunk_structured_unit",
    "clean_structured_text",
    "estimate_token_count",
    "resolve_display_budget",
    "serialize_table_unit_text",
]
