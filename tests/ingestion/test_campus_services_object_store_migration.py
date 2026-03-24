from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.campus_services_migration import (
    build_campus_services_migration_plan,
    migrate_campus_services_canonical_to_object_store,
)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.puts: list[tuple[str, str, bytes, str]] = []
        self.deleted_prefixes: list[tuple[str, str, tuple[str, ...]]] = []

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

            report = migrate_campus_services_canonical_to_object_store(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
                    "CAMPUSRAG_CANONICAL_ROOT": str(canonical_root),
                },
                object_store=object_store,
            )

        self.assertEqual(report.imported_count, 2)
        self.assertEqual(report.skipped_count, 1)
        self.assertEqual(
            report.imported_object_keys,
            (
                "campus_services/documents/contact_directory/"
                "中央民族大学校内常用电话--bf03f0bd/source-faithful/2018/canonical.md",
                "campus_services/documents/service_catalog/"
                "一网通办服务目录--4122f8f8/source-faithful/2026/canonical.md",
            ),
        )
        self.assertEqual(len(object_store.deleted_prefixes), 3)
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
        self.assertEqual(object_store.deleted_prefixes[2][0], "campus-rag-processed")
        self.assertEqual(
            object_store.deleted_prefixes[2][1],
            "regulations/documents/student_handbook/中央民族大学校内常用电话--bf03f0bd/",
        )
        self.assertEqual(object_store.deleted_prefixes[2][2], ())
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
            ],
        )
        phone_doc = object_store.puts[0][2].decode("utf-8")
        service_doc = object_store.puts[1][2].decode("utf-8")
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


if __name__ == "__main__":
    unittest.main()
