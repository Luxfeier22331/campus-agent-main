from __future__ import annotations

import hashlib
import unittest

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    apply_authorization_projection_metadata,
    collect_import_document_stats,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.settings import ObjectStoreSettings


def _metadata(document_id: str, version_id: str) -> dict[str, object]:
    return {
        "document_id": document_id,
        "version_id": version_id,
        "acl_groups": (),
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
        acl_groups=(),
        campus_scope=None,
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


class CampusragIngestionSupportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.object_store = ObjectStoreSettings(
            endpoint="http://localhost:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
        )

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
            default_campus_scope=None,
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
            default_campus_scope=None,
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
            default_campus_scope=None,
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
            default_campus_scope=None,
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
            default_campus_scope=None,
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
            default_campus_scope="fallback-campus",
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
        self.assertEqual(created_record.acl_groups, ("students",))
        self.assertEqual(created_record.campus_scope, "main")

    def test_apply_authorization_projection_metadata_treats_acl_level_as_legacy_mirror(self) -> None:
        metadata = {
            "document_id": "handbook:doc-authz",
            "version_id": "v1:doc-authz",
            "acl_level": "public",
            "acl_groups": ["legacy-staff"],
            "campus_scope": "south",
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
        self.assertEqual(metadata["acl_level"], "restricted")
        self.assertEqual(metadata["acl_groups"], ["students"])
        self.assertEqual(metadata["campus_scope"], "main")


if __name__ == "__main__":
    unittest.main()
