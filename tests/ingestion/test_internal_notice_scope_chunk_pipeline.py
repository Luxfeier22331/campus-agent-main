from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from qdrant_client import QdrantClient

from campus_ingestion_core.models import DocumentRegistryRecord
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
