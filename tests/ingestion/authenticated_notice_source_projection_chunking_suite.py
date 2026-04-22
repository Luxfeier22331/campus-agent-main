from __future__ import annotations

import unittest

from .authenticated_notice_source_projection_test_support import *  # noqa: F401,F403


class AuthenticatedNoticeSourceProjectionChunkingTest(unittest.TestCase):
    def test_internal_notice_chunking_skips_attachment_ref_units(self) -> None:
        record = DocumentRegistryRecord(
            document_id="notice:muc_internal_portal:355119",
            revision_track="source-faithful",
            version_id="sha256:test-version",
            source_uri="https://portal.example.edu/notice/355119",
            content_hash="content-hash",
            corpus="campus_notices",
            collection="internal_notice",
            cleaning_policy_version="authenticated_notice_projection_v1",
            entitlement_groups=("campus_members",),
            visibility_scope="campus",
            visibility_level="restricted",
            ingestion_timestamp="2026-04-05T00:00:00+00:00",
            parser_version="authenticated_notice_import_v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="authenticated_notice_portal",
            is_current=False,
            document_units_object_key="campus_notices/documents/internal_notice/test/source-faithful/2026/document-units.jsonl",
            processed_object_keys=(
                "campus_notices/documents/internal_notice/test/source-faithful/2026/document-units.jsonl",
            ),
            import_source="authenticated_notice_bootstrap_import",
        )

        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "body-001",
                    "root_unit_id": "body-001",
                    "unit_type": "paragraph",
                    "text": "请同学们于4月10日前完成报名。",
                    "raw_text": "请同学们于4月10日前完成报名。",
                    "clean_text": "请同学们于4月10日前完成报名。",
                    "anchor": {"source_uri": record.source_uri},
                    "metadata": {"block_role": "paragraph"},
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "attachment-0001",
                    "root_unit_id": "attachment-0001",
                    "unit_type": "attachment_ref",
                    "text": "报名表.docx",
                    "raw_text": "报名表.docx",
                    "clean_text": "报名表.docx",
                    "anchor": {
                        "source_uri": record.source_uri,
                        "attachment_ref_id": "attachment-0001",
                    },
                    "metadata": {"block_role": "attachment_ref"},
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        self.assertEqual(len(chunks), 1)
        self.assertNotIn("attachment_ref", [chunk.metadata["unit_type"] for chunk in chunks])

    def test_internal_notice_chunking_splits_large_table_unit_without_row_lines(self) -> None:
        record = DocumentRegistryRecord(
            document_id="notice:muc_internal_portal:355120",
            revision_track="source-faithful",
            version_id="sha256:test-version-2",
            source_uri="https://portal.example.edu/notice/355120",
            content_hash="content-hash-2",
            corpus="campus_notices",
            collection="internal_notice",
            cleaning_policy_version="authenticated_notice_projection_v1",
            entitlement_groups=("campus_members",),
            visibility_scope="campus",
            visibility_level="restricted",
            ingestion_timestamp="2026-04-05T00:00:00+00:00",
            parser_version="authenticated_notice_import_v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="authenticated_notice_portal",
            is_current=False,
            document_units_object_key="campus_notices/documents/internal_notice/test/source-faithful/2026/document-units-large-table.jsonl",
            processed_object_keys=(
                "campus_notices/documents/internal_notice/test/source-faithful/2026/document-units-large-table.jsonl",
            ),
            import_source="authenticated_notice_bootstrap_import",
        )

        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "body-001",
                    "root_unit_id": "body-001",
                    "unit_type": "paragraph",
                    "text": "关于考试安排的补充说明。",
                    "raw_text": "关于考试安排的补充说明。",
                    "clean_text": "关于考试安排的补充说明。",
                    "anchor": {"source_uri": record.source_uri},
                    "metadata": {"block_role": "paragraph"},
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "table-001",
                    "root_unit_id": "table-001",
                    "unit_type": "table_unit",
                    "text": "\n".join(f"第{index}行 | {'甲' * 24}" for index in range(1, 40)),
                    "raw_text": "\n".join(f"第{index}行 | {'甲' * 24}" for index in range(1, 40)),
                    "clean_text": "\n".join(f"第{index}行 | {'甲' * 24}" for index in range(1, 40)),
                    "anchor": {"source_uri": record.source_uri},
                    "metadata": {"block_role": "table"},
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        table_chunks = [chunk for chunk in chunks if chunk.metadata["unit_type"] == "table_unit"]
        self.assertGreater(len(table_chunks), 1)
        self.assertTrue(
            all(chunk.metadata["split_reason"] == "token_guardrail" for chunk in table_chunks)
        )
        self.assertTrue(all(chunk.metadata["final_token_count"] <= 320 for chunk in table_chunks))
        self.assertTrue(
            all(
                chunk.metadata["strategy_name"] == "internal_notice_notice_body_v2"
                for chunk in table_chunks
            )
        )
