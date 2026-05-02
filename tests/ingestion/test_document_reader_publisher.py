from __future__ import annotations

import json
import unittest
from dataclasses import replace

from campus_ingestion_core.curriculum_course_map_docs_surface import (
    build_curriculum_course_map_docs_surface_object_key,
)
from campus_ingestion_core.document_reader_publisher import publish_document_reader_assets
from campus_ingestion_core.models import DocumentRegistryRecord


class FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = dict(objects)
        self.writes: dict[tuple[str, str], bytes] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self.objects[(bucket, key)]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.writes[(bucket, key)] = data


class DocumentReaderPublisherTest(unittest.TestCase):
    def test_publish_document_reader_assets_writes_assets_and_read_model_manifest(self) -> None:
        public_record = _make_record(
            document_id="curriculum:law-ethnic-class-program",
            title_slug="law-ethnic-class-program",
            visibility_level="public",
            entitlement_groups=(),
        )
        restricted_record = _make_record(
            document_id="curriculum:restricted-program",
            title_slug="restricted-program",
            visibility_level="restricted",
            entitlement_groups=("students",),
        )
        object_store = FakeObjectStore(
            {
                ("campus-rag-derived", public_record.canonical_markdown_object_key or ""): (
                    "# 法学（民族班）培养方案\n\n## 课程设置\n\n第一学期开设法理学。\n"
                ).encode(),
                ("campus-rag-derived", public_record.document_units_object_key or ""): (
                    _document_units_jsonl(public_record, "法学（民族班）培养方案")
                ).encode(),
                ("campus-rag-derived", restricted_record.canonical_markdown_object_key or ""): (
                    "# 受限培养方案\n\n## 内部章节\n\n受限内容。\n"
                ).encode(),
                ("campus-rag-derived", restricted_record.document_units_object_key or ""): (
                    _document_units_jsonl(restricted_record, "受限培养方案")
                ).encode(),
            }
        )

        report = publish_document_reader_assets(
            bucket_derived="campus-rag-derived",
            generated_at="2026-04-27T08:00:00+00:00",
            object_store=object_store,
            records=(public_record, restricted_record),
        )

        self.assertEqual(report.document_count, 2)
        self.assertEqual(report.public_entry_count, 1)
        self.assertEqual(report.gated_entry_count, 1)
        self.assertIn(
            (
                "campus-rag-derived",
                "curriculum/documents/curriculum_plan/"
                "法学-民族班-培养方案--law-ethnic-class-program/"
                "current-effective/2026/reader-assets/reader.json",
            ),
            object_store.writes,
        )
        manifest = report.manifest
        self.assertEqual(manifest["schemaVersion"], "document_reader_publish_manifest_v1")
        self.assertEqual(len(manifest["documents"]), 2)
        self.assertEqual(len(manifest["readerAssets"]), 2)
        self.assertEqual(len(manifest["publicDocsSyncManifest"]["entries"]), 2)

        search_units = manifest["searchUnits"]
        self.assertTrue(search_units[0]["anchor"].startswith("section-"))
        self.assertEqual(search_units[0]["highlightRootUnitIds"], ["root-001", "root-002"])
        self.assertIn("第一学期开设法理学", search_units[0]["snippet"])
        self.assertNotIn("chunk_id", json.dumps(manifest, ensure_ascii=False))

    def test_publish_document_reader_assets_accepts_missing_canonical_key_when_units_exist(
        self,
    ) -> None:
        record = _make_record(
            document_id="curriculum:missing-canonical-key",
            title_slug="missing-canonical-key",
            visibility_level="public",
            entitlement_groups=(),
        )
        record = replace(record, canonical_markdown_object_key=None)
        object_store = FakeObjectStore(
            {
                ("campus-rag-derived", record.document_units_object_key or ""): (
                    _document_units_jsonl(record, "无 canonical key 的培养方案")
                ).encode(),
            }
        )

        report = publish_document_reader_assets(
            bucket_derived="campus-rag-derived",
            generated_at="2026-04-27T08:00:00+00:00",
            object_store=object_store,
            records=(record,),
        )

        self.assertEqual(report.document_count, 1)
        self.assertEqual(report.public_entry_count, 1)
        self.assertEqual(report.gated_entry_count, 0)

    def test_publish_document_reader_assets_fails_fast_on_missing_required_artifacts(self) -> None:
        record = _make_record(
            document_id="curriculum:missing",
            title_slug="missing",
            visibility_level="public",
            entitlement_groups=(),
        )
        missing_units_record = replace(
            record,
            canonical_markdown_object_key=None,
            document_units_object_key=None,
        )

        with self.assertRaisesRegex(ValueError, "missing canonical reader input"):
            publish_document_reader_assets(
                bucket_derived="campus-rag-derived",
                generated_at="2026-04-27T08:00:00+00:00",
                object_store=FakeObjectStore({}),
                records=(missing_units_record,),
            )

    def test_publish_document_reader_assets_rejects_internal_notice_records(self) -> None:
        record = _make_internal_notice_record()
        object_store = FakeObjectStore(
            {
                ("campus-rag-derived", record.canonical_markdown_object_key or ""): (
                    "# 关于修订《中央民族大学采购工作管理办法》的通知\n\n主要修订内容如下。\n"
                ).encode(),
                ("campus-rag-derived", record.document_units_object_key or ""): (
                    _document_units_jsonl(record, "关于修订《中央民族大学采购工作管理办法》的通知")
                ).encode(),
            }
        )

        with self.assertRaisesRegex(
            ValueError,
            "unsupported document reader scope: campus_notices/internal_notice",
        ):
            publish_document_reader_assets(
                bucket_derived="campus-rag-derived",
                generated_at="2026-04-27T08:00:00+00:00",
                object_store=object_store,
                records=(record,),
            )

    def test_publish_document_reader_assets_rejects_scoped_rules_by_default(self) -> None:
        record = _make_scoped_rule_record()
        object_store = FakeObjectStore(
            {
                ("campus-rag-derived", record.canonical_markdown_object_key or ""): (
                    "# 学院招生实施细则\n\n第一条 本细则适用于学院招生。"
                ).encode(),
                ("campus-rag-derived", record.document_units_object_key or ""): (
                    _document_units_jsonl(record, "学院招生实施细则")
                ).encode(),
            }
        )

        with self.assertRaisesRegex(
            ValueError,
            "unsupported document reader scope: regulations/scoped_rules",
        ):
            publish_document_reader_assets(
                bucket_derived="campus-rag-derived",
                generated_at="2026-05-02T00:00:00+00:00",
                object_store=object_store,
                records=(record,),
            )

    def test_publish_document_reader_assets_skips_invalid_course_map_surface(self) -> None:
        record = _make_record(
            document_id="curriculum:invalid-course-map-surface",
            title_slug="invalid-course-map-surface",
            visibility_level="public",
            entitlement_groups=(),
        )
        surface_key = build_curriculum_course_map_docs_surface_object_key(
            record.document_units_object_key or ""
        )
        object_store = FakeObjectStore(
            {
                ("campus-rag-derived", record.canonical_markdown_object_key or ""): (
                    "# 无效课程地图培养方案\n\n## 培养目标\n\n正文。\n"
                ).encode(),
                ("campus-rag-derived", record.document_units_object_key or ""): (
                    _document_units_jsonl(record, "无效课程地图培养方案")
                ).encode(),
                ("campus-rag-derived", surface_key): b'{"blocks":[{"node_id":""}]}',
            }
        )

        report = publish_document_reader_assets(
            bucket_derived="campus-rag-derived",
            generated_at="2026-04-27T08:00:00+00:00",
            object_store=object_store,
            records=(record,),
        )

        self.assertEqual(report.document_count, 1)
        self.assertFalse(any(key.endswith("course-maps.json") for _, key in object_store.writes))


