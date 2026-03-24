from __future__ import annotations

import json
import unittest

from campus_ingestion_core.chunking import (
    DEFAULT_CHUNK_OVERLAP,
    DEFAULT_CHUNK_POLICY_VERSION,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_CLEANING_POLICY_VERSION,
    TABLE_PLACEHOLDER,
    ChunkProfile,
    StudentHandbookChunkingStrategy,
)
from campus_ingestion_core.embed import MockEmbeddingSettings, build_mock_embedding_model
from campus_ingestion_core.handbook_cleanup import cleanup_handbook_document, serialize_handbook_document_units
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRef
from campus_ingestion_core.object_store import build_processed_artifact_key
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.split_manifest import SplitManifestDocument


def _make_registry_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="handbook:test-001",
        revision_track="source-faithful",
        version_id="v1:test-001",
        source_uri="https://campus.example/handbook/test-001",
        content_hash="sha256:test-001",
        corpus="regulations",
        collection="student_handbook",
        acl_groups=("students", "staff"),
        campus_scope=None,
        status="active",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="campusrag-import-v1",
        embedding_model="text-embedding-3-large",
        source_channel="pdf_ocr",
        document_units_object_key=build_processed_artifact_key(
            corpus="regulations",
            collection="student_handbook",
            document_id="handbook:test-001",
            revision_track="source-faithful",
            version_id="v1:test-001",
            title=None,
            year=None,
            filename="document-units.jsonl",
        ),
        processed_object_keys=(
            build_processed_artifact_key(
                corpus="regulations",
                collection="student_handbook",
                document_id="handbook:test-001",
                revision_track="source-faithful",
                version_id="v1:test-001",
                title=None,
                year=None,
                filename="document-units.jsonl",
            ),
        ),
        import_source="raw_online_ocr",
    )


def _handbook_source_row(page: int, row_type: str, text: str, *, html: str | None = None) -> dict[str, object]:
    return {
        "schema_version": "student_handbook_layout_elements_v1",
        "corpus": "regulations",
        "collection": "student_handbook",
        "source_artifact_id": "asset:student-handbook-master-pdf",
        "source_pdf": "student-handbook.pdf",
        "page_start": page,
        "page_end": page,
        "row_id": f"page-{page:04d}-{row_type}",
        "row_index": page,
        "ocr_provider": "paddleocr_async",
        "ocr_model": "PaddleOCR-VL-1.5",
        "provider_page_id": page,
        "provider_block_id": f"block-{page:04d}",
        "provider_payload_ref": f"line:{page}",
        "confidence": 0.98,
        "row_type": row_type,
        "block_role": "title" if row_type == "heading" else row_type,
        "heading_level": 1 if row_type == "heading" else None,
        "reading_order": 1,
        "bbox": [0.0, 0.0, 100.0, 20.0],
        "text_raw": text,
        "text_normalized": text,
        "html": html,
        "table_cells": [["项目", "说明"], ["等级", "一等奖"]] if row_type == "table" else None,
        "is_blank": False,
        "is_repeated_candidate": False,
        "title_candidate_score": 1.0 if row_type == "heading" else 0.0,
        "section_hint": text if row_type == "heading" else None,
    }


