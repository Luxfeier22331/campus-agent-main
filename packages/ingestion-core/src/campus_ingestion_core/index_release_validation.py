from __future__ import annotations

from collections.abc import Sequence
from itertools import pairwise

from campus_ingestion_core.curriculum_chunk_units import (
    _leading_curriculum_heading_lines,
    _looks_like_curriculum_structure_heading,
    _looks_like_curriculum_version_note,
    _normalize_curriculum_structural_path,
)
from campus_ingestion_core.index_release_hashing import (
    count_by_value as _count_by_value,
)
from campus_ingestion_core.index_release_models import IndexReleaseValidationResult
from campus_ingestion_core.process import IndexableChunk

_CURRICULUM_COURSE_MAP_HEADING = "六、课程地图"
_OFFICIAL_WEB_MIN_RELEASE_DOCUMENTS = 2
_OFFICIAL_WEB_DISALLOWED_PAGE_FAMILIES = frozenset(
    {"listing_page", "generic_content_page", "dynamic_shell_page", "structural_shell_page"}
)


def validate_scope_release(
    *,
    corpus: str,
    collection: str,
    chunks: Sequence[IndexableChunk],
    official_web_min_release_documents: int | None = None,
) -> IndexReleaseValidationResult:
    if collection == "curriculum_plan":
        return _validate_curriculum_release(chunks)
    if corpus == "official_web":
        return _validate_official_web_release(
            chunks,
            min_release_documents=(
                official_web_min_release_documents or _OFFICIAL_WEB_MIN_RELEASE_DOCUMENTS
            ),
        )
    return _validate_default_release(chunks)


def _validate_default_release(chunks: Sequence[IndexableChunk]) -> IndexReleaseValidationResult:
    token_counts = [int(chunk.metadata.get("final_token_count") or 0) for chunk in chunks]
    summary = {
        "chunk_count": len(chunks),
        "unit_type_counts": _count_by_value(
            str(chunk.metadata.get("unit_type") or "unknown") for chunk in chunks
        ),
        "token_summary": {
            "min": min(token_counts) if token_counts else 0,
            "max": max(token_counts) if token_counts else 0,
            "avg": round(sum(token_counts) / len(token_counts), 2) if token_counts else 0.0,
        },
    }
    return IndexReleaseValidationResult(status="passed", summary=summary)


def _validate_official_web_release(
    chunks: Sequence[IndexableChunk],
    *,
    min_release_documents: int,
) -> IndexReleaseValidationResult:
    if min_release_documents < 1:
        raise ValueError("official_web min release documents must be at least 1")
    token_counts = [int(chunk.metadata.get("final_token_count") or 0) for chunk in chunks]
    page_family_counts = _count_by_value(
        str(chunk.metadata.get("page_family") or "unknown") for chunk in chunks
    )
    serving_intent_counts = _count_by_value(
        str(chunk.metadata.get("serving_intent") or "unknown") for chunk in chunks
    )
    disallowed_page_family_chunks = sum(
        count
        for page_family, count in page_family_counts.items()
        if page_family in _OFFICIAL_WEB_DISALLOWED_PAGE_FAMILIES
    )
    audit_only_chunks = int(serving_intent_counts.get("audit_only") or 0)
    promotable_chunks = int(serving_intent_counts.get("promotable") or 0)
    non_promotable_serving_intent_chunks = max(len(chunks) - promotable_chunks, 0)
    unknown_serving_intent_chunks = int(serving_intent_counts.get("unknown") or 0)
    missing_page_family_chunks = int(page_family_counts.get("unknown") or 0)
    document_count = len({chunk.document_id for chunk in chunks})
    summary = {
        "chunk_count": len(chunks),
        "document_count": document_count,
        "minimum_document_count": min_release_documents,
        "documents_below_minimum": 1 if document_count < min_release_documents else 0,
        "disallowed_page_family_chunks": disallowed_page_family_chunks,
        "audit_only_chunks": audit_only_chunks,
        "non_promotable_serving_intent_chunks": non_promotable_serving_intent_chunks,
        "unknown_serving_intent_chunks": unknown_serving_intent_chunks,
        "missing_page_family_chunks": missing_page_family_chunks,
        "page_family_counts": page_family_counts,
        "serving_intent_counts": serving_intent_counts,
        "unit_type_counts": _count_by_value(
            str(chunk.metadata.get("unit_type") or "unknown") for chunk in chunks
        ),
        "token_summary": {
            "min": min(token_counts) if token_counts else 0,
            "max": max(token_counts) if token_counts else 0,
            "avg": round(sum(token_counts) / len(token_counts), 2) if token_counts else 0.0,
        },
    }
    status = (
        "passed"
        if summary["documents_below_minimum"] == 0
        and disallowed_page_family_chunks == 0
        and non_promotable_serving_intent_chunks == 0
        and missing_page_family_chunks == 0
        else "failed"
    )
    return IndexReleaseValidationResult(status=status, summary=summary)


