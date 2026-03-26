from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_core.campus_services_migration import (
    build_campus_services_migration_plan,
    migrate_campus_services_canonical_to_object_store,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import build_processed_asset_artifact_key


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.puts: list[tuple[str, str, bytes, str]] = []
        self.deleted_prefixes: list[tuple[str, str, tuple[str, ...]]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.puts.append((bucket, key, data, content_type))

    def delete_prefix(self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()) -> None:
        self.deleted_prefixes.append((bucket, prefix, exclude_keys))


class _FakeRawAssetRegistry:
    def __init__(self, *records: RawAssetRecord) -> None:
        self.records = records

    def list_by_scope(self, corpus: str, collection: str | None = None) -> tuple[RawAssetRecord, ...]:
        return tuple(
            record
            for record in self.records
            if record.corpus == corpus and (collection is None or record.collection == collection)
        )


class CampusServicesObjectStoreMigrationTest(unittest.TestCase):
    def test_build_plan_projects_active_service_portal_and_phone_docs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            canonical_root = _build_canonical_fixture(Path(temp_dir))

            plan = build_campus_services_migration_plan(canonical_root)

        self.assertEqual(len(plan.entries), 2)
        self.assertEqual(
            [entry.collection for entry in plan.entries],
            ["contact_directory", "service_catalog"],
        )
        self.assertEqual(
            [entry.document_id for entry in plan.entries],
            [
                "campus_services:contact_directory:bf03f0bd6930e89bcc6d2733c1e87a423b510675",
                "campus_services:service_catalog:4122f8f863e497f4f21234da1e35dd7693bbc6e9",
            ],
        )
        self.assertEqual(
            plan.entries[0].target_object_key,
            "campus_services/documents/contact_directory/"
            "中央民族大学校内常用电话--bf03f0bd/source-faithful/2018/canonical.md",
        )
        self.assertEqual(
            plan.entries[1].target_object_key,
            "campus_services/documents/service_catalog/"
            "一网通办服务目录--4122f8f8/source-faithful/2026/canonical.md",
        )
        self.assertTrue(plan.entries[0].source_path.name.endswith("常用电话.md"))
        self.assertTrue(plan.entries[1].source_path.name.endswith("一网通办服务目录.md"))

    def test_migration_writes_canonical_docs_to_processed_bucket_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            canonical_root = _build_canonical_fixture(Path(temp_dir))
            object_store = _FakeObjectStore()
            raw_asset_registry = _build_handbook_raw_asset_registry()
            _seed_handbook_provider_response(object_store)

            with patch(
                "campus_ingestion_core.campus_services_migration.normalize_handbook_provider_result",
                return_value=_build_handbook_navigation_rows(),
            ):
                report = migrate_campus_services_canonical_to_object_store(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
                        "CAMPUSRAG_CANONICAL_ROOT": str(canonical_root),
                    },
                    object_store=object_store,
                    raw_asset_registry=raw_asset_registry,
                )

        self.assertEqual(report.imported_count, 3)
        self.assertEqual(report.skipped_count, 1)
        self.assertEqual(
            report.imported_object_keys,
            (
                "campus_services/documents/contact_directory/"
                "中央民族大学校内常用电话--bf03f0bd/source-faithful/2018/canonical.md",
                "campus_services/documents/service_catalog/"
                "一网通办服务目录--4122f8f8/source-faithful/2026/canonical.md",
                "campus_services/documents/service_catalog/"
                "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/canonical.md",
            ),
        )
        self.assertEqual(len(object_store.deleted_prefixes), 4)
        self.assertEqual(object_store.deleted_prefixes[0][0], "campus-rag-processed")
        self.assertEqual(object_store.deleted_prefixes[0][1], "campus_services/documents/contact_directory/")
        self.assertEqual(
            object_store.deleted_prefixes[0][2],
            (
                "campus_services/documents/contact_directory/"
                "中央民族大学校内常用电话--bf03f0bd/source-faithful/2018/canonical.md",
            ),
        )
        self.assertEqual(object_store.deleted_prefixes[1][0], "campus-rag-processed")
        self.assertEqual(object_store.deleted_prefixes[1][1], "campus_services/documents/service_catalog/")
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "一网通办服务目录--4122f8f8/source-faithful/2026/canonical.md",
            object_store.deleted_prefixes[1][2],
        )
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/canonical.md",
            object_store.deleted_prefixes[1][2],
        )
        self.assertEqual(object_store.deleted_prefixes[2][0], "campus-rag-processed")
        self.assertEqual(
            object_store.deleted_prefixes[2][1],
            "regulations/documents/student_handbook/中央民族大学校内常用电话--bf03f0bd/",
        )
        self.assertEqual(object_store.deleted_prefixes[2][2], ())
        self.assertEqual(object_store.deleted_prefixes[3][0], "campus-rag-processed")
        self.assertEqual(
            object_store.deleted_prefixes[3][1],
            "regulations/documents/student_handbook/中央民族大学公寓及公费医疗管理规定--66f91543/",
        )
        self.assertEqual(object_store.deleted_prefixes[3][2], ())
        self.assertEqual(
            [(bucket, key, content_type) for bucket, key, _, content_type in object_store.puts],
            [
                (
                    "campus-rag-processed",
                    "campus_services/documents/contact_directory/"
                    "中央民族大学校内常用电话--bf03f0bd/source-faithful/2018/canonical.md",
                    "text/markdown; charset=utf-8",
                ),
                (
                    "campus-rag-processed",
                    "campus_services/documents/service_catalog/"
                    "一网通办服务目录--4122f8f8/source-faithful/2026/canonical.md",
                    "text/markdown; charset=utf-8",
                ),
                (
                    "campus-rag-processed",
                    "campus_services/documents/service_catalog/"
                    "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/canonical.md",
                    "text/markdown; charset=utf-8",
                ),
            ],
        )
        phone_doc = object_store.puts[0][2].decode("utf-8")
        service_doc = object_store.puts[1][2].decode("utf-8")
        handbook_doc = object_store.puts[2][2].decode("utf-8")
        self.assertIn("doc_id: campus_services:contact_directory:bf03f0bd6930e89bcc6d2733c1e87a423b510675", phone_doc)
        self.assertIn("corpus: campus_services", phone_doc)
        self.assertIn("collection: contact_directory", phone_doc)
        self.assertIn("migration_source_corpus: student_handbook", phone_doc)
        self.assertIn(
            "legacy_doc_id: handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",
            phone_doc,
        )
        self.assertIn(
            "doc_id: campus_services:service_catalog:4122f8f863e497f4f21234da1e35dd7693bbc6e9",
            service_doc,
        )
        self.assertIn("corpus: campus_services", service_doc)
        self.assertIn("collection: service_catalog", service_doc)
        self.assertIn("migration_source_corpus: service_portal", service_doc)
        self.assertIn("legacy_doc_id: service_portal:4122f8f863e497f4f21234da1e35dd7693bbc6e9", service_doc)
        self.assertNotIn("\ncorpus: service_portal\n", service_doc)
        self.assertIn(
            "doc_id: campus_services:service_catalog:66f91543748400ae59b3f9265353a0538088028a",
            handbook_doc,
        )
        self.assertIn("title: 中央民族大学学生公寓管理工作流程", handbook_doc)
        self.assertIn("collection: service_catalog", handbook_doc)
        self.assertIn("migration_source_corpus: regulations", handbook_doc)
        self.assertIn("migration_source_collection: student_handbook", handbook_doc)
        self.assertIn(
            "migration_reason: handbook_navigation_document",
            handbook_doc,
        )
        self.assertIn("# 中央民族大学学生公寓管理工作流程", handbook_doc)
        self.assertNotIn("# 中央民族大学公寓及公费医疗管理规定", handbook_doc)


