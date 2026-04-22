from __future__ import annotations

import unittest

from .processing_pipeline_test_support import *  # noqa: F401,F403


class ProcessingPipelineHandbookTest(unittest.TestCase):
    def test_build_indexable_chunks_from_jsonl_accepts_split_handbook_cleanup_output(self) -> None:
        cleanup_result = cleanup_handbook_document(
            structured_rows=[
                _handbook_source_row(1, "heading", "中央民族大学奖学金评定办法"),
                _handbook_source_row(1, "paragraph", "民大校发〔2018〕329号"),
                _handbook_source_row(1, "paragraph", "第一条 奖学金评定坚持公开、公平、公正。"),
                _handbook_source_row(
                    2,
                    "table",
                    "项目 | 说明",
                    html="<table><tr><td>项目</td><td>说明</td></tr></table>",
                ),
            ],
            manifest_document=SplitManifestDocument(
                document_id="manifest:scholarship-policy",
                title="中央民族大学奖学金评定办法",
                page_start=1,
                page_end=2,
                source_uri="https://campus.example/handbook/scholarship-policy",
                handbook_section="中央民族大学学生奖励管理规定",
                entitlement_groups=("students",),
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
            collection="student_rules",
            cleaning_policy_version="student_rules_cleaning_v1",
            entitlement_groups=("students",),
            visibility_scope="main",
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
                collection="student_rules",
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
                    collection="student_rules",
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
        document_unit_rows = [
            json.loads(line)
            for line in serialize_handbook_document_units(cleanup_result.document_units)
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertTrue(all("acl" not in row for row in document_unit_rows))
        self.assertTrue(
            all(row["entitlement_groups"] == ["students"] for row in document_unit_rows)
        )
        self.assertTrue(all(row["visibility_level"] == "restricted" for row in document_unit_rows))

    def test_build_indexable_chunks_contextualizes_handbook_text_with_document_metadata(
        self,
    ) -> None:
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
                entitlement_groups=("students",),
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
            collection="student_rules",
            cleaning_policy_version="student_rules_cleaning_v1",
            entitlement_groups=("students",),
            visibility_scope="main",
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
                collection="student_rules",
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

        article_chunk = next(
            chunk for chunk in chunks if chunk.metadata["unit_type"] == "article_body"
        )
        self.assertIn("中央民族大学奖学金评定办法", article_chunk.text)
        self.assertIn("第一条", article_chunk.text)
        self.assertIn("文号：民大校发〔2018〕329号", article_chunk.text)
        self.assertIn("奖学金评定坚持公开、公平、公正", article_chunk.text)
        self.assertEqual(article_chunk.metadata["display_text"], "奖学金评定坚持公开、公平、公正。")

    def test_build_indexable_chunks_contextualizes_large_handbook_chunk_without_dropping_minimum_context(
        self,
    ) -> None:
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
