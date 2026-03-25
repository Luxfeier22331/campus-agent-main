from __future__ import annotations

import json
import unittest

from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.embed import MockEmbeddingSettings, build_mock_embedding_model
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_processed_artifact_key
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl


def _registry_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="handbook:test-doc",
        revision_track="source-faithful",
        version_id="v1:test-doc",
        source_uri="campus-agent://regulations/student_handbook/docs/handbook:test-doc",
        content_hash="sha256:test-doc",
        corpus="regulations",
        collection="student_handbook",
        cleaning_policy_version="student_handbook_cleaning_v1",
        acl_groups=("students",),
        campus_scope="main",
        status="active",
        ingestion_timestamp="2026-03-23T12:00:00+00:00",
        parser_version="paddleocr-vl-1.5",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        document_units_object_key=build_processed_artifact_key(
            corpus="regulations",
            collection="student_handbook",
            document_id="handbook:test-doc",
            revision_track="source-faithful",
            version_id="v1:test-doc",
            title=None,
            year=None,
            filename="document-units.jsonl",
        ),
        processed_object_keys=(
            build_processed_artifact_key(
                corpus="regulations",
                collection="student_handbook",
                document_id="handbook:test-doc",
                revision_track="source-faithful",
                version_id="v1:test-doc",
                title=None,
                year=None,
                filename="document-units.jsonl",
            ),
        ),
        import_source="raw_online_ocr",
    )


def _structured_row(
    *,
    doc_id: str = "handbook:test-doc",
    version_id: str = "v1:test-doc",
    unit_type: str,
    clean_text: str,
    root_unit_id: str,
    chunk_id: str | None = None,
) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": chunk_id or root_unit_id,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "clean_text": clean_text,
        "anchor": {"page_start": 1, "page_end": 1},
        "acl": {"level": "public", "allow_groups": []},
    }


class HandbookChunkingPipelineTest(unittest.TestCase):
    def test_build_indexable_chunks_rejects_mixed_document_units(self) -> None:
        structured_payload = "\n".join(
            [
                json.dumps(_structured_row(unit_type="article_body", clean_text="第一条 正文", root_unit_id="article-001")),
                json.dumps(
                    _structured_row(
                        doc_id="handbook:other-doc",
                        unit_type="article_body",
                        clean_text="第二条 正文",
                        root_unit_id="article-002",
                    )
                ),
            ]
        ).encode("utf-8")

        with self.assertRaises(ValueError):
            build_indexable_chunks_from_jsonl(
                record=_registry_record(),
                structured_jsonl_bytes=structured_payload,
            )

    def test_policy_page_fallback_keeps_token_guardrail_split_metadata(self) -> None:
        structured_payload = (
            json.dumps(
                _structured_row(
                    unit_type="policy_page",
                    clean_text=" ".join(f"token-{index:04d}" for index in range(480)),
                    root_unit_id="policy-page-001",
                )
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=_registry_record(),
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(chunk.metadata["unit_type"] == "policy_page" for chunk in chunks))
        self.assertTrue(all(chunk.metadata["split_reason"] == "token_guardrail" for chunk in chunks))
        self.assertTrue(all(chunk.metadata["root_unit_id"] == "policy-page-001" for chunk in chunks))

    def test_table_unit_becomes_primary_embeddable_evidence_unit(self) -> None:
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_row(
                        unit_type="table",
                        clean_text="单位名称\t电话号码\n校园110\t68932220",
                        root_unit_id="table-001",
                    )
                ),
                json.dumps(
                    _structured_row(
                        unit_type="table_unit",
                        clean_text="表格上下文: 校内常用电话\n单位名称 | 电话号码\n校园110 | 68932220",
                        root_unit_id="table-001",
                    )
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=_registry_record(),
            structured_jsonl_bytes=structured_payload,
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual([chunk.metadata["unit_type"] for chunk in chunks], ["table_unit"])
        self.assertEqual([chunk.metadata["root_unit_id"] for chunk in chunks], ["table-001"])

    def test_oversize_article_body_keeps_root_segment_metadata(self) -> None:
        structured_payload = (
            json.dumps(
                _structured_row(
                    unit_type="article_body",
                    clean_text=" ".join(f"token-{index:04d}" for index in range(520)),
                    root_unit_id="article-001",
                )
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=_registry_record(),
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


if __name__ == "__main__":
    unittest.main()