def _build_canonical_fixture(root: Path) -> Path:
    canonical_root = root / "canonical"
    service_portal_docs = canonical_root / "service_portal" / "docs"
    service_portal_manifests = canonical_root / "service_portal" / "manifests"
    handbook_docs = canonical_root / "student_handbook" / "docs"
    service_portal_docs.mkdir(parents=True)
    service_portal_manifests.mkdir(parents=True)
    handbook_docs.mkdir(parents=True)

    (service_portal_docs / "一网通办服务目录.md").write_text(
        "\n".join(
            [
                "# 一网通办服务目录",
                "- schema_version: 1",
                "- doc_id: service_portal:4122f8f863e497f4f21234da1e35dd7693bbc6e9",
                "- corpus: service_portal",
                "- title: 一网通办服务目录",
                "- status: active",
                "- effective_from: 2026-02-10",
                "- source_kind: crawl_internal_auth",
                "- source_url: https://service.muc.edu.cn/v2/site/index",
                "- source_doc: 一网通办",
                "",
                "---",
                "",
                "## 服务分类",
                "",
                "- IT服务",
            ]
        ),
        encoding="utf-8",
    )
    (service_portal_docs / "测试事项3.27.md").write_text(
        "\n".join(
            [
                "---",
                "doc_id: service_portal:84d45452218c46e2b3eb9a91738ce5cd69661a0d",
                "title: 测试事项3.27",
                "effective_from: 2026-03-27",
                "---",
                "# 测试事项3.27",
            ]
        ),
        encoding="utf-8",
    )
    (service_portal_manifests / "docs.jsonl").write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "id": "service_portal:4122f8f863e497f4f21234da1e35dd7693bbc6e9",
                        "path": "docs/一网通办服务目录.md",
                        "sha256": "abc",
                        "updated_at": "2026-03-05T09:29:20Z",
                        "status": "active",
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "id": "service_portal:84d45452218c46e2b3eb9a91738ce5cd69661a0d",
                        "path": "docs/测试事项3.27.md",
                        "sha256": "def",
                        "updated_at": "2026-03-05T09:29:20Z",
                        "status": "retired",
                    },
                    ensure_ascii=False,
                ),
            ]
        ),
        encoding="utf-8",
    )
    (handbook_docs / "中央民族大学校内常用电话.md").write_text(
        "\n".join(
            [
                "---",
                "doc_id: handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",
                "title: '中央民族大学校内常用电话'",
                "source_doc: '学生手册_2018.pdf'",
                "---",
                "# 中央民族大学校内常用电话",
            ]
        ),
        encoding="utf-8",
    )
    return canonical_root


