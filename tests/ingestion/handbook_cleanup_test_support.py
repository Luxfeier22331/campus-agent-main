from __future__ import annotations

import unittest

from itertools import count

from pathlib import Path

from campus_ingestion_core.handbook_cleanup import (
    cleanup_handbook_document,
    normalize_handbook_article_body_text,
    normalize_handbook_body_text,
)

from campus_ingestion_core.handbook_provider_normalize import normalize_handbook_provider_result

from campus_ingestion_core.split_manifest import SplitManifestDocument

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "student_handbook"

SOURCE_ROW_SEQUENCE = count(1)


def _manifest_document(
    page_start: int,
    page_end: int,
    *,
    title: str = "制度标题",
    handbook_section: str = "中央民族大学学生日常管理规定",
) -> SplitManifestDocument:
    return SplitManifestDocument(
        document_id="manifest:placeholder",
        title=title,
        page_start=page_start,
        page_end=page_end,
        source_uri="https://campus.example/student-handbook/policy",
        handbook_section=handbook_section,
    )


def _source_row(
    page: int,
    row_type: str,
    text: str,
    *,
    block_role: str | None = None,
    table_cells: list[list[str]] | None = None,
    html: str | None = None,
    title_candidate_score: float = 0.0,
    is_repeated_candidate: bool | None = None,
    classification_confidence: float = 0.9,
    classification_reason: str = "test_fixture",
) -> dict[str, object]:
    sequence = next(SOURCE_ROW_SEQUENCE)
    return {
        "schema_version": "student_handbook_layout_elements_v3",
        "corpus": "regulations",
        "collection": "student_rules",
        "source_artifact_id": "asset:student-handbook",
        "source_pdf": "学生手册_2018.pdf",
        "page_start": page,
        "page_end": page,
        "row_id": f"page-{page:04d}-{sequence:04d}-{row_type}",
        "row_index": sequence,
        "ocr_provider": "paddleocr_async",
        "ocr_model": "PaddleOCR-VL-1.5",
        "provider_page_id": page,
        "provider_block_id": f"block-{page:04d}",
        "provider_payload_ref": f"line:{page}",
        "confidence": 0.98,
        "row_type": row_type,
        "block_role": block_role or row_type,
        "heading_level": 1 if row_type == "heading" else None,
        "reading_order": sequence,
        "bbox": [0.0, 0.0, 100.0, 20.0],
        "text_raw": text,
        "text_normalized": text,
        "html": html,
        "table_cells": table_cells,
        "is_blank": False,
        "is_repeated_candidate": (
            row_type in {"header", "footer", "page_number"}
            if is_repeated_candidate is None
            else is_repeated_candidate
        ),
        "title_candidate_score": title_candidate_score,
        "section_hint": text if row_type == "heading" else None,
        "classification_confidence": classification_confidence,
        "classification_reason": classification_reason,
        "repeat_cluster_id": None,
        "repeat_frequency": 0,
        "repeat_position_band": None,
        "parent_heading_hint": None,
        "list_level_hint": None,
        "continues_from_previous_page": False,
        "continues_to_next_page": False,
        "table_fragment_id": None,
        "table_header_rows": table_cells[:1] if table_cells else None,
        "table_row_count": len(table_cells) if table_cells else None,
        "table_column_count": len(table_cells[0]) if table_cells else None,
        "table_has_merged_cells": False if table_cells else None,
        "table_caption_hint": None,
    }


def _load_fixture_rows(fixture_name: str) -> list[dict[str, object]]:
    return normalize_handbook_provider_result(
        source_pdf="学生手册_2018.pdf",
        provider_jsonl_bytes=(FIXTURE_DIR / fixture_name).read_bytes(),
        ocr_provider="paddleocr_async",
        ocr_model="PaddleOCR-VL-1.5",
        source_artifact_id="asset:student-handbook-master-pdf",
    )


__all__ = [name for name in globals() if not name.startswith("__")]
