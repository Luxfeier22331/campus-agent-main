from __future__ import annotations

from dataclasses import asdict, replace
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord, RawAssetRef, SourceObservation
from campus_ingestion_core.authenticated_notice_closeout_store import (
    PostgresAuthenticatedNoticeCloseoutStore,
    build_authenticated_notice_closeout_store_from_env,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    PostgresAuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.registry import (
    DEFAULT_DOCUMENT_REGISTRY_TABLE,
    DEFAULT_RAW_ASSET_REGISTRY_TABLE,
    PostgresDocumentRegistry,
    PostgresRawAssetRegistry,
    _ensure_table_schema,
    _document_record_from_dict,
    _raw_asset_record_from_dict,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


HANDBOOK_DOC_UNITS_KEY = (
    "regulations/documents/student_handbook/test-001--test-001/"
    "source-faithful/undated/document-units.jsonl"
)
HANDBOOK_PROVIDER_KEY = (
    "official_pdf/student-handbook/undated/sha256/raw-001/provider/paddleocr-vl-1-5/provider-response.jsonl"
)
HANDBOOK_CANONICAL_KEY = (
    "regulations/documents/student_handbook/test-001--test-001/source-faithful/undated/canonical.md"
)
CURRICULUM_DOC_UNITS_KEY = (
    "curriculum/documents/curriculum_plan/plan-001--plan-001/"
    "source-faithful/undated/document-units.jsonl"
)


def _handbook_document_record(*, version_id: str, content_hash: str, ingestion_timestamp: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="handbook:test-001",
        revision_track="source-faithful",
        version_id=version_id,
        source_uri="campusrag://canonical/regulations/student_handbook/docs/test-001.md",
        content_hash=content_hash,
        corpus="regulations",
        collection="student_handbook",
        cleaning_policy_version="student_handbook_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope=None,
        status="active",
        ingestion_timestamp=ingestion_timestamp,
        parser_version="campusrag-import-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        raw_asset=RawAssetRef(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:raw-001",
            page_start=10,
            page_end=12,
        ),
        document_units_object_key=HANDBOOK_DOC_UNITS_KEY,
        provider_response_object_key=HANDBOOK_PROVIDER_KEY,
        canonical_markdown_object_key=HANDBOOK_CANONICAL_KEY,
        processed_object_keys=(
            HANDBOOK_PROVIDER_KEY,
            HANDBOOK_CANONICAL_KEY,
            HANDBOOK_DOC_UNITS_KEY,
        ),
        import_source="raw_online_ocr",
    )


def _curriculum_document_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="curriculum:plan-001",
        revision_track="source-faithful",
        version_id="sha256:raw-001:split:plan-001:abcd1234",
        source_uri="https://campus.example/curriculum/plan-001",
        content_hash="sha256:doc-001",
        corpus="curriculum",
        collection="curriculum_plan",
        entitlement_groups=(),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="curriculum-plan-ocr-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        raw_asset=RawAssetRef(
            raw_asset_id="asset:curriculum-plan-master-pdf",
            raw_version_id="sha256:raw-001",
            page_start=1,
            page_end=12,
        ),
        document_units_object_key=CURRICULUM_DOC_UNITS_KEY,
        processed_object_keys=(CURRICULUM_DOC_UNITS_KEY,),
        import_source="raw_online_ocr",
    )


def _handbook_raw_asset_record() -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:student-handbook-pdf",
        raw_version_id="sha256:raw-001",
        corpus="regulations",
        collection="student_handbook",
        raw_source_uri="campusrag://raw/regulations/student_handbook/student-handbook.pdf",
        content_hash="raw-001",
        source_filename="student-handbook.pdf",
        object_key="official_pdf/student-handbook/undated/sha256/raw-001/capture/student-handbook.pdf",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        import_source="raw_online_ocr",
    )


def _curriculum_raw_asset_record() -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:curriculum-plan-master-pdf",
        raw_version_id="sha256:raw-002",
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri="https://campus.example/curriculum/master.pdf",
        content_hash="raw-002",
        source_filename="curriculum-plan.pdf",
        object_key="official_pdf/curriculum-plan-master/undated/sha256/raw-002/capture/curriculum-plan.pdf",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        import_source="raw_online_ocr",
    )


