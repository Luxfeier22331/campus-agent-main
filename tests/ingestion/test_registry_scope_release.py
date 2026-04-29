from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry_scope_release import release_registry_scope
from qdrant_client import QdrantClient

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
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )


def _make_document_units_bytes(*, document_id: str, version_id: str, text: str) -> bytes:
    row = {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": f"{document_id}:legacy:0001",
        "clean_text": text,
        "anchor": {
            "section_path": ["Official Web", "News"],
            "page_start": 1,
            "page_end": 1,
        },
        "acl": {"level": "public", "allow_groups": []},
        "metadata": {
            "page_family": "article_detail",
            "unit_type": "page_content",
            "serving_intent": "promotable",
            "content_role": "primary_content",
        },
    }
    return (json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8")


def _make_record(
    *,
    document_id: str,
    version_id: str,
    object_key: str,
    status: str = "active",
    is_current: bool = True,
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=f"https://www.muc.edu.cn/{document_id.split(':')[-1]}.htm",
        content_hash=f"sha256:{document_id}",
        corpus="official_web",
        collection="muc_public_pages",
        cleaning_policy_version="official_web_cleaning_v1",
        entitlement_groups=(),
        visibility_scope=None,
        status=status,
        ingestion_timestamp="2026-04-02T10:00:00+00:00",
        parser_version="official_web_projection_v1",
        embedding_model="mock-embedding-8d",
        source_channel="official_web",
        is_current=is_current,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source="official_web_sync",
    )


class RegistryScopeReleaseTest(unittest.TestCase):
    def test_release_registry_scope_writes_manifest_without_publishing_alias(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key_1 = (
                "official_web/documents/muc_public_pages/"
                "news-001--news001/source-faithful/undated/document-units.jsonl"
            )
            object_key_2 = (
                "official_web/documents/muc_public_pages/"
                "news-002--news002/source-faithful/undated/document-units.jsonl"
            )
            registry = InMemoryDocumentRegistry(
                (
                    _make_record(
                        document_id="official_web:muc_public_pages:news-001",
                        version_id="owver:news-001",
                        object_key=object_key_1,
                    ),
                    _make_record(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        object_key=object_key_2,
                    ),
                ),
                backing_path=root / "registry.json",
            )
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key_1): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-001",
                        version_id="owver:news-001",
                        text="中央民族大学官网新闻正文。",
                    ),
                    ("campus-rag-derived", object_key_2): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        text="中央民族大学法学院新闻正文。",
                    ),
                }
            )
            qdrant_client = QdrantClient(location=":memory:")

            report = release_registry_scope(
                corpus="official_web",
                collection="muc_public_pages",
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                registry=registry,
                object_store=object_store,
                qdrant_client=qdrant_client,
                publish_alias=False,
            )

        self.assertEqual(report.corpus, "official_web")
        self.assertEqual(report.collection, "muc_public_pages")
        self.assertEqual(report.serving_alias, "muc_public_pages")
        self.assertTrue(report.physical_collection_name.startswith("muc_public_pages__r"))
        self.assertIsNone(report.published_at)
        self.assertEqual(report.document_count, 2)
        self.assertGreater(report.point_count, 0)
        self.assertEqual(
            resolve_alias_target(qdrant_client=qdrant_client, alias_name="muc_public_pages"),
            None,
        )
        self.assertEqual(
            object_store.reads,
            [
                ("campus-rag-derived", object_key_1),
                ("campus-rag-derived", object_key_2),
            ],
        )
        upload_keys = [str(item["key"]) for item in object_store.uploads]
        self.assertIn(report.manifest_object_key, upload_keys)
        self.assertIn(str(report.validation_summary_object_key), upload_keys)

    def test_release_registry_scope_publishes_alias_for_active_records_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            active_key = (
                "official_web/documents/muc_public_pages/"
                "news-002--news002/source-faithful/undated/document-units.jsonl"
            )
            active_key_two = (
                "official_web/documents/muc_public_pages/"
                "news-004--news004/source-faithful/undated/document-units.jsonl"
            )
            superseded_key = (
                "official_web/documents/muc_public_pages/"
                "news-003--news003/source-faithful/undated/document-units.jsonl"
            )
            registry = InMemoryDocumentRegistry(
                (
                    _make_record(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        object_key=active_key,
                        status="active",
                        is_current=True,
                    ),
                    _make_record(
                        document_id="official_web:muc_public_pages:news-004",
                        version_id="owver:news-004",
                        object_key=active_key_two,
                        status="active",
                        is_current=True,
                    ),
                    _make_record(
                        document_id="official_web:muc_public_pages:news-003",
                        version_id="owver:news-003",
                        object_key=superseded_key,
                        status="superseded",
                        is_current=False,
                    ),
                ),
                backing_path=root / "registry.json",
            )
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", active_key): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        text="官方网页采集正文。",
                    ),
                    ("campus-rag-derived", active_key_two): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-004",
                        version_id="owver:news-004",
                        text="官方网页第二条正文。",
                    ),
                    ("campus-rag-derived", superseded_key): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-003",
                        version_id="owver:news-003",
                        text="旧版本网页正文。",
                    ),
                }
            )
            qdrant_client = QdrantClient(location=":memory:")

            report = release_registry_scope(
                corpus="official_web",
                collection="muc_public_pages",
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                registry=registry,
                object_store=object_store,
                qdrant_client=qdrant_client,
                publish_alias=True,
            )

        self.assertEqual(report.document_count, 2)
        self.assertEqual(
            resolve_alias_target(qdrant_client=qdrant_client, alias_name="muc_public_pages"),
            report.physical_collection_name,
        )
        manifest_payload = next(
            json.loads(item["data"].decode("utf-8"))
            for item in object_store.uploads
            if item["key"] == report.manifest_object_key
        )
        self.assertEqual(len(manifest_payload["documents"]), 2)
        self.assertEqual(
            [document["document_id"] for document in manifest_payload["documents"]],
            [
                "official_web:muc_public_pages:news-002",
                "official_web:muc_public_pages:news-004",
            ],
        )

    def test_release_registry_scope_fails_closed_when_scope_has_no_releasable_records(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "no releasable registry records found for official_web/muc_public_pages",
        ):
            release_registry_scope(
                corpus="official_web",
                collection="muc_public_pages",
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                registry=InMemoryDocumentRegistry(),
                object_store=_FakeObjectStore(),
                qdrant_client=QdrantClient(location=":memory:"),
            )


if __name__ == "__main__":
    unittest.main()
