from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from qdrant_client import QdrantClient

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.registry_scope_chunk_preparation import prepare_registry_scope_chunks
from campus_ingestion_core.registry_scope_release import release_registry_scope
from tests.support.in_memory_registry import InMemoryDocumentRegistry


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.reads: list[tuple[str, str]] = []
        self.uploads: list[dict[str, object]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.reads.append((bucket, key))
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.objects[(bucket, key)] = data
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )


def _make_internal_notice_record(*, object_key: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="notice:muc_internal_portal:355119",
        revision_track="source-faithful",
        version_id="sha256:test-version",
        source_uri="https://portal.example.edu/notice/355119",
        content_hash="sha256:test-content",
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        ingestion_timestamp="2026-04-06T00:00:00+00:00",
        parser_version="authenticated_notice_import_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source="authenticated_notice_source_projection",
    )


def _make_internal_notice_attachment_record(*, object_key: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="notice_attachment:muc_internal_portal:355119:attachment-0001",
        revision_track="source-faithful",
        version_id="sha256:test-attachment-version",
        source_uri="https://portal.example.edu/notice/355119/attachments/1",
        content_hash="sha256:test-attachment-content",
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        ingestion_timestamp="2026-04-06T00:00:00+00:00",
        parser_version="authenticated_notice_import_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source="authenticated_notice_source_projection",
    )


