from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk
from campus_ingestion_core.registry_scope_release import (
    publish_scope_release,
    release_registry_scope,
)
from campus_ingestion_core.settings import ObjectStoreSettings
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


class _OrderedObjectStore(_FakeObjectStore):
    def __init__(self, *, events: list[tuple[str, str | None]]) -> None:
        super().__init__()
        self.events = events
        self.manifest_payloads: list[bytes] = []

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        super().put_bytes(bucket=bucket, key=key, data=data, content_type=content_type)
        self.events.append(("put", key))
        if key.endswith("index-release.json"):
            self.manifest_payloads.append(data)


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


def _make_indexable_chunk(
    *,
    record: DocumentRegistryRecord,
    chunk_id: str,
    text: str,
) -> IndexableChunk:
    return IndexableChunk(
        document_id=record.document_id,
        revision_track=record.revision_track,
        version_id=record.version_id,
        chunk_id=chunk_id,
        chunk_order=1,
        corpus=record.corpus,
        collection=record.collection,
        entitlement_groups=record.entitlement_groups,
        visibility_scope=record.visibility_scope,
        visibility_level="public",
        source_uri=record.source_uri,
        source_chunk_id=None,
        anchor={"section_path": ["News"]},
        text=text,
        source_channel=record.source_channel,
        is_current=True,
        parser_version=record.parser_version,
        embedding_model="mock-embedding-8d",
        embedding=(0.1, 0.2, 0.3),
        metadata={
            "unit_type": "page_content",
            "final_token_count": 32,
            "page_family": "article_detail",
            "serving_intent": "promotable",
        },
    )


class RegistryScopeReleaseTest(unittest.TestCase):
    def test_publish_scope_release_writes_prepublish_manifest_before_alias(self) -> None:
        events: list[tuple[str, str | None]] = []
        object_store = _OrderedObjectStore(events=events)
        qdrant_client = Mock()
        qdrant_client.get_aliases.return_value.aliases = []
        qdrant_client.collection_exists.return_value = False
        first_record = _make_record(
            document_id="official_web:muc_public_pages:news-001",
            version_id="owver:news-001",
            object_key="official_web/news-001/document-units.jsonl",
        )
        second_record = _make_record(
            document_id="official_web:muc_public_pages:news-002",
            version_id="owver:news-002",
            object_key="official_web/news-002/document-units.jsonl",
        )
        chunks = (
            _make_indexable_chunk(
                record=first_record,
                chunk_id=f"{first_record.document_id}:chunk-0001",
                text="中央民族大学官网新闻正文。",
            ),
            _make_indexable_chunk(
                record=second_record,
                chunk_id=f"{second_record.document_id}:chunk-0001",
                text="中央民族大学官网第二条新闻正文。",
            ),
        )

        with (
            patch(
                "campus_ingestion_core.registry_scope_release.index_chunks_to_qdrant",
                side_effect=lambda **kwargs: events.append(("upsert", None)),
            ),
            patch(
                "campus_ingestion_core.registry_scope_release.publish_release_alias",
                side_effect=lambda **kwargs: events.append(("alias", None)),
            ),
        ):
            publish_scope_release(
                corpus="official_web",
                collection="muc_public_pages",
                records=(first_record, second_record),
                chunks=chunks,
                object_store=object_store,
                qdrant_client=qdrant_client,
                object_store_settings=ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                    bucket_derived="campus-rag-derived",
                ),
                runtime_profile=load_runtime_profile("official_web", "muc_public_pages"),
                sparse_embedding_model=object(),
                publish_alias=True,
                upsert_batch_size=128,
            )

        manifest_events = [
            (index, event)
            for index, event in enumerate(events)
            if event[0] == "put" and str(event[1]).endswith("index-release.json")
        ]
        alias_index = next(index for index, event in enumerate(events) if event[0] == "alias")
        self.assertLess(manifest_events[0][0], alias_index)
        first_manifest = json.loads(object_store.manifest_payloads[0].decode("utf-8"))
        final_manifest = json.loads(object_store.manifest_payloads[-1].decode("utf-8"))
        self.assertIsNone(first_manifest["published_at"])
        self.assertIsNotNone(final_manifest["published_at"])

    def test_release_registry_scope_rejects_embedding_model_env_drift(self) -> None:
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

            with self.assertRaisesRegex(ValueError, "embedding model mismatch"):
                release_registry_scope(
                    corpus="official_web",
                    collection="muc_public_pages",
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_MODEL": "different-query-model",
                        "EMBEDDING_PROVIDER": "mock",
                        "SPARSE_PROVIDER": "mock",
                    },
                    registry=registry,
                    object_store=object_store,
                    qdrant_client=QdrantClient(location=":memory:"),
                    publish_alias=True,
                )

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

    def test_release_registry_scope_reports_embedding_cache_hits_on_repeated_release(self) -> None:
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
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "EMBEDDING_PROVIDER": "mock",
                "EMBEDDING_MODEL": "mock-embedding-8d",
                "SPARSE_PROVIDER": "mock",
                "INGESTION_EMBEDDING_CACHE_ENABLED": "true",
            }

            first_report = release_registry_scope(
                corpus="official_web",
                collection="muc_public_pages",
                env=env,
                registry=registry,
                object_store=object_store,
                qdrant_client=QdrantClient(location=":memory:"),
                publish_alias=False,
            )
            for upload in object_store.uploads:
                object_store.objects[(str(upload["bucket"]), str(upload["key"]))] = upload[
                    "data"
                ]
            second_report = release_registry_scope(
                corpus="official_web",
                collection="muc_public_pages",
                env=env,
                registry=registry,
                object_store=object_store,
                qdrant_client=QdrantClient(location=":memory:"),
                publish_alias=False,
            )

        self.assertGreater(first_report.embedding_cache_miss_count, 0)
        self.assertEqual(first_report.embedding_cache_hit_count, 0)
        self.assertGreater(second_report.embedding_cache_hit_count, 0)
        self.assertEqual(second_report.embedding_provider_call_count, 0)

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
