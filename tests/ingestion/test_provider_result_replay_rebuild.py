from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from campus_ingestion_core.campusrag_ingestion_support import DocumentImportInput
from campus_ingestion_core.local_rebuild import RebuildRequest, _build_replay_documents, _index_replayed_documents
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.collection_config import CollectionTruthConfig
from campus_ingestion_core.split_manifest import SplitManifest, SplitManifestDocument
from campus_ingestion_core.process import IndexableChunk
from campus_ingestion_core.registry import DocumentRegistryRecord
from campus_ingestion_core.local_rebuild import replay_provider_response_rebuild
from campus_ingestion_core.object_store import build_processed_asset_artifact_key
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry
from qdrant_client import QdrantClient

SOURCE_BUCKET = "campus-rag-source"


class _FakeObjectStore:
    def __init__(self, *, provider_result_bytes: bytes) -> None:
        self.provider_result_bytes = provider_result_bytes
        self.uploads: list[dict[str, object]] = []
        self.reads: list[tuple[str, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.reads.append((bucket, key))
        return self.provider_result_bytes

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


def _provider_page(*blocks: dict[str, object]) -> dict[str, object]:
    return {
        "prunedResult": {
            "page_count": 1,
            "width": 828,
            "height": 1151,
            "parsing_res_list": list(blocks),
        }
    }


def _provider_block(block_label: str, block_content: str, *, block_id: str, block_order: int) -> dict[str, object]:
    return {
        "block_id": block_id,
        "block_label": block_label,
        "block_content": block_content,
        "block_order": block_order,
        "block_bbox": [0, 0, 100, 20],
    }


def _provider_batch_line(*pages: dict[str, object]) -> dict[str, object]:
    return {
        "logId": "log-batch-001",
        "result": {
            "dataInfo": {
                "numPages": len(pages),
                "pages": [{"width": 828, "height": 1151} for _ in pages],
                "type": "pdf",
            },
            "layoutParsingResults": list(pages),
        },
    }


class ProviderResultReplayRebuildTest(unittest.TestCase):
    def test_build_replay_documents_passes_real_raw_asset_record_to_service_navigation_hybrid_lane(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_config_path = root / "source-projections.v1.json"
            projection_config_path.write_text(
                json.dumps(
                    {
                        "schema_version": "student_handbook_source_projections_v1",
                        "source_corpus": "regulations",
                        "source_collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "projections": [
                            {
                                "projection_name": "student_handbook_primary_documents",
                                "target_corpus": "regulations",
                                "target_collection": "student_handbook",
                                "projection_family": "primary_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                            },
                            {
                                "projection_name": "handbook_navigation_service_catalog",
                                "target_corpus": "campus_services",
                                "target_collection": "service_catalog",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "source_title": "中央民族大学公寓及公费医疗管理规定",
                                "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                                "source_page_start": 252,
                                "source_page_end": 255,
                                "attachment_kind": "navigation_like",
                                "attachment_role": "service_navigation_document",
                                "target_title": "中央民族大学学生公寓管理工作流程",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            collection_config = CollectionTruthConfig(
                corpus="regulations",
                collection="student_handbook",
                config_root=root,
                runtime_profile_path=root / "runtime-profile.json",
                split_manifest_path=root / "split-manifest.v1.json",
                canonical_profile_path=root / "canonical-profile.json",
                chunk_profile_path=root / "chunk-profile.json",
                source_projections_path=projection_config_path,
            )
            split_manifest = SplitManifest(
                manifest_version="student_handbook_split_manifest_v1",
                corpus="regulations",
                collection="student_handbook",
                raw_asset_id="asset:student-handbook-pdf",
                documents=(
                    SplitManifestDocument(
                        document_id="handbook:source-001",
                        title="中央民族大学公寓及公费医疗管理规定",
                        handbook_section="中央民族大学公寓及公费医疗管理规定",
                        page_start=252,
                        page_end=255,
                        source_uri="campus-agent://regulations/student_handbook/docs/handbook:source-001",
                    ),
                ),
            )
            raw_asset_record = RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:test-raw-version",
                corpus="regulations",
                collection="student_handbook",
                raw_source_uri="s3://source/student-handbook.pdf",
                content_hash="test-raw-version",
                source_filename="学生手册_2018.pdf",
                object_key="official_pdf/student-handbook/2018/sha256/test-raw-version/capture/student-handbook.pdf",
                ingestion_timestamp="2026-04-20T00:00:00+00:00",
                import_source="raw_online_ocr",
            )
            structured_rows = [
                {
                    "row_id": "page-0252-title",
                    "page_start": 252,
                    "page_end": 252,
                    "row_type": "heading",
                    "block_role": "title",
                    "text_normalized": "中央民族大学公寓及公费医疗管理规定",
                    "text_raw": "中央民族大学公寓及公费医疗管理规定",
                }
            ]

            with (
                patch(
                    "campus_ingestion_core.local_rebuild._build_handbook_replay_document_input"
                ) as build_primary_document,
                patch(
                    "campus_ingestion_core.handbook_source_projections.build_handbook_service_navigation_hybrid_document"
                ) as build_hybrid,
            ):
                build_primary_document.return_value = DocumentImportInput(
                    source_label="primary-doc",
                    document_units_bytes=b'{"doc_id":"handbook:source-001","version_id":"primary:test"}\n',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=b"# \xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\x85\xac\xe5\xaf\x93\xe5\x8f\x8a\xe5\x85\xac\xe8\xb4\xb9\xe5\x8c\xbb\xe7\x96\x97\xe7\xae\xa1\xe7\x90\x86\xe8\xa7\x84\xe5\xae\x9a\n",
                    metadata={"document_id": "handbook:source-001", "version_id": "primary:test"},
                    import_source="provider_response_replay",
                    corpus="regulations",
                    collection="student_handbook",
                )
                build_hybrid.return_value = DocumentImportInput(
                    source_label="hybrid-doc",
                    document_units_bytes=(
                        '{"doc_id":"campus_services:service_catalog:test-001","version_id":"flow-graph:test",'
                        '"chunk_id":"flow-001","root_unit_id":"flow-001","unit_type":"section_text",'
                        '"clean_text":"学生到学院完成报到登记","source_pdf":"学生手册_2018.pdf",'
                        '"source_url":"campus-agent://regulations/student_handbook/docs/handbook:source-001",'
                        '"source":{"id":"campus-agent://regulations/student_handbook/docs/handbook:source-001"},'
                        '"page_start":253,"page_end":253,"anchor":{"page_start":253,"page_end":253},'
                        '"metadata":{"title":"中央民族大学学生公寓管理工作流程"},'
                        '"entitlement_groups":[],"visibility_scope":null,"visibility_level":"public",'
                        '"policy_projection_version":"phase1-authorization-projection-v1"}\n'
                    ).encode("utf-8"),
                    provider_response_bytes=None,
                    canonical_markdown_bytes=b"# \xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xad\xa6\xe7\x94\x9f\xe5\x85\xac\xe5\xaf\x93\xe7\xae\xa1\xe7\x90\x86\xe5\xb7\xa5\xe4\xbd\x9c\xe6\xb5\x81\xe7\xa8\x8b\n",
                    metadata={
                        "document_id": "campus_services:service_catalog:test-001",
                        "version_id": "flow-graph:test",
                        "title": "中央民族大学学生公寓管理工作流程",
                    },
                    import_source="provider_response_replay",
                    corpus="campus_services",
                    collection="service_catalog",
                    raw_source_uri=raw_asset_record.raw_source_uri,
                    raw_asset_id=raw_asset_record.raw_asset_id,
                    raw_version_id=raw_asset_record.raw_version_id,
                    provider_response_object_key="provider-response-key",
                )

                _build_replay_documents(
                    source={"OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET},
                    collection_config=collection_config,
                    split_manifest=split_manifest,
                    corpus="regulations",
                    collection="student_handbook",
                    source_pdf="学生手册_2018.pdf",
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:test-raw-version",
                    provider_response_key="provider-response-key",
                    layout_elements_key="layout-elements-key",
                    structured_rows=structured_rows,
                    reader=_FakeObjectStore(provider_result_bytes=b""),
                    source_bucket=SOURCE_BUCKET,
                    replay_raw_asset_record=raw_asset_record,
                )

        self.assertEqual(build_hybrid.call_count, 1)
        self.assertEqual(build_hybrid.call_args.kwargs["raw_asset_record"].object_key, raw_asset_record.object_key)

    def test_build_replay_documents_fails_closed_when_service_navigation_hybrid_lane_has_no_raw_asset_record(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_config_path = root / "source-projections.v1.json"
            projection_config_path.write_text(
                json.dumps(
                    {
                        "schema_version": "student_handbook_source_projections_v1",
                        "source_corpus": "regulations",
                        "source_collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "projections": [
                            {
                                "projection_name": "student_handbook_primary_documents",
                                "target_corpus": "regulations",
                                "target_collection": "student_handbook",
                                "projection_family": "primary_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                            },
                            {
                                "projection_name": "handbook_navigation_service_catalog",
                                "target_corpus": "campus_services",
                                "target_collection": "service_catalog",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "source_title": "中央民族大学公寓及公费医疗管理规定",
                                "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                                "source_page_start": 252,
                                "source_page_end": 255,
                                "attachment_kind": "navigation_like",
                                "attachment_role": "service_navigation_document",
                                "target_title": "中央民族大学学生公寓管理工作流程",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            collection_config = CollectionTruthConfig(
                corpus="regulations",
                collection="student_handbook",
                config_root=root,
                runtime_profile_path=root / "runtime-profile.json",
                split_manifest_path=root / "split-manifest.v1.json",
                canonical_profile_path=root / "canonical-profile.json",
                chunk_profile_path=root / "chunk-profile.json",
                source_projections_path=projection_config_path,
            )
            split_manifest = SplitManifest(
                manifest_version="student_handbook_split_manifest_v1",
                corpus="regulations",
                collection="student_handbook",
                raw_asset_id="asset:student-handbook-pdf",
                documents=(
                    SplitManifestDocument(
                        document_id="handbook:source-001",
                        title="中央民族大学公寓及公费医疗管理规定",
                        handbook_section="中央民族大学公寓及公费医疗管理规定",
                        page_start=252,
                        page_end=255,
                        source_uri="campus-agent://regulations/student_handbook/docs/handbook:source-001",
                    ),
                ),
            )
            structured_rows = [
                {
                    "row_id": "page-0252-title",
                    "page_start": 252,
                    "page_end": 252,
                    "row_type": "heading",
                    "block_role": "title",
                    "text_normalized": "中央民族大学公寓及公费医疗管理规定",
                    "text_raw": "中央民族大学公寓及公费医疗管理规定",
                }
            ]

            with patch(
                "campus_ingestion_core.local_rebuild._build_handbook_replay_document_input"
            ) as build_primary_document:
                build_primary_document.return_value = DocumentImportInput(
                    source_label="primary-doc",
                    document_units_bytes=b'{"doc_id":"handbook:source-001","version_id":"primary:test"}\n',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=b"# \xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\x85\xac\xe5\xaf\x93\xe5\x8f\x8a\xe5\x85\xac\xe8\xb4\xb9\xe5\x8c\xbb\xe7\x96\x97\xe7\xae\xa1\xe7\x90\x86\xe8\xa7\x84\xe5\xae\x9a\n",
                    metadata={"document_id": "handbook:source-001", "version_id": "primary:test"},
                    import_source="provider_response_replay",
                    corpus="regulations",
                    collection="student_handbook",
                )
                with self.assertRaisesRegex(ValueError, "raw asset record is required"):
                    _build_replay_documents(
                        source={"OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET},
                        collection_config=collection_config,
                        split_manifest=split_manifest,
                        corpus="regulations",
                        collection="student_handbook",
                        source_pdf="学生手册_2018.pdf",
                        raw_asset_id="asset:student-handbook-pdf",
                        raw_version_id="sha256:test-raw-version",
                        provider_response_key="provider-response-key",
                        layout_elements_key="layout-elements-key",
                        structured_rows=structured_rows,
                        reader=_FakeObjectStore(provider_result_bytes=b""),
                        source_bucket=SOURCE_BUCKET,
                        replay_raw_asset_record=None,
                    )

    def test_index_replayed_documents_fails_closed_when_registry_record_is_missing(self) -> None:
        documents = [
            DocumentImportInput(
                source_label="missing-registry-doc",
                document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                provider_response_bytes=None,
                canonical_markdown_bytes=None,
                metadata={"document_id": "handbook:missing-record", "version_id": "v1:missing-record"},
                import_source="provider_response_replay",
                corpus="regulations",
                collection="student_handbook",
            )
        ]

        with (
            patch("campus_ingestion_core.local_rebuild.build_embedding_model", return_value=object()),
            patch("campus_ingestion_core.local_rebuild.build_sparse_embedding_model", return_value=object()),
        ):
            with self.assertRaisesRegex(
                ValueError,
                "missing registry record for replayed document regulations/student_handbook handbook:missing-record@v1:missing-record",
            ):
                _index_replayed_documents(
                    source={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                    },
                    registry=InMemoryDocumentRegistry(),
                    documents=documents,
                    object_store=_FakeObjectStore(provider_result_bytes=b""),
                    qdrant_client=QdrantClient(location=":memory:"),
                )

    def test_index_replayed_documents_fails_closed_when_document_produces_no_chunks(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry.json")
            document_id = "handbook:empty-chunks"
            version_id = "v1:empty-chunks"
            registry.upsert(
                DocumentRegistryRecord(
                    document_id=document_id,
                    revision_track="source-faithful",
                    version_id=version_id,
                    source_uri=f"https://campus.example/{document_id}",
                    content_hash=f"sha256:{document_id}",
                    corpus="regulations",
                    collection="student_handbook",
                    entitlement_groups=("students",),
                    status="active",
                    ingestion_timestamp="2026-03-26T10:00:00+00:00",
                    parser_version="paddleocr-vl-1.5",
                    embedding_model="mock-embedding-8d",
                    source_channel="pdf_ocr",
                    document_units_object_key=f"documents/{document_id}.jsonl",
                    processed_object_keys=(f"documents/{document_id}.jsonl",),
                    import_source="provider_response_replay",
                )
            )
            documents = [
                DocumentImportInput(
                    source_label="empty-chunks-doc",
                    document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=None,
                    metadata={"document_id": document_id, "version_id": version_id},
                    import_source="provider_response_replay",
                    corpus="regulations",
                    collection="student_handbook",
                )
            ]

            with (
                patch("campus_ingestion_core.local_rebuild.build_embedding_model", return_value=object()),
                patch("campus_ingestion_core.local_rebuild.build_sparse_embedding_model", return_value=object()),
                patch(
                    "campus_ingestion_core.local_rebuild.build_indexable_chunks_from_jsonl",
                    return_value=(),
                ),
            ):
                with self.assertRaisesRegex(
                    ValueError,
                    "replayed document regulations/student_handbook handbook:empty-chunks@v1:empty-chunks produced no chunks",
                ):
                    _index_replayed_documents(
                        source={
                            "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                            "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                            "OBJECT_STORE_SECRET_KEY": "minioadmin",
                            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                            "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                            "EMBEDDING_PROVIDER": "mock",
                        },
                        registry=registry,
                        documents=documents,
                        object_store=_FakeObjectStore(provider_result_bytes=b""),
                        qdrant_client=QdrantClient(location=":memory:"),
                    )

    def test_index_replayed_documents_batches_upserts_and_only_ensures_collection_once(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry.json")
            documents: list[DocumentImportInput] = []
            for index in range(3):
                document_id = f"handbook:test-{index + 1:03d}"
                version_id = f"v1:test-{index + 1:03d}"
                registry.upsert(
                    DocumentRegistryRecord(
                        document_id=document_id,
                        revision_track="source-faithful",
                        version_id=version_id,
                        source_uri=f"https://campus.example/{document_id}",
                        content_hash=f"sha256:{document_id}",
                        corpus="regulations",
                        collection="student_handbook",
                        entitlement_groups=("students",),
                        status="active",
                        ingestion_timestamp="2026-03-26T10:00:00+00:00",
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        source_channel="pdf_ocr",
                        document_units_object_key=f"documents/{document_id}.jsonl",
                        processed_object_keys=(f"documents/{document_id}.jsonl",),
                        import_source="provider_response_replay",
                    )
                )
                documents.append(
                    DocumentImportInput(
                        source_label=f"doc-{index + 1}",
                        document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                        provider_response_bytes=None,
                        canonical_markdown_bytes=None,
                        metadata={"document_id": document_id, "version_id": version_id},
                        import_source="provider_response_replay",
                        corpus="regulations",
                        collection="student_handbook",
                    )
                )

            built_chunks = {
                str(document.metadata["document_id"]): (
                    IndexableChunk(
                        document_id=str(document.metadata["document_id"]),
                        revision_track="source-faithful",
                        version_id=str(document.metadata["version_id"]),
                        chunk_id=f'{document.metadata["document_id"]}:chunk-0001',
                        chunk_order=1,
                        corpus="regulations",
                        collection="student_handbook",
                        entitlement_groups=("students",),
                        visibility_scope=None,
                        visibility_level="restricted",
                        source_uri=f'https://campus.example/{document.metadata["document_id"]}',
                        source_chunk_id=None,
                        anchor={"page_start": index + 1, "page_end": index + 1},
                        text=f'chunk text {index + 1}',
                        source_channel="pdf_ocr",
                        is_current=False,
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        embedding=(0.1, 0.2),
                    ),
                )
                for index, document in enumerate(documents)
            }
            release_store = _FakeObjectStore(provider_result_bytes=b"")

            with (
                patch("campus_ingestion_core.local_rebuild.build_embedding_model", return_value=object()),
                patch("campus_ingestion_core.local_rebuild.build_sparse_embedding_model", return_value=object()),
                patch(
                    "campus_ingestion_core.local_rebuild.build_indexable_chunks_from_jsonl",
                    side_effect=lambda **kwargs: built_chunks[kwargs["record"].document_id],
                ),
                patch("campus_ingestion_core.local_rebuild.index_chunks_to_qdrant") as index_chunks,
                patch("campus_ingestion_core.local_rebuild.publish_release_alias", return_value=None),
            ):
                _index_replayed_documents(
                    source={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "QDRANT_UPSERT_BATCH_SIZE": "2",
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                    },
                    registry=registry,
                    documents=documents,
                    object_store=release_store,
                    qdrant_client=QdrantClient(location=":memory:"),
                )

        self.assertEqual(index_chunks.call_count, 2)
        first_call = index_chunks.call_args_list[0].kwargs
        second_call = index_chunks.call_args_list[1].kwargs
        self.assertEqual(tuple(chunk.document_id for chunk in first_call["chunks"]), ("handbook:test-001", "handbook:test-002"))
        self.assertEqual(tuple(chunk.document_id for chunk in second_call["chunks"]), ("handbook:test-003",))
        self.assertTrue(first_call["collection_name"].startswith("student_handbook__r"))
        self.assertEqual(first_call["collection_name"], second_call["collection_name"])
        self.assertTrue(first_call["ensure_collection"])
        self.assertTrue(first_call["ensure_payload_indexes"])
        self.assertFalse(second_call["ensure_collection"])
        self.assertFalse(second_call["ensure_payload_indexes"])
        self.assertEqual(first_call["extra_payload"]["index_release_alias"], "student_handbook")
        self.assertEqual(first_call["extra_payload"]["index_release_id"], second_call["extra_payload"]["index_release_id"])
        self.assertEqual(first_call["extra_payload"]["index_physical_collection_name"], first_call["collection_name"])
        upload_keys = [str(upload["key"]) for upload in release_store.uploads]
        self.assertIn(
            f'regulations/releases/student_handbook/{first_call["extra_payload"]["index_release_id"]}/index-release.json',
            upload_keys,
        )
        self.assertIn(
            f'regulations/releases/student_handbook/{first_call["extra_payload"]["index_release_id"]}/validation-summary.json',
            upload_keys,
        )

    def test_index_replayed_documents_routes_projection_documents_to_their_own_collections(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry.json")
            documents = [
                DocumentImportInput(
                    source_label="handbook",
                    document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=None,
                    metadata={"document_id": "handbook:test-001", "version_id": "v1:handbook-001"},
                    import_source="provider_response_replay",
                    corpus="regulations",
                    collection="student_handbook",
                ),
                DocumentImportInput(
                    source_label="contact",
                    document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=None,
                    metadata={"document_id": "campus_services:contact_directory:test-001", "version_id": "v1:contact-001"},
                    import_source="provider_response_replay",
                    corpus="campus_services",
                    collection="contact_directory",
                ),
                DocumentImportInput(
                    source_label="service",
                    document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=None,
                    metadata={"document_id": "campus_services:service_catalog:test-001", "version_id": "v1:service-001"},
                    import_source="provider_response_replay",
                    corpus="campus_services",
                    collection="service_catalog",
                ),
            ]
            for document in documents:
                registry.upsert(
                    DocumentRegistryRecord(
                        document_id=str(document.metadata["document_id"]),
                        revision_track="source-faithful",
                        version_id=str(document.metadata["version_id"]),
                        source_uri=f'https://campus.example/{document.metadata["document_id"]}',
                        content_hash=f'sha256:{document.metadata["document_id"]}',
                        corpus=document.corpus,
                        collection=document.collection,
                        entitlement_groups=("students",),
                        status="active",
                        ingestion_timestamp="2026-03-26T10:00:00+00:00",
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        source_channel="pdf_ocr",
                        document_units_object_key=f'documents/{document.metadata["document_id"]}.jsonl',
                        processed_object_keys=(f'documents/{document.metadata["document_id"]}.jsonl',),
                        import_source="provider_response_replay",
                    )
                )

            built_chunks = {
                "handbook:test-001": (
                    IndexableChunk(
                        document_id="handbook:test-001",
                        revision_track="source-faithful",
                        version_id="v1:handbook-001",
                        chunk_id="handbook:test-001:chunk-0001",
                        chunk_order=1,
                        corpus="regulations",
                        collection="student_handbook",
                        entitlement_groups=("students",),
                        visibility_scope=None,
                        visibility_level="restricted",
                        source_uri="https://campus.example/handbook:test-001",
                        source_chunk_id=None,
                        anchor={"page_start": 1, "page_end": 1},
                        text="handbook chunk",
                        source_channel="pdf_ocr",
                        is_current=False,
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        embedding=(0.1, 0.2),
                    ),
                ),
                "campus_services:contact_directory:test-001": (
                    IndexableChunk(
                        document_id="campus_services:contact_directory:test-001",
                        revision_track="source-faithful",
                        version_id="v1:contact-001",
                        chunk_id="campus_services:contact_directory:test-001:chunk-0001",
                        chunk_order=1,
                        corpus="campus_services",
                        collection="contact_directory",
                        entitlement_groups=("students",),
                        visibility_scope=None,
                        visibility_level="restricted",
                        source_uri="https://campus.example/campus_services:contact_directory:test-001",
                        source_chunk_id=None,
                        anchor={"page_start": 1, "page_end": 1},
                        text="contact chunk",
                        source_channel="pdf_ocr",
                        is_current=False,
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        embedding=(0.1, 0.2),
                    ),
                ),
                "campus_services:service_catalog:test-001": (
                    IndexableChunk(
                        document_id="campus_services:service_catalog:test-001",
                        revision_track="source-faithful",
                        version_id="v1:service-001",
                        chunk_id="campus_services:service_catalog:test-001:chunk-0001",
                        chunk_order=1,
                        corpus="campus_services",
                        collection="service_catalog",
                        entitlement_groups=("students",),
                        visibility_scope=None,
                        visibility_level="restricted",
                        source_uri="https://campus.example/campus_services:service_catalog:test-001",
                        source_chunk_id=None,
                        anchor={"page_start": 1, "page_end": 1},
                        text="service chunk",
                        source_channel="pdf_ocr",
                        is_current=False,
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        embedding=(0.1, 0.2),
                    ),
                ),
            }
            release_store = _FakeObjectStore(provider_result_bytes=b"")

            with (
                patch("campus_ingestion_core.local_rebuild.build_embedding_model", return_value=object()),
                patch("campus_ingestion_core.local_rebuild.build_sparse_embedding_model", return_value=object()),
                patch(
                    "campus_ingestion_core.local_rebuild.build_indexable_chunks_from_jsonl",
                    side_effect=lambda **kwargs: built_chunks[kwargs["record"].document_id],
                ),
                patch("campus_ingestion_core.local_rebuild.index_chunks_to_qdrant") as index_chunks,
                patch("campus_ingestion_core.local_rebuild.publish_release_alias", return_value=None),
            ):
                _index_replayed_documents(
                    source={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "QDRANT_UPSERT_BATCH_SIZE": "128",
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                    },
                    registry=registry,
                    documents=documents,
                    object_store=release_store,
                    qdrant_client=QdrantClient(location=":memory:"),
                )

        self.assertEqual(index_chunks.call_count, 3)
        self.assertTrue(index_chunks.call_args_list[0].kwargs["collection_name"].startswith("student_handbook__r"))
        self.assertTrue(index_chunks.call_args_list[1].kwargs["collection_name"].startswith("contact_directory__r"))
        self.assertTrue(index_chunks.call_args_list[2].kwargs["collection_name"].startswith("service_catalog__r"))
        self.assertEqual(index_chunks.call_args_list[0].kwargs["extra_payload"]["index_release_alias"], "student_handbook")
        self.assertEqual(index_chunks.call_args_list[1].kwargs["extra_payload"]["index_release_alias"], "contact_directory")
        self.assertEqual(index_chunks.call_args_list[2].kwargs["extra_payload"]["index_release_alias"], "service_catalog")
        self.assertTrue(index_chunks.call_args_list[0].kwargs["ensure_collection"])
        self.assertTrue(index_chunks.call_args_list[1].kwargs["ensure_collection"])
        self.assertTrue(index_chunks.call_args_list[2].kwargs["ensure_collection"])
        upload_keys = [str(upload["key"]) for upload in release_store.uploads]
        self.assertIn(
            f'regulations/releases/student_handbook/{index_chunks.call_args_list[0].kwargs["extra_payload"]["index_release_id"]}/index-release.json',
            upload_keys,
        )
        self.assertIn(
            f'campus_services/releases/contact_directory/{index_chunks.call_args_list[1].kwargs["extra_payload"]["index_release_id"]}/index-release.json',
            upload_keys,
        )
        self.assertIn(
            f'campus_services/releases/service_catalog/{index_chunks.call_args_list[2].kwargs["extra_payload"]["index_release_id"]}/index-release.json',
            upload_keys,
        )

    def test_replay_provider_response_rebuild_reconstructs_declared_downstream_projections_from_source_truth(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                                "title": "普通高等学校学生管理规定",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            projection_config_path = root / "configs" / "source-projections.v1.json"
            projection_config_path.write_text(
                json.dumps(
                    {
                        "schema_version": "student_handbook_source_projections_v1",
                        "source_corpus": "regulations",
                        "source_collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "source_truth_artifacts": [
                            "provider-response.jsonl",
                            "layout-elements.jsonl",
                            "split-manifest.v1.json",
                            "per-document source rows",
                        ],
                        "rebuild_boundary": "source_truth",
                        "rebuild_rule": "When canonical source truth exists, downstream rebuild must reuse source truth and must not return to raw.",
                        "derived_document_fields": [
                            "projection_name",
                            "derived_from_raw_asset_id",
                            "derived_from_raw_version_id",
                            "derived_from",
                            "derived_from_document_id",
                            "parent_document_id",
                            "source_title",
                            "source_handbook_section",
                            "source_page_start",
                            "source_page_end",
                            "attachment_kind",
                            "attachment_role",
                        ],
                        "projections": [
                            {
                                "projection_name": "student_handbook_primary_documents",
                                "target_corpus": "regulations",
                                "target_collection": "student_handbook",
                                "projection_family": "primary_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "derived_from_document_id": None,
                                "parent_document_id": None,
                                "attachment_kind": None,
                                "attachment_role": None,
                            },
                            {
                                "projection_name": "handbook_phone_directory",
                                "target_corpus": "campus_services",
                                "target_collection": "contact_directory",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "derived_from_document_id": None,
                                "parent_document_id": None,
                                "source_title": "中央民族大学校内常用电话",
                                "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                                "source_page_start": 1,
                                "source_page_end": 1,
                                "attachment_kind": "navigation_like",
                                "attachment_role": "service_contact_directory",
                                "target_title": "中央民族大学校内常用电话",
                                "migration_reason": "handbook_phone_directory_projection",
                            },
                            {
                                "projection_name": "handbook_navigation_service_catalog",
                                "target_corpus": "campus_services",
                                "target_collection": "service_catalog",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "derived_from_document_id": None,
                                "parent_document_id": None,
                                "source_title": "中央民族大学公寓及公费医疗管理规定",
                                "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                                "source_page_start": 2,
                                "source_page_end": 2,
                                "attachment_kind": "navigation_like",
                                "attachment_role": "service_navigation_document",
                                "target_title": "中央民族大学学生公寓管理工作流程",
                                "migration_reason": "handbook_navigation_document",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block("doc_title", "中央民族大学校内常用电话", block_id="p1-title", block_order=1),
                        _provider_block("text", "保卫处：68930010", block_id="p1-body", block_order=2),
                    ),
                    _provider_page(
                        _provider_block("doc_title", "中央民族大学公寓及公费医疗管理规定", block_id="p2-title", block_order=1),
                        _provider_block("text", "一、学生公寓入住办理流程。", block_id="p2-body", block_order=2),
                    ),
                    _provider_page(
                        _provider_block("doc_title", "普通高等学校学生管理规定", block_id="p3-title", block_order=1),
                        _provider_block("text", "第一条 为规范普通高等学校学生管理行为。", block_id="p3-body", block_order=2),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(backing_path=root / "registry" / "raw-assets.json")
            source_key = (
                "official_pdf/student-handbook/2018/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider/paddleocr-vl-1-5/provider-response.jsonl"
            )

            report = replay_provider_response_rebuild(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "HANDBOOK_SOURCE_PROJECTIONS_PATH": str(projection_config_path),
                    "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                    "REPLAY_SOURCE_PDF": "学生手册_2018.pdf",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                    "EMBEDDING_PROVIDER": "mock",
                },
                object_store=object_store,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.import_mode, "provider_response_replay")
            self.assertEqual(report.success_count, 3)
            self.assertEqual(
                tuple(sorted(record.document_id for record in registry.list_by_scope("campus_services", "contact_directory"))),
                ("campus_services:contact_directory:bf03f0bd6930e89bcc6d2733c1e87a423b510675",),
            )
            self.assertEqual(
                tuple(sorted(record.document_id for record in registry.list_by_scope("campus_services", "service_catalog"))),
                ("campus_services:service_catalog:66f91543748400ae59b3f9265353a0538088028a",),
            )
            upload_payloads = {
                str(upload["key"]): upload["data"].decode("utf-8")
                for upload in object_store.uploads
                if str(upload["key"]).endswith("/canonical.md")
            }
            phone_doc = next(
                payload
                for key, payload in upload_payloads.items()
                if "campus_services/documents/contact_directory/" in key
            )
            self.assertIn("projection_name: handbook_phone_directory", phone_doc)
            self.assertIn("derived_from_raw_asset_id: asset:student-handbook-pdf", phone_doc)
            self.assertIn("parent_document_id: handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675", phone_doc)

    def test_replay_provider_response_rebuild_reconstructs_handbook_documents_without_indexing_by_default(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                                "title": "普通高等学校学生管理规定",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                            },
                            {
                                "document_id": "handbook:1a45ef1bc4be11e74514b0bf6e3365ada8a07bbd",
                                "title": "高等学校学生行为准则",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:1a45ef1bc4be11e74514b0bf6e3365ada8a07bbd",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block("doc_title", "普通高等学校学生管理规定", block_id="p1-title", block_order=1),
                        _provider_block("text", "第一条 学校坚持育人为本。", block_id="p1-body", block_order=2),
                    ),
                    _provider_page(
                        _provider_block("text", "第二条 学生应当遵守校纪校规。", block_id="p2-body", block_order=1),
                    ),
                    _provider_page(
                        _provider_block("doc_title", "高等学校学生行为准则", block_id="p3-title", block_order=1),
                        _provider_block("text", "学生应当勤奋学习，尊敬师长。", block_id="p3-body", block_order=2),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            source_key = (
                "official_pdf/student-handbook/2018/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider/paddleocr-vl-1-5/provider-response.jsonl"
            )
            canonical_provider_key = (
                "official_pdf/student-handbook/2018/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider/paddleocr-vl-1-5/provider-response.jsonl"
            )
            canonical_layout_key = (
                "official_pdf/student-handbook/2018/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/source-truth/layout-elements.jsonl"
            )

            with patch("campus_ingestion_core.local_rebuild._index_replayed_documents") as index_documents:
                report = replay_provider_response_rebuild(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "REBUILD_CORPUS": "regulations",
                        "REBUILD_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                        "REPLAY_SOURCE_PDF": "学生手册_2018.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                    },
                    object_store=object_store,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                )

            self.assertEqual(report.import_mode, "provider_response_replay")
            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            index_documents.assert_not_called()
            self.assertEqual(
                object_store.reads,
                [(SOURCE_BUCKET, source_key)],
            )

            upload_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertIn(canonical_provider_key, upload_keys)
            self.assertIn(canonical_layout_key, upload_keys)
            self.assertEqual(len([key for key in upload_keys if key.endswith("/document-units.jsonl")]), 2)
            self.assertEqual(len([key for key in upload_keys if key.endswith("/canonical.md")]), 2)

            records = registry.list_by_scope("regulations", "student_handbook")
            self.assertEqual(len(records), 2)
            self.assertTrue(all(record.import_source == "provider_response_replay" for record in records))
            self.assertTrue(all(record.raw_asset is None for record in records))
            self.assertTrue(all(record.canonical_markdown_object_key is not None for record in records))
            self.assertTrue(
                all(
                    record.source_uri.startswith("campus-agent://regulations/student_handbook/docs/handbook:")
                    for record in records
                )
            )

            self.assertEqual(raw_asset_registry.list_by_scope("regulations", "student_handbook"), ())

    def test_replay_provider_response_rebuild_writes_trace_events_when_trace_path_is_configured(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                                "title": "普通高等学校学生管理规定",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block("doc_title", "普通高等学校学生管理规定", block_id="p1-title", block_order=1),
                        _provider_block("text", "第一条 学校坚持育人为本。", block_id="p1-body", block_order=2),
                    ),
                    _provider_page(
                        _provider_block("text", "第二条 学生应当遵守校纪校规。", block_id="p2-body", block_order=1),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            trace_path = root / "trace" / "rebuild.jsonl"

            with patch("campus_ingestion_core.local_rebuild._index_replayed_documents") as index_documents:
                replay_provider_response_rebuild(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "REBUILD_CORPUS": "regulations",
                        "REBUILD_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                        "REPLAY_SOURCE_PDF": "学生手册_2018.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                        "REBUILD_TRACE_JSONL_PATH": str(trace_path),
                    },
                    object_store=object_store,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                )

            index_documents.assert_not_called()
            events = [
                json.loads(line)
                for line in trace_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            event_pairs = {(event["stage"], event["event"]) for event in events}
            self.assertIn(("replay.load_source_artifacts", "end"), event_pairs)
            self.assertIn(("replay.build_documents", "end"), event_pairs)
            self.assertIn(("replay.persist_documents", "end"), event_pairs)

    def test_replay_provider_response_rebuild_can_optionally_index_qdrant(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                                "title": "普通高等学校学生管理规定",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                            },
                            {
                                "document_id": "handbook:1a45ef1bc4be11e74514b0bf6e3365ada8a07bbd",
                                "title": "高等学校学生行为准则",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:1a45ef1bc4be11e74514b0bf6e3365ada8a07bbd",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block("doc_title", "普通高等学校学生管理规定", block_id="p1-title", block_order=1),
                        _provider_block("text", "第一条 学校坚持育人为本。", block_id="p1-body", block_order=2),
                    ),
                    _provider_page(
                        _provider_block("text", "第二条 学生应当遵守校纪校规。", block_id="p2-body", block_order=1),
                    ),
                    _provider_page(
                        _provider_block("doc_title", "高等学校学生行为准则", block_id="p3-title", block_order=1),
                        _provider_block("text", "学生应当勤奋学习，尊敬师长。", block_id="p3-body", block_order=2),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            qdrant_client = QdrantClient(location=":memory:")
            source_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="provider-response.jsonl",
            )
            canonical_provider_key = (
                "official_pdf/student-handbook/2018/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider/paddleocr-vl-1-5/provider-response.jsonl"
            )
            canonical_layout_key = (
                "official_pdf/student-handbook/2018/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/source-truth/layout-elements.jsonl"
            )

            report = replay_provider_response_rebuild(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                    "REPLAY_SOURCE_PDF": "学生手册_2018.pdf",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    "EMBEDDING_PROVIDER": "mock",
                    "SPARSE_PROVIDER": "mock",
                    "REBUILD_INDEX_QDRANT": "1",
                },
                object_store=object_store,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
                qdrant_client=qdrant_client,
            )

            self.assertEqual(report.failed_count, 0)
            aliases = {alias.alias_name: alias.collection_name for alias in qdrant_client.get_aliases().aliases or []}
            self.assertIn("student_handbook", aliases)
            collection_info = qdrant_client.get_collection(aliases["student_handbook"])
            self.assertGreater(collection_info.points_count or 0, 0)

    def test_replay_provider_response_rebuild_can_index_without_publishing_alias(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-2022",
                        "documents": [
                            {
                                "document_id": "curriculum:test-doc-001",
                                "title": "培养方案示例",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "campus-agent://curriculum/curriculum_plan/docs/curriculum:test-doc-001",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block("doc_title", "培养方案示例", block_id="p1-title", block_order=1),
                        _provider_block("text", "一、培养目标。", block_id="p1-body", block_order=2),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "curriculum_documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_raw_assets.json"
            )
            qdrant_client = QdrantClient(location=":memory:")

            with patch(
                "campus_ingestion_core.local_rebuild.validate_scope_release",
                return_value=SimpleNamespace(status="passed", summary={"chunk_count": 1}),
            ):
                report = replay_provider_response_rebuild(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "REBUILD_CORPUS": "curriculum",
                        "REBUILD_COLLECTION": "curriculum_plan",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "RAW_VERSION_ID": "sha256:curriculum-replay-001",
                        "REPLAY_SOURCE_PDF": "curriculum-plan.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                        "SPARSE_PROVIDER": "mock",
                        "REBUILD_INDEX_QDRANT": "1",
                        "REBUILD_PUBLISH_ALIAS": "0",
                    },
                    object_store=object_store,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                    qdrant_client=qdrant_client,
                )

            self.assertEqual(report.failed_count, 0)
            aliases = {alias.alias_name: alias.collection_name for alias in qdrant_client.get_aliases().aliases or []}
            self.assertNotIn("curriculum_plan", aliases)
            collections = [collection.name for collection in qdrant_client.get_collections().collections or []]
            self.assertTrue(any(str(name).startswith("curriculum_plan__r") for name in collections))
            upload_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/index-release.json") for key in upload_keys))
            self.assertTrue(any(key.endswith("/validation-summary.json") for key in upload_keys))

    def test_replay_provider_response_rebuild_uses_raw_asset_source_pdf_when_request_omits_it(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-2022",
                        "documents": [
                            {
                                "document_id": "curriculum:test-doc-001",
                                "title": "培养方案示例",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "campus-agent://curriculum/curriculum_plan/docs/curriculum:test-doc-001",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block("doc_title", "培养方案示例", block_id="p1-title", block_order=1),
                        _provider_block("text", "一、培养目标。", block_id="p1-body", block_order=2),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "curriculum_documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_raw_assets.json"
            )
            raw_asset_registry.upsert(
                RawAssetRecord(
                    raw_asset_id="asset:curriculum-plan-2022",
                    raw_version_id="sha256:curriculum-replay-001",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    raw_source_uri="s3://upstream/curriculum-plan-2022.pdf",
                    content_hash="curriculum-replay-001",
                    source_filename="curriculum-plan-2022.pdf",
                    object_key=(
                        "official_pdf/curriculum-plan/2022/sha256/curriculum-replay-001/"
                        "capture/curriculum-plan-2022.pdf"
                    ),
                    ingestion_timestamp="2026-04-03T00:00:00+00:00",
                    import_source="raw_online_ocr",
                )
            )

            report = replay_provider_response_rebuild(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "REBUILD_CORPUS": "curriculum",
                    "REBUILD_COLLECTION": "curriculum_plan",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "RAW_VERSION_ID": "sha256:curriculum-replay-001",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                    "EMBEDDING_PROVIDER": "mock",
                },
                request=RebuildRequest(
                    corpus="curriculum",
                    collection="curriculum_plan",
                    import_mode="provider_response_replay",
                    raw_version_id="sha256:curriculum-replay-001",
                ),
                object_store=object_store,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.failed_count, 0)
            self.assertEqual(
                object_store.reads[0],
                (
                    SOURCE_BUCKET,
                    "official_pdf/curriculum-plan/2022/sha256/"
                    "curriculum-replay-001/provider/paddleocr-vl-1-5/provider-response.jsonl",
                ),
            )

    def test_replay_provider_response_rebuild_indexing_defers_to_record_chunk_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                                "title": "普通高等学校学生管理规定",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block("doc_title", "普通高等学校学生管理规定", block_id="p1-title", block_order=1),
                        _provider_block("text", "第一条 学校坚持育人为本。", block_id="p1-body", block_order=2),
                    ),
                    _provider_page(
                        _provider_block("text", "第二条 学生应当遵守校纪校规。", block_id="p2-body", block_order=1),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            source_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="provider-response.jsonl",
            )

            chunk_profile_args: list[object | None] = []

            def _capture_chunk_profile(**kwargs: object) -> tuple[object, ...]:
                chunk_profile_args.append(kwargs.get("chunk_profile"))
                record = kwargs["record"]
                assert isinstance(record, DocumentRegistryRecord)
                return (
                    IndexableChunk(
                        document_id=record.document_id,
                        revision_track=record.revision_track,
                        version_id=record.version_id,
                        chunk_id=f"{record.document_id}:chunk-0001",
                        chunk_order=1,
                        corpus=record.corpus,
                        collection=record.collection,
                        entitlement_groups=record.entitlement_groups,
                        visibility_scope=record.visibility_scope,
                        visibility_level="public",
                        source_uri=record.source_uri,
                        source_chunk_id=None,
                        anchor={"page_start": 1, "page_end": 1},
                        text="captured chunk",
                        source_channel=record.source_channel,
                        is_current=record.is_current,
                        parser_version=record.parser_version,
                        embedding_model=record.embedding_model,
                        embedding=(0.1, 0.2),
                    ),
                )

            with patch(
                "campus_ingestion_core.local_rebuild.build_indexable_chunks_from_jsonl",
                side_effect=_capture_chunk_profile,
            ), patch(
                "campus_ingestion_core.local_rebuild.validate_scope_release",
                return_value=SimpleNamespace(status="passed", summary={"chunk_count": 1}),
            ), patch(
                "campus_ingestion_core.local_rebuild.index_chunks_to_qdrant",
                return_value=(),
            ), patch(
                "campus_ingestion_core.local_rebuild.publish_release_alias",
                return_value=None,
            ):
                report = replay_provider_response_rebuild(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "REBUILD_CORPUS": "regulations",
                        "REBUILD_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                        "REPLAY_SOURCE_PDF": "学生手册_2018.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                        "REBUILD_INDEX_QDRANT": "1",
                    },
                    object_store=object_store,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                    qdrant_client=QdrantClient(location=":memory:"),
                )

            self.assertEqual(report.failed_count, 0)
            self.assertEqual(chunk_profile_args, [None])

    def test_replay_provider_response_rebuild_reports_indexing_failure_in_final_report(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                                "title": "普通高等学校学生管理规定",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                            },
                            {
                                "document_id": "handbook:1a45ef1bc4be11e74514b0bf6e3365ada8a07bbd",
                                "title": "高等学校学生行为准则",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:1a45ef1bc4be11e74514b0bf6e3365ada8a07bbd",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block("doc_title", "普通高等学校学生管理规定", block_id="p1-title", block_order=1),
                        _provider_block("text", "第一条 学校坚持育人为本。", block_id="p1-body", block_order=2),
                    ),
                    _provider_page(
                        _provider_block("text", "第二条 学生应当遵守校纪校规。", block_id="p2-body", block_order=1),
                    ),
                    _provider_page(
                        _provider_block("doc_title", "高等学校学生行为准则", block_id="p3-title", block_order=1),
                        _provider_block("text", "学生应当勤奋学习，尊敬师长。", block_id="p3-body", block_order=2),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            source_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="provider-response.jsonl",
            )
            canonical_provider_key = (
                "official_pdf/student-handbook/2018/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider/paddleocr-vl-1-5/provider-response.jsonl"
            )
            canonical_layout_key = (
                "official_pdf/student-handbook/2018/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/source-truth/layout-elements.jsonl"
            )

            with patch(
                "campus_ingestion_core.local_rebuild._index_replayed_documents",
                side_effect=RuntimeError("qdrant indexing failed"),
            ):
                report = replay_provider_response_rebuild(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "REBUILD_CORPUS": "regulations",
                        "REBUILD_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                        "REPLAY_SOURCE_PDF": "学生手册_2018.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                        "REBUILD_INDEX_QDRANT": "1",
                    },
                    object_store=object_store,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                    qdrant_client=QdrantClient(location=":memory:"),
                )

            self.assertEqual(report.import_mode, "provider_response_replay")
            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.failed_count, 1)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertIn("qdrant indexing failed", report.errors[0])

            upload_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertIn(canonical_provider_key, upload_keys)
            self.assertIn(canonical_layout_key, upload_keys)
            self.assertEqual(len([key for key in upload_keys if key.endswith("/document-units.jsonl")]), 2)
            self.assertEqual(len([key for key in upload_keys if key.endswith("/canonical.md")]), 2)

            records = registry.list_by_scope("regulations", "student_handbook")
            self.assertEqual(len(records), 2)
            self.assertTrue(all(record.import_source == "provider_response_replay" for record in records))
            self.assertTrue(all(record.canonical_markdown_object_key is not None for record in records))
            self.assertEqual(raw_asset_registry.list_by_scope("regulations", "student_handbook"), ())

            report_path = Path(report.report_path)
            self.assertTrue(report_path.exists())
            payload = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["success_count"], 2)
            self.assertEqual(payload["failed_count"], 1)
            self.assertIn("qdrant indexing failed", payload["errors"][0])


if __name__ == "__main__":
    unittest.main()