def _build_handbook_raw_asset_registry() -> _FakeRawAssetRegistry:
    return _FakeRawAssetRegistry(
        RawAssetRecord(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:test-handbook-source",
            corpus="regulations",
            collection="student_handbook",
            raw_source_uri="s3://upstream/student-handbook.pdf",
            content_hash="test-handbook-source",
            source_filename="学生手册_2018.pdf",
            object_key="pdf/student-handbook/2018/sha256/test-handbook-source/学生手册_2018.pdf",
            ingestion_timestamp="2026-03-26T09:00:00+00:00",
            import_source="provider_response_replay",
        )
    )


def _seed_handbook_provider_response(object_store: _FakeObjectStore) -> None:
    provider_response_key = build_processed_asset_artifact_key(
        corpus="regulations",
        raw_asset_id="asset:student-handbook-pdf",
        raw_version_id="sha256:test-handbook-source",
        filename="provider-response.jsonl",
        year="2018",
    )
    object_store.objects[("campus-rag-processed", provider_response_key)] = b'{"stub":true}\n'


def _build_handbook_navigation_rows() -> list[dict[str, object]]:
    return [
        _handbook_source_row(
            252,
            "heading",
            "中央民族大学公寓及公费医疗管理规定",
            block_role="title",
            title_candidate_score=1.0,
        ),
        _handbook_source_row(252, "paragraph", "四、住宿中途申请办理退宿流程"),
        _handbook_source_row(253, "paragraph", "1、本科生特殊情况申请办理退宿手续"),
        _handbook_source_row(254, "paragraph", "学生须经学院审批后办理退宿。"),
    ]


def _handbook_source_row(
    page: int,
    row_type: str,
    text: str,
    *,
    block_role: str | None = None,
    title_candidate_score: float = 0.0,
) -> dict[str, object]:
    return {
        "schema_version": "student_handbook_layout_elements_v1",
        "corpus": "regulations",
        "collection": "student_handbook",
        "source_artifact_id": "asset:student-handbook-pdf",
        "source_pdf": "学生手册_2018.pdf",
        "page_start": page,
        "page_end": page,
        "row_id": f"page-{page:04d}-{row_type}",
        "row_index": page,
        "ocr_provider": "paddleocr_async",
        "ocr_model": "PaddleOCR-VL-1.5",
        "provider_page_id": page,
        "provider_block_id": f"block-{page:04d}",
        "provider_payload_ref": f"line:{page}",
        "confidence": 0.98,
        "row_type": row_type,
        "block_role": block_role or row_type,
        "heading_level": 1 if row_type == "heading" else None,
        "reading_order": page,
        "bbox": [0.0, 0.0, 100.0, 20.0],
        "text_raw": text,
        "text_normalized": text,
        "clean_text": text,
        "html": None,
        "table_cells": None,
        "is_blank": False,
        "is_repeated_candidate": False,
        "title_candidate_score": title_candidate_score,
        "section_hint": text if row_type == "heading" else None,
    }


if __name__ == "__main__":
    unittest.main()
