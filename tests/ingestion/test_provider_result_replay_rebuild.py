from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_core.local_rebuild import replay_provider_response_rebuild
from campus_ingestion_core.object_store import build_processed_asset_artifact_key
from campus_ingestion_core.registry import FileDocumentRegistry, FileRawAssetRegistry
from qdrant_client import QdrantClient


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
                                "document_id": "handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",
                                "title": "中央民族大学校内常用电话",
                                "handbook_section": "校园服务电话",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",
                            },
                            {
                                "document_id": "handbook:66f91543748400ae59b3f9265353a0538088028a",
                                "title": "中央民族大学公寓及公费医疗管理规定",
                                "handbook_section": "学生公寓管理",
                                "page_start": 2,
                                "page_end": 2,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:66f91543748400ae59b3f9265353a0538088028a",
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
                                "derived_from_document_id": "handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",
                                "parent_document_id": "handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",
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
                                "derived_from_document_id": "handbook:66f91543748400ae59b3f9265353a0538088028a",
                                "parent_document_id": "handbook:66f91543748400ae59b3f9265353a0538088028a",
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
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = FileDocumentRegistry(root / "registry" / "documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "raw-assets.json")
            source_key = (
                "regulations/sources/pdf_ocr/student-handbook/undated/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
            )

            report = replay_provider_response_rebuild(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "HANDBOOK_SOURCE_PROJECTIONS_PATH": str(projection_config_path),
                    "REBUILD_PROVIDER_RESPONSE_KEY": source_key,
                    "REPLAY_SOURCE_PDF": "student-handbook.pdf",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                    "EMBEDDING_PROVIDER": "mock",
                    "QDRANT_COLLECTION": "student_handbook",
                },
                object_store=object_store,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.import_mode, "provider_response_replay")
            self.assertEqual(report.success_count, 4)
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
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            source_key = (
                "regulations/sources/pdf_ocr/student-handbook/undated/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
            )
            canonical_provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="provider-response.jsonl",
            )
            canonical_layout_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="layout-elements.jsonl",
            )

            with patch("campus_ingestion_core.local_rebuild._index_replayed_documents") as index_documents:
                report = replay_provider_response_rebuild(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "REBUILD_PROVIDER_RESPONSE_KEY": source_key,
                        "REPLAY_SOURCE_PDF": "student-handbook.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                        "QDRANT_COLLECTION": "student_handbook",
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
                [("campus-rag-processed", source_key)],
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
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            qdrant_client = QdrantClient(location=":memory:")
            source_key = (
                "regulations/sources/pdf_ocr/student-handbook/undated/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
            )
            canonical_provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="provider-response.jsonl",
            )
            canonical_layout_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="layout-elements.jsonl",
            )

            report = replay_provider_response_rebuild(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "REBUILD_PROVIDER_RESPONSE_KEY": source_key,
                    "REPLAY_SOURCE_PDF": "student-handbook.pdf",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                    "EMBEDDING_PROVIDER": "mock",
                    "QDRANT_COLLECTION": "student_handbook",
                    "REBUILD_INDEX_QDRANT": "1",
                },
                object_store=object_store,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
                qdrant_client=qdrant_client,
            )

            self.assertEqual(report.failed_count, 0)
            collection_info = qdrant_client.get_collection("student_handbook")
            self.assertGreater(collection_info.points_count or 0, 0)

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
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            source_key = (
                "regulations/sources/pdf_ocr/student-handbook/undated/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
            )

            chunk_profile_args: list[object | None] = []

            def _capture_chunk_profile(**kwargs: object) -> tuple[object, ...]:
                chunk_profile_args.append(kwargs.get("chunk_profile"))
                return ()

            with patch(
                "campus_ingestion_core.local_rebuild.build_indexable_chunks_from_jsonl",
                side_effect=_capture_chunk_profile,
            ), patch(
                "campus_ingestion_core.local_rebuild.index_chunks_to_qdrant",
                return_value=(),
            ):
                report = replay_provider_response_rebuild(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "REBUILD_PROVIDER_RESPONSE_KEY": source_key,
                        "REPLAY_SOURCE_PDF": "student-handbook.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                        "QDRANT_COLLECTION": "student_handbook",
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
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            source_key = (
                "regulations/sources/pdf_ocr/student-handbook/undated/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
            )
            canonical_provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="provider-response.jsonl",
            )
            canonical_layout_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="layout-elements.jsonl",
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
                        "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "REBUILD_PROVIDER_RESPONSE_KEY": source_key,
                        "REPLAY_SOURCE_PDF": "student-handbook.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                        "QDRANT_COLLECTION": "student_handbook",
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
