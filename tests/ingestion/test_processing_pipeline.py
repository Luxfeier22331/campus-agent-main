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
from tests.ingestion._handbook_chunking_test_support import build_hermetic_handbook_v3_chunk_profile


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
        embedding_model="Qwen3-Embedding-4B",
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


def _structured_unit_row(
    *,
    doc_id: str,
    version_id: str,
    chunk_id: str,
    unit_type: str,
    root_unit_id: str,
    clean_text: str,
    anchor: dict[str, object] | None = None,
    metadata: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": chunk_id,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "clean_text": clean_text,
        "anchor": anchor or {},
        "metadata": metadata or {},
        "acl": {"level": "public", "allow_groups": []},
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
        self.assertEqual(chunk.metadata["unit_type"], "policy_page")
        self.assertEqual(chunk.metadata["root_unit_id"], "legacy-chunk-001")
        self.assertEqual(chunk.metadata["segment_index"], 1)
        self.assertEqual(chunk.metadata["segment_total"], 1)
        self.assertIsNone(chunk.metadata["split_reason"])
        self.assertIsNone(chunk.metadata["boundary_rule"])
        self.assertEqual(chunk.metadata["strategy_name"], "student_handbook_structure")
        self.assertEqual(chunk.metadata["split_strategy"], "structure_first")
        self.assertEqual(chunk.metadata["chunk_policy_version"], DEFAULT_CHUNK_POLICY_VERSION)
        self.assertEqual(chunk.metadata["cleaning_policy_version"], DEFAULT_CLEANING_POLICY_VERSION)
        self.assertEqual(chunk.metadata["display_text"], "Student handbook library hours are from 08:00 to 22:00.")
        self.assertFalse(chunk.metadata["contextualized_text"])
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
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
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
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
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
                _handbook_source_row(1, "paragraph", "民大校发〔2018〕329号"),
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
            embedding_model="Qwen3-Embedding-4B",
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
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 2)
        self.assertTrue(all(chunk.document_id == cleanup_result.doc_id for chunk in chunks))
        self.assertTrue(all(chunk.revision_track == "source-faithful" for chunk in chunks))
        self.assertTrue(all(chunk.version_id == cleanup_result.version_id for chunk in chunks))
        self.assertEqual(
            {chunk.metadata["unit_type"] for chunk in chunks},
            {"article_body", "table_unit"},
        )
        self.assertTrue(all(1 <= int(chunk.anchor["page_start"]) <= 2 for chunk in chunks))

    def test_build_indexable_chunks_contextualizes_handbook_text_with_document_metadata(self) -> None:
        cleanup_result = cleanup_handbook_document(
            structured_rows=[
                _handbook_source_row(1, "heading", "中央民族大学奖学金评定办法"),
                _handbook_source_row(1, "paragraph", "民大校发〔2018〕329号"),
                _handbook_source_row(1, "paragraph", "第一条 奖学金评定坚持公开、公平、公正。"),
            ],
            manifest_document=SplitManifestDocument(
                document_id="manifest:scholarship-policy",
                title="中央民族大学奖学金评定办法",
                page_start=1,
                page_end=1,
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
            embedding_model="Qwen3-Embedding-4B",
            source_channel="pdf_ocr",
            raw_asset=RawAssetRef(
                raw_asset_id="asset:student-handbook-master-pdf",
                raw_version_id="sha256:raw-001",
                page_start=1,
                page_end=1,
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
            processed_object_keys=(),
            import_source="raw_online_ocr",
        )

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=serialize_handbook_document_units(cleanup_result.document_units),
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        article_chunk = next(chunk for chunk in chunks if chunk.metadata["unit_type"] == "article_body")
        self.assertIn("中央民族大学奖学金评定办法", article_chunk.text)
        self.assertIn("第一条", article_chunk.text)
        self.assertIn("文号：民大校发〔2018〕329号", article_chunk.text)
        self.assertIn("奖学金评定坚持公开、公平、公正", article_chunk.text)
        self.assertEqual(article_chunk.metadata["display_text"], "奖学金评定坚持公开、公平、公正。")

    def test_build_indexable_chunks_contextualizes_large_handbook_chunk_without_dropping_minimum_context(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "article-001",
                        "unit_type": "article_body",
                        "root_unit_id": "article-001",
                        "clean_text": "\n".join(
                            [
                                f"{index}、学生应严格遵守课堂纪律,维护良好的教学秩序。"
                                for index in range(3, 12)
                            ]
                        ),
                        "anchor": {
                            "section_path": ["二、学生课堂行为规范"],
                            "article_label": "第十六条",
                            "page_start": 12,
                            "page_end": 12,
                        },
                        "metadata": {
                            "title": "中央民族大学学生课堂行为规范及课堂秩序管理办法",
                            "policy_doc_no": "民大校发〔2007〕282号",
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
            chunk_profile=ChunkProfile(
                chunk_size=384,
                max_chunk_size=512,
                chunk_overlap=64,
                min_chunk_size=96,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertTrue(chunk.metadata["contextualized_text"])
        self.assertIn("中央民族大学学生课堂行为规范及课堂秩序管理办法", chunk.text)
        self.assertIn("二、学生课堂行为规范", chunk.text)
        self.assertIn("第十六条", chunk.text)
        self.assertIn("3、学生应严格遵守课堂纪律", chunk.text)

    def test_build_indexable_chunks_merges_adjacent_short_textual_units_before_embedding(self) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生管理规定",
            "policy_doc_no": "民大校发〔2024〕12号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-002",
                        unit_type="article_body",
                        root_unit_id="article-002",
                        clean_text="学生应按时注册。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第二条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-003",
                        unit_type="article_body",
                        root_unit_id="article-003",
                        clean_text="学生应按时缴费。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第三条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-004",
                        unit_type="article_body",
                        root_unit_id="article-004",
                        clean_text="学生应遵守宿舍秩序。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第四条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.anchor["article_label"], "第二条-第四条")
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertEqual(chunk.metadata["member_unit_count"], 3)
        self.assertEqual(
            chunk.metadata["member_root_unit_ids"],
            ["article-002", "article-003", "article-004"],
        )
        self.assertEqual(
            chunk.metadata["member_article_labels"],
            ["第二条", "第三条", "第四条"],
        )
        self.assertIn("第二条 学生应按时注册。", chunk.metadata["display_text"])
        self.assertIn("第三条 学生应按时缴费。", chunk.metadata["display_text"])
        self.assertIn("第四条 学生应遵守宿舍秩序。", chunk.metadata["display_text"])
        self.assertIn("第二条-第四条", chunk.text)

    def test_build_indexable_chunks_does_not_merge_short_textual_units_across_table_units(self) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生管理规定",
            "policy_doc_no": "民大校发〔2024〕12号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-002",
                        unit_type="article_body",
                        root_unit_id="article-002",
                        clean_text="学生应按时注册。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第二条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="table-001",
                        unit_type="table_unit",
                        root_unit_id="table-001",
                        clean_text="学生类别 | 管理要求\n本科生 | 按学期注册",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "table_context": "学生类别与管理要求",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata={
                            **metadata,
                            "table_header_line": "学生类别 | 管理要求",
                            "table_row_lines": ["本科生 | 按学期注册"],
                        },
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-003",
                        unit_type="article_body",
                        root_unit_id="article-003",
                        clean_text="学生应按时缴费。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第三条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 3)
        self.assertEqual(
            [chunk.metadata["unit_type"] for chunk in chunks],
            ["article_body", "table_unit", "article_body"],
        )
        self.assertIsNone(chunks[0].metadata.get("aggregation_mode"))
        self.assertIsNone(chunks[2].metadata.get("aggregation_mode"))
        self.assertEqual(chunks[1].metadata["unit_type"], "table_unit")

    def test_build_indexable_chunks_absorbs_trailing_short_tail_into_previous_textual_chunk(self) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生管理规定",
            "policy_doc_no": "民大校发〔2024〕12号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-002",
                        unit_type="article_body",
                        root_unit_id="article-002",
                        clean_text="学生应当遵守学校管理制度。",
                        anchor={
                            "section_path": ["第三章 学生支持"],
                            "article_label": "第二条",
                            "page_start": 2,
                            "page_end": 2,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-003",
                        unit_type="article_body",
                        root_unit_id="article-003",
                        clean_text="学生应当完成学籍注册。",
                        anchor={
                            "section_path": ["第三章 学生支持"],
                            "article_label": "第三条",
                            "page_start": 2,
                            "page_end": 2,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-004",
                        unit_type="article_body",
                        root_unit_id="article-004",
                        clean_text="学生应当按时缴纳相关费用。",
                        anchor={
                            "section_path": ["第三章 学生支持"],
                            "article_label": "第四条",
                            "page_start": 2,
                            "page_end": 2,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-005",
                        unit_type="article_body",
                        root_unit_id="article-005",
                        clean_text="学生应当维护校园秩序。",
                        anchor={
                            "section_path": ["第三章 学生支持"],
                            "article_label": "第五条",
                            "page_start": 2,
                            "page_end": 2,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-006",
                        unit_type="article_body",
                        root_unit_id="article-006",
                        clean_text="本办法自公布之日起施行。",
                        anchor={
                            "section_path": ["第三章 学生支持"],
                            "article_label": "第六条",
                            "page_start": 2,
                            "page_end": 2,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.anchor["article_label"], "第二条-第六条")
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertEqual(chunk.metadata["member_unit_count"], 5)
        self.assertIn("第五条", chunk.metadata["display_text"])
        self.assertIn("第六条 本办法自公布之日起施行。", chunk.metadata["display_text"])

    def test_build_indexable_chunks_merges_first_article_even_when_only_first_has_preface_text(self) -> None:
        record = _make_registry_record()
        base_metadata = {
            "title": "中央民族大学学生资助管理工作暂行办法",
            "policy_doc_no": "民大校发〔2012〕357号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-001",
                        unit_type="article_body",
                        root_unit_id="article-001",
                        clean_text="坚持公平、公开、公正原则,合理分配资助资源。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata={
                            **base_metadata,
                            "preface_text": "为规范学校学生资助工作,制定本办法。",
                        },
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-002",
                        unit_type="article_body",
                        root_unit_id="article-002",
                        clean_text="坚持资助与解困、助学与育人相结合的原则。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第二条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=base_metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.anchor["article_label"], "第一条-第二条")
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertNotIn("preface_text", chunk.metadata)
        self.assertIn("第一条 坚持公平、公开、公正原则", chunk.metadata["display_text"])
        self.assertIn("第二条 坚持资助与解困、助学与育人相结合的原则。", chunk.metadata["display_text"])

    def test_build_indexable_chunks_merges_short_policy_page_siblings_under_shared_parent(self) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生志愿服务管理办法",
            "policy_doc_no": "民大团发〔2010〕14号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-010",
                        unit_type="policy_page",
                        root_unit_id="policy-010",
                        clean_text="志愿服务认证是针对注册志愿服务组织、志愿者组织和参加的各项志愿服务活动而定期开展的志愿服务评定工作。",
                        anchor={
                            "section_path": ["第二章 分则", "第二部分 认证"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-011",
                        unit_type="policy_page",
                        root_unit_id="policy-011",
                        clean_text="(一)每学年第一学期,针对全体注册志愿者开展志愿服务认证。",
                        anchor={
                            "section_path": ["第二章 分则", "第二部分 认证", "一、认证时间"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-012",
                        unit_type="policy_page",
                        root_unit_id="policy-012",
                        clean_text="共青团中央民族大学委员会(青年志愿者工作部)。",
                        anchor={
                            "section_path": ["第二章 分则", "第二部分 认证", "三、认证程序"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertEqual(chunk.metadata["member_unit_count"], 3)
        self.assertEqual(chunk.anchor["section_path"], ["第二章 分则", "第二部分 认证"])
        self.assertIn("第二部分 认证", chunk.text)
        self.assertIn("(一)每学年第一学期,针对全体注册志愿者开展志愿服务认证。", chunk.metadata["display_text"])
        self.assertIn("共青团中央民族大学委员会(青年志愿者工作部)。", chunk.metadata["display_text"])
        self.assertNotIn("一、认证时间 (一)每学年第一学期", chunk.metadata["display_text"])
        self.assertNotIn("三、认证程序 共青团中央民族大学委员会", chunk.metadata["display_text"])

    def test_build_indexable_chunks_does_not_repeat_policy_section_heading_inside_display_text(self) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生课堂行为规范及课堂秩序管理办法",
            "policy_doc_no": "民大校发[2007]282号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-020",
                        unit_type="policy_page",
                        root_unit_id="policy-020",
                        clean_text="12、学生课堂行为规范和秩序的管理依照“全员参与、分级管理”的原则进行。",
                        anchor={
                            "section_path": ["三、学生课堂秩序管理"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-021",
                        unit_type="policy_page",
                        root_unit_id="policy-021",
                        clean_text="四、本办法由学生工作部(处)负责解释。",
                        anchor={
                            "section_path": ["三、学生课堂秩序管理"],
                            "provision_label": "四",
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=512,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertIn("12、学生课堂行为规范和秩序的管理依照", chunk.metadata["display_text"])
        self.assertNotIn("三、学生课堂秩序管理 12、", chunk.metadata["display_text"])
        self.assertIn("\n\n四、本办法由学生工作部(处)负责解释。", chunk.metadata["display_text"])
        self.assertNotIn("三、学生课堂秩序管理 12、", chunk.text)

    def test_build_indexable_chunks_does_not_merge_policy_procedure_block_with_closing_provisions(self) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学全日制本科学生学士学位授予规定",
            "policy_doc_no": "民大校发[2009]90号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-030",
                        unit_type="policy_page",
                        root_unit_id="policy-030",
                        clean_text="\n".join(
                            [
                                "1. 学生本人提出申请,填报学士学位申请表。",
                                "2. 院(系)学位委员会对提出申请授予学士学位的学生进行审核,提出建议授予学士学位名单和不授予学士学位名单。",
                                "3. 教务处审核全部学生材料并负责向校学位委员会提出召开学士学位评定委员会会议。",
                                "4. 校学位委员会审查通过获得学士学位的学生名单。",
                            ]
                        ),
                        anchor={
                            "section_path": ["三、学士学位授予程序"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-031",
                        unit_type="policy_page",
                        root_unit_id="policy-031",
                        clean_text="四、学士学位证书遗失不予补发。如遗失或者损坏,经本人申请,学校核实后出具相应的证明书。证明书与原证书具有同等效力。",
                        anchor={
                            "section_path": ["三、学士学位授予程序"],
                            "provision_label": "四",
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-032",
                        unit_type="policy_page",
                        root_unit_id="policy-032",
                        clean_text="五、本规定自2009年3月17日起实施。",
                        anchor={
                            "section_path": ["三、学士学位授予程序"],
                            "provision_label": "五",
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-033",
                        unit_type="policy_page",
                        root_unit_id="policy-033",
                        clean_text="六、本规定由教务处负责解释。",
                        anchor={
                            "section_path": ["三、学士学位授予程序"],
                            "provision_label": "六",
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=512,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 2)
        self.assertNotIn("四、学士学位证书遗失不予补发", chunks[0].metadata["display_text"])
        self.assertEqual(chunks[1].anchor["provision_label"], "四-六")
        self.assertEqual(chunks[1].metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertIn("四、学士学位证书遗失不予补发", chunks[1].metadata["display_text"])
        self.assertIn("五、本规定自2009年3月17日起实施。", chunks[1].metadata["display_text"])
        self.assertIn("六、本规定由教务处负责解释。", chunks[1].metadata["display_text"])

if __name__ == "__main__":
    unittest.main()
