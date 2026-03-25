from __future__ import annotations

import hashlib
from itertools import count
from pathlib import Path
import unittest
import unicodedata

from campus_ingestion_core.handbook_cleanup import cleanup_handbook_document
from campus_ingestion_core.handbook_provider_normalize import normalize_handbook_provider_result
from campus_ingestion_core.split_manifest import SplitManifestDocument

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "student_handbook"
SOURCE_ROW_SEQUENCE = count(1)


def _manifest_document(title: str, *, page_start: int = 20, page_end: int = 21) -> SplitManifestDocument:
    return SplitManifestDocument(
        document_id="manifest:placeholder",
        title=title,
        page_start=page_start,
        page_end=page_end,
        source_uri="https://campus.example/student-handbook/policy",
        handbook_section="中央民族大学学生奖励管理规定",
    )


def _source_row(page: int, row_type: str, text: str, *, block_role: str | None = None) -> dict[str, object]:
    sequence = next(SOURCE_ROW_SEQUENCE)
    return {
        "schema_version": "student_handbook_layout_elements_v1",
        "corpus": "regulations",
        "collection": "student_handbook",
        "source_artifact_id": "asset:student-handbook",
        "source_pdf": "学生手册_2018.pdf",
        "page_start": page,
        "page_end": page,
        "row_id": f"row-{page}-{sequence:04d}-{row_type}",
        "row_index": sequence,
        "ocr_provider": "paddleocr_async",
        "ocr_model": "PaddleOCR-VL-1.5",
        "provider_page_id": page,
        "provider_block_id": f"block-{page}",
        "provider_payload_ref": f"line:{page}",
        "confidence": 0.98,
        "row_type": row_type,
        "block_role": block_role or row_type,
        "heading_level": 1 if row_type == "heading" else None,
        "reading_order": sequence,
        "bbox": [0.0, 0.0, 100.0, 20.0],
        "text_raw": text,
        "text_normalized": text,
        "html": None,
        "table_cells": None,
        "is_blank": False,
        "is_repeated_candidate": False,
        "title_candidate_score": 1.0 if row_type == "heading" else 0.0,
        "section_hint": text if row_type == "heading" else None,
    }


def _normalize_title(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return " ".join(normalized.strip().split())


def _normalize_body(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()
    lines = [" ".join(line.split()).strip() for line in normalized.split("\n")]
    return "\n".join(line for line in lines if line)


def _load_fixture_rows(fixture_name: str) -> list[dict[str, object]]:
    return normalize_handbook_provider_result(
        source_pdf="学生手册_2018.pdf",
        provider_jsonl_bytes=(FIXTURE_DIR / fixture_name).read_bytes(),
        ocr_provider="paddleocr_async",
        ocr_model="PaddleOCR-VL-1.5",
        source_artifact_id="asset:student-handbook-master-pdf",
    )


class HandbookCanonicalTest(unittest.TestCase):
    def test_cleanup_uses_title_hash_for_doc_id(self) -> None:
        title = "中央民族大学优秀本科毕业生评选办法"
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(20, "heading", title, block_role="title"),
                _source_row(20, "paragraph", "第一条 为做好评选工作"),
            ],
            manifest_document=_manifest_document(title),
            source_doc="学生手册_2018.pdf",
        )

        expected = "handbook:" + hashlib.sha1(_normalize_title(title).encode("utf-8")).hexdigest()
        self.assertEqual(result.doc_id, expected)

    def test_cleanup_uses_normalized_title_and_body_for_version_id(self) -> None:
        title = "中央民族大学优秀本科毕业生评选办法"
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(20, "heading", "  中央民族大学优秀本科毕业生评选办法  ", block_role="title"),
                _source_row(20, "paragraph", "第一条   为做好评选工作"),
                _source_row(21, "paragraph", "第二条  评选过程坚持公开公平公正"),
            ],
            manifest_document=_manifest_document(title),
            source_doc="学生手册_2018.pdf",
        )

        canonical_body = (
            "### 第一条\n"
            "为做好评选工作\n\n"
            "### 第二条\n"
            "评选过程坚持公开公平公正"
        )
        expected = "v1:" + hashlib.sha1(
            f"{_normalize_title(title)}\n\n{_normalize_body(canonical_body)}".encode("utf-8")
        ).hexdigest()
        self.assertEqual(result.version_id, expected)

    def test_cleanup_metadata_only_keeps_stable_handbook_fields(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(20, "heading", "中央民族大学优秀本科毕业生评选办法", block_role="title"),
                _source_row(20, "paragraph", "民大校发〔2018〕329号"),
                _source_row(20, "paragraph", "第一条 为做好评选工作"),
            ],
            manifest_document=_manifest_document("中央民族大学优秀本科毕业生评选办法"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(
            result.metadata,
            {
                "title": "中央民族大学优秀本科毕业生评选办法",
                "source_doc": "学生手册_2018.pdf",
                "page_start": 20,
                "page_end": 21,
                "policy_doc_no": "民大校发〔2018〕329号",
                "handbook_section": "中央民族大学学生奖励管理规定",
            },
        )
        self.assertIn("corpus: regulations", result.canonical_markdown)
        self.assertIn("collection: student_handbook", result.canonical_markdown)

    def test_cleanup_normalizes_square_bracket_policy_doc_no(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(20, "heading", "中央民族大学本科学生学籍管理办法", block_role="title"),
                _source_row(20, "paragraph", "民大校发 [2017] 304号"),
                _source_row(20, "paragraph", "第一条 为了维护学校正常的教育教学秩序。"),
            ],
            manifest_document=_manifest_document("中央民族大学本科学生学籍管理办法"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.metadata["policy_doc_no"], "民大校发[2017]304号")
        self.assertIn("policy_doc_no: '民大校发[2017]304号'", result.canonical_markdown)

    def test_cleanup_keeps_policy_doc_no_and_front_matter_text_in_canonical_body_order(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(20, "heading", "中央民族大学本科学生学籍管理办法", block_role="title"),
                _source_row(20, "paragraph", "民大校发 [2017] 304号"),
                _source_row(20, "paragraph", "2017年9月1日"),
                _source_row(20, "heading", "第一章 总则", block_role="heading"),
                _source_row(20, "paragraph", "第一条 为做好学籍管理工作。"),
            ],
            manifest_document=_manifest_document("中央民族大学本科学生学籍管理办法"),
            source_doc="学生手册_2018.pdf",
        )

        body = result.canonical_markdown.split("---\n")[-1]
        self.assertIn("# 中央民族大学本科学生学籍管理办法", body)
        self.assertIn("2017年9月1日", body)
        self.assertNotIn("民大校发[2017]304号", body)
        self.assertLess(body.index("2017年9月1日"), body.index("## 第一章 总则"))
        self.assertIn("policy_doc_no: '民大校发[2017]304号'", result.canonical_markdown)

    def test_fixture_update_keeps_title_hash_identity(self) -> None:
        stable = cleanup_handbook_document(
            structured_rows=_load_fixture_rows("provider-result-stable.jsonl"),
            manifest_document=_manifest_document("中央民族大学奖学金评定办法", page_start=1, page_end=1),
            source_doc="学生手册_2018.pdf",
        )
        updated = cleanup_handbook_document(
            structured_rows=_load_fixture_rows("provider-result-updated.jsonl"),
            manifest_document=_manifest_document("中央民族大学奖学金评定办法", page_start=1, page_end=1),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(stable.doc_id, updated.doc_id)
        self.assertNotEqual(stable.version_id, updated.version_id)


if __name__ == "__main__":
    unittest.main()
