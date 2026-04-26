from __future__ import annotations

import hashlib
import re
import unicodedata

from campus_ingestion_core.handbook_cleanup_normalize_overlap import _find_boundary_overlap
from campus_ingestion_core.handbook_cleanup_shared import (
    ARTICLE_PREFIX_RE,
    SHORT_HEADING_BODY_STARTERS,
    SHORT_HEADING_WHITELIST,
)
from campus_ingestion_core.handbook_cleanup_text_normalization import (
    _has_unclosed_citation_context,
    _looks_like_handbook_page_marker,
    _looks_like_title_like_heading_remainder,
    _normalize_article_label,
    _normalize_body_fragment,
    _split_glued_structural_heading,
    _split_short_heading_from_body,
    _split_title_like_heading_body,
    normalize_handbook_article_body_text,
    normalize_handbook_body_text,
)


def build_handbook_doc_id(title: str) -> str:
    return "handbook:" + hashlib.sha1(normalize_handbook_title(title).encode("utf-8")).hexdigest()


def build_handbook_version_id(title: str, canonical_body: str) -> str:
    digest_input = (
        f"{normalize_handbook_title(title)}\n\n{normalize_handbook_body_text(canonical_body)}"
    )
    return "v1:" + hashlib.sha1(digest_input.encode("utf-8")).hexdigest()


def normalize_handbook_title(value: str) -> str:
    normalized = " ".join(unicodedata.normalize("NFKC", value).strip().split())
    return re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", normalized)


__all__ = [
    "ARTICLE_PREFIX_RE",
    "SHORT_HEADING_BODY_STARTERS",
    "SHORT_HEADING_WHITELIST",
    "_find_boundary_overlap",
    "_has_unclosed_citation_context",
    "_looks_like_handbook_page_marker",
    "_looks_like_title_like_heading_remainder",
    "_normalize_article_label",
    "_normalize_body_fragment",
    "_split_glued_structural_heading",
    "_split_short_heading_from_body",
    "_split_title_like_heading_body",
    "build_handbook_doc_id",
    "build_handbook_version_id",
    "normalize_handbook_article_body_text",
    "normalize_handbook_body_text",
    "normalize_handbook_title",
]
