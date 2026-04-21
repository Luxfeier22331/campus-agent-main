from __future__ import annotations

from campus_ingestion_core.handbook_cleanup_normalize import (
    ARTICLE_PREFIX_RE,
    SHORT_HEADING_BODY_STARTERS,
    SHORT_HEADING_WHITELIST,
    _find_boundary_overlap,
    _has_unclosed_citation_context,
    _looks_like_title_like_heading_remainder,
    _split_short_heading_from_body,
    build_handbook_doc_id,
    build_handbook_version_id,
    normalize_handbook_article_body_text,
    normalize_handbook_body_text,
    normalize_handbook_title,
)
from campus_ingestion_core.handbook_cleanup_policy import (
    _looks_like_appendix_leaf_section_heading,
)
from campus_ingestion_core.handbook_cleanup_projection import (
    cleanup_handbook_document,
    extract_handbook_title_candidate,
    serialize_handbook_document_units,
    validate_handbook_manifest_title,
)
from campus_ingestion_core.handbook_cleanup_shared import (
    HandbookCleanupResult,
    NormalizedHandbookTable,
)

__all__ = [
    "ARTICLE_PREFIX_RE",
    "HandbookCleanupResult",
    "NormalizedHandbookTable",
    "SHORT_HEADING_BODY_STARTERS",
    "SHORT_HEADING_WHITELIST",
    "_find_boundary_overlap",
    "_has_unclosed_citation_context",
    "_looks_like_appendix_leaf_section_heading",
    "_looks_like_title_like_heading_remainder",
    "_split_short_heading_from_body",
    "build_handbook_doc_id",
    "build_handbook_version_id",
    "cleanup_handbook_document",
    "extract_handbook_title_candidate",
    "normalize_handbook_article_body_text",
    "normalize_handbook_body_text",
    "normalize_handbook_title",
    "serialize_handbook_document_units",
    "validate_handbook_manifest_title",
]
