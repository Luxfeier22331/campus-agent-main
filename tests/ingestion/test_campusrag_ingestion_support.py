from __future__ import annotations

import hashlib
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    S3ObjectStoreWriter,
    apply_authorization_projection_metadata,
    collect_import_document_stats,
    persist_import_documents,
    load_metadata_from_bytes,
    persist_import_documents,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.settings import ObjectStoreSettings


def _metadata(document_id: str, version_id: str) -> dict[str, object]:
    return {
        "document_id": document_id,
        "version_id": version_id,
        "entitlement_groups": [],
    }


def _document_input(
    *,
    document_id: str,
    version_id: str,
    body: str,
    revision_track: str = "source-faithful",
    is_current: bool = False,
    source_channel: str = "pdf_ocr",
    source_url: str | None = None,
    import_source: str = "provider_response_replay",
) -> DocumentImportInput:
    metadata = _metadata(document_id, version_id)
    if source_url is not None:
        metadata["source_url"] = source_url
    return DocumentImportInput(
        source_label=f"{document_id}.jsonl",
        document_units_bytes=body.encode("utf-8"),
        provider_response_bytes=None,
        canonical_markdown_bytes=None,
        metadata=metadata,
        import_source=import_source,
        revision_track=revision_track,
        source_channel=source_channel,
        is_current=is_current,
        corpus="regulations",
        collection="student_handbook",
        title=document_id.split(":")[-1],
        year="2026",
    )


def _record(
    *,
    document_id: str,
    version_id: str,
    content_hash: str,
    ingestion_timestamp: str = "2026-03-25T00:00:00+00:00",
    revision_track: str = "source-faithful",
    is_current: bool = False,
    status: str = "active",
    source_channel: str = "pdf_ocr",
    source_uri: str | None = None,
    import_source: str = "provider_response_replay",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track=revision_track,
        version_id=version_id,
        source_uri=source_uri or f"campusrag://import/{document_id}/{version_id}",
        content_hash=content_hash,
        corpus="regulations",
        collection="student_handbook",
        cleaning_policy_version="student_handbook_cleaning_v1",
        entitlement_groups=(),
        visibility_scope=None,
        status=status,
        ingestion_timestamp=ingestion_timestamp,
        parser_version="campusrag-import-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel=source_channel,
        is_current=is_current,
        document_units_object_key=f"regulations/documents/student_handbook/{document_id}/{version_id}/document-units.jsonl",
        processed_object_keys=(
            f"regulations/documents/student_handbook/{document_id}/{version_id}/document-units.jsonl",
        ),
        import_source=import_source,
    )


class _FakeWriter:
    def __init__(self, *, existing_objects: tuple[tuple[str, str], ...] = ()) -> None:
        self.puts: list[tuple[str, str]] = []
        self.objects = {key: b"" for key in existing_objects}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.puts.append((bucket, key))
        self.objects[(bucket, key)] = data

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self.objects[(bucket, key)]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc


class _FakeRawAssetRegistry:
    def get(self, raw_asset_id: str, raw_version_id: str) -> None:
        return None

    def upsert(self, record: object) -> None:
        raise AssertionError("raw asset upsert should not be called in this test")


class _SpyDocumentRegistry:
    def __init__(self, records: tuple[DocumentRegistryRecord, ...]) -> None:
        self.records = records
        self.list_by_scope_calls: list[tuple[str, str | None]] = []
        self.upsert_calls: list[DocumentRegistryRecord] = []
        self.upsert_many_calls: list[tuple[DocumentRegistryRecord, ...]] = []
        self.replace_scope_calls: list[tuple[str, str, tuple[DocumentRegistryRecord, ...]]] = []

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        self.list_by_scope_calls.append((corpus, collection))
        return self.records

    def upsert(self, record: DocumentRegistryRecord) -> None:
        self.upsert_calls.append(record)

    def upsert_many(self, records: tuple[DocumentRegistryRecord, ...]) -> None:
        self.upsert_many_calls.append(records)

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: tuple[DocumentRegistryRecord, ...],
    ) -> None:
        self.replace_scope_calls.append((corpus, collection, records))


