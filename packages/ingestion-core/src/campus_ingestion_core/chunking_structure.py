from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from typing import Protocol

from campus_ingestion_core.handbook_article_structure import build_article_structure_groups

_CLAUSE_BOUNDARY_RE = re.compile(
    r"^(?:第[一二三四五六七八九十百千万〇零两0-9]+条|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十]+、|[0-9]+\.)"
)
_ROSTER_LINE_RE = re.compile(r"\d{5,}")
_ENUMERATED_LINE_RE = re.compile(
    r"^(?:第[一二三四五六七八九十百千万〇零两0-9]+条|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十]+、|[0-9]+\.)"
)
_TOP_LEVEL_CLAUSE_CONTEXT_RE = re.compile(
    r"^(?:[（(][一二三四五六七八九十百千万〇零两]+[)）]|[一二三四五六七八九十百千万〇零两]+、)"
)
_NUMERIC_SUBCLAUSE_CONTEXT_RE = re.compile(r"^[0-9]+[.、]")
_PAREN_NUMERIC_SUBCLAUSE_CONTEXT_RE = re.compile(r"^[（(][0-9]+[)）]")


class DisplayBudgetLike(Protocol):
    max_tokens: int
    target_tokens: int
    min_tokens: int


def group_lines_by_token_budget(
    lines: list[str],
    *,
    display_budget: DisplayBudgetLike,
    count_tokens: Callable[[str], int],
    prefix_text: str | None = None,
    prefer_target_split: bool = False,
) -> tuple[str, ...]:
    normalized_prefix = (prefix_text or "").strip()
    soft_target_tokens = min(
        display_budget.max_tokens,
        display_budget.target_tokens
        + max((display_budget.max_tokens - display_budget.target_tokens) // 2, 0),
    )

    def group_token_count(group: list[str]) -> int:
        parts = [*([normalized_prefix] if normalized_prefix else []), *group]
        return count_tokens("\n".join(parts))

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
                and candidate_count > soft_target_tokens
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


def segments_within_budget(
    segments: tuple[str, ...],
    *,
    display_budget: DisplayBudgetLike,
    count_tokens: Callable[[str], int],
) -> bool:
    return all(count_tokens(segment) <= display_budget.max_tokens for segment in segments)


def looks_like_clause_line(line: str) -> bool:
    return bool(_CLAUSE_BOUNDARY_RE.match(line.strip()))


def looks_like_roster_line(line: str) -> bool:
    normalized = line.strip()
    return bool(normalized and _ROSTER_LINE_RE.search(normalized))


def build_clause_groups(lines: list[str]) -> list[tuple[str, list[str]]]:
    enumerated_indices = [index for index, line in enumerate(lines) if looks_like_clause_line(line)]
    if len(enumerated_indices) < 2:
        return [("", lines)]
    return _build_prefixed_groups(
        lines=lines,
        is_block_start=looks_like_clause_line,
    )


def build_enumerated_groups(lines: list[str]) -> list[tuple[str, list[str]]]:
    enumerated_indices = [
        index for index, line in enumerate(lines) if _looks_like_enumerated_line(line)
    ]
    if len(enumerated_indices) < 2:
        return [("", lines)]
    return _build_prefixed_groups(
        lines=lines,
        is_block_start=starts_new_enumerated_block,
    )


def starts_new_enumerated_block(line: str) -> bool:
    normalized = line.strip()
    return bool(
        normalized
        and re.match(
            r"^(?:[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十]+、|[0-9]+\.)",
            normalized,
        )
    )


def group_prefixed_blocks(
    groups: list[tuple[str, list[str]]],
    *,
    display_budget: DisplayBudgetLike,
    count_tokens: Callable[[str], int],
) -> tuple[str, ...]:
    segments: list[str] = []
    for prefix_text, blocks in groups:
        grouped = group_lines_by_token_budget(
            blocks,
            display_budget=display_budget,
            count_tokens=count_tokens,
            prefix_text=prefix_text,
            prefer_target_split=True,
        )
        segments.extend(grouped)
    return tuple(segments)


def group_article_structure_blocks(
    lines: list[str],
    *,
    display_budget: DisplayBudgetLike,
    count_tokens: Callable[[str], int],
) -> tuple[str, ...]:
    groups = build_article_structure_groups(lines)
    segments: list[str] = []
    for group in groups:
        prefix_text = "\n".join(group.prefix_lines).strip()
        blocks = [
            "\n".join(block).strip()
            for block in group.blocks
            if any(item.strip() for item in block)
        ]
        if not blocks:
            continue
        grouped = group_lines_by_token_budget(
            blocks,
            display_budget=display_budget,
            count_tokens=count_tokens,
            prefix_text=prefix_text,
            prefer_target_split=True,
        )
        segments.extend(grouped)
    return tuple(segments)


def repair_article_subclause_boundary_context(
    segments: tuple[str, ...],
    *,
    display_budget: DisplayBudgetLike,
    count_tokens: Callable[[str], int],
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
        parent_context = _infer_article_parent_context(
            first_line=first_line, previous_segment=repaired[-1]
        )
        if not parent_context:
            repaired.append("\n".join(normalized_lines).strip())
            continue

        prefixed_lines = [
            *normalized_lines[:target_index],
            *parent_context,
            *normalized_lines[target_index:],
        ]
        prefixed_segment = "\n".join(prefixed_lines).strip()
        if count_tokens(prefixed_segment) > display_budget.max_tokens:
            repaired.append("\n".join(normalized_lines).strip())
            continue
        repaired.append(prefixed_segment)

    return tuple(repaired)


def _looks_like_enumerated_line(line: str) -> bool:
    return bool(_ENUMERATED_LINE_RE.match(line.strip()))


def _find_article_repair_target(lines: Sequence[str]) -> tuple[int, str] | None:
    for index, line in enumerate(lines):
        if _PAREN_NUMERIC_SUBCLAUSE_CONTEXT_RE.match(line):
            return index, line
        if _NUMERIC_SUBCLAUSE_CONTEXT_RE.match(line):
            return index, line
        if looks_like_clause_line(line):
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


__all__ = [
    "build_clause_groups",
    "build_enumerated_groups",
    "group_article_structure_blocks",
    "group_lines_by_token_budget",
    "group_prefixed_blocks",
    "looks_like_clause_line",
    "looks_like_roster_line",
    "repair_article_subclause_boundary_context",
    "segments_within_budget",
    "starts_new_enumerated_block",
]