def _make_record(
    *,
    document_id: str,
    title_slug: str,
    visibility_level: str,
    entitlement_groups: tuple[str, ...],
) -> DocumentRegistryRecord:
    docid8 = document_id.split(":", 1)[1][:6]
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=f"ver_{title_slug}",
        source_uri=f"campus-agent://curriculum/curriculum_plan/{document_id}",
        content_hash=f"sha256:{title_slug}",
        corpus="curriculum",
        collection="curriculum_plan",
        entitlement_groups=entitlement_groups,
        visibility_level=visibility_level,
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-04-27T08:00:00+00:00",
        parser_version="mineru_api_v1",
        embedding_model="text-embedding-3-large",
        source_channel="pdf_ocr",
        is_current=True,
        effective_date="2026-02-01",
        published_date="2026-02-15",
        document_units_object_key=(
            f"curriculum/documents/curriculum_plan/{title_slug}--{docid8}/"
            "current-effective/2026/document-units.jsonl"
        ),
        canonical_markdown_object_key=(
            f"curriculum/documents/curriculum_plan/{title_slug}--{docid8}/"
            "current-effective/2026/canonical.md"
        ),
        import_source="raw_online_ocr",
    )


def _make_internal_notice_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="notice:muc_internal_portal:187233",
        revision_track="source-faithful",
        version_id="sha256:187233:source-faithful",
        source_uri="https://portal.example.edu/notices/187233",
        content_hash="sha256:notice-187233",
        corpus="campus_notices",
        collection="internal_notice",
        entitlement_groups=("campus_members",),
        visibility_level="restricted",
        visibility_scope="campus",
        status="active",
        ingestion_timestamp="2026-04-27T08:00:00+00:00",
        parser_version="authenticated_notice_source_projection_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        published_date="2021-02-28",
        document_units_object_key=(
            "campus_notices/documents/internal_notice/187233/document-units.jsonl"
        ),
        canonical_markdown_object_key=(
            "campus_notices/documents/internal_notice/187233/canonical.md"
        ),
        import_source="authenticated_notice_source_projection",
    )