def _make_internal_notice_document_units_bytes(
    *,
    document_id: str,
    version_id: str,
) -> bytes:
    row = {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": "body-001",
        "root_unit_id": "body-001",
        "unit_type": "paragraph",
        "clean_text": "请同学们于4月10日前完成报名，并按照通知要求提交材料。",
        "anchor": {
            "source_uri": f"https://portal.example.edu/notice/{document_id.split(':')[-1]}",
        },
        "metadata": {
            "title": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
            "block_role": "paragraph",
        },
    }
    return (json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8")


class InternalNoticeScopeChunkPipelineTest(unittest.TestCase):
    def _env(self) -> dict[str, str]:
        return {
            "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
            "OBJECT_STORE_ACCESS_KEY": "minioadmin",
            "OBJECT_STORE_SECRET_KEY": "minioadmin",
            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
            "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        }

    def test_prepare_registry_scope_chunks_writes_chunk_prep_artifacts_without_embedding_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key = (
                "campus_notices/documents/internal_notice/"
                "notice-355119/source-faithful/2026/document-units.jsonl"
            )
            record = _make_internal_notice_record(object_key=object_key)
            registry = InMemoryDocumentRegistry((record,), backing_path=root / "registry.json")
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key): _make_internal_notice_document_units_bytes(
                        document_id=record.document_id,
                        version_id=record.version_id,
                    ),
                }
            )

            report = prepare_registry_scope_chunks(
                corpus="campus_notices",
                collection="internal_notice",
                preparation_run_id="prep-20260406-0001",
                env=self._env(),
                registry=registry,
                object_store=object_store,
            )

        self.assertEqual(report.corpus, "campus_notices")
        self.assertEqual(report.collection, "internal_notice")
        self.assertEqual(report.preparation_run_id, "prep-20260406-0001")
        self.assertEqual(report.validation_status, "passed")
        self.assertEqual(report.document_count, 1)
        self.assertGreater(report.chunk_count, 0)
        self.assertEqual(object_store.reads, [("campus-rag-derived", object_key)])
        upload_keys = [str(item["key"]) for item in object_store.uploads]
        self.assertIn(report.manifest_object_key, upload_keys)
        self.assertIn(str(report.validation_summary_object_key), upload_keys)
        self.assertIn(str(report.document_report_object_key), upload_keys)

    def test_internal_notice_parent_chunks_use_notice_body_lane_strategy(self) -> None:
        record = _make_internal_notice_record(
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119/source-faithful/2026/document-units.jsonl"
            )
        )
        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "title-001",
                    "root_unit_id": "title-001",
                    "unit_type": "policy_page",
                    "text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
                    "raw_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
                    "clean_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
                    "anchor": {"source_uri": record.source_uri, "section_path": ["通知正文"]},
                    "metadata": {"block_role": "title"},
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "body-001",
                    "root_unit_id": "body-001",
                    "unit_type": "article_body",
                    "text": "请同学们于4月10日前完成报名，并按照通知要求提交材料。",
                    "raw_text": "请同学们于4月10日前完成报名，并按照通知要求提交材料。",
                    "clean_text": "请同学们于4月10日前完成报名，并按照通知要求提交材料。",
                    "anchor": {"source_uri": record.source_uri, "section_path": ["通知正文"]},
                    "metadata": {"block_role": "paragraph"},
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        body_chunks = [chunk for chunk in chunks if chunk.metadata["unit_type"] == "article_body"]
        self.assertTrue(body_chunks)
        self.assertTrue(
            all(chunk.metadata["internal_notice_lane"] == "notice_body" for chunk in body_chunks)
        )
        self.assertTrue(
            all(chunk.metadata["strategy_name"] == "internal_notice_notice_body_v2" for chunk in body_chunks)
        )
        self.assertTrue(
            all(
                chunk.metadata["title"] == "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知"
                for chunk in body_chunks
            )
        )

    def test_internal_notice_attachment_text_chunks_use_text_lane_strategy(self) -> None:
        record = _make_internal_notice_attachment_record(
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0001/source-faithful/2026/document-units.jsonl"
            )
        )
        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "attachment-title",
                    "root_unit_id": "attachment-title",
                    "unit_type": "attachment_title",
                    "text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 报名表.docx",
                    "raw_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 报名表.docx",
                    "clean_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 报名表.docx",
                    "anchor": {"source_uri": record.source_uri, "attachment_ref_id": "attachment-0001"},
                    "metadata": {
                        "projection_name": "internal_notice_attachment_documents",
                        "parent_document_id": "notice:muc_internal_portal:355119",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_kind": "office_document_attachment",
                        "attachment_role": "notice_attachment_document",
                        "attachment_filename": "报名表.docx",
                        "attachment_mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "extraction_class": "text_extractable",
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "attachment-body-0001",
                    "root_unit_id": "attachment-body-0001",
                    "unit_type": "attachment_body",
                    "text": "姓名：张三\n学院：法学院\n联系电话：12345678",
                    "raw_text": "姓名：张三\n学院：法学院\n联系电话：12345678",
                    "clean_text": "姓名：张三\n学院：法学院\n联系电话：12345678",
                    "anchor": {"source_uri": record.source_uri, "attachment_ref_id": "attachment-0001"},
                    "metadata": {
                        "projection_name": "internal_notice_attachment_documents",
                        "parent_document_id": "notice:muc_internal_portal:355119",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_kind": "office_document_attachment",
                        "attachment_role": "notice_attachment_document",
                        "attachment_filename": "报名表.docx",
                        "attachment_mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "extraction_class": "text_extractable",
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        body_chunks = [chunk for chunk in chunks if chunk.metadata["unit_type"] == "attachment_body"]
        self.assertTrue(body_chunks)
        self.assertTrue(
            all(
                chunk.metadata["internal_notice_lane"] == "attachment_text_extractable"
                for chunk in body_chunks
            )
        )
        self.assertTrue(
            all(chunk.metadata["strategy_name"] == "internal_notice_attachment_text_v2" for chunk in body_chunks)
        )
        self.assertTrue(
            all(
                chunk.metadata["title"]
                == "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 报名表.docx"
                for chunk in body_chunks
            )
        )

    def test_internal_notice_attachment_ocr_chunks_use_ocr_lane_budget(self) -> None:
        record = _make_internal_notice_attachment_record(
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0001/source-faithful/2026/document-units-ocr.jsonl"
            )
        )
        ocr_text = "\n".join(f"第{index}行 {'甲' * 40}" for index in range(1, 40))
        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "attachment-title",
                    "root_unit_id": "attachment-title",
                    "unit_type": "attachment_title",
                    "text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 现场签到图.jpg",
                    "raw_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 现场签到图.jpg",
                    "clean_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 现场签到图.jpg",
                    "anchor": {"source_uri": record.source_uri, "attachment_ref_id": "attachment-0001"},
                    "metadata": {
                        "projection_name": "internal_notice_attachment_documents",
                        "parent_document_id": "notice:muc_internal_portal:355119",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_kind": "ocr_image_attachment",
                        "attachment_role": "notice_attachment_document",
                        "attachment_filename": "现场签到图.jpg",
                        "attachment_mime_type": "image/jpeg",
                        "extraction_class": "ocr_required",
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "attachment-body-0001",
                    "root_unit_id": "attachment-body-0001",
                    "unit_type": "attachment_body",
                    "text": ocr_text,
                    "raw_text": ocr_text,
                    "clean_text": ocr_text,
                    "anchor": {"source_uri": record.source_uri, "attachment_ref_id": "attachment-0001"},
                    "metadata": {
                        "projection_name": "internal_notice_attachment_documents",
                        "parent_document_id": "notice:muc_internal_portal:355119",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_kind": "ocr_image_attachment",
                        "attachment_role": "notice_attachment_document",
                        "attachment_filename": "现场签到图.jpg",
                        "attachment_mime_type": "image/jpeg",
                        "extraction_class": "ocr_required",
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        body_chunks = [chunk for chunk in chunks if chunk.metadata["unit_type"] == "attachment_body"]
        self.assertGreater(len(body_chunks), 1)
        self.assertTrue(
            all(
                chunk.metadata["internal_notice_lane"] == "attachment_ocr_required"
                for chunk in body_chunks
            )
        )
        self.assertTrue(
            all(chunk.metadata["strategy_name"] == "internal_notice_attachment_ocr_v2" for chunk in body_chunks)
        )
        self.assertTrue(
            all(int(chunk.metadata["final_token_count"]) <= 240 for chunk in body_chunks)
        )

    def test_release_registry_scope_requires_chunk_preparation_for_internal_notice(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key = (
                "campus_notices/documents/internal_notice/"
                "notice-355119/source-faithful/2026/document-units.jsonl"
            )
            record = _make_internal_notice_record(object_key=object_key)
            registry = InMemoryDocumentRegistry((record,), backing_path=root / "registry.json")
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key): _make_internal_notice_document_units_bytes(
                        document_id=record.document_id,
                        version_id=record.version_id,
                    ),
                }
            )

            with self.assertRaisesRegex(
                ValueError,
                "chunk preparation run id is required before release for campus_notices/internal_notice",
            ):
                release_registry_scope(
                    corpus="campus_notices",
                    collection="internal_notice",
                    env=self._env(),
                    registry=registry,
                    object_store=object_store,
                    qdrant_client=QdrantClient(location=":memory:"),
                    publish_alias=False,
                )

    def test_release_registry_scope_uses_verified_chunk_preparation_for_internal_notice(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key = (
                "campus_notices/documents/internal_notice/"
                "notice-355119/source-faithful/2026/document-units.jsonl"
            )
            record = _make_internal_notice_record(object_key=object_key)
            registry = InMemoryDocumentRegistry((record,), backing_path=root / "registry.json")
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key): _make_internal_notice_document_units_bytes(
                        document_id=record.document_id,
                        version_id=record.version_id,
                    ),
                }
            )

            prepare_registry_scope_chunks(
                corpus="campus_notices",
                collection="internal_notice",
                preparation_run_id="prep-20260406-0002",
                env=self._env(),
                registry=registry,
                object_store=object_store,
            )
            report = release_registry_scope(
                corpus="campus_notices",
                collection="internal_notice",
                preparation_run_id="prep-20260406-0002",
                env={
                    **self._env(),
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                registry=registry,
                object_store=object_store,
                qdrant_client=QdrantClient(location=":memory:"),
                publish_alias=False,
            )

        self.assertEqual(report.corpus, "campus_notices")
        self.assertEqual(report.collection, "internal_notice")
        self.assertEqual(report.validation_status, "passed")
        self.assertEqual(report.document_count, 1)
        self.assertGreater(report.point_count, 0)

    def test_prepare_registry_scope_chunks_reports_record_context_on_structured_mismatch(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key = (
                "campus_notices/documents/internal_notice/"
                "notice-355119/source-faithful/2026/document-units.jsonl"
            )
            record = _make_internal_notice_record(object_key=object_key)
            registry = InMemoryDocumentRegistry((record,), backing_path=root / "registry.json")
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key): _make_internal_notice_document_units_bytes(
                        document_id="notice_attachment:muc_internal_portal:355119:attachment-0001",
                        version_id=record.version_id,
                    ),
                }
            )

            with self.assertRaisesRegex(
                ValueError,
                "document_units_object_key=.*document-units.jsonl",
            ):
                prepare_registry_scope_chunks(
                    corpus="campus_notices",
                    collection="internal_notice",
                    preparation_run_id="prep-20260406-0003",
                    env=self._env(),
                    registry=registry,
                    object_store=object_store,
                )


if __name__ == "__main__":
    unittest.main()