class _LegacyProjectionBlockedScopeRefreshRegistry(_SpyDocumentRegistry):
    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        self.list_by_scope_calls.append((corpus, collection))
        raise ValueError(
            "registry payload contains unsupported authorization projection keys: acl_groups, campus_scope"
        )

    def list_processed_object_keys_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[str, ...]:
        return ()


class _ImportablePrefetchRegistry(_SpyDocumentRegistry):
    def __init__(self, records: tuple[DocumentRegistryRecord, ...] = ()) -> None:
        super().__init__(records=records)
        self.importable_scope_calls: list[tuple[str, str | None]] = []

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        self.list_by_scope_calls.append((corpus, collection))
        raise AssertionError("list_by_scope should not be used when importable scope prefetch is available")

    def list_importable_scope_records_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        self.importable_scope_calls.append((corpus, collection))
        return self.records


class _FakeS3Client:
    def __init__(self, name: str) -> None:
        self.name = name
        self.put_calls: list[dict[str, object]] = []
        self.get_calls: list[dict[str, object]] = []
        self.closed = False
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, **kwargs: object) -> None:
        self.put_calls.append(kwargs)
        bucket = str(kwargs["Bucket"])
        key = str(kwargs["Key"])
        body = kwargs["Body"]
        assert isinstance(body, bytes)
        self.objects[(bucket, key)] = body

    def get_object(self, **kwargs: object) -> dict[str, object]:
        self.get_calls.append(kwargs)
        bucket = str(kwargs["Bucket"])
        key = str(kwargs["Key"])
        payload = self.objects[(bucket, key)]

        class _Body:
            def __init__(self, data: bytes) -> None:
                self._data = data

            def read(self) -> bytes:
                return self._data

        return {"Body": _Body(payload)}

    def close(self) -> None:
        self.closed = True


class CampusragIngestionSupportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.object_store = ObjectStoreSettings(
            endpoint="http://localhost:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
        )

    def test_s3_object_store_writer_uses_one_shot_client_for_zero_byte_payloads(self) -> None:
        created_clients: list[_FakeS3Client] = []

        class _Factory:
            def __init__(self, settings: ObjectStoreSettings) -> None:
                self.settings = settings

            def create(self) -> _FakeS3Client:
                client = _FakeS3Client(name=f"client-{len(created_clients) + 1}")
                created_clients.append(client)
                return client

        with patch("campus_ingestion_core.object_store.S3ObjectStoreClientFactory", _Factory):
            writer = S3ObjectStoreWriter(self.object_store)
            writer.put_bytes(
                bucket="campus-rag-source",
                key="non-empty-before.json",
                data=b'{"ok": 1}',
                content_type="application/json",
            )
            writer.put_bytes(
                bucket="campus-rag-source",
                key="empty.jsonl",
                data=b"",
                content_type="application/x-ndjson",
            )
            writer.put_bytes(
                bucket="campus-rag-source",
                key="non-empty-after.json",
                data=b'{"ok": 2}',
                content_type="application/json",
            )

        self.assertEqual(len(created_clients), 2)
        self.assertEqual(
            [call["Key"] for call in created_clients[0].put_calls],
            ["non-empty-before.json", "non-empty-after.json"],
        )
        self.assertEqual([call["Key"] for call in created_clients[1].put_calls], ["empty.jsonl"])
        self.assertTrue(created_clients[1].closed)

    def test_s3_object_store_writer_supports_get_bytes(self) -> None:
        class _Factory:
            def __init__(self, settings: ObjectStoreSettings) -> None:
                self.settings = settings

            def create(self) -> _FakeS3Client:
                client = _FakeS3Client(name="reader")
                client.objects[("campus-rag-source", "source-truth/test.json")] = b'{"ok": 1}'
                return client

        with patch("campus_ingestion_core.object_store.S3ObjectStoreClientFactory", _Factory):
            writer = S3ObjectStoreWriter(self.object_store)
            payload = writer.get_bytes(
                bucket="campus-rag-source",
                key="source-truth/test.json",
            )

        self.assertEqual(payload, b'{"ok": 1}')

    def test_collect_import_document_stats_batches_incremental_upserts_after_single_prefetch(self) -> None:
        doc_a = _document_input(
            document_id="handbook:doc-a",
            version_id="v1:doc-a",
            body='{"type":"paragraph","text":"A"}\n',
        )
        doc_b = _document_input(
            document_id="handbook:doc-b",
            version_id="v1:doc-b",
            body='{"type":"paragraph","text":"B"}\n',
        )
        registry = _SpyDocumentRegistry(records=())

        stats = collect_import_document_stats(
            documents=[doc_a, doc_b],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_handbook_cleaning_v1",
            default_visibility_scope=None,
        )

        self.assertEqual(stats.success_count, 2)
        self.assertEqual(registry.list_by_scope_calls, [("regulations", "student_handbook")])
        self.assertEqual(len(registry.upsert_calls), 0)
        self.assertEqual(len(registry.upsert_many_calls), 1)
        self.assertEqual(
            tuple(record.document_id for record in registry.upsert_many_calls[0]),
            ("handbook:doc-a", "handbook:doc-b"),
        )

    def test_collect_import_document_stats_can_replace_scope_after_single_prefetch(self) -> None:
        doc_keep = _document_input(
            document_id="handbook:doc-keep",
            version_id="v1:doc-keep",
            body='{"type":"paragraph","text":"keep"}\n',
        )
        doc_new = _document_input(
            document_id="handbook:doc-new",
            version_id="v2:doc-new",
            body='{"type":"paragraph","text":"new"}\n',
        )
        keep_hash = hashlib.sha256(doc_keep.document_units_bytes).hexdigest()
        old_hash = hashlib.sha256(b"old\n").hexdigest()
        existing_keep = _record(
            document_id="handbook:doc-keep",
            version_id="v1:doc-keep",
            content_hash=keep_hash,
        )
        existing_old = _record(
            document_id="handbook:doc-new",
            version_id="v1:doc-new",
            content_hash=old_hash,
        )
        stale_orphan = _record(
            document_id="handbook:doc-orphan",
            version_id="v1:doc-orphan",
            content_hash=hashlib.sha256(b"orphan\n").hexdigest(),
        )
        registry = _SpyDocumentRegistry(records=(existing_keep, existing_old, stale_orphan))

        stats = collect_import_document_stats(
            documents=[doc_keep, doc_new],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_handbook_cleaning_v1",
            default_visibility_scope=None,
            scope_refresh=("regulations", "student_handbook"),
        )

        self.assertEqual(stats.success_count, 1)
        self.assertEqual(stats.skipped_count, 1)
        self.assertEqual(stats.updated_document_ids, ("handbook:doc-new",))
        self.assertEqual(stats.skipped_document_ids, ("handbook:doc-keep",))
        self.assertEqual(registry.list_by_scope_calls, [("regulations", "student_handbook")])
        self.assertEqual(len(registry.upsert_calls), 0)
        self.assertEqual(len(registry.upsert_many_calls), 0)
        self.assertEqual(len(registry.replace_scope_calls), 1)
        self.assertEqual(
            tuple(record.document_id for record in registry.replace_scope_calls[0][2]),
            ("handbook:doc-keep", "handbook:doc-new"),
        )

    def test_collect_import_document_stats_scope_refresh_can_recover_from_legacy_registry_rows(self) -> None:
        doc_keep = _document_input(
            document_id="handbook:doc-keep",
            version_id="v1:doc-keep",
            body='{"type":"paragraph","text":"keep"}\n',
        )
        doc_new = _document_input(
            document_id="handbook:doc-new",
            version_id="v2:doc-new",
            body='{"type":"paragraph","text":"new"}\n',
        )
        registry = _LegacyProjectionBlockedScopeRefreshRegistry(records=())

        stats = collect_import_document_stats(
            documents=[doc_keep, doc_new],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_handbook_cleaning_v1",
            default_visibility_scope=None,
            scope_refresh=("regulations", "student_handbook"),
        )

        self.assertEqual(stats.success_count, 2)
        self.assertEqual(stats.failed_count, 0)
        self.assertEqual(registry.list_by_scope_calls, [("regulations", "student_handbook")])
        self.assertEqual(len(registry.replace_scope_calls), 1)
        self.assertEqual(
            tuple(record.document_id for record in registry.replace_scope_calls[0][2]),
            ("handbook:doc-keep", "handbook:doc-new"),
        )

    def test_collect_import_document_stats_prefers_importable_scope_prefetch(self) -> None:
        doc_new = _document_input(
            document_id="handbook:doc-new",
            version_id="v1:doc-new",
            body='{"type":"paragraph","text":"new"}\n',
        )
        registry = _ImportablePrefetchRegistry(records=())

        stats = collect_import_document_stats(
            documents=[doc_new],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_handbook_cleaning_v1",
            default_visibility_scope=None,
        )

        self.assertEqual(stats.success_count, 1)
        self.assertEqual(registry.importable_scope_calls, [("regulations", "student_handbook")])
        self.assertEqual(registry.list_by_scope_calls, [])

    def test_collect_import_document_stats_demotes_prior_current_version_when_new_current_is_imported(self) -> None:
        doc_new_current = _document_input(
            document_id="handbook:doc-current",
            version_id="v2:doc-current",
            body='{"type":"paragraph","text":"current"}\n',
            revision_track="current-effective",
            is_current=True,
        )
        old_current = _record(
            document_id="handbook:doc-current",
            version_id="v1:doc-current",
            content_hash=hashlib.sha256(b"old-current\n").hexdigest(),
            revision_track="current-effective",
            is_current=True,
            status="active",
            ingestion_timestamp="2026-03-24T00:00:00+00:00",
        )
        registry = _SpyDocumentRegistry(records=(old_current,))

        stats = collect_import_document_stats(
            documents=[doc_new_current],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_handbook_cleaning_v1",
            default_visibility_scope=None,
            scope_refresh=("regulations", "student_handbook"),
        )

        self.assertEqual(stats.success_count, 1)
        self.assertEqual(len(registry.replace_scope_calls), 1)
        refreshed_records = registry.replace_scope_calls[0][2]
        self.assertEqual(len(refreshed_records), 2)
        records_by_version = {record.version_id: record for record in refreshed_records}
        self.assertTrue(records_by_version["v2:doc-current"].is_current)
        self.assertEqual(records_by_version["v2:doc-current"].supersedes_version_id, "v1:doc-current")
        self.assertFalse(records_by_version["v1:doc-current"].is_current)
        self.assertEqual(records_by_version["v1:doc-current"].status, "superseded")

    def test_collect_import_document_stats_merges_equivalent_web_source_without_creating_new_version(self) -> None:
        body = '{"type":"paragraph","text":"same"}\n'
        existing = _record(
            document_id="handbook:doc-merge",
            version_id="v1:doc-merge",
            content_hash=hashlib.sha256(body.encode("utf-8")).hexdigest(),
            revision_track="current-effective",
            is_current=True,
            source_channel="pdf_ocr",
            source_uri="https://pdf.example/doc-merge",
        )
        incoming = _document_input(
            document_id="handbook:doc-merge",
            version_id="v2:web-doc-merge",
            body=body,
            revision_track="current-effective",
            is_current=True,
            source_channel="official_web",
            source_url="https://web.example/doc-merge",
            import_source="official_web_sync",
        )
        registry = _SpyDocumentRegistry(records=(existing,))

        stats = collect_import_document_stats(
            documents=[incoming],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_handbook_cleaning_v1",
            default_visibility_scope=None,
        )

        self.assertEqual(stats.success_count, 0)
        self.assertEqual(stats.skipped_count, 1)
        self.assertEqual(len(registry.upsert_many_calls), 1)
        self.assertEqual(len(registry.upsert_many_calls[0]), 1)
        merged = registry.upsert_many_calls[0][0]
        self.assertEqual(merged.version_id, "v1:doc-merge")
        self.assertEqual(merged.source_channel, "official_web")
        self.assertEqual(merged.source_uri, "https://web.example/doc-merge")
        self.assertEqual(len(merged.source_observations), 2)
        self.assertEqual(
            tuple(observation.source_channel for observation in merged.source_observations if observation.is_primary),
            ("official_web",),
        )

    def test_collect_import_document_stats_merges_equivalent_official_web_scope_record_with_different_document_id(
        self,
    ) -> None:
        body = (
            '{"doc_id":"official_web:muc_public:article_detail:news-doc","version_id":"owdocver:news-doc",'
            '"chunk_id":"news-doc:0001","clean_text":"中央民族大学与北京丰台人才集团共建就业实习实践基地。",'
            '"anchor":{"section_path":["新闻"],"page_start":1,"page_end":1},'
            '"source_url":"https://news.muc.edu.cn/info/1011/61874.htm",'
            '"metadata":{"title":"中央民族大学与北京丰台人才集团共建就业实习实践基地",'
            '"page_family":"article_detail","serving_intent":"promotable","content_role":"primary_content"},'
            '"acl":{"level":"public","allow_groups":[]}}\n'
        )
        semantic_hash = hashlib.sha256(b"official-web-semantic-duplicate").hexdigest()
        existing = DocumentRegistryRecord(
            document_id="official_web:muc_public:article_detail:news-doc",
            revision_track="source-faithful",
            version_id="owdocver:news-doc",
            source_uri="https://news.muc.edu.cn/info/1011/61874.htm",
            content_hash=semantic_hash,
            corpus="official_web",
            collection="muc_public_pages",
            cleaning_policy_version="official_web_cleaning_v2",
            entitlement_groups=(),
            visibility_scope=None,
            status="active",
            ingestion_timestamp="2026-04-03T00:00:00+00:00",
            parser_version="official_web_projection_replay.v1",
            embedding_model="",
            source_channel="official_web",
            is_current=True,
            document_units_object_key=(
                "official_web/documents/muc_public_pages/news-doc/source-faithful/undated/document-units.jsonl"
            ),
            processed_object_keys=(
                "official_web/documents/muc_public_pages/news-doc/source-faithful/undated/document-units.jsonl",
            ),
            import_source="official_web_source_truth_replay",
        )
        incoming = DocumentImportInput(
            source_label="official_web:muc_public:article_detail:xxgk-doc",
            document_units_bytes=body.encode("utf-8"),
            provider_response_bytes=None,
            canonical_markdown_bytes=None,
            metadata={
                "document_id": "official_web:muc_public:article_detail:xxgk-doc",
                "version_id": "owdocver:xxgk-doc",
                "acl_groups": (),
                "source_url": "https://xxgk.muc.edu.cn/info/1362/28641.htm",
                "title": "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                "page_family": "article_detail",
                "serving_intent": "promotable",
                "content_role": "primary_content",
                "semantic_content_hash": semantic_hash,
            },
            import_source="official_web_source_truth_replay",
            revision_track="source-faithful",
            source_channel="official_web",
            is_current=True,
            corpus="official_web",
            collection="muc_public_pages",
            title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
        )
        registry = _SpyDocumentRegistry(records=(existing,))

        stats = collect_import_document_stats(
            documents=[incoming],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="official_web_projection_replay.v1",
            embedding_model="",
            cleaning_policy_version="official_web_cleaning_v2",
            default_visibility_scope=None,
            scope_refresh=("official_web", "muc_public_pages"),
        )

        self.assertEqual(stats.success_count, 0)
        self.assertEqual(stats.skipped_count, 1)
        self.assertEqual(len(registry.replace_scope_calls), 1)
        refreshed_records = registry.replace_scope_calls[0][2]
        self.assertEqual(len(refreshed_records), 1)
        merged = refreshed_records[0]
        self.assertEqual(merged.document_id, "official_web:muc_public:article_detail:news-doc")
        self.assertEqual(merged.version_id, "owdocver:news-doc")
        self.assertEqual(len(merged.source_observations), 2)
        self.assertEqual(
            {observation.source_uri for observation in merged.source_observations},
            {
                "https://news.muc.edu.cn/info/1011/61874.htm",
                "https://xxgk.muc.edu.cn/info/1362/28641.htm",
            },
        )

    def test_collect_import_document_stats_rewrites_missing_processed_artifacts_for_matching_content(self) -> None:
        document = _document_input(
            document_id="handbook:doc-a",
            version_id="v1:doc-a",
            body='{"type":"paragraph","text":"A"}\n',
        )
        content_hash = hashlib.sha256(document.document_units_bytes).hexdigest()
        existing = _record(
            document_id="handbook:doc-a",
            version_id="v1:doc-a",
            content_hash=content_hash,
        )
        registry = _SpyDocumentRegistry(records=(existing,))
        writer = _FakeWriter()

        stats = collect_import_document_stats(
            documents=[document],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=writer,
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_handbook_cleaning_v1",
            default_visibility_scope=None,
        )

        expected_key = (
            "regulations/documents/student_handbook/doc-a--doc-a/"
            "source-faithful/2026/document-units.jsonl"
        )
        self.assertEqual(stats.success_count, 0)
        self.assertEqual(stats.skipped_count, 1)
        self.assertEqual(stats.updated_document_ids, ())
        self.assertEqual(stats.skipped_document_ids, ("handbook:doc-a",))
        self.assertIn((self.object_store.bucket_derived, expected_key), writer.puts)
        self.assertEqual(len(registry.upsert_many_calls), 1)

    def test_collect_import_document_stats_rewrites_changed_processed_artifacts_for_matching_content(self) -> None:
        document = _document_input(
            document_id="handbook:doc-b",
            version_id="v1:doc-b",
            body='{"type":"paragraph","text":"new"}\n',
        )
        document.metadata["semantic_content_hash"] = "semantic-doc-b"
        existing = _record(
            document_id="handbook:doc-b",
            version_id="v1:doc-b",
            content_hash="semantic-doc-b",
        )
        registry = _SpyDocumentRegistry(records=(existing,))
        expected_key = (
            "regulations/documents/student_handbook/doc-b--doc-b/"
            "source-faithful/2026/document-units.jsonl"
        )
        writer = _FakeWriter(
            existing_objects=((self.object_store.bucket_derived, expected_key),)
        )
        writer.objects[(self.object_store.bucket_derived, expected_key)] = (
            '{"type":"paragraph","text":"old"}\n'.encode("utf-8")
        )

        stats = collect_import_document_stats(
            documents=[document],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=writer,
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_handbook_cleaning_v1",
            default_visibility_scope=None,
        )

        self.assertEqual(stats.success_count, 0)
        self.assertEqual(stats.skipped_count, 1)
        self.assertEqual(stats.skipped_document_ids, ("handbook:doc-b",))
        self.assertIn((self.object_store.bucket_derived, expected_key), writer.puts)
        self.assertEqual(
            writer.objects[(self.object_store.bucket_derived, expected_key)],
            document.document_units_bytes,
        )
        self.assertEqual(len(registry.upsert_many_calls), 1)

    def test_persist_import_documents_forwards_scope_refresh_to_collect_stats(self) -> None:
        document = _document_input(
            document_id="handbook:doc-a",
            version_id="v1:doc-a",
            body='{"type":"paragraph","text":"A"}\n',
        )
        registry = _SpyDocumentRegistry(records=())
        writer = _FakeWriter()

        with patch("campus_ingestion_core.campusrag_ingestion_support.collect_import_document_stats") as collect_stats:
            collect_stats.return_value = Mock(
                success_count=1,
                skipped_count=0,
                failed_count=0,
                raw_uploaded_count=0,
                raw_reused_count=0,
                document_ids=("handbook:doc-a",),
                created_document_ids=("handbook:doc-a",),
                updated_document_ids=(),
                skipped_document_ids=(),
                unresolved_source_pdfs=(),
                errors=(),
                timestamp="2026-04-03T00:00:00+00:00",
            )
            persist_import_documents(
                documents=[document],
                registry=registry,
                raw_asset_registry=_FakeRawAssetRegistry(),
                writer=writer,
                object_store=self.object_store,
                parser_version="campusrag-import-v1",
                embedding_model="Qwen3-Embedding-4B",
                cleaning_policy_version="student_handbook_cleaning_v1",
                default_visibility_scope=None,
                import_mode="test",
                report_dir=Path("/tmp/test-import-report"),
                report_prefix="test-import",
                scope_refresh=("regulations", "student_handbook"),
            )

        self.assertEqual(
            collect_stats.call_args.kwargs["scope_refresh"],
            ("regulations", "student_handbook"),
        )

    def test_collect_import_document_stats_prefers_new_authorization_projection_metadata(self) -> None:
        document = _document_input(
            document_id="handbook:doc-authz",
            version_id="v1:doc-authz",
            body='{"type":"paragraph","text":"Authz"}\n',
        )
        document.metadata.update(
            {
                "entitlement_groups": ["students"],
                "visibility_scope": "main",
                "visibility_level": "restricted",
            }
        )
        registry = _SpyDocumentRegistry(records=())

        stats = collect_import_document_stats(
            documents=[document],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_handbook_cleaning_v1",
            default_visibility_scope="fallback-campus",
        )

        self.assertEqual(stats.success_count, 1)
        self.assertEqual(len(registry.upsert_many_calls), 1)
        created_record = registry.upsert_many_calls[0][0]
        self.assertEqual(created_record.entitlement_groups, ("students",))
        self.assertEqual(created_record.visibility_scope, "main")
        self.assertEqual(created_record.visibility_level, "restricted")
        self.assertEqual(
            created_record.policy_projection_version,
            DEFAULT_POLICY_PROJECTION_VERSION,
        )

    def test_collect_import_document_stats_rejects_unsupported_authorization_metadata_keys(self) -> None:
        document = _document_input(
            document_id="handbook:doc-authz",
            version_id="v1:doc-authz",
            body='{"type":"paragraph","text":"Authz"}\n',
        )
        document.metadata.update(
            {
                "acl_level": "restricted",
                "acl_groups": ["legacy-staff"],
                "campus_scope": "south",
            }
        )
        registry = _SpyDocumentRegistry(records=())

        stats = collect_import_document_stats(
            documents=[document],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_handbook_cleaning_v1",
            default_visibility_scope="fallback-campus",
        )

        self.assertEqual(stats.success_count, 0)
        self.assertEqual(stats.failed_count, 1)
        self.assertEqual(len(registry.upsert_many_calls), 0)
        self.assertRegex(
            stats.errors[0],
            "unsupported authorization metadata keys",
        )

    def test_apply_authorization_projection_metadata_writes_canonical_projection_fields(self) -> None:
        metadata = {
            "document_id": "handbook:doc-authz",
            "version_id": "v1:doc-authz",
        }

        apply_authorization_projection_metadata(
            metadata,
            entitlement_groups=("students",),
            visibility_scope="main",
            visibility_level="restricted",
        )

        self.assertEqual(metadata["entitlement_groups"], ["students"])
        self.assertEqual(metadata["visibility_scope"], "main")
        self.assertEqual(metadata["visibility_level"], "restricted")
        self.assertEqual(
            metadata["policy_projection_version"],
            DEFAULT_POLICY_PROJECTION_VERSION,
        )

    def test_apply_authorization_projection_metadata_rejects_unsupported_authorization_metadata_keys(self) -> None:
        metadata = {
            "document_id": "handbook:doc-authz",
            "version_id": "v1:doc-authz",
            "acl_level": "public",
            "acl_groups": ["legacy-staff"],
            "campus_scope": "south",
        }

        with self.assertRaisesRegex(ValueError, "unsupported authorization metadata keys"):
            apply_authorization_projection_metadata(
                metadata,
                entitlement_groups=("students",),
                visibility_scope="main",
                visibility_level="restricted",
            )

    def test_load_metadata_from_bytes_reads_canonical_row_authorization_projection(self) -> None:
        metadata = load_metadata_from_bytes(
            (
                '{"doc_id":"handbook:doc-authz","version_id":"v1:doc-authz",'
                '"entitlement_groups":["students"],'
                '"visibility_scope":"main",'
                '"visibility_level":"restricted",'
                '"policy_projection_version":"phase1-authorization-projection-v1"}\n'
            ).encode("utf-8")
        )

        self.assertEqual(metadata["entitlement_groups"], ("students",))
        self.assertEqual(metadata["visibility_scope"], "main")
        self.assertEqual(metadata["visibility_level"], "restricted")
        self.assertEqual(
            metadata["policy_projection_version"],
            "phase1-authorization-projection-v1",
        )
        self.assertNotIn("acl_level", metadata)
        self.assertEqual(metadata["acl_groups"], ("students",))
        self.assertEqual(metadata["campus_scope"], "main")

    def test_load_metadata_from_bytes_accepts_legacy_acl_row_metadata_for_wave3_compat(self) -> None:
        metadata = load_metadata_from_bytes(
            (
                '{"doc_id":"handbook:doc-authz","version_id":"v1:doc-authz",'
                '"visibility_scope":"main",'
                '"visibility_level":"restricted",'
                '"acl":{"level":"public","allow_groups":["legacy-staff"]}}\n'
            ).encode("utf-8")
        )

        self.assertEqual(metadata["entitlement_groups"], ("legacy-staff",))
        self.assertEqual(metadata["acl_groups"], ("legacy-staff",))
        self.assertEqual(metadata["campus_scope"], "main")

if __name__ == "__main__":
    unittest.main()