class RegistryModelsTest(unittest.TestCase):
    def test_registry_defaults_are_schema_qualified_under_ingestion_registry(self) -> None:
        self.assertEqual(
            DEFAULT_DOCUMENT_REGISTRY_TABLE,
            "ingestion_registry.document_registry_records",
        )
        self.assertEqual(
            DEFAULT_RAW_ASSET_REGISTRY_TABLE,
            "ingestion_registry.raw_asset_registry_records",
        )

    def test_document_registry_record_serializes_required_fields(self) -> None:
        record = _handbook_document_record(
            version_id="v1:test-001",
            content_hash="sha256:test-001",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
        )

        payload = asdict(record)

        self.assertEqual(payload["document_id"], "handbook:test-001")
        self.assertEqual(payload["revision_track"], "source-faithful")
        self.assertEqual(payload["corpus"], "regulations")
        self.assertEqual(payload["collection"], "student_handbook")
        self.assertEqual(payload["cleaning_policy_version"], "student_handbook_cleaning_v1")
        self.assertEqual(payload["entitlement_groups"], ("students",))
        self.assertEqual(payload["visibility_scope"], None)
        self.assertEqual(payload["visibility_level"], "restricted")
        self.assertEqual(
            payload["policy_projection_version"],
            "phase1-authorization-projection-v1",
        )
        self.assertEqual(payload["status"], "active")
        self.assertEqual(payload["import_source"], "raw_online_ocr")
        self.assertEqual(payload["source_channel"], "pdf_ocr")
        self.assertEqual(payload["raw_asset"]["raw_asset_id"], "asset:student-handbook-pdf")
        self.assertEqual(payload["raw_asset"]["raw_version_id"], "sha256:raw-001")
        self.assertEqual(payload["raw_asset"]["page_start"], 10)
        self.assertEqual(payload["raw_asset"]["page_end"], 12)
        self.assertEqual(
            payload["canonical_markdown_object_key"],
            HANDBOOK_CANONICAL_KEY,
        )

    def test_document_registry_record_defaults_to_public_without_projection(self) -> None:
        record = DocumentRegistryRecord(
            document_id="curriculum:plan-legacy",
            revision_track="source-faithful",
            version_id="sha256:raw-legacy",
            source_uri="https://campus.example/curriculum/legacy",
            content_hash="sha256:legacy",
            corpus="curriculum",
            collection="curriculum_plan",
            status="active",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
            parser_version="curriculum-plan-ocr-v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="pdf_ocr",
            import_source="raw_online_ocr",
        )

        self.assertEqual(record.entitlement_groups, ())
        self.assertIsNone(record.visibility_scope)
        self.assertEqual(record.visibility_level, "public")
        self.assertEqual(
            record.policy_projection_version,
            "phase1-authorization-projection-v1",
        )

    def test_document_registry_record_uses_canonical_projection_fields(self) -> None:
        record = DocumentRegistryRecord(
            document_id="curriculum:plan-authz",
            revision_track="source-faithful",
            version_id="sha256:raw-authz",
            source_uri="https://campus.example/curriculum/authz",
            content_hash="sha256:authz",
            corpus="curriculum",
            collection="curriculum_plan",
            entitlement_groups=("students",),
            visibility_scope="main",
            status="active",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
            parser_version="curriculum-plan-ocr-v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="pdf_ocr",
            import_source="raw_online_ocr",
        )

        self.assertEqual(record.entitlement_groups, ("students",))
        self.assertEqual(record.visibility_scope, "main")
        self.assertEqual(record.visibility_level, "restricted")

    def test_file_document_registry_upsert_and_get_are_stable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )

            registry.upsert(record)
            loaded = registry.get("handbook:test-001", "source-faithful", "v1:test-001")

            self.assertEqual(loaded, record)

    def test_file_document_registry_roundtrips_source_observations(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            record = replace(
                record,
                source_observations=(
                    SourceObservation(
                        source_channel="pdf_ocr",
                        source_uri="campusrag://canonical/regulations/student_handbook/docs/test-001.md",
                        raw_asset=record.raw_asset,
                        is_primary=False,
                        import_source="raw_online_ocr",
                    ),
                    SourceObservation(
                        source_channel="official_web",
                        source_uri="https://campus.example/policies/test-001",
                        raw_asset=None,
                        is_primary=True,
                        import_source="official_web_sync",
                    ),
                ),
                source_uri="https://campus.example/policies/test-001",
                source_channel="official_web",
                raw_asset=None,
            )

            registry.upsert(record)
            loaded = registry.get("handbook:test-001", "source-faithful", "v1:test-001")

            self.assertEqual(loaded, record)

    def test_file_document_registry_lists_by_corpus_and_latest_versions(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            v1 = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            v2 = _handbook_document_record(
                version_id="v2:test-001",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            )

            registry.upsert(v1)
            registry.upsert(v2)

            records = registry.list_by_scope("regulations", "student_handbook")
            latest = registry.latest_versions("handbook:test-001")

            self.assertEqual(records, (v1, v2))
            self.assertEqual(latest, (v2,))

    def test_file_document_registry_current_version_requires_explicit_current_record(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            stale_record = replace(
                _handbook_document_record(
                    version_id="v2:test-001",
                    content_hash="sha256:test-002",
                    ingestion_timestamp="2026-03-23T10:00:00+00:00",
                ),
                is_current=False,
            )

            registry.upsert(stale_record)

            self.assertIsNone(registry.current_version("handbook:test-001"))

    def test_file_document_registry_upsert_many_persists_all_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            handbook_record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()

            registry.upsert_many((handbook_record, curriculum_record))

            self.assertEqual(
                registry.get("handbook:test-001", "source-faithful", "v1:test-001"),
                handbook_record,
            )
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_replace_scope_replaces_only_target_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            handbook_old = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            handbook_new = _handbook_document_record(
                version_id="v2:test-001",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()
            registry.upsert(handbook_old)
            registry.upsert(curriculum_record)

            registry.replace_scope("regulations", "student_handbook", (handbook_new,))

            self.assertEqual(
                registry.list_by_scope("regulations", "student_handbook"),
                (handbook_new,),
            )
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_delete_by_corpus_removes_only_matching_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            registry = InMemoryDocumentRegistry(backing_path=path)
            handbook_record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()
            registry.upsert(handbook_record)
            registry.upsert(curriculum_record)

            registry.delete_by_scope("regulations", "student_handbook")

            self.assertIsNone(registry.get("handbook:test-001", "source-faithful", "v1:test-001"))
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_delete_document_removes_all_versions_for_document(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            registry = InMemoryDocumentRegistry(backing_path=path)
            handbook_v1 = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            handbook_v2 = _handbook_document_record(
                version_id="v2:test-001",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()
            registry.upsert(handbook_v1)
            registry.upsert(handbook_v2)
            registry.upsert(curriculum_record)

            registry.delete_document("handbook:test-001")

            self.assertIsNone(registry.get("handbook:test-001", "source-faithful", "v1:test-001"))
            self.assertIsNone(registry.get("handbook:test-001", "source-faithful", "v2:test-001"))
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_requires_explicit_artifact_keys_in_payload(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            path.write_text(
                json.dumps(
                    {
                        "handbook:test-001::source-faithful::v1:test-001": {
                            "document_id": "handbook:test-001",
                            "revision_track": "source-faithful",
                            "version_id": "v1:test-001",
                            "source_uri": "campusrag://canonical/regulations/student_handbook/docs/test-001.md",
                            "content_hash": "sha256:test-001",
                            "corpus": "regulations",
                            "collection": "student_handbook",
                            "cleaning_policy_version": "student_handbook_cleaning_v1",
                            "entitlement_groups": ["students"],
                            "visibility_scope": None,
                            "status": "active",
                            "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                            "parser_version": "campusrag-import-v1",
                            "embedding_model": "Qwen3-Embedding-4B",
                            "source_channel": "pdf_ocr",
                            "raw_asset": None,
                            "processed_object_keys": [
                                "student_handbook/documents/handbook/test-001/tracks/source-faithful/v1/test-001/provider-response.jsonl",
                                "student_handbook/documents/handbook/test-001/tracks/source-faithful/v1/test-001/canonical.md",
                                "student_handbook/documents/handbook/test-001/tracks/source-faithful/v1/test-001/document-units.jsonl",
                            ],
                            "import_source": "raw_online_ocr",
                        }
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            loaded = InMemoryDocumentRegistry.from_json_file(path).get(
                "handbook:test-001", "source-faithful", "v1:test-001"
            )

            self.assertIsNone(loaded.provider_response_object_key)
            self.assertEqual(loaded.corpus, "regulations")
            self.assertEqual(loaded.collection, "student_handbook")
            self.assertEqual(loaded.cleaning_policy_version, "student_handbook_cleaning_v1")
            self.assertIsNone(loaded.canonical_markdown_object_key)
            self.assertIsNone(loaded.document_units_object_key)
            self.assertEqual(len(loaded.source_observations), 1)
            self.assertTrue(loaded.source_observations[0].is_primary)
            self.assertEqual(loaded.source_observations[0].source_channel, "pdf_ocr")

    def test_file_document_registry_rejects_unsupported_authz_payload_keys(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            path.write_text(
                json.dumps(
                    {
                        "handbook:test-001::source-faithful::v1:test-001": {
                            "document_id": "handbook:test-001",
                            "revision_track": "source-faithful",
                            "version_id": "v1:test-001",
                            "source_uri": "campusrag://canonical/regulations/student_handbook/docs/test-001.md",
                            "content_hash": "sha256:test-001",
                            "corpus": "regulations",
                            "collection": "student_handbook",
                            "cleaning_policy_version": "student_handbook_cleaning_v1",
                            "acl_groups": ["students"],
                            "campus_scope": "main",
                            "status": "active",
                            "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                            "parser_version": "campusrag-import-v1",
                            "embedding_model": "Qwen3-Embedding-4B",
                            "source_channel": "pdf_ocr",
                            "raw_asset": None,
                            "processed_object_keys": [
                                "student_handbook/documents/handbook/test-001/tracks/source-faithful/v1/test-001/document-units.jsonl"
                            ],
                            "import_source": "raw_online_ocr",
                        }
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "unsupported authorization projection keys"):
                InMemoryDocumentRegistry.from_json_file(path)

    def test_document_registry_payload_prefers_canonical_projection_over_conflicting_legacy_fields(self) -> None:
        record = _document_record_from_dict(
            {
                "document_id": "handbook:test-001",
                "revision_track": "source-faithful",
                "version_id": "v1:test-001",
                "source_uri": "campusrag://canonical/regulations/student_handbook/docs/test-001.md",
                "content_hash": "sha256:test-001",
                "corpus": "regulations",
                "collection": "student_handbook",
                "cleaning_policy_version": "student_handbook_cleaning_v1",
                "entitlement_groups": ["students"],
                "visibility_scope": "main",
                "visibility_level": "restricted",
                "status": "active",
                "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                "parser_version": "campusrag-import-v1",
                "embedding_model": "Qwen3-Embedding-4B",
                "source_channel": "pdf_ocr",
                "raw_asset": None,
                "processed_object_keys": (),
                "import_source": "raw_online_ocr",
            }
        )

        self.assertEqual(record.entitlement_groups, ("students",))
        self.assertEqual(record.visibility_scope, "main")
        self.assertEqual(record.visibility_level, "restricted")

    def test_document_registry_payload_rejects_unsupported_authz_projection_keys(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported authorization projection keys"):
            _document_record_from_dict(
                {
                    "document_id": "handbook:test-001",
                    "revision_track": "source-faithful",
                    "version_id": "v1:test-001",
                    "source_uri": "campusrag://canonical/regulations/student_handbook/docs/test-001.md",
                    "content_hash": "sha256:test-001",
                    "corpus": "regulations",
                    "collection": "student_handbook",
                    "cleaning_policy_version": "student_handbook_cleaning_v1",
                    "entitlement_groups": ["students"],
                    "visibility_scope": "main",
                    "visibility_level": "restricted",
                    "acl_groups": ["legacy-staff"],
                    "campus_scope": "south",
                    "status": "active",
                    "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                    "parser_version": "campusrag-import-v1",
                    "embedding_model": "Qwen3-Embedding-4B",
                    "source_channel": "pdf_ocr",
                    "raw_asset": None,
                    "processed_object_keys": (),
                    "import_source": "raw_online_ocr",
                }
            )

    def test_document_registry_payload_requires_explicit_corpus_collection_and_source_channel(self) -> None:
        with self.assertRaisesRegex(ValueError, "source_channel"):
            _document_record_from_dict(
                {
                    "document_id": "handbook:test-001",
                    "revision_track": "source-faithful",
                    "version_id": "v1:test-001",
                    "source_uri": "campusrag://canonical/regulations/student_handbook/docs/test-001.md",
                    "content_hash": "sha256:test-001",
                    "corpus": "regulations",
                    "status": "active",
                    "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                    "parser_version": "campusrag-import-v1",
                    "embedding_model": "Qwen3-Embedding-4B",
                    "import_source": "raw_online_ocr",
                }
            )

        with self.assertRaisesRegex(KeyError, "revision_track"):
            _document_record_from_dict(
                {
                    "document_id": "handbook:test-001",
                    "version_id": "v1:test-001",
                    "source_uri": "campusrag://canonical/regulations/student_handbook/docs/test-001.md",
                    "content_hash": "sha256:test-001",
                    "corpus": "regulations",
                    "collection": "student_handbook",
                    "status": "active",
                    "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                    "parser_version": "campusrag-import-v1",
                    "embedding_model": "Qwen3-Embedding-4B",
                    "source_channel": "pdf_ocr",
                    "import_source": "raw_online_ocr",
                }
            )

        with self.assertRaisesRegex(ValueError, "collection"):
            _document_record_from_dict(
                {
                    "document_id": "handbook:test-001",
                    "revision_track": "source-faithful",
                    "version_id": "v1:test-001",
                    "source_uri": "campusrag://canonical/regulations/student_handbook/docs/test-001.md",
                    "content_hash": "sha256:test-001",
                    "corpus": "regulations",
                    "status": "active",
                    "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                    "parser_version": "campusrag-import-v1",
                    "embedding_model": "Qwen3-Embedding-4B",
                    "source_channel": "pdf_ocr",
                    "import_source": "raw_online_ocr",
                }
            )

    def test_raw_asset_registry_payload_requires_explicit_corpus_and_collection(self) -> None:
        with self.assertRaisesRegex(ValueError, "collection"):
            _raw_asset_record_from_dict(
                {
                    "raw_asset_id": "asset:student-handbook-pdf",
                    "raw_version_id": "sha256:raw-001",
                    "corpus": "regulations",
                    "raw_source_uri": "campusrag://raw/regulations/student_handbook/student-handbook.pdf",
                    "content_hash": "raw-001",
                    "source_filename": "student-handbook.pdf",
                    "object_key": "official_pdf/student-handbook/undated/sha256/raw-001/capture/student-handbook.pdf",
                    "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                    "import_source": "raw_online_ocr",
                }
            )

    def test_raw_asset_registry_payload_backfills_missing_typed_metadata_fields(self) -> None:
        record = _raw_asset_record_from_dict(
            {
                "raw_asset_id": "asset:student-handbook-pdf",
                "raw_version_id": "sha256:raw-001",
                "corpus": "regulations",
                "collection": "student_handbook",
                "raw_source_uri": "campusrag://raw/regulations/student_handbook/student-handbook.pdf",
                "content_hash": "raw-001",
                "source_filename": "student-handbook.pdf",
                "object_key": "official_pdf/student-handbook/undated/sha256/raw-001/capture/student-handbook.pdf",
                "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                "import_source": "raw_online_ocr",
            }
        )

        self.assertIsNone(record.content_type)
        self.assertEqual(record.file_extension, "")
        self.assertIsNone(record.byte_size)
        self.assertIsNone(record.page_count)
        self.assertIsNone(record.image_width)
        self.assertIsNone(record.image_height)
        self.assertEqual(record.asset_kind, "")
        self.assertEqual(record.asset_subkind, "")
        self.assertIsNone(record.classification_confidence)

    def test_file_raw_asset_registry_upsert_and_get_are_stable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryRawAssetRegistry(backing_path=Path(temp_dir) / "raw-assets.json")
            record = _handbook_raw_asset_record()

            registry.upsert(record)

            self.assertEqual(
                registry.get("asset:student-handbook-pdf", "sha256:raw-001"),
                record,
            )

    def test_file_raw_asset_registry_delete_by_corpus_removes_only_matching_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "raw-assets.json"
            registry = InMemoryRawAssetRegistry(backing_path=path)
            handbook_record = _handbook_raw_asset_record()
            curriculum_record = _curriculum_raw_asset_record()
            registry.upsert(handbook_record)
            registry.upsert(curriculum_record)

            registry.delete_by_scope("regulations", "student_handbook")

            self.assertIsNone(registry.get("asset:student-handbook-pdf", "sha256:raw-001"))
            self.assertEqual(
                registry.get("asset:curriculum-plan-master-pdf", "sha256:raw-002"),
                curriculum_record,
            )

    def test_file_raw_asset_registry_replace_scope_replaces_only_target_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "raw-assets.json"
            registry = InMemoryRawAssetRegistry(backing_path=path)
            handbook_record = _handbook_raw_asset_record()
            curriculum_record = _curriculum_raw_asset_record()
            handbook_replacement = RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf-v2",
                raw_version_id="sha256:raw-003",
                corpus="regulations",
                collection="student_handbook",
                raw_source_uri="campusrag://raw/regulations/student_handbook/student-handbook-v2.pdf",
                content_hash="raw-003",
                source_filename="student-handbook-v2.pdf",
                object_key="official_pdf/student-handbook/undated/sha256/raw-003/capture/student-handbook-v2.pdf",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
                import_source="raw_online_ocr",
            )
            registry.upsert(handbook_record)
            registry.upsert(curriculum_record)

            registry.replace_scope("regulations", "student_handbook", (handbook_replacement,))

            self.assertEqual(
                registry.list_by_scope("regulations", "student_handbook"),
                (handbook_replacement,),
            )
            self.assertEqual(
                registry.list_by_scope("curriculum", "curriculum_plan"),
                (curriculum_record,),
            )

    def test_curriculum_plan_records_are_supported(self) -> None:
        document_record = _curriculum_document_record()
        raw_asset_record = _curriculum_raw_asset_record()

        self.assertEqual(document_record.corpus, "curriculum")
        self.assertEqual(document_record.collection, "curriculum_plan")
        self.assertEqual(raw_asset_record.corpus, "curriculum")
        self.assertEqual(raw_asset_record.collection, "curriculum_plan")

    def test_build_document_registry_from_env_uses_database_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresDocumentRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_document_registry_from_env(
                {"DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://registry.example/postgres")

    def test_build_document_registry_from_env_falls_back_to_shared_postgres_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresDocumentRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_document_registry_from_env(
                {"CAMPUS_SHARED_POSTGRES_URL": "postgresql://shared.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://shared.example/postgres")

    def test_build_document_registry_from_env_prefers_management_database_url_when_requested(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresDocumentRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_document_registry_from_env(
                {
                    "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://runtime.example/postgres",
                    "DOCUMENT_REGISTRY_MANAGEMENT_DATABASE_URL": "postgresql://management.example/postgres",
                },
                prefer_management=True,
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with(
                "postgresql://management.example/postgres?__campus_connection_mode=management_direct"
            )

    def test_build_document_registry_from_env_requires_management_database_url_when_requested(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL.*prefer_management=True",
        ):
            build_document_registry_from_env(
                {
                    "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://runtime.example/postgres",
                },
                prefer_management=True,
            )

    def test_build_document_registry_from_env_rejects_supabase_direct_connection(self) -> None:
        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            with self.assertRaisesRegex(ValueError, "session pooler"):
                build_document_registry_from_env(
                    {
                        "DOCUMENT_REGISTRY_DATABASE_URL": (
                            "postgresql://postgres:secret@"
                            "db.project-ref.supabase.co:5432/postgres?sslmode=require"
                        )
                    }
                )

    def test_build_raw_asset_registry_from_env_uses_database_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {"DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://registry.example/postgres")

    def test_build_raw_asset_registry_from_env_prefers_dedicated_database_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                    "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://document-registry.example/postgres",
                }
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://raw-registry.example/postgres")

    def test_build_raw_asset_registry_from_env_falls_back_to_shared_postgres_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {"CAMPUS_SHARED_POSTGRES_URL": "postgresql://shared.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://shared.example/postgres")

    def test_build_raw_asset_registry_from_env_prefers_management_database_url_when_requested(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://runtime.example/postgres",
                    "RAW_ASSET_REGISTRY_MANAGEMENT_DATABASE_URL": "postgresql://management.example/postgres",
                },
                prefer_management=True,
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with(
                "postgresql://management.example/postgres?__campus_connection_mode=management_direct"
            )

    def test_build_raw_asset_registry_from_env_requires_management_database_url_when_requested(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL.*prefer_management=True",
        ):
            build_raw_asset_registry_from_env(
                {
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://runtime.example/postgres",
                },
                prefer_management=True,
            )

    def test_build_raw_asset_registry_from_env_rejects_supabase_transaction_pooler(self) -> None:
        with patch.object(PostgresRawAssetRegistry, "_ensure_schema", return_value=None):
            with self.assertRaisesRegex(ValueError, "session pooler"):
                build_raw_asset_registry_from_env(
                    {
                        "RAW_ASSET_REGISTRY_DATABASE_URL": (
                            "postgresql://postgres:secret@"
                            "db.project-ref.supabase.co:6543/postgres?sslmode=require"
                        )
                    }
                )

    def test_build_raw_asset_registry_from_env_accepts_dedicated_database_url_without_document_registry(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {"RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://raw-registry.example/postgres")

    def test_build_closeout_store_from_env_rejects_supabase_direct_connection(self) -> None:
        with patch.object(
            PostgresAuthenticatedNoticeCloseoutStore,
            "_ensure_schema",
            return_value=None,
        ):
            with self.assertRaisesRegex(ValueError, "session pooler"):
                build_authenticated_notice_closeout_store_from_env(
                    {
                        "AUTHENTICATED_NOTICE_CLOSEOUT_DATABASE_URL": (
                            "postgresql://postgres:secret@"
                            "db.project-ref.supabase.co:5432/postgres?sslmode=require"
                        )
                    }
                )

    def test_build_closeout_store_from_env_prefers_management_database_url_when_requested(self) -> None:
        with patch(
            "campus_ingestion_core.authenticated_notice_closeout_store.PostgresAuthenticatedNoticeCloseoutStore"
        ) as store_cls:
            instance = store_cls.return_value

            store = build_authenticated_notice_closeout_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_CLOSEOUT_DATABASE_URL": "postgresql://runtime.example/postgres",
                    "AUTHENTICATED_NOTICE_CLOSEOUT_MANAGEMENT_DATABASE_URL": "postgresql://management.example/postgres",
                },
                prefer_management=True,
            )

            self.assertIs(store, instance)
            store_cls.assert_called_once_with(
                "postgresql://management.example/postgres?__campus_connection_mode=management_direct"
            )

    def test_build_closeout_store_from_env_requires_management_database_url_when_requested(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL.*prefer_management=True",
        ):
            build_authenticated_notice_closeout_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_CLOSEOUT_DATABASE_URL": "postgresql://runtime.example/postgres",
                },
                prefer_management=True,
            )

    def test_build_source_truth_inventory_store_from_env_prefers_management_database_url_when_requested(
        self,
    ) -> None:
        with patch(
            "campus_ingestion_core.authenticated_notice_source_truth_inventory.PostgresAuthenticatedNoticeSourceTruthInventoryStore"
        ) as store_cls:
            instance = store_cls.return_value

            store = build_authenticated_notice_source_truth_inventory_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_DATABASE_URL": "postgresql://runtime.example/postgres",
                    "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_MANAGEMENT_DATABASE_URL": "postgresql://management.example/postgres",
                },
                prefer_management=True,
            )

            self.assertIs(store, instance)
            store_cls.assert_called_once_with(
                database_url=(
                    "postgresql://management.example/postgres"
                    "?__campus_connection_mode=management_direct"
                )
            )

    def test_build_source_truth_inventory_store_from_env_requires_management_database_url_when_requested(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL.*prefer_management=True",
        ):
            build_authenticated_notice_source_truth_inventory_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_DATABASE_URL": "postgresql://runtime.example/postgres",
                },
                prefer_management=True,
            )

    def test_postgres_document_registry_delete_document_targets_document_id(self) -> None:
        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")
        with patch.object(registry, "_execute") as execute:
            registry.delete_document("handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675")

        execute.assert_called_once_with(
            "delete from ingestion_registry.document_registry_records where document_id = %s",
            ("handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",),
        )

    def test_postgres_document_registry_current_version_does_not_fallback_to_latest(self) -> None:
        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with (
            patch.object(registry, "_fetchone", return_value=None),
            patch.object(
                registry,
                "latest_versions",
                return_value=(
                    replace(
                        _handbook_document_record(
                            version_id="v2:test-001",
                            content_hash="sha256:test-002",
                            ingestion_timestamp="2026-03-23T10:00:00+00:00",
                        ),
                        is_current=False,
                    ),
                ),
            ) as latest_versions,
        ):
            self.assertIsNone(registry.current_version("handbook:test-001"))
            latest_versions.assert_not_called()

    def test_postgres_document_registry_list_by_scope_canonicalizes_legacy_authz_projection_keys(self) -> None:
        legacy_payload = {
            "document_id": "official_web:test-001",
            "revision_track": "source-faithful",
            "version_id": "owdocver:test-001",
            "source_uri": "https://www.example.edu/test-001.htm",
            "content_hash": "sha256:test-001",
            "corpus": "official_web",
            "collection": "muc_public_pages",
            "cleaning_policy_version": "official_web_cleaning_v2",
            "acl_level": "restricted",
            "acl_groups": ["legacy-staff"],
            "campus_scope": "south",
            "status": "active",
            "ingestion_timestamp": "2026-04-04T10:00:00+00:00",
            "parser_version": "official_web_projection_replay.v1",
            "embedding_model": "",
            "source_channel": "official_web",
            "import_source": "official_web_source_truth_replay",
        }

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with patch.object(registry, "_fetchall", return_value=((json.dumps(legacy_payload),),)):
            records = registry.list_by_scope("official_web", "muc_public_pages")

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].entitlement_groups, ("legacy-staff",))
        self.assertEqual(records[0].visibility_scope, "south")
        self.assertEqual(records[0].visibility_level, "restricted")
        self.assertEqual(records[0].policy_projection_version, DEFAULT_POLICY_PROJECTION_VERSION)

    def test_postgres_document_registry_list_by_scope_paginates_large_scope_reads(self) -> None:
        first = _handbook_document_record(
            version_id="v1:test-001",
            content_hash="sha256:test-001",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
        )
        second = replace(
            _handbook_document_record(
                version_id="v1:test-002",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            ),
            document_id="handbook:test-002",
            version_id="v1:test-002",
            source_uri="campusrag://canonical/regulations/student_handbook/docs/test-002.md",
            content_hash="sha256:test-002",
            document_units_object_key=HANDBOOK_DOC_UNITS_KEY.replace("test-001", "test-002"),
            provider_response_object_key=HANDBOOK_PROVIDER_KEY.replace("raw-001", "raw-002"),
            canonical_markdown_object_key=HANDBOOK_CANONICAL_KEY.replace("test-001", "test-002"),
            processed_object_keys=(
                HANDBOOK_PROVIDER_KEY.replace("raw-001", "raw-002"),
                HANDBOOK_CANONICAL_KEY.replace("test-001", "test-002"),
                HANDBOOK_DOC_UNITS_KEY.replace("test-001", "test-002"),
            ),
        )
        page_rows = (
            ((json.dumps(asdict(first), ensure_ascii=False),),),
            ((json.dumps(asdict(second), ensure_ascii=False),),),
            (),
        )
        fetchall_calls: list[tuple[str, tuple[object, ...]]] = []

        def _fetchall(query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
            fetchall_calls.append((query, params))
            return page_rows[len(fetchall_calls) - 1]

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with (
            patch("campus_ingestion_core.registry.DEFAULT_DOCUMENT_REGISTRY_SCAN_PAGE_SIZE", 1),
            patch.object(registry, "_fetchall", side_effect=_fetchall),
        ):
            records = registry.list_by_scope("regulations", "student_handbook")

        self.assertEqual(records, (first, second))
        self.assertEqual(len(fetchall_calls), 3)
        self.assertIn("limit %s", fetchall_calls[0][0].lower())
        self.assertEqual(fetchall_calls[0][1], ("regulations", "student_handbook", 1))
        self.assertIn(
            "(document_id, revision_track, version_id) > (%s, %s, %s)",
            fetchall_calls[1][0],
        )
        self.assertEqual(
            fetchall_calls[1][1],
            (
                "regulations",
                "student_handbook",
                first.document_id,
                first.revision_track,
                first.version_id,
                1,
            ),
        )

    def test_postgres_document_registry_get_canonicalizes_legacy_authz_projection_keys(self) -> None:
        legacy_payload = {
            "document_id": "official_web:test-001",
            "revision_track": "source-faithful",
            "version_id": "owdocver:test-001",
            "source_uri": "https://www.example.edu/test-001.htm",
            "content_hash": "sha256:test-001",
            "corpus": "official_web",
            "collection": "muc_public_pages",
            "cleaning_policy_version": "official_web_cleaning_v2",
            "acl_level": "restricted",
            "acl_groups": ["legacy-staff"],
            "campus_scope": "south",
            "status": "active",
            "ingestion_timestamp": "2026-04-04T10:00:00+00:00",
            "parser_version": "official_web_projection_replay.v1",
            "embedding_model": "",
            "source_channel": "official_web",
            "import_source": "official_web_source_truth_replay",
        }

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with patch.object(registry, "_fetchone", return_value=(json.dumps(legacy_payload),)):
            record = registry.get("official_web:test-001", "source-faithful", "owdocver:test-001")

        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record.entitlement_groups, ("legacy-staff",))
        self.assertEqual(record.visibility_scope, "south")
        self.assertEqual(record.visibility_level, "restricted")
        self.assertEqual(record.policy_projection_version, DEFAULT_POLICY_PROJECTION_VERSION)

    def test_postgres_document_registry_latest_versions_canonicalizes_legacy_authz_projection_keys(self) -> None:
        legacy_payload = {
            "document_id": "official_web:test-003",
            "revision_track": "source-faithful",
            "version_id": "owdocver:test-003",
            "source_uri": "https://www.example.edu/test-003.htm",
            "content_hash": "sha256:test-003",
            "corpus": "official_web",
            "collection": "muc_public_pages",
            "cleaning_policy_version": "official_web_cleaning_v2",
            "acl_level": "restricted",
            "acl_groups": ["legacy-editors"],
            "campus_scope": "north",
            "status": "active",
            "ingestion_timestamp": "2026-04-04T10:00:00+00:00",
            "parser_version": "official_web_projection_replay.v1",
            "embedding_model": "",
            "source_channel": "official_web",
            "import_source": "official_web_source_truth_replay",
        }

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with patch.object(registry, "_fetchone", return_value=(json.dumps(legacy_payload),)):
            records = registry.latest_versions("official_web:test-003", "source-faithful")

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].entitlement_groups, ("legacy-editors",))
        self.assertEqual(records[0].visibility_scope, "north")
        self.assertEqual(records[0].visibility_level, "restricted")
        self.assertEqual(records[0].policy_projection_version, DEFAULT_POLICY_PROJECTION_VERSION)

    def test_postgres_document_registry_current_version_canonicalizes_legacy_authz_projection_keys(self) -> None:
        legacy_payload = {
            "document_id": "official_web:test-002",
            "revision_track": "source-faithful",
            "version_id": "owdocver:test-002",
            "source_uri": "https://www.example.edu/test-002.htm",
            "content_hash": "sha256:test-002",
            "corpus": "official_web",
            "collection": "muc_public_pages",
            "cleaning_policy_version": "official_web_cleaning_v2",
            "acl_level": "restricted",
            "acl_groups": ["legacy-operators"],
            "campus_scope": "main",
            "status": "active",
            "ingestion_timestamp": "2026-04-04T10:00:00+00:00",
            "parser_version": "official_web_projection_replay.v1",
            "embedding_model": "",
            "source_channel": "official_web",
            "is_current": True,
            "import_source": "official_web_source_truth_replay",
        }

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with patch.object(registry, "_fetchone", return_value=(json.dumps(legacy_payload),)):
            record = registry.current_version("official_web:test-002")

        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record.entitlement_groups, ("legacy-operators",))
        self.assertEqual(record.visibility_scope, "main")
        self.assertEqual(record.visibility_level, "restricted")
        self.assertEqual(record.policy_projection_version, DEFAULT_POLICY_PROJECTION_VERSION)

    def test_postgres_raw_asset_registry_list_by_scope_paginates_large_scope_reads(self) -> None:
        first = replace(
            _handbook_raw_asset_record(),
            raw_asset_id="asset:001",
            raw_version_id="sha256:001",
        )
        second = replace(
            _handbook_raw_asset_record(),
            raw_asset_id="asset:002",
            raw_version_id="sha256:002",
            content_hash="raw-002",
            object_key="official_pdf/student-handbook/undated/sha256/raw-002/capture/student-handbook.pdf",
        )
        page_rows = (
            ((json.dumps(asdict(first), ensure_ascii=False),),),
            ((json.dumps(asdict(second), ensure_ascii=False),),),
            (),
        )
        fetchall_calls: list[tuple[str, tuple[object, ...]]] = []

        def _fetchall(query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
            fetchall_calls.append((query, params))
            return page_rows[len(fetchall_calls) - 1]

        with patch.object(PostgresRawAssetRegistry, "_ensure_schema", return_value=None):
            registry = PostgresRawAssetRegistry("postgresql://registry.example/postgres")

        with (
            patch("campus_ingestion_core.registry.DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE", 1),
            patch.object(registry, "_fetchall", side_effect=_fetchall),
        ):
            records = registry.list_by_scope("regulations", "student_handbook")

        self.assertEqual(records, (first, second))
        self.assertEqual(len(fetchall_calls), 3)
        self.assertIn("limit %s", fetchall_calls[0][0].lower())
        self.assertEqual(fetchall_calls[0][1], ("regulations", "student_handbook", 1))
        self.assertIn(
            "(raw_asset_id, raw_version_id) > (%s, %s)",
            fetchall_calls[1][0],
        )
        self.assertEqual(
            fetchall_calls[1][1],
            (
                "regulations",
                "student_handbook",
                first.raw_asset_id,
                first.raw_version_id,
                1,
            ),
        )

    def test_postgres_document_registry_replace_scope_uses_bulk_recordset_insert(self) -> None:
        class _RecordingCursor:
            def __init__(self) -> None:
                self.execute_calls: list[tuple[str, tuple[object, ...] | None]] = []
                self.executemany_calls: list[tuple[str, tuple[tuple[object, ...], ...]]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.execute_calls.append((sql, params))

            def executemany(self, sql: str, params_seq) -> None:
                self.executemany_calls.append((sql, tuple(params_seq)))

        class _CursorContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self.cursor = cursor

            def __enter__(self) -> _RecordingCursor:
                return self.cursor

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _ConnectionContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self._cursor = cursor

            def __enter__(self) -> _ConnectionContext:
                return self

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

            def cursor(self) -> _CursorContext:
                return _CursorContext(self._cursor)

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")
        cursor = _RecordingCursor()
        handbook_record = _handbook_document_record(
            version_id="v2:test-001",
            content_hash="sha256:test-002",
            ingestion_timestamp="2026-03-23T10:00:00+00:00",
        )
        curriculum_record = _curriculum_document_record()

        with patch(
            "campus_ingestion_core.registry._postgres_connection",
            return_value=_ConnectionContext(cursor),
        ):
            registry.replace_scope(
                "regulations",
                "student_handbook",
                (handbook_record, curriculum_record),
            )

        self.assertEqual(cursor.executemany_calls, [])
        self.assertTrue(
            any("jsonb_to_recordset" in sql for sql, _params in cursor.execute_calls)
        )

    def test_postgres_raw_asset_registry_upsert_many_uses_bulk_recordset_insert(self) -> None:
        class _RecordingCursor:
            def __init__(self) -> None:
                self.execute_calls: list[tuple[str, tuple[object, ...] | None]] = []
                self.executemany_calls: list[tuple[str, tuple[tuple[object, ...], ...]]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.execute_calls.append((sql, params))

            def executemany(self, sql: str, params_seq) -> None:
                self.executemany_calls.append((sql, tuple(params_seq)))

        class _CursorContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self.cursor = cursor

            def __enter__(self) -> _RecordingCursor:
                return self.cursor

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _ConnectionContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self._cursor = cursor

            def __enter__(self) -> _ConnectionContext:
                return self

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

            def cursor(self) -> _CursorContext:
                return _CursorContext(self._cursor)

        with patch.object(PostgresRawAssetRegistry, "_ensure_schema", return_value=None):
            registry = PostgresRawAssetRegistry("postgresql://registry.example/postgres")
        cursor = _RecordingCursor()
        first = replace(
            _handbook_raw_asset_record(),
            raw_asset_id="asset:001",
            raw_version_id="sha256:001",
        )
        second = replace(
            _curriculum_raw_asset_record(),
            raw_asset_id="asset:002",
            raw_version_id="sha256:002",
        )

        with patch(
            "campus_ingestion_core.registry._postgres_connection",
            return_value=_ConnectionContext(cursor),
        ):
            registry.upsert_many((first, second))

        self.assertEqual(cursor.executemany_calls, [])
        self.assertTrue(
            any("jsonb_to_recordset" in sql for sql, _params in cursor.execute_calls)
        )

    def test_ensure_table_schema_serializes_schema_bootstrap_with_advisory_lock(self) -> None:
        class _RecordingCursor:
            def __init__(self) -> None:
                self.calls: list[tuple[str, tuple[object, ...] | None]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.calls.append((sql.strip(), params))

        cursor = _RecordingCursor()

        _ensure_table_schema(cursor, table_name="ingestion_closeout.closeout_runs")

        self.assertEqual(
            cursor.calls,
            [
                (
                    "select pg_advisory_lock(%s, hashtext(%s))",
                    (174901, "ingestion_closeout"),
                ),
                ('create schema if not exists "ingestion_closeout"', None),
                (
                    "select pg_advisory_unlock(%s, hashtext(%s))",
                    (174901, "ingestion_closeout"),
                ),
            ],
        )

    def test_ensure_table_schema_releases_advisory_lock_after_create_failure(self) -> None:
        class _FailingCursor:
            def __init__(self) -> None:
                self.calls: list[tuple[str, tuple[object, ...] | None]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.calls.append((sql.strip(), params))
                if sql.strip().startswith("create schema if not exists"):
                    raise RuntimeError("bootstrap failed")

        cursor = _FailingCursor()

        with self.assertRaisesRegex(RuntimeError, "bootstrap failed"):
            _ensure_table_schema(cursor, table_name="ingestion_closeout.closeout_runs")

        self.assertEqual(
            cursor.calls,
            [
                (
                    "select pg_advisory_lock(%s, hashtext(%s))",
                    (174901, "ingestion_closeout"),
                ),
                ('create schema if not exists "ingestion_closeout"', None),
                (
                    "select pg_advisory_unlock(%s, hashtext(%s))",
                    (174901, "ingestion_closeout"),
                ),
            ],
        )

    def test_registry_builders_require_database_url(self) -> None:
        with self.assertRaisesRegex(
            ValueError, "DOCUMENT_REGISTRY_DATABASE_URL or CAMPUS_SHARED_POSTGRES_URL"
        ):
            build_document_registry_from_env({})
        with self.assertRaisesRegex(
            ValueError,
            (
                "RAW_ASSET_REGISTRY_DATABASE_URL or DOCUMENT_REGISTRY_DATABASE_URL or "
                "CAMPUS_SHARED_POSTGRES_URL"
            ),
        ):
            build_raw_asset_registry_from_env({})


if __name__ == "__main__":
    unittest.main()
