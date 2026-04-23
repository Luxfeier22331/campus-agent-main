from __future__ import annotations

import re


def _deduplicate_boundary_overlap_lines(lines: list[str]) -> list[str]:
    deduplicated: list[str] = []
    for line in lines:
        if not deduplicated:
            deduplicated.append(line)
            continue
        previous = deduplicated[-1]
        deduplicated[-1] = _deduplicate_adjacent_overlap(previous, line)
    return deduplicated


def _deduplicate_adjacent_overlap(previous: str, current: str) -> str:
    if not previous or not current:
        return previous + ("\n" + current if current else "")
    previous_line = previous.rsplit("\n", 1)[-1].strip()
    current_line = current.split("\n", 1)[0].strip()
    if previous_line and current_line:
        overlap = _find_boundary_overlap(previous_line, current_line)
        if overlap:
            current = current[len(overlap) :].lstrip()
    return f"{previous}\n{current}" if current else previous


def _find_boundary_overlap(previous: str, current: str) -> str:
    max_overlap = min(len(previous), len(current), 8)
    for overlap_length in range(max_overlap, 1, -1):
        suffix = previous[-overlap_length:]
        prefix = current[:overlap_length]
        if suffix != prefix:
            continue
        if not re.fullmatch(r"[\u4e00-\u9fff]{2,8}", suffix):
            continue
        if (
            len(previous) == overlap_length
            and len(current) > overlap_length
            and current[overlap_length : overlap_length + 1] in {"申", "需"}
        ):
            continue
        return suffix
    return ""
