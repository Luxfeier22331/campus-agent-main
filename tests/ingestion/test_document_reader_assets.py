from __future__ import annotations

import json
import unittest

from campus_ingestion_core.document_reader_assets import (
    build_document_reader_asset_package,
    build_document_reader_publish_entry,
    build_public_docs_sync_manifest,
)
from campus_ingestion_core.models import DocumentRegistryRecord


def _make_public_curriculum_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="curriculum:law-ethnic-class-program",
        revision_track="current-effective",
        version_id="ver_2026_01",
        source_uri="campus-agent://curriculum/curriculum_plan/docs/curriculum:law-ethnic-class-program",
        content_hash="sha256:test-curriculum-doc",
        corpus="curriculum",
        collection="curriculum_plan",
        cleaning_policy_version="curriculum_plan_cleaning_v1",
        entitlement_groups=(),
        visibility_scope="main",
        visibility_level="public",
        status="active",
        ingestion_timestamp="2026-04-23T08:00:00+00:00",
        parser_version="mineru_api_v1",
        embedding_model="text-embedding-3-large",
        source_channel="pdf_ocr",
        is_current=True,
        effective_date="2026-02-01",
        published_date="2026-02-15",
        document_units_object_key=(
            "curriculum/documents/curriculum_plan/"
            "law-ethnic-class-program--law-ethnic/current-effective/2026/document-units.jsonl"
        ),
        canonical_markdown_object_key=(
            "curriculum/documents/curriculum_plan/"
            "law-ethnic-class-program--law-ethnic/current-effective/2026/canonical.md"
        ),
        import_source="raw_online_ocr",
    )


