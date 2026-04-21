from __future__ import annotations

import re
from bisect import bisect_left, bisect_right
from typing import Callable, Protocol

_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s]")


class DisplayBudgetLike(Protocol):
    max_tokens: int
    target_tokens: int
    min_tokens: int
    overlap_tokens: int


def tokenize_text(text: str) -> list[re.Match[str]]:
    return list(_TOKEN_RE.finditer(text))


def collect_soft_boundary_indexes(
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


def split_token_windows(
    *,
    text: str,
    token_spans: list[re.Match[str]],
    display_budget: DisplayBudgetLike,
    count_tokens: Callable[[str], int],
) -> list[tuple[int, int, str]]:
    windows: list[tuple[int, int, str]] = []
    boundary_indexes = collect_soft_boundary_indexes(text=text, token_spans=token_spans)
    start_index = 0
    total_tokens = len(token_spans)
    while start_index < total_tokens:
        remaining = total_tokens - start_index
        window_size = (
            remaining if remaining <= display_budget.max_tokens else display_budget.target_tokens
        )
        window_size = min(window_size, display_budget.max_tokens)
        target_end_index = min(
            start_index + max(window_size, display_budget.min_tokens), total_tokens
        )
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
        while end_index - start_index > 1 and count_tokens(piece_text) > display_budget.max_tokens:
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


def merge_short_tail(
    windows: list[tuple[int, int, str]],
    *,
    text: str,
    token_spans: list[re.Match[str]],
    boundary_indexes: tuple[int, ...],
    display_budget: DisplayBudgetLike,
    count_tokens: Callable[[str], int],
) -> list[tuple[int, int, str]]:
    if len(windows) < 2:
        return windows
    last_start, last_end, last_text = windows[-1]
    if count_tokens(last_text) >= display_budget.min_tokens:
        return windows
    prev_start, _, prev_text = windows[-2]
    merged_text = f"{prev_text} {last_text}".strip()
    if count_tokens(merged_text) > display_budget.max_tokens:
        rebalance_start = _resolve_short_tail_rebalance_start_index(
            prev_start=prev_start,
            last_start=last_start,
            last_end=last_end,
            boundary_indexes=boundary_indexes,
            display_budget=display_budget,
        )
        if rebalance_start is None:
            return windows
        rebalanced_text = _slice_token_window(
            text=text,
            token_spans=token_spans,
            start_index=rebalance_start,
            end_index=last_end,
        )
        rebalanced_token_count = count_tokens(rebalanced_text)
        if (
            rebalanced_token_count < display_budget.min_tokens
            or rebalanced_token_count > display_budget.max_tokens
        ):
            return windows
        return [*windows[:-1], (rebalance_start, last_end, rebalanced_text)]
    return [*windows[:-2], (prev_start, last_end, merged_text)]


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
    display_budget: DisplayBudgetLike,
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


def _resolve_short_tail_rebalance_start_index(
    *,
    prev_start: int,
    last_start: int,
    last_end: int,
    boundary_indexes: tuple[int, ...],
    display_budget: DisplayBudgetLike,
) -> int | None:
    earliest_start = max(last_end - display_budget.max_tokens, prev_start + 1)
    latest_start = min(last_end - display_budget.min_tokens, last_start - 1)
    if latest_start < earliest_start:
        return None
    boundary_start = _previous_boundary_index(
        boundary_indexes=boundary_indexes,
        upper_bound=latest_start,
        lower_bound=earliest_start,
    )
    if boundary_start is not None:
        return boundary_start
    return latest_start


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


__all__ = [
    "collect_soft_boundary_indexes",
    "merge_short_tail",
    "split_token_windows",
    "tokenize_text",
]
