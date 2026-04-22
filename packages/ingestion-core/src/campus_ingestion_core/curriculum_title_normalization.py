from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping

_TRAILING_EDITION_SUFFIX_PATTERN = re.compile(r"\(\s*20\d{2}\s*版\s*\)$")


def normalize_curriculum_title_for_match(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip()
    if not normalized:
        return ""
    normalized = " ".join(normalized.split())
    normalized = _TRAILING_EDITION_SUFFIX_PATTERN.sub("", normalized).strip()
    return normalized


def canonicalize_curriculum_manifest_heading(
    *,
    row: Mapping[str, object],
    clean_text: str,
    manifest_title: str,
) -> str:
    if str(row.get("row_type") or "") != "heading":
        return clean_text
    if not _row_is_manifest_title_candidate(row):
        return clean_text
    if normalize_curriculum_title_for_match(clean_text) != normalize_curriculum_title_for_match(
        manifest_title
    ):
        return clean_text
    return manifest_title.strip() or clean_text


def _row_is_manifest_title_candidate(row: Mapping[str, object]) -> bool:
    block_role = str(row.get("block_role") or "").strip()
    if block_role in {"doc_title", "paragraph_title", "text_heading_candidate"}:
        return True
    title_candidate_score = row.get("title_candidate_score")
    return isinstance(title_candidate_score, (int, float)) and float(title_candidate_score) > 0