class ProcessingPipelineTest(unittest.TestCase):
    def test_default_chunk_profile_matches_current_student_handbook_runtime_truth(self) -> None:
        profile = ChunkProfile()

        self.assertEqual(profile.chunk_size, DEFAULT_CHUNK_SIZE)
        self.assertEqual(profile.chunk_overlap, DEFAULT_CHUNK_OVERLAP)
        self.assertEqual(profile.split_strategy, "structure_first")
        self.assertEqual(profile.chunk_policy_version, DEFAULT_CHUNK_POLICY_VERSION)
        self.assertEqual(profile.cleaning_policy_version, DEFAULT_CLEANING_POLICY_VERSION)
        self.assertEqual(profile.strategy_name, "student_handbook_structure")
        self.assertIsInstance(profile.strategy, StudentHandbookChunkingStrategy)

    def test_build_indexable_chunks_from_jsonl_keeps_required_metadata(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "legacy-chunk-001",
                        "clean_text": "Student handbook library hours are from 08:00 to 22:00.",
                        "anchor": {
                            "section_path": ["Student Handbook", "Library", "Hours"],
                            "page_start": 12,
                            "page_end": 12,
                        },
                        "acl": {
                            "level": "public",
                            "allow_groups": [],
                        },
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(chunk_size=128, max_chunk_size=192, chunk_overlap=16, min_chunk_size=32),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.document_id, "handbook:test-001")
        self.assertEqual(chunk.revision_track, "source-faithful")
        self.assertEqual(chunk.version_id, "v1:test-001")
        self.assertEqual(chunk.chunk_id, "handbook:test-001:source-faithful:v1:test-001:chunk-0001")
        self.assertEqual(chunk.corpus, "regulations")
        self.assertEqual(chunk.acl_groups, ("students", "staff"))
        self.assertIsNone(chunk.campus_scope)
        self.assertEqual(chunk.source_chunk_id, "legacy-chunk-001")
        self.assertEqual(chunk.anchor["page_start"], 12)
        self.assertEqual(chunk.source_channel, "pdf_ocr")
        self.assertFalse(chunk.is_current)
        self.assertEqual(
            chunk.metadata,
            {
                "unit_type": "policy_page",
                "root_unit_id": "legacy-chunk-001",
                "segment_index": 1,
                "segment_total": 1,
                "split_reason": None,
                "boundary_rule": None,
                "strategy_name": "student_handbook_structure",
                "split_strategy": "structure_first",
                "chunk_policy_version": DEFAULT_CHUNK_POLICY_VERSION,
                "cleaning_policy_version": DEFAULT_CLEANING_POLICY_VERSION,
            },
        )
        self.assertIn("library hours", chunk.text.lower())

    def test_build_indexable_chunks_from_jsonl_rewrites_parent_table_html_to_placeholder(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "legacy-chunk-001",
                        "unit_type": "article_body",
                        "root_unit_id": "article-001",
                        "clean_text": (
                            "Library opening hours are listed below.\n"
                            "<table><tr><td>Mon</td><td>08:00-22:00</td></tr></table>\n"
                            "The library remains open for regular student use."
                        ),
                        "anchor": {
                            "section_path": ["Student Handbook", "Library", "Hours"],
                            "page_start": 12,
                            "page_end": 12,
                        },
                        "acl": {"level": "public", "allow_groups": []},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.source_chunk_id, "legacy-chunk-001")
        self.assertEqual(chunk.metadata["unit_type"], "article_body")
        self.assertEqual(chunk.metadata["root_unit_id"], "article-001")
        self.assertNotIn("<table>", chunk.text)
        self.assertIn(TABLE_PLACEHOLDER, chunk.text)
        self.assertIn("library remains open", chunk.text.lower())

    def test_build_indexable_chunks_from_jsonl_splits_oversized_unit_and_keeps_root_metadata(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "legacy-chunk-001",
                        "unit_type": "article_body",
                        "root_unit_id": "article-001",
                        "clean_text": " ".join(f"token-{index:04d}" for index in range(520)),
                    }
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        self.assertGreater(len(chunks), 1)
        self.assertEqual(
            tuple(chunk.metadata["segment_index"] for chunk in chunks),
            tuple(range(1, len(chunks) + 1)),
        )
        self.assertTrue(all(chunk.metadata["segment_total"] == len(chunks) for chunk in chunks))
        self.assertTrue(all(chunk.metadata["split_reason"] == "token_guardrail" for chunk in chunks))
        self.assertTrue(all(chunk.metadata["unit_type"] == "article_body" for chunk in chunks))
        self.assertTrue(all(chunk.metadata["root_unit_id"] == "article-001" for chunk in chunks))

    def test_build_indexable_chunks_from_jsonl_rejects_doc_version_mismatch(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:other-doc",
                        "version_id": "v1:test-001",
                        "clean_text": "Mismatched document id.",
                    }
                )
            ]
        ).encode("utf-8")

        with self.assertRaises(ValueError):
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=structured_payload,
                chunk_profile=ChunkProfile(chunk_size=128, max_chunk_size=192, chunk_overlap=16, min_chunk_size=32),
            )

    def test_build_indexable_chunks_from_jsonl_falls_back_to_raw_text(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "raw_text": "Raw text fallback remains indexable.",
                        "anchor": {"page_start": 1, "page_end": 1},
                    }
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(chunk_size=128, max_chunk_size=192, chunk_overlap=16, min_chunk_size=32),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].text, "Raw text fallback remains indexable.")

    def test_build_indexable_chunks_from_jsonl_rejects_synthetic_document_summary_row(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "document-0000",
                        "clean_text": "Synthetic whole-document summary text.",
                    }
                )
            ]
        ).encode("utf-8")

        with self.assertRaisesRegex(ValueError, "document-0000"):
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=structured_payload,
            )

    def test_build_indexable_chunks_from_jsonl_accepts_split_handbook_cleanup_output(self) -> None:
        cleanup_result = cleanup_handbook_document(
            structured_rows=[
                _handbook_source_row(1, "heading", "中央民族大学奖学金评定办法"),
                _handbook_source_row(1, "paragraph", "第一条 奖学金评定坚持公开、公平、公正。"),
                _handbook_source_row(2, "table", "项目 | 说明", html="<table><tr><td>项目</td><td>说明</td></tr></table>"),
            ],
            manifest_document=SplitManifestDocument(
                document_id="manifest:scholarship-policy",
                title="中央民族大学奖学金评定办法",
                page_start=1,
                page_end=2,
                source_uri="https://campus.example/handbook/scholarship-policy",
                handbook_section="中央民族大学学生奖励管理规定",
                acl_groups=("students",),
            ),
            source_doc="student-handbook.pdf",
        )
        record = DocumentRegistryRecord(
            document_id=cleanup_result.doc_id,
            revision_track="source-faithful",
            version_id=cleanup_result.version_id,
            source_uri="https://campus.example/handbook/scholarship-policy",
            content_hash="sha256:cleanup-output",
            corpus="regulations",
            collection="student_handbook",
            cleaning_policy_version="student_handbook_cleaning_v1",
            acl_groups=("students",),
            campus_scope="main",
            status="active",
            ingestion_timestamp="2026-03-23T10:00:00+00:00",
            parser_version="paddleocr-vl-1.5",
            embedding_model="text-embedding-3-large",
            source_channel="pdf_ocr",
            raw_asset=RawAssetRef(
                raw_asset_id="asset:student-handbook-master-pdf",
                raw_version_id="sha256:raw-001",
                page_start=1,
                page_end=2,
            ),
            document_units_object_key=build_processed_artifact_key(
                corpus="regulations",
                collection="student_handbook",
                document_id=cleanup_result.doc_id,
                revision_track="source-faithful",
                version_id=cleanup_result.version_id,
                title="中央民族大学奖学金评定办法",
                year=None,
                filename="document-units.jsonl",
            ),
            processed_object_keys=(
                build_processed_artifact_key(
                    corpus="regulations",
                    collection="student_handbook",
                    document_id=cleanup_result.doc_id,
                    revision_track="source-faithful",
                    version_id=cleanup_result.version_id,
                    title="中央民族大学奖学金评定办法",
                    year=None,
                    filename="document-units.jsonl",
                ),
            ),
            import_source="raw_online_ocr",
        )

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=serialize_handbook_document_units(cleanup_result.document_units),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 4)
        self.assertTrue(all(chunk.document_id == cleanup_result.doc_id for chunk in chunks))
        self.assertTrue(all(chunk.revision_track == "source-faithful" for chunk in chunks))
        self.assertTrue(all(chunk.version_id == cleanup_result.version_id for chunk in chunks))
        self.assertEqual(
            {chunk.metadata["unit_type"] for chunk in chunks},
            {"article_body", "table", "table_row"},
        )
        self.assertTrue(all(1 <= int(chunk.anchor["page_start"]) <= 2 for chunk in chunks))

if __name__ == "__main__":
    unittest.main()
