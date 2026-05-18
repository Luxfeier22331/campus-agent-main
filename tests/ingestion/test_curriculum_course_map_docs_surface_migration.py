from __future__ import annotations

import json
import unittest

from campus_ingestion_core.curriculum_course_map_docs_surface import (
    build_curriculum_course_map_docs_surface_object_key,
    load_curriculum_course_map_docs_surface,
)
from campus_ingestion_core.curriculum_course_map_docs_surface_migration import (
    migrate_legacy_curriculum_course_map_docs_surfaces,
)


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = dict(objects)
        self.writes: dict[tuple[str, str], bytes] = {}

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        return tuple(
            key
            for object_bucket, key in self.objects
            if object_bucket == bucket and key.startswith(prefix)
        )

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self.objects[(bucket, key)]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.writes[(bucket, key)] = data
        self.objects[(bucket, key)] = data


class CurriculumCourseMapDocsSurfaceMigrationTest(unittest.TestCase):
    def test_migrates_docs_surface_v1_into_non_reader_source_surface(self) -> None:
        document_units_key = (
            "curriculum/documents/curriculum_plan/example/source-faithful/2022/document-units.jsonl"
        )
        legacy_surface_key = document_units_key.replace(
            "document-units.jsonl", "reader-assets/course-maps.json"
        )
        legacy_image_key = document_units_key.replace(
            "document-units.jsonl", "reader-assets/course-maps/page-0001-row-01-map-01.png"
        )
        object_store = _FakeObjectStore(
            {
                ("campus-rag-derived", legacy_surface_key): json.dumps(
                    {
                        "schemaVersion": "curriculum_course_map_docs_surface_v1",
                        "generatedAt": "2026-04-22T00:00:00+00:00",
                        "documentId": "curriculum:example",
                        "documentTitle": "示例培养方案",
                        "rawAssetId": "asset:curriculum-plan-2022",
                        "rawVersionId": "sha256:legacy",
                        "blocks": [
                            {
                                "blockId": "page-0001-row-01-map-01",
                                "pageNumber": 1,
                                "rowId": "page-0001-row-01",
                                "mapIndex": 1,
                                "title": "课程地图",
                                "status": "ready",
                                "titleConfidence": "visible",
                                "parentHeadingHint": "六、课程地图",
                                "displayStageLabels": ["一年级"],
                                "nodes": [
                                    {
                                        "node_label": "程序设计基础",
                                        "stage_label": "一年级",
                                        "category_label": "专业基础课",
                                    },
                                    {
                                        "node_label": "数据结构",
                                        "stage_label": "二年级",
                                        "category_label": "专业核心课",
                                    },
                                ],
                                "edges": [
                                    {
                                        "source_label": "程序设计基础",
                                        "target_label": "数据结构",
                                    }
                                ],
                                "extractionNotes": [],
                                "imageObjectKey": legacy_image_key,
                                "regionBBoxProvider": [1, 2, 3, 4],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ).encode("utf-8"),
                ("campus-rag-derived", legacy_image_key): b"legacy-image",
            }
        )

        report = migrate_legacy_curriculum_course_map_docs_surfaces(
            bucket="campus-rag-derived",
            generated_at="2026-05-18T00:00:00+00:00",
            object_store=object_store,
            legacy_surface_keys=(legacy_surface_key,),
        )

        surface_key = build_curriculum_course_map_docs_surface_object_key(document_units_key)
        self.assertEqual(report.migrated_surface_count, 1)
        self.assertIn(("campus-rag-derived", surface_key), object_store.writes)
        surface = load_curriculum_course_map_docs_surface(
            object_store.writes[("campus-rag-derived", surface_key)]
        )
        self.assertEqual(surface.schema_version, "curriculum_course_map_docs_surface_v2")
        self.assertEqual(surface.blocks[0].nodes[0].node_label, "程序设计基础")
        self.assertTrue(surface.blocks[0].nodes[0].node_id.startswith("node-"))
        self.assertEqual(len(surface.blocks[0].edges), 1)
        self.assertTrue(surface.blocks[0].edges[0].edge_id.startswith("edge-"))
        self.assertIn(
            ("campus-rag-derived", surface.blocks[0].image_object_key), object_store.writes
        )
        self.assertIn("/docs-surfaces/course-maps/", surface.blocks[0].image_object_key)
        self.assertNotIn("/reader-assets/", surface.blocks[0].image_object_key)

    def test_migrates_reader_v1_relative_images_and_preserves_existing_ids(self) -> None:
        document_units_key = (
            "curriculum/documents/curriculum_plan/example/source-faithful/2022/document-units.jsonl"
        )
        legacy_surface_key = document_units_key.replace(
            "document-units.jsonl", "reader-assets/course-maps.json"
        )
        legacy_image_key = document_units_key.replace(
            "document-units.jsonl", "reader-assets/course-maps/map-01.png"
        )
        object_store = _FakeObjectStore(
            {
                ("campus-rag-derived", legacy_surface_key): json.dumps(
                    {
                        "schemaVersion": "curriculum_course_maps_reader_v1",
                        "docId": "curriculum:example",
                        "versionId": "sha256:published-reader-version",
                        "blocks": [
                            {
                                "blockId": "page-0001-row-01-map-01",
                                "pageNumber": 1,
                                "rowId": "page-0001-row-01",
                                "mapIndex": 1,
                                "title": "课程地图",
                                "status": "ready",
                                "titleConfidence": "visible",
                                "parentHeadingHint": "六、课程地图",
                                "displayStageLabels": ["一年级"],
                                "nodes": [
                                    {
                                        "nodeId": "n01",
                                        "nodeLabel": "程序设计基础",
                                        "stageId": "s01",
                                        "stageLabel": "一年级",
                                        "categoryLabel": "专业基础课",
                                    }
                                ],
                                "edges": [],
                                "extractionNotes": [],
                                "imagePath": "course-maps/map-01.png",
                                "regionBBoxProvider": [1, 2, 3, 4],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ).encode("utf-8"),
                ("campus-rag-derived", legacy_image_key): b"legacy-image",
            }
        )

        migrate_legacy_curriculum_course_map_docs_surfaces(
            bucket="campus-rag-derived",
            generated_at="2026-05-18T00:00:00+00:00",
            object_store=object_store,
            legacy_surface_keys=(legacy_surface_key,),
        )

        surface_key = build_curriculum_course_map_docs_surface_object_key(document_units_key)
        surface = load_curriculum_course_map_docs_surface(
            object_store.writes[("campus-rag-derived", surface_key)]
        )
        self.assertEqual(surface.document_title, "example")
        self.assertEqual(surface.raw_asset_id, "asset:curriculum-plan-2022")
        self.assertEqual(surface.blocks[0].nodes[0].node_id, "n01")
        self.assertEqual(surface.blocks[0].nodes[0].stage_id, "s01")
        self.assertEqual(
            object_store.writes[("campus-rag-derived", surface.blocks[0].image_object_key)],
            b"legacy-image",
        )


if __name__ == "__main__":
    unittest.main()