def _make_scoped_rule_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="institutional_regulation:muc:scoped-rule",
        revision_track="current-effective",
        version_id="sha256:scoped-rule:current-effective",
        source_uri="campus-agent://regulations/scoped_rules/scoped-rule",
        content_hash="sha256:scoped-rule",
        corpus="regulations",
        collection="scoped_rules",
        entitlement_groups=("campus_members",),
        visibility_level="restricted",
        visibility_scope="campus",
        status="active",
        ingestion_timestamp="2026-05-02T00:00:00+00:00",
        parser_version="scoped_rules_test",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        published_date="2026-05-01",
        document_units_object_key=(
            "regulations/documents/scoped_rules/scoped-rule/current-effective/2026/"
            "document-units.jsonl"
        ),
        canonical_markdown_object_key=(
            "regulations/documents/scoped_rules/scoped-rule/current-effective/2026/canonical.md"
        ),
        import_source="test",
    )


def _document_units_jsonl(record: DocumentRegistryRecord, title: str) -> str:
    rows = [
        {
            "doc_id": record.document_id,
            "version_id": record.version_id,
            "chunk_id": "chunk-001",
            "root_unit_id": "root-001",
            "unit_type": "heading",
            "text": "第一节",
            "anchor": {"section_path": ["第一节"], "page_start": 1, "page_end": 1},
            "metadata": {"title": title, "heading_level": 2},
        },
        {
            "doc_id": record.document_id,
            "version_id": record.version_id,
            "chunk_id": "chunk-002",
            "root_unit_id": "root-002",
            "unit_type": "paragraph",
            "text": "第一学期开设法理学。",
            "anchor": {"section_path": ["第一节"], "page_start": 1, "page_end": 1},
        },
    ]
    return "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n"


if __name__ == "__main__":
    unittest.main()
