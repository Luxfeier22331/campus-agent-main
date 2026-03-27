from __future__ import annotations

import json
from pathlib import Path
import hashlib
import unittest

from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.raw_ingestion import _build_split_manifest_document_input, _load_layout_elements_rows
from campus_ingestion_core.split_manifest import load_split_manifest


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
        acl_groups=("students",),
        campus_scope="main",
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
        raw_asset_record=type("RawAssetRecordProxy", (), {
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
        })(),
        manifest_version=manifest.manifest_version,
        manifest_document=target_document,
        structured_rows=layout_rows,
        provider_response_key="official_pdf/curriculum-plan/2022/sha256/test/provider/paddleocr-vl-1-5/provider-response.jsonl",
        layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
        default_campus_scope="main",
        corpus="curriculum",
        collection="curriculum_plan",
    )
    record = DocumentRegistryRecord(
        document_id=target_document.document_id,
        revision_track="source-faithful",
        version_id=str(document_input.metadata["version_id"]),
        source_uri=str(document_input.metadata.get("source_url") or document_input.metadata.get("source_id") or ""),
        content_hash=hashlib.sha256(document_input.document_units_bytes).hexdigest(),
        corpus="curriculum",
        collection="curriculum_plan",
        cleaning_policy_version="curriculum_plan_cleaning_v1",
        acl_groups=tuple(document_input.metadata.get("acl_groups") or ()),
        campus_scope="main",
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


class CurriculumChunkingTest(unittest.TestCase):
    def test_build_indexable_chunks_from_jsonl_uses_runtime_curriculum_chunk_profile_by_default(self) -> None:
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

        chunks = build_indexable_chunks_from_jsonl(record=record, structured_jsonl_bytes=structured_payload)

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["chunk_policy_version"], "curriculum_plan_semantic_v1")
        self.assertEqual(chunks[0].metadata["cleaning_policy_version"], "curriculum_plan_cleaning_v1")
        self.assertEqual(chunks[0].metadata["strategy_name"], "curriculum_plan_structure_v1")
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")

    def test_build_indexable_chunks_from_jsonl_uses_curriculum_section_and_table_units(self) -> None:
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
                            {"row": 1, "col": 1, "text": "课程", "rowspan": 1, "colspan": 1, "is_header": True},
                            {"row": 1, "col": 2, "text": "学分", "rowspan": 1, "colspan": 1, "is_header": True},
                            {"row": 2, "col": 1, "text": "宏观经济学原理", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 2, "col": 2, "text": "3", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 3, "col": 1, "text": "国际贸易理论", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 3, "col": 2, "text": "3", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 4, "col": 1, "text": "计量经济学方法", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 4, "col": 2, "text": "4", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 5, "col": 1, "text": "政策评估工作坊", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 5, "col": 2, "text": "2", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 6, "col": 1, "text": "跨文化商务沟通", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 6, "col": 2, "text": "2", "rowspan": 1, "colspan": 1, "is_header": False},
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
        self.assertTrue(all(chunk.metadata["root_unit_id"] == "page-0020-block-0005" for chunk in table_chunks))
        self.assertTrue(all(chunk.metadata["split_reason"] == "table_row_window" for chunk in table_chunks))
        self.assertTrue(all(chunk.anchor["page_start"] == 20 for chunk in table_chunks))
        self.assertTrue(all(chunk.anchor["page_end"] == 21 for chunk in table_chunks))
        self.assertTrue(all("表 1 核心课程设置" in chunk.text for chunk in table_chunks))
        self.assertTrue(all("课程 | 学分" in chunk.text for chunk in table_chunks))
        self.assertTrue(any("备注：实践类课程不少于 8 学分。" in chunk.text for chunk in table_chunks))

    def test_build_indexable_chunks_from_jsonl_requires_row_id_for_curriculum_document_units(self) -> None:
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
                            {"row": 1, "col": 1, "text": "专业名称", "rowspan": 1, "colspan": 1, "is_header": True},
                            {"row": 1, "col": 2, "text": "课程号", "rowspan": 1, "colspan": 1, "is_header": True},
                            {"row": 2, "col": 1, "text": "音乐表演(声乐)", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 2, "col": 2, "text": "1048030493", "rowspan": 1, "colspan": 1, "is_header": False},
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

        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertEqual(chunks[0].text, "五、课程设置和修读建议")
        self.assertEqual(chunks[1].metadata["unit_type"], "table_unit")
        self.assertIn("1. 专业核心课程", chunks[1].text)
        self.assertIn("(1)音乐表演(声乐)专业必修的专业核心课程 30 学分。", chunks[1].text)
        self.assertIn("课程清单如下:", chunks[1].text)
        self.assertIn("专业名称 | 课程号", chunks[1].text)

    def test_build_indexable_chunks_from_jsonl_detaches_heading_like_note_from_table_chunk(self) -> None:
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
                            {"row": 1, "col": 1, "text": "专业名称", "rowspan": 1, "colspan": 1, "is_header": True},
                            {"row": 1, "col": 2, "text": "课程号", "rowspan": 1, "colspan": 1, "is_header": True},
                            {"row": 2, "col": 1, "text": "舞蹈表演(民族英才班)", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 2, "col": 2, "text": "1047030278", "rowspan": 1, "colspan": 1, "is_header": False},
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

        self.assertEqual(len(chunks), 3)
        self.assertEqual(chunks[1].metadata["unit_type"], "table_unit")
        self.assertNotIn("(3)舞蹈学专业必修的专业核心课程 50 学分。", chunks[1].text)
        self.assertEqual(chunks[2].metadata["unit_type"], "section_text")
        self.assertIn("(3)舞蹈学专业必修的专业核心课程 50 学分。", chunks[2].text)

    def test_build_indexable_chunks_from_jsonl_renders_rowspan_and_colspan_rows_readably(self) -> None:
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
                        "clean_text": "<table><tr><td>培养阶段</td><td>板块名称</td><td>类别</td><td>学分</td></tr><tr><td rowspan=\"2\">大类培养</td><td rowspan=\"2\">通识教育</td><td>人文素养类</td><td>2</td></tr><tr><td colspan=\"2\">创新创业素养类 / 2</td></tr></table>",
                        "html": "<table><tr><td>培养阶段</td><td>板块名称</td><td>类别</td><td>学分</td></tr><tr><td rowspan=\"2\">大类培养</td><td rowspan=\"2\">通识教育</td><td>人文素养类</td><td>2</td></tr><tr><td colspan=\"2\">创新创业素养类 / 2</td></tr></table>",
                        "table_cells": [
                            {"row": 1, "col": 1, "text": "培养阶段", "rowspan": 1, "colspan": 1, "is_header": True},
                            {"row": 1, "col": 2, "text": "板块名称", "rowspan": 1, "colspan": 1, "is_header": True},
                            {"row": 1, "col": 3, "text": "类别", "rowspan": 1, "colspan": 1, "is_header": True},
                            {"row": 1, "col": 4, "text": "学分", "rowspan": 1, "colspan": 1, "is_header": True},
                            {"row": 2, "col": 1, "text": "大类培养", "rowspan": 2, "colspan": 1, "is_header": False},
                            {"row": 2, "col": 2, "text": "通识教育", "rowspan": 2, "colspan": 1, "is_header": False},
                            {"row": 2, "col": 3, "text": "人文素养类", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 2, "col": 4, "text": "2", "rowspan": 1, "colspan": 1, "is_header": False},
                            {"row": 3, "col": 3, "text": "创新创业素养类 / 2", "rowspan": 1, "colspan": 2, "is_header": False},
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
        _, chunks = _build_real_curriculum_projection_chunks("curriculum:国际经济与贸易本科人才培养方案")

        self.assertGreater(len(chunks), 0)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertEqual(chunks[0].anchor["page_start"], 278)
        self.assertIn("国际经济与贸易本科人才培养方案", chunks[0].text)

    def test_real_curriculum_projection_absorbs_short_intro_and_table_cue_into_table_chunk(self) -> None:
        _, chunks = _build_real_curriculum_projection_chunks("curriculum:国际经济与贸易本科人才培养方案")

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

    def test_real_curriculum_projection_merges_weak_single_row_table_into_previous_table_context(self) -> None:
        _, chunks = _build_real_curriculum_projection_chunks("curriculum:国际经济与贸易本科人才培养方案")

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and chunk.text.strip() == "1034030154 | 国际商务案例分析(实训) | 1 | 36 | 18 | 理论部分第6学期1-9周/实践部分5-6小学期"
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

    def test_real_curriculum_projection_repairs_parent_heading_context_for_subsection_chunks(self) -> None:
        _, chunks = _build_real_curriculum_projection_chunks("curriculum:国际经济与贸易本科人才培养方案")

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


if __name__ == "__main__":
    unittest.main()
