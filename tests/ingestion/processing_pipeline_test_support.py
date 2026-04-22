from __future__ import annotations

import json
import unittest

from campus_ingestion_core.chunking import (
    CURRICULUM_CLEANING_POLICY_VERSION,
    CURRICULUM_V2_CHUNK_POLICY_VERSION,
    DEFAULT_CHUNK_OVERLAP,
    DEFAULT_CHUNK_POLICY_VERSION,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_CLEANING_POLICY_VERSION,
    TABLE_PLACEHOLDER,
    ChunkProfile,
    StudentHandbookChunkingStrategy,
    build_curriculum_chunk_profile,
)
from campus_ingestion_core.embed import MockEmbeddingSettings, build_mock_embedding_model
from campus_ingestion_core.handbook_cleanup import (
    cleanup_handbook_document,
    serialize_handbook_document_units,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRef
from campus_ingestion_core.object_store import build_processed_artifact_key
from campus_ingestion_core.process import IndexableChunk, build_indexable_chunks_from_jsonl
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
        collection="student_rules",
        entitlement_groups=("students", "staff"),
        visibility_scope=None,
        status="active",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="campusrag-import-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        document_units_object_key=build_processed_artifact_key(
            corpus="regulations",
            collection="student_rules",
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
                collection="student_rules",
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


def _make_public_registry_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="handbook:test-public",
        revision_track="source-faithful",
        version_id="v1:test-public",
        source_uri="https://campus.example/handbook/test-public",
        content_hash="sha256:test-public",
        corpus="regulations",
        collection="student_rules",
        entitlement_groups=(),
        visibility_scope=None,
        status="active",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="campusrag-import-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        document_units_object_key=build_processed_artifact_key(
            corpus="regulations",
            collection="student_rules",
            document_id="handbook:test-public",
            revision_track="source-faithful",
            version_id="v1:test-public",
            title=None,
            year=None,
            filename="document-units.jsonl",
        ),
        processed_object_keys=(
            build_processed_artifact_key(
                corpus="regulations",
                collection="student_rules",
                document_id="handbook:test-public",
                revision_track="source-faithful",
                version_id="v1:test-public",
                title=None,
                year=None,
                filename="document-units.jsonl",
            ),
        ),
        import_source="raw_online_ocr",
    )


def _make_curriculum_registry_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="curriculum:test-001",
        revision_track="source-faithful",
        version_id="v1:curriculum-test-001",
        source_uri="campusrag://source/curriculum/test/pages/1-1",
        content_hash="sha256:curriculum-test-001",
        corpus="curriculum",
        collection="curriculum_plan",
        cleaning_policy_version=CURRICULUM_CLEANING_POLICY_VERSION,
        entitlement_groups=("students",),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-27T10:00:00+00:00",
        parser_version="raw-online-ocr-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        document_units_object_key=build_processed_artifact_key(
            corpus="curriculum",
            collection="curriculum_plan",
            document_id="curriculum:test-001",
            revision_track="source-faithful",
            version_id="v1:curriculum-test-001",
            title=None,
            year=None,
            filename="document-units.jsonl",
        ),
        processed_object_keys=(
            build_processed_artifact_key(
                corpus="curriculum",
                collection="curriculum_plan",
                document_id="curriculum:test-001",
                revision_track="source-faithful",
                version_id="v1:curriculum-test-001",
                title=None,
                year=None,
                filename="document-units.jsonl",
            ),
        ),
        import_source="raw_online_ocr",
    )


def _make_official_web_registry_record(
    *, collection: str = "muc_public_pages"
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="official_web:muc_public:listing_page:test-001",
        revision_track="source-faithful",
        version_id="owdocver:test-001",
        source_uri="https://news.muc.edu.cn/jxky.htm",
        content_hash="sha256:official-web-test-001",
        corpus="official_web",
        collection=collection,
        cleaning_policy_version="official_web_cleaning_v1",
        status="active",
        ingestion_timestamp="2026-04-02T10:00:00+00:00",
        parser_version="official_web_projection_replay.v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="official_web",
        is_current=True,
        import_source="manual_chunk_test",
    )


def _handbook_source_row(
    page: int, row_type: str, text: str, *, html: str | None = None
) -> dict[str, object]:
    return {
        "schema_version": "student_handbook_layout_elements_v3",
        "corpus": "regulations",
        "collection": "student_rules",
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
        "classification_confidence": 0.95,
        "classification_reason": "test_fixture",
        "repeat_cluster_id": None,
        "repeat_frequency": 0,
        "repeat_position_band": None,
        "parent_heading_hint": None,
        "list_level_hint": None,
        "continues_from_previous_page": False,
        "continues_to_next_page": False,
        "table_fragment_id": None,
        "table_header_rows": [["项目", "说明"]] if row_type == "table" else None,
        "table_row_count": 2 if row_type == "table" else None,
        "table_column_count": 2 if row_type == "table" else None,
        "table_has_merged_cells": False if row_type == "table" else None,
        "table_caption_hint": None,
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


__all__ = [name for name in globals() if not name.startswith("__")]
