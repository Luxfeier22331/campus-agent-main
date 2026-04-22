from __future__ import annotations

from campus_ingestion_core.curriculum_chunk_units_build import build_curriculum_structured_units
from campus_ingestion_core.curriculum_chunk_units_chunking import (
    _build_curriculum_contextual_text,
    chunk_curriculum_unit,
)
from campus_ingestion_core.curriculum_chunk_units_shared import (
    DerivedStructuredUnit,
    _is_curriculum_course_map_title_line,
    _is_table_cue_row,
    _leading_curriculum_heading_lines,
    _looks_like_curriculum_page_marker_line,
    _looks_like_curriculum_structure_heading,
    _looks_like_curriculum_version_note,
    _normalize_curriculum_structural_path,
)

__all__ = [
    "DerivedStructuredUnit",
    "_build_curriculum_contextual_text",
    "_is_curriculum_course_map_title_line",
    "_is_table_cue_row",
    "_leading_curriculum_heading_lines",
    "_looks_like_curriculum_page_marker_line",
    "_looks_like_curriculum_structure_heading",
    "_looks_like_curriculum_version_note",
    "_normalize_curriculum_structural_path",
    "build_curriculum_structured_units",
    "chunk_curriculum_unit",
]