class DocumentReaderAssetsTest(unittest.TestCase):
    def test_build_document_reader_asset_package_emits_core_assets_and_course_map_supplement(
        self,
    ) -> None:
        record = _make_public_curriculum_record()
        document_units_bytes = (
            "\n".join(
                [
                    json.dumps(
                        {
                            "doc_id": record.document_id,
                            "version_id": record.version_id,
                            "chunk_id": "unit-001",
                            "root_unit_id": "curriculum-root-001",
                            "unit_type": "heading",
                            "clean_text": "第一学期",
                            "anchor": {
                                "section_path": ["课程设置", "第一学期"],
                                "page_start": 1,
                                "page_end": 1,
                            },
                            "metadata": {"heading_level": 2},
                        },
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        {
                            "doc_id": record.document_id,
                            "version_id": record.version_id,
                            "chunk_id": "unit-002",
                            "root_unit_id": "semester-1-course-list",
                            "unit_type": "paragraph",
                            "clean_text": "第一学期开设思想政治理论、大学英语、体育。",
                            "anchor": {
                                "section_path": ["课程设置", "第一学期"],
                                "page_start": 1,
                                "page_end": 1,
                            },
                        },
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        {
                            "doc_id": record.document_id,
                            "version_id": record.version_id,
                            "chunk_id": "unit-003",
                            "root_unit_id": "semester-2-course-list",
                            "unit_type": "paragraph",
                            "clean_text": "第二学期开设法理学、宪法学。",
                            "anchor": {
                                "section_path": ["课程设置", "第二学期"],
                                "page_start": 2,
                                "page_end": 2,
                            },
                        },
                        ensure_ascii=False,
                    ),
                ]
            )
            + "\n"
        ).encode("utf-8")
        canonical_markdown_bytes = (
            "# 法学（民族班）培养方案\n\n"
            "## 课程设置\n\n"
            "### 第一学期\n\n"
            "第一学期开设思想政治理论、大学英语、体育。\n\n"
            "### 第二学期\n\n"
            "第二学期开设法理学、宪法学。\n"
        ).encode()
        course_maps_bytes = (
            "{\n"
            '  "schemaVersion": "curriculum_course_map_docs_surface_v2",\n'
            '  "generatedAt": "2026-04-23T08:00:00+00:00",\n'
            '  "documentId": "curriculum:law-ethnic-class-program",\n'
            '  "documentTitle": "法学（民族班）培养方案",\n'
            '  "rawAssetId": "asset:curriculum-plan-2026",\n'
            '  "rawVersionId": "sha256:course-map",\n'
            '  "blocks": [\n'
            "    {\n"
            '      "blockId": "page-0349-row-01-map-01",\n'
            '      "pageNumber": 349,\n'
            '      "rowId": "page-0349-row-01",\n'
            '      "mapIndex": 1,\n'
            '      "title": "课程地图",\n'
            '      "status": "ready",\n'
            '      "titleConfidence": "visible",\n'
            '      "parentHeadingHint": "六、课程地图",\n'
            '      "displayStageLabels": ["第一学期"],\n'
            '      "nodes": [\n'
            '        {"node_id": "node-legal-theory", "node_label": "法理学", "stage_id": "stage-1", "stage_label": "第一学期", "category_label": ""},\n'
            '        {"node_id": "node-constitution", "node_label": "宪法学", "stage_id": "stage-1", "stage_label": "第一学期", "category_label": ""}\n'
            "      ],\n"
            '      "edges": [{"edge_id": "edge-legal-constitution", "source_node_id": "node-legal-theory", "source_label": "法理学", "target_node_id": "node-constitution", "target_label": "宪法学"}],\n'
            '      "extractionNotes": ["自动抽取通过"],\n'
            '      "imageObjectKey": "curriculum/documents/curriculum_plan/law-ethnic-class-program--law-ethnic/current-effective/2026/reader-assets/course-maps/page-0349-row-01-map-01.png",\n'
            '      "regionBBoxProvider": [10, 20, 30, 40]\n'
            "    }\n"
            "  ]\n"
            "}\n"
        ).encode()

        package = build_document_reader_asset_package(
            record=record,
            canonical_markdown_bytes=canonical_markdown_bytes,
            document_units_bytes=document_units_bytes,
            course_maps_bytes=course_maps_bytes,
            course_map_image_objects={
                "curriculum/documents/curriculum_plan/law-ethnic-class-program--law-ethnic/current-effective/2026/reader-assets/course-maps/page-0349-row-01-map-01.png": b"course-map-image",
            },
        )

        self.assertEqual(
            set(package.assets.keys()),
            {
                "asset-manifest.json",
                "course-maps/page-0349-row-01-map-01.png",
                "course-maps.json",
                "meta.json",
                "outline.json",
                "reader.json",
            },
        )

        reader_payload = json.loads(package.assets["reader.json"].decode("utf-8"))
        self.assertEqual(reader_payload["document"]["docId"], record.document_id)
        self.assertEqual(reader_payload["document"]["documentSlug"], "law-ethnic-class-program")
        self.assertEqual(
            reader_payload["sections"][0]["anchor"],
            "section-b57a3af59c/section-5e7417834c",
        )
        self.assertEqual(
            reader_payload["sections"][0]["blocks"][1]["rootUnitId"],
            "semester-1-course-list",
        )
        self.assertEqual(
            reader_payload["sections"][0]["blocks"][1]["text"],
            "第一学期开设思想政治理论、大学英语、体育。",
        )
        self.assertEqual(
            reader_payload["supplements"],
            [{"kind": "course_maps", "path": "course-maps.json"}],
        )

        course_map_payload = json.loads(package.assets["course-maps.json"].decode("utf-8"))
        self.assertEqual(course_map_payload["versionId"], "ver_2026_01")
        self.assertEqual(
            course_map_payload["blocks"][0]["imagePath"], "course-maps/page-0349-row-01-map-01.png"
        )
        self.assertEqual(course_map_payload["blocks"][0]["nodes"][0]["nodeId"], "node-legal-theory")
        self.assertEqual(course_map_payload["blocks"][0]["nodes"][0]["stageId"], "stage-1")
        self.assertEqual(
            course_map_payload["blocks"][0]["edges"][0]["edgeId"],
            "edge-legal-constitution",
        )
        self.assertEqual(
            course_map_payload["blocks"][0]["edges"][0]["sourceNodeId"],
            "node-legal-theory",
        )
        self.assertEqual(
            course_map_payload["blocks"][0]["edges"][0]["targetNodeId"],
            "node-constitution",
        )
        self.assertNotIn("imageObjectKey", course_map_payload["blocks"][0])
        self.assertEqual(
            package.assets["course-maps/page-0349-row-01-map-01.png"],
            b"course-map-image",
        )

        outline_payload = json.loads(package.assets["outline.json"].decode("utf-8"))
        self.assertEqual(
            outline_payload["nodes"],
            [
                {
                    "anchor": "section-b57a3af59c",
                    "depth": 1,
                    "order": 1,
                    "parentAnchor": None,
                    "title": "课程设置",
                },
                {
                    "anchor": "section-b57a3af59c/section-5e7417834c",
                    "depth": 2,
                    "order": 2,
                    "parentAnchor": "section-b57a3af59c",
                    "title": "第一学期",
                },
                {
                    "anchor": "section-b57a3af59c/section-874265e06a",
                    "depth": 2,
                    "order": 3,
                    "parentAnchor": "section-b57a3af59c",
                    "title": "第二学期",
                },
            ],
        )

        meta_payload = json.loads(package.assets["meta.json"].decode("utf-8"))
        self.assertEqual(
            meta_payload["canonicalUrl"],
            "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
        )
        self.assertEqual(meta_payload["resolvedVersion"]["versionSlug"], "2026-current")

        manifest_payload = json.loads(package.assets["asset-manifest.json"].decode("utf-8"))
        self.assertEqual(
            manifest_payload["files"]["course-maps.json"]["contentType"], "application/json"
        )
        self.assertEqual(
            manifest_payload["files"]["course-maps/page-0349-row-01-map-01.png"]["contentType"],
            "image/png",
        )
        self.assertEqual(
            manifest_payload["readerTarget"],
            {
                "anchor": None,
                "canonicalUrl": "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
                "docId": record.document_id,
                "highlightRootUnitIds": [],
                "versionId": record.version_id,
            },
        )

    def test_build_document_reader_asset_package_excludes_table_units_from_reader_blocks(
        self,
    ) -> None:
        record = _make_public_curriculum_record()
        html_table = (
            '<table><tr><td rowspan="2">比赛项目</td><td colspan="2">评分标准</td></tr>'
            "<tr><td>第一名</td><td>第二名</td></tr>"
            "<tr><td>全国大学生运动会</td><td>20分</td><td>15分</td></tr></table>"
        )
        pipe_table = (
            "比赛项目 | 评分标准 / 第一名 | 评分标准 / 第二名\n"
            "全国大学生运动会 | 20分 | 15分"
        )
        document_units_bytes = (
            "\n".join(
                [
                    json.dumps(
                        {
                            "doc_id": record.document_id,
                            "version_id": record.version_id,
                            "chunk_id": "table-0001",
                            "root_unit_id": "table-0001",
                            "unit_type": "table",
                            "clean_text": html_table,
                            "anchor": {
                                "section_path": ["竞赛成绩"],
                                "page_start": 1,
                                "page_end": 1,
                            },
                        },
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        {
                            "doc_id": record.document_id,
                            "version_id": record.version_id,
                            "chunk_id": "table-0001-unit",
                            "root_unit_id": "table-0001",
                            "unit_type": "table_unit",
                            "clean_text": pipe_table,
                            "anchor": {
                                "section_path": ["竞赛成绩"],
                                "page_start": 1,
                                "page_end": 1,
                            },
                        },
                        ensure_ascii=False,
                    ),
                ]
            )
            + "\n"
        ).encode("utf-8")

        package = build_document_reader_asset_package(
            record=record,
            canonical_markdown_bytes="# 竞赛成绩\n\n[表格]\n".encode(),
            document_units_bytes=document_units_bytes,
        )

        reader_payload = json.loads(package.assets["reader.json"].decode("utf-8"))
        blocks = reader_payload["sections"][0]["blocks"]

        self.assertEqual([block["rootUnitId"] for block in blocks], ["table-0001"])
        self.assertEqual(blocks[0]["kind"], "table")
        self.assertEqual(blocks[0]["text"], html_table)
        self.assertNotIn(pipe_table, json.dumps(reader_payload, ensure_ascii=False))

    def test_build_document_reader_publish_entry_marks_public_static_delivery(self) -> None:
        record = _make_public_curriculum_record()

        entry = build_document_reader_publish_entry(
            record=record,
            title="法学（民族班）培养方案",
            published_asset_names=(
                "reader.json",
                "outline.json",
                "meta.json",
                "asset-manifest.json",
                "course-maps.json",
                "course-maps/page-0349-row-01-map-01.png",
            ),
        )

        self.assertEqual(entry["deliveryMode"], "public_static_asset")
        self.assertEqual(entry["documentSlug"], "law-ethnic-class-program")
        self.assertEqual(entry["versionSlug"], "2026-current")
        self.assertEqual(
            entry["sourceObjects"],
            {
                "manifest": (
                    "curriculum/documents/curriculum_plan/"
                    "法学-民族班-培养方案--law-ethnic-class-program/current-effective/2026/"
                    "reader-assets/asset-manifest.json"
                ),
                "meta": (
                    "curriculum/documents/curriculum_plan/"
                    "法学-民族班-培养方案--law-ethnic-class-program/current-effective/2026/"
                    "reader-assets/meta.json"
                ),
                "outline": (
                    "curriculum/documents/curriculum_plan/"
                    "法学-民族班-培养方案--law-ethnic-class-program/current-effective/2026/"
                    "reader-assets/outline.json"
                ),
                "reader": (
                    "curriculum/documents/curriculum_plan/"
                    "法学-民族班-培养方案--law-ethnic-class-program/current-effective/2026/"
                    "reader-assets/reader.json"
                ),
                "supplement.course-maps.json": (
                    "curriculum/documents/curriculum_plan/"
                    "法学-民族班-培养方案--law-ethnic-class-program/current-effective/2026/"
                    "reader-assets/course-maps.json"
                ),
                "supplement.course-maps/page-0349-row-01-map-01.png": (
                    "curriculum/documents/curriculum_plan/"
                    "法学-民族班-培养方案--law-ethnic-class-program/current-effective/2026/"
                    "reader-assets/course-maps/page-0349-row-01-map-01.png"
                ),
            },
        )
        self.assertEqual(
            entry["targetObjects"],
            {
                "asset-manifest": "_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/asset-manifest.json",
                "course-maps.json": "_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/course-maps.json",
                "course-maps/page-0349-row-01-map-01.png": (
                    "_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/course-maps/page-0349-row-01-map-01.png"
                ),
                "meta": "_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/meta.json",
                "outline": "_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/outline.json",
                "reader": "_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/reader.json",
            },
        )

    def test_build_document_reader_publish_entry_marks_gated_static_delivery(self) -> None:
        restricted_record = DocumentRegistryRecord(
            document_id="curriculum:restricted-program",
            revision_track="current-effective",
            version_id="ver_2026_restricted",
            source_uri="campus-agent://curriculum/curriculum_plan/docs/curriculum:restricted-program",
            content_hash="sha256:restricted",
            corpus="curriculum",
            collection="curriculum_plan",
            cleaning_policy_version="curriculum_plan_cleaning_v1",
            entitlement_groups=("students",),
            visibility_scope="main",
            visibility_level="restricted",
            status="active",
            ingestion_timestamp="2026-04-23T08:00:00+00:00",
            parser_version="mineru_api_v1",
            embedding_model="text-embedding-3-large",
            source_channel="pdf_ocr",
            is_current=True,
            effective_date="2026-02-01",
            published_date="2026-02-15",
            document_units_object_key=(
                "curriculum/documents/curriculum_plan/"
                "restricted-program--restricted/current-effective/2026/document-units.jsonl"
            ),
            canonical_markdown_object_key=(
                "curriculum/documents/curriculum_plan/"
                "restricted-program--restricted/current-effective/2026/canonical.md"
            ),
            import_source="raw_online_ocr",
        )
        entry = build_document_reader_publish_entry(
            record=restricted_record,
            title="受限培养方案",
        )

        self.assertEqual(entry["deliveryMode"], "gated_asset")
        self.assertEqual(
            entry["targetObjects"]["reader"],
            "_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/reader.json",
        )

    def test_regulation_reader_entry_keeps_document_slug_separate_from_revision_version(
        self,
    ) -> None:
        record = DocumentRegistryRecord(
            document_id="institutional_regulation:muc:中央民族大学采购工作管理办法:219ecb636aaf",
            revision_track="source-faithful",
            version_id="sha256:c55cc6f8:effective-2021年3月1日:revision-修订",
            source_uri="campusrag://promotion/internal_notice/187233",
            content_hash="sha256:test-regulation",
            corpus="regulations",
            collection="institutional_rules",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            entitlement_groups=("campus_members",),
            visibility_scope="campus",
            visibility_level="restricted",
            status="active",
            ingestion_timestamp="2026-04-27T23:54:52+00:00",
            parser_version="internal_notice_regulation_materialization_v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="manual_curated",
            is_current=True,
            effective_date="2021年3月1日",
            published_date="2021-02-28",
            document_units_object_key=(
                "regulations/documents/institutional_rules/"
                "中央民族大学采购工作管理办法--219ecb63/source-faithful/2021/"
                "document-units.jsonl"
            ),
            canonical_markdown_object_key=(
                "regulations/documents/institutional_rules/"
                "中央民族大学采购工作管理办法--219ecb63/source-faithful/2021/"
                "canonical.md"
            ),
            import_source="internal_notice_regulation_materialization",
        )

        entry = build_document_reader_publish_entry(
            record=record,
            title="中央民族大学采购工作管理办法",
        )

        self.assertEqual(entry["documentSlug"], "中央民族大学采购工作管理办法")
        self.assertEqual(entry["versionSlug"], "effective-2021-03-01")
        self.assertEqual(
            entry["canonicalUrl"],
            "/docs/regulations/institutional_rules/中央民族大学采购工作管理办法",
        )
        self.assertEqual(
            entry["targetObjects"]["reader"],
            "_gated-docs/regulations/institutional_rules/"
            "中央民族大学采购工作管理办法/effective-2021-03-01/reader.json",
        )
        self.assertNotIn("2021年修订", "\n".join(entry["targetObjects"].values()))

    def test_build_public_docs_sync_manifest_keeps_public_and_gated_entries(self) -> None:
        public_entry = build_document_reader_publish_entry(
            record=_make_public_curriculum_record(),
            title="法学（民族班）培养方案",
        )
        restricted_record = DocumentRegistryRecord(
            document_id="curriculum:restricted-program",
            revision_track="current-effective",
            version_id="ver_2026_restricted",
            source_uri="campus-agent://curriculum/curriculum_plan/docs/curriculum:restricted-program",
            content_hash="sha256:restricted",
            corpus="curriculum",
            collection="curriculum_plan",
            cleaning_policy_version="curriculum_plan_cleaning_v1",
            entitlement_groups=("students",),
            visibility_scope="main",
            visibility_level="restricted",
            status="active",
            ingestion_timestamp="2026-04-23T08:00:00+00:00",
            parser_version="mineru_api_v1",
            embedding_model="text-embedding-3-large",
            source_channel="pdf_ocr",
            is_current=True,
            effective_date="2026-02-01",
            published_date="2026-02-15",
            document_units_object_key=(
                "curriculum/documents/curriculum_plan/"
                "restricted-program--restricted/current-effective/2026/document-units.jsonl"
            ),
            canonical_markdown_object_key=(
                "curriculum/documents/curriculum_plan/"
                "restricted-program--restricted/current-effective/2026/canonical.md"
            ),
            import_source="raw_online_ocr",
        )
        restricted_entry = build_document_reader_publish_entry(
            record=restricted_record,
            title="受限培养方案",
        )

        manifest = build_public_docs_sync_manifest(
            entries=[public_entry, restricted_entry],
            generated_at="2026-04-23T08:30:00+00:00",
        )

        self.assertEqual(manifest["surface"], "public_docs")
        self.assertEqual(manifest["generatedAt"], "2026-04-23T08:30:00+00:00")
        self.assertEqual(manifest["entries"], [public_entry, restricted_entry])


if __name__ == "__main__":
    unittest.main()