def _validate_curriculum_release(chunks: Sequence[IndexableChunk]) -> IndexReleaseValidationResult:
    rows: list[dict[str, object]] = []
    for chunk in chunks:
        lines = [line.strip() for line in chunk.text.splitlines() if line.strip()]
        leading = _leading_curriculum_heading_lines(lines)
        structural = _normalize_curriculum_structural_path(
            list(chunk.anchor.get("section_path") or [])
        )
        first_heading = leading[0] if leading else None
        rows.append(
            {
                "tokens": int(chunk.metadata.get("final_token_count") or 0),
                "duplicated_heading": any(a == b for a, b in pairwise(leading)),
                "path_mismatch": (
                    chunk.metadata.get("unit_type") == "section_text"
                    and bool(leading)
                    and not _curriculum_has_heading_overlap(structural, leading)
                ),
                "first_heading_mismatch": bool(
                    chunk.metadata.get("unit_type") == "section_text"
                    and first_heading
                    and structural
                    and first_heading != structural[0]
                ),
                "multiple_top_level_heading_chunks": bool(
                    sum(
                        1
                        for heading in leading
                        if heading and heading[:1] in "一二三四五六七八九十" and "、" in heading
                    )
                    >= 2
                ),
                "allowed_tiny_chunk": _curriculum_is_allowed_tiny_chunk(
                    chunk=chunk,
                    lines=lines,
                    leading=leading,
                    structural=structural,
                ),
                "course_map_chunk": bool(
                    (chunk.anchor.get("section_path") or [])[-1:]
                    == [_CURRICULUM_COURSE_MAP_HEADING]
                ),
                "topology_leak": "拓扑图" in chunk.text
                and (chunk.anchor.get("section_path") or [])[-1:]
                != [_CURRICULUM_COURSE_MAP_HEADING],
            }
        )
    summary = {
        "chunk_count": len(chunks),
        "duplicated_heading_chunks": sum(1 for row in rows if row["duplicated_heading"]),
        "path_mismatch_chunks": sum(1 for row in rows if row["path_mismatch"]),
        "first_heading_mismatch_chunks": sum(1 for row in rows if row["first_heading_mismatch"]),
        "multiple_top_level_heading_chunks": sum(
            1 for row in rows if row["multiple_top_level_heading_chunks"]
        ),
        "tiny_chunks_lt24": sum(
            1 for row in rows if int(row["tokens"]) < 24 and not row["allowed_tiny_chunk"]
        ),
        "course_map_chunks": sum(1 for row in rows if row["course_map_chunk"]),
        "topology_leaks": sum(1 for row in rows if row["topology_leak"]),
    }
    status = (
        "passed"
        if all(
            int(value) == 0
            for key, value in summary.items()
            if key not in {"chunk_count", "course_map_chunks"}
        )
        else "failed"
    )
    return IndexReleaseValidationResult(status=status, summary=summary)


def _curriculum_has_heading_overlap(structural_path: list[str], leading: list[str]) -> bool:
    if not leading:
        return True
    for start in range(len(leading)):
        max_overlap = min(len(structural_path), len(leading) - start)
        for overlap in range(max_overlap, 0, -1):
            if leading[start : start + overlap] == structural_path[-overlap:]:
                return True
    return False


def _curriculum_is_allowed_tiny_chunk(
    *,
    chunk: IndexableChunk,
    lines: list[str],
    leading: list[str],
    structural: list[str],
) -> bool:
    if int(chunk.metadata.get("final_token_count") or 0) >= 24:
        return False
    if chunk.metadata.get("unit_type") != "section_text":
        return False
    if any("|" in line for line in lines):
        return False
    if (chunk.anchor.get("section_path") or [])[-1:] == [_CURRICULUM_COURSE_MAP_HEADING]:
        if not lines or len(lines) > 3:
            return False
        remainder = lines[len(leading) :] if leading else lines
        if not remainder:
            return True
        if any(
            _looks_like_curriculum_structure_heading(line)
            and line != _CURRICULUM_COURSE_MAP_HEADING
            for line in remainder
        ):
            return False
        return all(len(line) <= 32 for line in remainder)
    if "拓扑图" in chunk.text:
        return False
    if not lines or len(lines) > 4:
        return False
    if leading and len(leading) == len(lines):
        return True
    if structural and len(lines) == 1 and lines[0] == structural[-1]:
        return True
    if (
        structural
        and lines[0] == structural[-1]
        and all(_looks_like_curriculum_version_note(line) for line in lines[1:])
    ):
        return True
    if not leading:
        return False
    remainder = lines[len(leading) :]
    if not remainder or len(remainder) > 2:
        return False
    heading_remainder = [
        line for line in remainder if _looks_like_curriculum_structure_heading(line)
    ]
    if heading_remainder:
        non_heading_remainder = [
            line for line in remainder if not _looks_like_curriculum_structure_heading(line)
        ]
        return (
            len(heading_remainder) == 1
            and len(non_heading_remainder) == 1
            and len(non_heading_remainder[0]) <= 8
            and len(heading_remainder[0]) <= 16
        )
    return all(len(line) <= 32 for line in remainder)
