from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.curriculum_budget_evaluation import (
    load_default_curriculum_budget_evaluation_documents,
)
from campus_ingestion_core.curriculum_chunk_units import (
    _build_curriculum_contextual_text,
    build_curriculum_structured_units,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.raw_ingestion_split_manifest import (
    _build_split_manifest_document_input,
    _load_layout_elements_rows,
)
from campus_ingestion_core.split_manifest import SplitManifestDocument, load_split_manifest


def _make_curriculum_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="curriculum:test-001",
        revision_track="source-faithful",
        version_id="sha256:test-001:split:test-001:abc123",
        source_uri="campusrag://source/curriculum/curriculum-plan-2022/sha256/test/capture/pages/20-21",
        content_hash="sha256:test-001",
        corpus="curriculum",
        collection="curriculum_plan",
        cleaning_policy_version="curriculum_plan_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-24T10:00:00+00:00",
        parser_version="raw-online-ocr-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        document_units_object_key=(
            "curriculum/documents/curriculum_plan/test-001--test-001/source-faithful/undated/document-units.jsonl"
        ),
        processed_object_keys=(
            "official_pdf/curriculum-plan/2022/sha256/test/provider/paddleocr-vl-1-5/provider-response.jsonl",
            "official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            "curriculum/documents/curriculum_plan/test-001--test-001/source-faithful/undated/document-units.jsonl",
        ),
        import_source="raw_online_ocr",
    )


def _make_public_curriculum_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="curriculum:test-public",
        revision_track="source-faithful",
        version_id="sha256:test-public:split:test-public:abc123",
        source_uri="campusrag://source/curriculum/test-public/pages/1-1",
        content_hash="sha256:test-public",
        corpus="curriculum",
        collection="curriculum_plan",
        cleaning_policy_version="curriculum_plan_cleaning_v1",
        entitlement_groups=(),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-24T10:00:00+00:00",
        parser_version="raw-online-ocr-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        document_units_object_key=(
            "curriculum/documents/curriculum_plan/test-public--test-public/source-faithful/undated/document-units.jsonl"
        ),
        processed_object_keys=(
            "curriculum/documents/curriculum_plan/test-public--test-public/source-faithful/undated/document-units.jsonl",
        ),
        import_source="raw_online_ocr",
    )


def _build_real_curriculum_projection_chunks(
    document_id: str,
) -> tuple[DocumentRegistryRecord, tuple[object, ...]]:
    manifest = load_split_manifest(
        Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
        expected_corpus="curriculum",
        expected_collection="curriculum_plan",
    )
    layout_rows = _load_layout_elements_rows(
        Path("tests/fixtures/curriculum_plan/layout-elements.pages-278-297.jsonl").read_bytes()
    )
    target_document = next(item for item in manifest.documents if item.document_id == document_id)
    raw_version_id = "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67"
    document_input = _build_split_manifest_document_input(
        raw_asset_record=type(
            "RawAssetRecordProxy",
            (),
            {
                "raw_asset_id": "asset:curriculum-plan-2022",
                "raw_version_id": raw_version_id,
                "corpus": "curriculum",
                "collection": "curriculum_plan",
                "raw_source_uri": "file:///tmp/curriculum-plan-2022.pdf",
                "content_hash": raw_version_id.removeprefix("sha256:"),
                "source_filename": "curriculum-plan-2022.pdf",
                "object_key": "official_pdf/curriculum-plan/2022/sha256/test/capture/curriculum-plan-2022.pdf",
                "ingestion_timestamp": "2026-03-24T10:00:00+00:00",
                "import_source": "raw_online_ocr",
            },
        )(),
        manifest_version=manifest.manifest_version,
        manifest_document=target_document,
        structured_rows=layout_rows,
        provider_response_key="official_pdf/curriculum-plan/2022/sha256/test/provider/paddleocr-vl-1-5/provider-response.jsonl",
        layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
        default_visibility_scope="main",
        corpus="curriculum",
        collection="curriculum_plan",
    )
    record = DocumentRegistryRecord(
        document_id=target_document.document_id,
        revision_track="source-faithful",
        version_id=str(document_input.metadata["version_id"]),
        source_uri=str(
            document_input.metadata.get("source_url")
            or document_input.metadata.get("source_id")
            or ""
        ),
        content_hash=hashlib.sha256(document_input.document_units_bytes).hexdigest(),
        corpus="curriculum",
        collection="curriculum_plan",
        cleaning_policy_version="curriculum_plan_cleaning_v1",
        entitlement_groups=tuple(document_input.metadata.get("entitlement_groups") or ()),
        visibility_scope=str(document_input.metadata.get("visibility_scope") or "main"),
        status=str(document_input.metadata.get("status") or "active"),
        ingestion_timestamp="2026-03-27T12:00:00+00:00",
        parser_version="raw-online-ocr-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        is_current=True,
        document_units_object_key="curriculum/documents/tmp/document-units.jsonl",
        import_source="raw_online_ocr",
    )
    chunks = build_indexable_chunks_from_jsonl(
        record=record,
        structured_jsonl_bytes=document_input.document_units_bytes,
        chunk_profile=ChunkProfile(
            chunk_size=360,
            max_chunk_size=540,
            chunk_overlap=72,
            min_chunk_size=50,
            chunk_policy_version="curriculum_plan_semantic_v1",
            cleaning_policy_version="curriculum_plan_cleaning_v1",
        ),
    )
    return record, chunks


