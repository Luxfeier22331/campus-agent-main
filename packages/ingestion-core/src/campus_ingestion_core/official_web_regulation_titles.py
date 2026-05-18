from __future__ import annotations

import re
from dataclasses import dataclass

TRIAL_TITLE_QUALIFIERS = frozenset({"试行", "暂行"})
SOURCE_TITLE_MARKERS = frozenset({"最新"})
_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_CJK_INTERNAL_SPACE_RE = re.compile(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])")


@dataclass(frozen=True, slots=True)
class NormalizedOfficialWebRegulationTitle:
    display_title: str
    base_title: str
    raw_title: str
    source_title_marker: str | None = None
    status_kind: str | None = None
    status_qualifier: str | None = None


def normalize_official_web_regulation_title(title: str) -> NormalizedOfficialWebRegulationTitle:
    raw_title = title.strip()
    normalized = _collapse_spaced_cjk_runs(raw_title)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    marker: str | None = None
    status_qualifier: str | None = None
    status_kind: str | None = None
    while True:
        stripped_title, qualifier = _strip_terminal_parenthetical(normalized)
        if qualifier is None:
            break
        normalized_qualifier = qualifier.strip()
        if normalized_qualifier in SOURCE_TITLE_MARKERS:
            marker = normalized_qualifier
            normalized = stripped_title
            continue
        if normalized_qualifier in TRIAL_TITLE_QUALIFIERS:
            status_qualifier = normalized_qualifier
            status_kind = "trial"
            normalized = f"{stripped_title}（{normalized_qualifier}）"
            break
        break
    base_title = normalized
    if status_qualifier is not None:
        base_title = normalized.removesuffix(f"（{status_qualifier}）").strip()
    return NormalizedOfficialWebRegulationTitle(
        display_title=normalized,
        base_title=base_title,
        raw_title=raw_title,
        source_title_marker=marker,
        status_kind=status_kind,
        status_qualifier=status_qualifier,
    )


def official_web_regulation_title_metadata(
    title_info: NormalizedOfficialWebRegulationTitle,
) -> dict[str, object]:
    metadata: dict[str, object] = {}
    if title_info.source_title_marker is not None:
        metadata["title_source_marker"] = title_info.source_title_marker
    if title_info.status_qualifier is not None:
        metadata["title_status_qualifier"] = title_info.status_qualifier
    if title_info.status_kind is not None:
        metadata["title_status_kind"] = title_info.status_kind
    return metadata


def _collapse_spaced_cjk_runs(value: str) -> str:
    current = value
    while True:
        updated = _CJK_INTERNAL_SPACE_RE.sub("", current)
        if updated == current:
            return updated
        current = updated


def _strip_terminal_parenthetical(value: str) -> tuple[str, str | None]:
    stripped = value.strip()
    for left, right in (("（", "）"), ("(", ")")):
        if not stripped.endswith(right):
            continue
        start = stripped.rfind(left)
        if start <= 0:
            continue
        qualifier = stripped[start + 1 : -1].strip()
        if qualifier:
            return stripped[:start].strip(), qualifier
    return stripped, None


__all__ = [
    "NormalizedOfficialWebRegulationTitle",
    "normalize_official_web_regulation_title",
    "official_web_regulation_title_metadata",
]