def _build_real_curriculum_runtime_chunks(
    document_title: str,
) -> tuple[DocumentRegistryRecord, tuple[object, ...]]:
    document = next(
        item
        for item in load_default_curriculum_budget_evaluation_documents(include_historical=True)
        if item.title == document_title
    )
    chunks = build_indexable_chunks_from_jsonl(
        record=document.record,
        structured_jsonl_bytes=document.structured_jsonl_bytes,
    )
    return document.record, chunks


class CurriculumChunkingTest(unittest.TestCase):
    def test_build_indexable_chunks_from_jsonl_uses_canonical_curriculum_row_visibility(
        self,
    ) -> None:
        record = _make_public_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0001-block-0001",
                        "row_id": "page-0001-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "一、培养目标",
                        "page_start": 1,
                        "page_end": 1,
                        "visibility_level": "restricted",
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0001-block-0002",
                        "row_id": "page-0001-block-0002",
                        "row_type": "paragraph",
                        "clean_text": "仅对受限用户可见的课程说明。",
                        "page_start": 1,
                        "page_end": 1,
                        "visibility_level": "restricted",
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].entitlement_groups, ())
        self.assertEqual(chunks[0].visibility_level, "restricted")

    def test_build_curriculum_contextual_text_only_prepends_missing_parent_headings(self) -> None:
        contextual_text = _build_curriculum_contextual_text(
            unit_type="section_text",
            section_path=[
                "经济学拔尖人才创新班人才培养方案",
                "二、毕业要求",
                "(二)知识要求",
            ],
            piece_text=(
                "(二)知识要求\n"
                "1. 通识性知识:掌握文学、历史、哲学、艺术、管理、法律、社会、写作等方面的知识。"
            ),
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(
            contextual_text,
            (
                "二、毕业要求\n\n"
                "(二)知识要求\n"
                "1. 通识性知识:掌握文学、历史、哲学、艺术、管理、法律、社会、写作等方面的知识。"
            ),
        )

    def test_build_curriculum_structured_units_flushes_section_before_advancing_parent_heading(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_id": "page-0020-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "二、毕业要求",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0002",
                        "row_id": "page-0020-block-0002",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "(二)知识要求",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0003",
                        "row_id": "page-0020-block-0003",
                        "row_type": "paragraph",
                        "clean_text": "1. 通识性知识:掌握文学、历史、哲学、艺术、管理、法律、社会、写作等方面的知识。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0004",
                        "row_id": "page-0020-block-0004",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "三、学制、总学分和学位授予",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0005",
                        "row_id": "page-0020-block-0005",
                        "row_type": "paragraph",
                        "clean_text": "学制:4年",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        units = build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(units), 2)
        self.assertEqual(
            units[0].anchor["section_path"],
            ["二、毕业要求", "(二)知识要求"],
        )
        self.assertTrue(units[0].text.startswith("二、毕业要求\n\n(二)知识要求"))
        self.assertNotIn("三、学制、总学分和学位授予", units[0].text)
        self.assertEqual(
            units[1].anchor["section_path"],
            ["三、学制、总学分和学位授予"],
        )
        self.assertEqual(units[1].text, "三、学制、总学分和学位授予\n\n学制:4年")

    def test_build_curriculum_structured_units_flushes_same_level_heading_only_section_before_next_section(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_id": "page-0020-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "六、课程地图",
                        "section_hint": "section",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0002",
                        "row_id": "page-0020-block-0002",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "国际经济与贸易专业本科课程结构拓扑图",
                        "section_hint": None,
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0003",
                        "row_id": "page-0020-block-0003",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "七、其他说明",
                        "section_hint": "section",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0004",
                        "row_id": "page-0020-block-0004",
                        "row_type": "paragraph",
                        "clean_text": "允许国际学分、在线课程学分等学分转换。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        units = build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(units), 2)
        self.assertEqual(units[0].anchor["section_path"], ["六、课程地图"])
        self.assertEqual(
            units[0].text,
            "六、课程地图\n\n国际经济与贸易专业本科课程结构拓扑图",
        )
        self.assertEqual(units[1].anchor["section_path"], ["七、其他说明"])
        self.assertEqual(
            units[1].text,
            "七、其他说明\n\n允许国际学分、在线课程学分等学分转换。",
        )

    def test_build_curriculum_structured_units_flushes_consecutive_same_level_structural_headings(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_id": "page-0020-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "六、课程地图",
                        "section_hint": "section",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0002",
                        "row_id": "page-0020-block-0002",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "七、其他说明",
                        "section_hint": "section",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0003",
                        "row_id": "page-0020-block-0003",
                        "row_type": "paragraph",
                        "clean_text": "允许国际学分、在线课程学分等学分转换。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        units = build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(units), 2)
        self.assertEqual(units[0].anchor["section_path"], ["六、课程地图"])
        self.assertEqual(units[0].text, "六、课程地图")
        self.assertEqual(units[1].anchor["section_path"], ["七、其他说明"])
        self.assertEqual(
            units[1].text,
            "七、其他说明\n\n允许国际学分、在线课程学分等学分转换。",
        )

    def test_build_curriculum_structured_units_flushes_heading_only_mixed_levels_before_new_parent_heading(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_id": "page-0020-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "二、毕业要求",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0002",
                        "row_id": "page-0020-block-0002",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "(一)素质要求",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0003",
                        "row_id": "page-0020-block-0003",
                        "row_type": "heading",
                        "heading_level": 4,
                        "clean_text": "1. 政治素质",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0004",
                        "row_id": "page-0020-block-0004",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "三、学制、总学分和学位授予",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0005",
                        "row_id": "page-0020-block-0005",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "学制:4年",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        units = build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(units), 2)
        self.assertEqual(
            units[0].anchor["section_path"], ["二、毕业要求", "(一)素质要求", "1. 政治素质"]
        )
        self.assertTrue(units[0].text.startswith("二、毕业要求\n\n(一)素质要求\n\n1. 政治素质"))
        self.assertNotIn("三、学制、总学分和学位授予", units[0].text)
        self.assertEqual(
            units[1].anchor["section_path"], ["三、学制、总学分和学位授予", "学制:4年"]
        )
        self.assertTrue(units[1].text.startswith("三、学制、总学分和学位授予\n\n学制:4年"))

    def test_build_indexable_chunks_from_jsonl_uses_runtime_curriculum_chunk_profile_by_default(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_id": "page-0020-block-0001",
                        "row_type": "paragraph",
                        "clean_text": "培养具有系统分析能力的经济学人才。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["chunk_policy_version"], "curriculum_plan_semantic_v2")
        self.assertEqual(
            chunks[0].metadata["cleaning_policy_version"], "curriculum_plan_cleaning_v1"
        )
        self.assertEqual(chunks[0].metadata["strategy_name"], "curriculum_plan_structure_v2")
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")

    def test_build_indexable_chunks_from_jsonl_uses_curriculum_section_and_table_units(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_id": "page-0020-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "一、培养目标",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0002",
                        "row_id": "page-0020-block-0002",
                        "row_type": "paragraph",
                        "clean_text": "培养具有国际视野、系统分析能力和跨学科协同能力的复合型人才。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0003",
                        "row_id": "page-0020-block-0003",
                        "row_type": "paragraph",
                        "clean_text": "学生应掌握宏观经济分析、政策研判和数据建模方法。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0004",
                        "row_id": "page-0020-block-0004",
                        "row_type": "table_caption",
                        "clean_text": "表 1 核心课程设置",
                        "page_start": 20,
                        "page_end": 20,
                        "owner_row_id": "page-0020-block-0005",
                        "relation_type": "caption_of",
                        "continuation_group_id": "page-0020-block-0005",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0005",
                        "row_id": "page-0020-block-0005",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>课程</td><td>学分</td></tr></table>",
                        "html": "<table><tr><td>课程</td><td>学分</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "课程",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "学分",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "宏观经济学原理",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "3",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 3,
                                "col": 1,
                                "text": "国际贸易理论",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 3,
                                "col": 2,
                                "text": "3",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 4,
                                "col": 1,
                                "text": "计量经济学方法",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 4,
                                "col": 2,
                                "text": "4",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 5,
                                "col": 1,
                                "text": "政策评估工作坊",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 5,
                                "col": 2,
                                "text": "2",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 6,
                                "col": 1,
                                "text": "跨文化商务沟通",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 6,
                                "col": 2,
                                "text": "2",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 20,
                        "page_end": 20,
                        "continuation_group_id": "page-0020-block-0005",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0021-block-0001",
                        "row_id": "page-0021-block-0001",
                        "row_type": "note",
                        "clean_text": "备注：实践类课程不少于 8 学分。",
                        "page_start": 21,
                        "page_end": 21,
                        "owner_row_id": "page-0020-block-0005",
                        "relation_type": "note_of",
                        "continuation_group_id": "page-0020-block-0005",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=24,
                max_chunk_size=30,
                chunk_overlap=4,
                min_chunk_size=8,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertGreaterEqual(len(chunks), 3)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertEqual(chunks[0].metadata["root_unit_id"], "page-0020-block-0001")
        self.assertEqual(chunks[0].anchor["page_start"], 20)
        self.assertEqual(chunks[0].anchor["page_end"], 20)
        self.assertEqual(chunks[0].anchor["section_path"], ["一、培养目标"])

        table_chunks = [chunk for chunk in chunks if chunk.metadata["unit_type"] == "table_unit"]
        self.assertGreaterEqual(len(table_chunks), 2)
        self.assertTrue(
            all(chunk.metadata["root_unit_id"] == "page-0020-block-0005" for chunk in table_chunks)
        )
        self.assertTrue(
            all(chunk.metadata["split_reason"] == "table_row_window" for chunk in table_chunks)
        )
        self.assertTrue(all(chunk.anchor["page_start"] == 20 for chunk in table_chunks))
        self.assertTrue(all(chunk.anchor["page_end"] == 21 for chunk in table_chunks))
        self.assertTrue(all("表 1 核心课程设置" in chunk.text for chunk in table_chunks))
        self.assertTrue(all("课程 | 学分" in chunk.text for chunk in table_chunks))
        self.assertTrue(
            any("备注：实践类课程不少于 8 学分。" in chunk.text for chunk in table_chunks)
        )

    def test_build_indexable_chunks_from_jsonl_requires_row_id_for_curriculum_document_units(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "一、培养目标",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        with self.assertRaisesRegex(ValueError, "missing row_id"):
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=structured_payload,
                chunk_profile=ChunkProfile(
                    chunk_size=24,
                    max_chunk_size=30,
                    chunk_overlap=4,
                    min_chunk_size=8,
                    chunk_policy_version="curriculum_plan_semantic_v1",
                    cleaning_policy_version="curriculum_plan_cleaning_v1",
                ),
            )

    def test_build_indexable_chunks_from_jsonl_rejects_heading_without_heading_level(self) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_id": "page-0020-block-0001",
                        "row_type": "heading",
                        "clean_text": "一、培养目标",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        with self.assertRaisesRegex(ValueError, "heading_level"):
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=structured_payload,
                chunk_profile=ChunkProfile(
                    chunk_size=24,
                    max_chunk_size=30,
                    chunk_overlap=4,
                    min_chunk_size=8,
                    chunk_policy_version="curriculum_plan_semantic_v1",
                    cleaning_policy_version="curriculum_plan_cleaning_v1",
                ),
            )

    def test_build_indexable_chunks_from_jsonl_keeps_non_table_notes_in_section_text(self) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0337-block-0001",
                        "row_id": "page-0337-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "四、各学期课程修读说明",
                        "page_start": 337,
                        "page_end": 337,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0337-block-0002",
                        "row_id": "page-0337-block-0002",
                        "row_type": "paragraph",
                        "clean_text": "第一学年以通识课和学科基础课为主。",
                        "page_start": 337,
                        "page_end": 337,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0337-block-0003",
                        "row_id": "page-0337-block-0003",
                        "row_type": "note",
                        "clean_text": "通识课和学科基础课为主",
                        "page_start": 337,
                        "page_end": 337,
                        "owner_row_id": "page-0337-block-0002",
                        "relation_type": "note_of",
                        "continuation_group_id": "page-0337-block-0002",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertIn("第一学年以通识课和学科基础课为主。", chunks[0].text)
        self.assertIn("通识课和学科基础课为主", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_merges_curriculum_subsection_marker_into_following_table_chunk(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0300-block-0001",
                        "row_id": "page-0300-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "二、课程设计",
                        "page_start": 300,
                        "page_end": 300,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0300-block-0002",
                        "row_id": "page-0300-block-0002",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "(三) 学时学分设置",
                        "page_start": 300,
                        "page_end": 300,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0300-block-0003",
                        "row_id": "page-0300-block-0003",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>课程名称</td><td>学分</td></tr><tr><td>马克思主义基本原理</td><td>3</td></tr></table>",
                        "html": "<table><tr><td>课程名称</td><td>学分</td></tr><tr><td>马克思主义基本原理</td><td>3</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "课程名称",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "学分",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "马克思主义基本原理",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "3",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 300,
                        "page_end": 300,
                        "continuation_group_id": "page-0300-block-0003",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["unit_type"], "table_unit")
        self.assertTrue(chunks[0].text.startswith("二、课程设计\n\n(三) 学时学分设置"))
        self.assertEqual(chunks[0].text.count("(三) 学时学分设置"), 1)
        self.assertIn("课程名称 | 学分", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_merges_curriculum_subsection_marker_with_following_same_parent_items(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0301-block-0001",
                        "row_id": "page-0301-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "二、毕业要求",
                        "page_start": 301,
                        "page_end": 301,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0301-block-0002",
                        "row_id": "page-0301-block-0002",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "(二)知识要求",
                        "page_start": 301,
                        "page_end": 301,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0301-block-0003",
                        "row_id": "page-0301-block-0003",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "1. 跨学科基础和理论。",
                        "page_start": 301,
                        "page_end": 301,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0301-block-0004",
                        "row_id": "page-0301-block-0004",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "2. 核心知识。",
                        "page_start": 301,
                        "page_end": 301,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertTrue(chunks[0].text.startswith("二、毕业要求\n\n(二)知识要求"))
        self.assertEqual(chunks[0].text.count("二、毕业要求"), 1)
        self.assertIn("1. 跨学科基础和理论。", chunks[0].text)
        self.assertIn("2. 核心知识。", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_merges_short_curriculum_items_under_same_parent(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0302-block-0001",
                        "row_id": "page-0302-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "七、其他说明",
                        "page_start": 302,
                        "page_end": 302,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0302-block-0002",
                        "row_id": "page-0302-block-0002",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "6. 讲座报告。第 1-6 学期每学期至少参加 2 次本专业组织的讲座。",
                        "page_start": 302,
                        "page_end": 302,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0302-block-0003",
                        "row_id": "page-0302-block-0003",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "7. 学年论文以及毕业论文由专业分流后的导师具体负责指导。",
                        "page_start": 302,
                        "page_end": 302,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertEqual(chunks[0].text.count("七、其他说明"), 1)
        self.assertIn(
            "6. 讲座报告。第 1-6 学期每学期至少参加 2 次本专业组织的讲座。", chunks[0].text
        )
        self.assertIn("7. 学年论文以及毕业论文由专业分流后的导师具体负责指导。", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_canonicalizes_root_title_anchor(self) -> None:
        raw_version_id = "sha256:test-curriculum-root-title"
        document_input = _build_split_manifest_document_input(
            raw_asset_record=type(
                "RawAssetRecordProxy",
                (),
                {
                    "raw_asset_id": "asset:curriculum-plan-2022",
                    "raw_version_id": raw_version_id,
                    "corpus": "curriculum",
                    "collection": "curriculum_plan",
                    "raw_source_uri": "file:///tmp/curriculum-plan-2022.pdf",
                    "content_hash": raw_version_id.removeprefix("sha256:"),
                    "source_filename": "curriculum-plan-2022.pdf",
                    "object_key": "official_pdf/curriculum-plan/2022/sha256/test/capture/curriculum-plan-2022.pdf",
                    "ingestion_timestamp": "2026-03-28T10:00:00+00:00",
                    "import_source": "raw_online_ocr",
                },
            )(),
            manifest_version="curriculum_plan_split_manifest_v1",
            manifest_document=SplitManifestDocument(
                document_id="curriculum:民族学本科第二学士学位人才培养方案",
                title="民族学本科第二学士学位人才培养方案",
                page_start=100,
                page_end=101,
                status="active",
            ),
            structured_rows=[
                {
                    "row_id": "page-0100-block-0001",
                    "row_type": "heading",
                    "block_role": "doc_title",
                    "heading_level": 1,
                    "text_normalized": "民族学本科第二学士学位人才培养方案(2020 版)",
                    "page_start": 100,
                    "page_end": 100,
                },
                {
                    "row_id": "page-0100-block-0002",
                    "row_type": "heading",
                    "heading_level": 2,
                    "text_normalized": "一、培养目标",
                    "page_start": 100,
                    "page_end": 100,
                },
                {
                    "row_id": "page-0100-block-0003",
                    "row_type": "paragraph",
                    "text_normalized": "培养具备民族学基础理论与方法的复合型人才。",
                    "page_start": 100,
                    "page_end": 100,
                },
            ],
            provider_response_key="official_pdf/curriculum-plan/2022/sha256/test/provider/paddleocr-vl-1-5/provider-response.jsonl",
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            default_visibility_scope="main",
            corpus="curriculum",
            collection="curriculum_plan",
        )
        record = DocumentRegistryRecord(
            document_id="curriculum:民族学本科第二学士学位人才培养方案",
            revision_track="source-faithful",
            version_id=str(document_input.metadata["version_id"]),
            source_uri=str(
                document_input.metadata.get("source_url")
                or document_input.metadata.get("source_id")
                or ""
            ),
            content_hash=hashlib.sha256(document_input.document_units_bytes).hexdigest(),
            corpus="curriculum",
            collection="curriculum_plan",
            cleaning_policy_version="curriculum_plan_cleaning_v1",
            entitlement_groups=tuple(document_input.metadata.get("entitlement_groups") or ()),
            visibility_scope="main",
            status=str(document_input.metadata.get("status") or "active"),
            ingestion_timestamp="2026-03-28T10:00:00+00:00",
            parser_version="raw-online-ocr-v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="pdf_ocr",
            is_current=True,
            document_units_object_key="curriculum/documents/tmp/document-units.jsonl",
            import_source="raw_online_ocr",
        )

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=document_input.document_units_bytes,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertGreaterEqual(len(chunks), 1)
        self.assertEqual(
            chunks[0].anchor["section_path"],
            ["民族学本科第二学士学位人才培养方案", "一、培养目标"],
        )
        self.assertNotIn("(2020 版)", chunks[0].text)
        self.assertNotIn("(2020 版)", "\n".join(chunks[0].anchor["section_path"]))

    def test_build_indexable_chunks_from_jsonl_moves_table_lead_in_into_table_chunk(self) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0532-block-0001",
                        "row_id": "page-0532-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "五、课程设置和修读建议",
                        "page_start": 532,
                        "page_end": 532,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0532-block-0002",
                        "row_id": "page-0532-block-0002",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "1. 专业核心课程",
                        "page_start": 532,
                        "page_end": 532,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0532-block-0003",
                        "row_id": "page-0532-block-0003",
                        "row_type": "paragraph",
                        "clean_text": "(1)音乐表演(声乐)专业必修的专业核心课程 30 学分。",
                        "page_start": 532,
                        "page_end": 532,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0532-block-0004",
                        "row_id": "page-0532-block-0004",
                        "row_type": "paragraph",
                        "clean_text": "课程清单如下:",
                        "page_start": 532,
                        "page_end": 532,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0532-block-0005",
                        "row_id": "page-0532-block-0005",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>专业名称</td><td>课程号</td></tr><tr><td>音乐表演(声乐)</td><td>1048030493</td></tr></table>",
                        "html": "<table><tr><td>专业名称</td><td>课程号</td></tr><tr><td>音乐表演(声乐)</td><td>1048030493</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "专业名称",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "课程号",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "音乐表演(声乐)",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "1048030493",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 532,
                        "page_end": 532,
                        "continuation_group_id": "page-0532-block-0005",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["unit_type"], "table_unit")
        self.assertTrue(chunks[0].text.startswith("五、课程设置和修读建议\n\n1. 专业核心课程"))
        self.assertIn("(1)音乐表演(声乐)专业必修的专业核心课程 30 学分。", chunks[0].text)
        self.assertIn("课程清单如下:", chunks[0].text)
        self.assertIn("专业名称 | 课程号", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_detaches_heading_like_note_from_table_chunk(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0559-block-0001",
                        "row_id": "page-0559-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "五、课程设置和修读建议",
                        "page_start": 559,
                        "page_end": 559,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0559-block-0002",
                        "row_id": "page-0559-block-0002",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>专业名称</td><td>课程号</td></tr><tr><td>舞蹈表演(民族英才班)</td><td>1047030278</td></tr></table>",
                        "html": "<table><tr><td>专业名称</td><td>课程号</td></tr><tr><td>舞蹈表演(民族英才班)</td><td>1047030278</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "专业名称",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "课程号",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "舞蹈表演(民族英才班)",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "1047030278",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 559,
                        "page_end": 559,
                        "continuation_group_id": "page-0559-block-0002",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0560-block-0001",
                        "row_id": "page-0560-block-0001",
                        "row_type": "note",
                        "clean_text": "(3)舞蹈学专业必修的专业核心课程 50 学分。",
                        "page_start": 560,
                        "page_end": 560,
                        "owner_row_id": "page-0559-block-0002",
                        "relation_type": "note_of",
                        "continuation_group_id": "page-0559-block-0002",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0].metadata["unit_type"], "table_unit")
        self.assertTrue(chunks[0].text.startswith("五、课程设置和修读建议"))
        self.assertNotIn("(3)舞蹈学专业必修的专业核心课程 50 学分。", chunks[0].text)
        self.assertEqual(chunks[1].metadata["unit_type"], "section_text")
        self.assertIn("(3)舞蹈学专业必修的专业核心课程 50 学分。", chunks[1].text)

    def test_build_indexable_chunks_from_jsonl_renders_rowspan_and_colspan_rows_readably(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0021-block-0001",
                        "row_id": "page-0021-block-0001",
                        "row_type": "table",
                        "clean_text": '<table><tr><td>培养阶段</td><td>板块名称</td><td>类别</td><td>学分</td></tr><tr><td rowspan="2">大类培养</td><td rowspan="2">通识教育</td><td>人文素养类</td><td>2</td></tr><tr><td colspan="2">创新创业素养类 / 2</td></tr></table>',
                        "html": '<table><tr><td>培养阶段</td><td>板块名称</td><td>类别</td><td>学分</td></tr><tr><td rowspan="2">大类培养</td><td rowspan="2">通识教育</td><td>人文素养类</td><td>2</td></tr><tr><td colspan="2">创新创业素养类 / 2</td></tr></table>',
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "培养阶段",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "板块名称",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 3,
                                "text": "类别",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 4,
                                "text": "学分",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "大类培养",
                                "rowspan": 2,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "通识教育",
                                "rowspan": 2,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 3,
                                "text": "人文素养类",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 4,
                                "text": "2",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 3,
                                "col": 3,
                                "text": "创新创业素养类 / 2",
                                "rowspan": 1,
                                "colspan": 2,
                                "is_header": False,
                            },
                        ],
                        "page_start": 21,
                        "page_end": 21,
                        "continuation_group_id": "page-0021-block-0001",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["unit_type"], "table_unit")
        self.assertIn("培养阶段 | 板块名称 | 类别 | 学分", chunks[0].text)
        self.assertIn("大类培养 | 通识教育 | 人文素养类 | 2", chunks[0].text)
        self.assertIn("大类培养 | 通识教育 | 创新创业素养类 / 2", chunks[0].text)
        self.assertNotIn("\n| ", chunks[0].text)

    def test_real_curriculum_projection_can_chunk_after_split(self) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertGreater(len(chunks), 0)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertEqual(chunks[0].anchor["page_start"], 278)
        self.assertIn("国际经济与贸易本科人才培养方案", chunks[0].text)

    def test_real_curriculum_projection_absorbs_short_intro_and_table_cue_into_table_chunk(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertFalse(any(chunk.text.strip() == "建议课程清单:" for chunk in chunks))
        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and "国际经济与贸易专业选修课程至少任选 7 门课程,完成 14 学分。" in chunk.text
                for chunk in chunks
            )
        )
        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and "国际经济与贸易专业选修课程至少任选 7 门课程,完成 14 学分。" in chunk.text
                and "课程清单如下:" in chunk.text
                and "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期" in chunk.text
                for chunk in chunks
            )
        )
        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and "建议课程清单:" in chunk.text
                and "课程类 | 课程号 | 课程名称 | 学分" in chunk.text
                for chunk in chunks
            )
        )

    def test_real_curriculum_projection_merges_weak_single_row_table_into_previous_table_context(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and chunk.text.strip()
                == "1034030154 | 国际商务案例分析(实训) | 1 | 36 | 18 | 理论部分第6学期1-9周/实践部分5-6小学期"
                for chunk in chunks
            )
        )
        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and "1034030154 | 国际商务案例分析(实训) | 1 | 36 | 18 | 理论部分第6学期1-9周/实践部分5-6小学期"
                in chunk.text
                and "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期" in chunk.text
                for chunk in chunks
            )
        )

    def test_real_curriculum_projection_repairs_parent_heading_context_for_subsection_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and chunk.text.startswith("(二)知识要求")
                for chunk in chunks
            )
        )
        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and chunk.text.startswith("二、毕业要求\n\n(二)知识要求")
                for chunk in chunks
            )
        )

    def test_runtime_v2_does_not_duplicate_leaf_heading_when_prepending_parent_context(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("经济学拔尖人才创新班人才培养方案")

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and chunk.anchor["section_path"]
            == [
                "经济学拔尖人才创新班人才培养方案",
                "二、毕业要求",
                "(二)知识要求",
            ]
        )

        self.assertTrue(target_chunk.text.startswith("二、毕业要求\n\n(二)知识要求"))
        self.assertNotIn("(二)知识要求\n\n(二)知识要求", target_chunk.text)

    def test_runtime_v2_does_not_duplicate_leaf_heading_on_historical_curriculum_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks(
            "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案"
        )

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and "2. 专业选修课程\n\n2. 专业选修课程" in chunk.text
                for chunk in chunks
            )
        )

    def test_real_curriculum_projection_does_not_emit_orphan_heading_only_section_chunk(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and chunk.text.strip() == "(二)专业教育"
                for chunk in chunks
            )
        )

    def test_real_curriculum_projection_repairs_course_setting_parent_context_for_section_and_table_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and "2. 学科基础教育" in chunk.text
                and chunk.text.startswith(
                    "五、课程设置和修读建议\n\n(一) 大类培养\n\n2. 学科基础教育"
                )
                for chunk in chunks
            )
        )
        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期" in chunk.text
                and chunk.text.startswith(
                    "五、课程设置和修读建议\n\n(一) 大类培养\n\n2. 学科基础教育"
                )
                for chunk in chunks
            )
        )

    def test_real_curriculum_projection_keeps_structural_context_on_high_token_table_chunks(
        self,
    ) -> None:
        for document_id in (
            "curriculum:国际经济与贸易本科人才培养方案",
            "curriculum:经济学拔尖人才创新班人才培养方案",
        ):
            _, chunks = _build_real_curriculum_projection_chunks(document_id)

            self.assertFalse(
                any(
                    chunk.metadata["unit_type"] == "table_unit"
                    and "五、课程设置和修读建议" in chunk.anchor["section_path"]
                    and chunk.metadata["final_token_count"] >= 500
                    and not any(
                        heading in chunk.text for heading in chunk.anchor["section_path"][1:]
                    )
                    for chunk in chunks
                )
            )

    def test_runtime_v2_keeps_intermediate_course_setting_heading_on_high_token_table_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("经济学拔尖人才创新班人才培养方案")

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "table_unit"
            and chunk.anchor["section_path"]
            == [
                "经济学拔尖人才创新班人才培养方案",
                "五、课程设置和修读建议",
                "(一) 大类培养",
                "1. 通识教育",
            ]
            and int(chunk.metadata["final_token_count"]) >= 600
        )

        self.assertIn("五、课程设置和修读建议", target_chunk.text)
        self.assertIn("(一) 大类培养", target_chunk.text)
        self.assertIn("1. 通识教育", target_chunk.text)

    def test_runtime_v2_keeps_leaf_professional_education_heading_on_large_historical_table_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("孝通实验班本科人才培养方案")

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "table_unit"
            and chunk.anchor["section_path"]
            == [
                "孝通实验班本科人才培养方案",
                "五、课程设置和修读建议",
                "(二)专业教育",
            ]
            and "老龄化与健康" in chunk.text
        )

        self.assertIn("五、课程设置和修读建议", target_chunk.text)
        self.assertIn("(二)专业教育", target_chunk.text)

    def test_runtime_v2_does_not_bleed_previous_section_into_degree_section_for_historical_curriculum(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("财政学本科人才培养方案")

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and chunk.anchor["section_path"]
            == [
                "财政学本科人才培养方案",
                "三、学制、总学分和学位授予",
            ]
        )

        self.assertTrue(target_chunk.text.startswith("三、学制、总学分和学位授予"))
        self.assertNotIn("二、毕业要求\n\n", target_chunk.text)

    def test_runtime_v2_does_not_bleed_previous_section_into_degree_section_for_mixed_heading_historical_curriculum(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("中国少数民族语言文学本科人才培养方案")

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and chunk.anchor["section_path"]
            == [
                "中国少数民族语言文学本科人才培养方案",
                "三、学制、总学分和学位授予",
            ]
        )

        self.assertTrue(target_chunk.text.startswith("三、学制、总学分和学位授予"))
        self.assertNotIn("二、毕业要求\n\n", target_chunk.text)

    def test_runtime_v2_absorbs_short_parent_intro_into_following_child_section(self) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks(
            "中央民族大学通识课程思想政治理论课教学计划"
        )

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and chunk.anchor["section_path"]
                == [
                    "中央民族大学通识课程思想政治理论课教学计划",
                    "二、课程设置及培养要求",
                ]
                and chunk.text
                == "二、课程设置及培养要求\n\n课程模式包括大学体育课程和第二课堂实践活动。"
                for chunk in chunks
            )
        )
        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and "课程模式包括大学体育课程和第二课堂实践活动。" in chunk.text
            and "(一)大学体育课程" in chunk.text
        )

        self.assertTrue(target_chunk.text.startswith("二、课程设置及培养要求"))

    def test_runtime_v2_excludes_course_map_section_chunks_from_query_serving(self) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("经济学拔尖人才创新班人才培养方案")
        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and chunk.anchor["section_path"]
                == [
                    "经济学拔尖人才创新班人才培养方案",
                    "六、课程地图",
                ]
                for chunk in chunks
            )
        )

    def test_runtime_v2_does_not_leave_course_map_title_card_on_previous_section(self) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks(
            "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案"
        )

        self.assertFalse(
            any(
                "拓扑图" in chunk.text
                for chunk in chunks
                if (chunk.anchor.get("section_path") or [])[-1:] != ["六、课程地图"]
            )
        )

    def test_build_indexable_chunks_from_jsonl_skips_course_map_navigation_noise(self) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0001",
                        "row_id": "page-0600-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "六、课程地图",
                        "section_hint": "section",
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0002",
                        "row_id": "page-0600-block-0002",
                        "row_type": "heading",
                        "heading_level": 4,
                        "clean_text": "1. 哲学",
                        "section_hint": "numeric_heading",
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0003",
                        "row_id": "page-0600-block-0003",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "哲学专业本科课程结构拓扑图",
                        "section_hint": None,
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0004",
                        "row_id": "page-0600-block-0004",
                        "row_type": "heading",
                        "heading_level": 4,
                        "clean_text": "2. 宗教学",
                        "section_hint": "numeric_heading",
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0005",
                        "row_id": "page-0600-block-0005",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "宗教学专业本科课程结构拓扑图",
                        "section_hint": None,
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0006",
                        "row_id": "page-0600-block-0006",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "七、其他说明",
                        "section_hint": "section",
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0007",
                        "row_id": "page-0600-block-0007",
                        "row_type": "paragraph",
                        "clean_text": "允许国际学分转换。",
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].anchor["section_path"], ["七、其他说明"])
        self.assertNotIn("拓扑图", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_promotes_structural_table_caption_to_table_section(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0610-block-0001",
                        "row_id": "page-0610-block-0001",
                        "row_type": "heading",
                        "heading_level": 1,
                        "clean_text": "八、教学进程计划表",
                        "section_hint": "section",
                        "page_start": 610,
                        "page_end": 610,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0610-block-0002",
                        "row_id": "page-0610-block-0002",
                        "row_type": "note",
                        "clean_text": "专业代码:060104",
                        "page_start": 610,
                        "page_end": 610,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0610-block-0003",
                        "row_id": "page-0610-block-0003",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>课程类别</td><td>课程名称</td></tr><tr><td>专业基础课</td><td>文物学概论</td></tr></table>",
                        "html": "<table><tr><td>课程类别</td><td>课程名称</td></tr><tr><td>专业基础课</td><td>文物学概论</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "课程类别",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "课程名称",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "专业基础课",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "文物学概论",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 610,
                        "page_end": 610,
                        "continuation_group_id": "page-0610-block-0003",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0611-block-0001",
                        "row_id": "page-0611-block-0001",
                        "row_type": "table_caption",
                        "clean_text": "九、实践教学环节安排表",
                        "page_start": 611,
                        "page_end": 611,
                        "owner_row_id": "page-0611-block-0002",
                        "relation_type": "caption_of",
                        "continuation_group_id": "page-0611-block-0002",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0611-block-0002",
                        "row_id": "page-0611-block-0002",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>实践教学环节</td><td>学分</td></tr><tr><td>毕业论文</td><td>6</td></tr></table>",
                        "html": "<table><tr><td>实践教学环节</td><td>学分</td></tr><tr><td>毕业论文</td><td>6</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "实践教学环节",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "学分",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "毕业论文",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "6",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 611,
                        "page_end": 611,
                        "continuation_group_id": "page-0611-block-0002",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0611-block-0003",
                        "row_id": "page-0611-block-0003",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "十、有关说明",
                        "section_hint": "section",
                        "page_start": 611,
                        "page_end": 611,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0611-block-0004",
                        "row_id": "page-0611-block-0004",
                        "row_type": "paragraph",
                        "clean_text": "允许使用案例分析作为毕业论文形式。",
                        "page_start": 611,
                        "page_end": 611,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        target_table_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "table_unit" and "毕业论文" in chunk.text
        )
        trailing_section_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and chunk.text.startswith("十、有关说明")
        )

        self.assertEqual(target_table_chunk.anchor["section_path"], ["九、实践教学环节安排表"])
        self.assertTrue(target_table_chunk.text.startswith("九、实践教学环节安排表"))
        self.assertNotIn("八、教学进程计划表\n\n", trailing_section_chunk.text)

    def test_build_indexable_chunks_from_jsonl_dedupes_repeated_structural_caption_heading(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0620-block-0001",
                        "row_id": "page-0620-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "七、各教学环节学时学分分配表",
                        "section_hint": "section",
                        "page_start": 620,
                        "page_end": 620,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0620-block-0002",
                        "row_id": "page-0620-block-0002",
                        "row_type": "table_caption",
                        "clean_text": "七、各教学环节学时学分分配表",
                        "page_start": 620,
                        "page_end": 620,
                        "owner_row_id": "page-0620-block-0003",
                        "relation_type": "caption_of",
                        "continuation_group_id": "page-0620-block-0003",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0620-block-0003",
                        "row_id": "page-0620-block-0003",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>类别</td><td>学分</td></tr><tr><td>专业教育</td><td>54</td></tr></table>",
                        "html": "<table><tr><td>类别</td><td>学分</td></tr><tr><td>专业教育</td><td>54</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "类别",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "学分",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "专业教育",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "54",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 620,
                        "page_end": 620,
                        "continuation_group_id": "page-0620-block-0003",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(
            chunks[0].text.count("七、各教学环节学时学分分配表"),
            1,
        )


if __name__ == "__main__":
    unittest.main()
