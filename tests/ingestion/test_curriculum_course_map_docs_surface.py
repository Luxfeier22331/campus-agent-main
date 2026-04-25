from __future__ import annotations

import unittest
from unittest.mock import patch

from tests.ingestion._curriculum_course_map_probe_test_support import (
    load_curriculum_course_map_docs_surface_module,
    load_curriculum_course_map_probe_module,
)

_docs_surface_module = load_curriculum_course_map_docs_surface_module()
_probe_module = load_curriculum_course_map_probe_module()

CourseMapFinding = _probe_module.CourseMapFinding
CourseMapEdge = _probe_module.CourseMapEdge
CourseMapNode = _probe_module.CourseMapNode
CurriculumCourseMapPageProbe = _probe_module.CurriculumCourseMapPageProbe
CurriculumCourseMapRenderedSample = _probe_module.CurriculumCourseMapRenderedSample
DetectedCourseMapRegion = _probe_module.DetectedCourseMapRegion

build_curriculum_course_map_docs_image_object_key = (
    _docs_surface_module.build_curriculum_course_map_docs_image_object_key
)
build_curriculum_course_map_docs_surface_artifact = (
    _docs_surface_module.build_curriculum_course_map_docs_surface_artifact
)
build_curriculum_course_map_docs_surface_object_key = (
    _docs_surface_module.build_curriculum_course_map_docs_surface_object_key
)
load_curriculum_course_map_docs_surface = (
    _docs_surface_module.load_curriculum_course_map_docs_surface
)
serialize_curriculum_course_map_docs_surface = (
    _docs_surface_module.serialize_curriculum_course_map_docs_surface
)
_purge_course_map_docs_surface_assets = _docs_surface_module._purge_course_map_docs_surface_assets


class _RecordingObjectStore:
    def __init__(self) -> None:
        self.deleted_prefixes: list[tuple[str, str]] = []

    def delete_prefix(
        self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()
    ) -> None:
        if exclude_keys:
            raise AssertionError("course-map purge should not need exclude_keys")
        self.deleted_prefixes.append((bucket, prefix))


class CurriculumCourseMapDocsSurfaceTest(unittest.TestCase):
    def test_build_surface_object_key_uses_reader_assets_sibling(self) -> None:
        key = build_curriculum_course_map_docs_surface_object_key(
            "curriculum/documents/curriculum_plan/example/current-effective/2022/document-units.jsonl"
        )

        self.assertEqual(
            key,
            "curriculum/documents/curriculum_plan/example/current-effective/2022/reader-assets/course-maps.json",
        )

    def test_build_surface_artifact_publishes_ready_partial_and_failed_blocks(self) -> None:
        rendered_sample = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p0513-row-1",
            page_number=513,
            document_id="curriculum:test",
            document_title="示例培养方案",
            row_id="page-0513-block-2-0003",
            parent_heading_hint="六、课程地图",
            provider_bbox=(100.0, 200.0, 900.0, 1000.0),
            provider_canvas=(1200.0, 1600.0),
            pdf_bbox=(50.0, 80.0, 450.0, 480.0),
            full_page_png=b"full-page-png",
            crop_png=b"crop-png",
        )
        page_probe = CurriculumCourseMapPageProbe(
            sample_id=rendered_sample.sample_id,
            page_number=513,
            document_id="curriculum:test",
            document_title="示例培养方案",
            parent_heading_hint="六、课程地图",
            detected_maps=(
                DetectedCourseMapRegion(
                    map_index=1,
                    map_title="主图",
                    title_confidence="visible",
                    region_bbox_normalized=(0.0, 0.0, 0.5, 0.5),
                    region_bbox_pdf=(1.0, 2.0, 3.0, 4.0),
                    region_bbox_provider=(10.0, 20.0, 30.0, 40.0),
                    manual_review_notes=(),
                ),
                DetectedCourseMapRegion(
                    map_index=2,
                    map_title=None,
                    title_confidence="partial",
                    region_bbox_normalized=(0.5, 0.0, 1.0, 0.5),
                    region_bbox_pdf=(5.0, 6.0, 7.0, 8.0),
                    region_bbox_provider=(50.0, 60.0, 70.0, 80.0),
                    manual_review_notes=("标题不清晰",),
                ),
                DetectedCourseMapRegion(
                    map_index=3,
                    map_title=None,
                    title_confidence="absent",
                    region_bbox_normalized=(0.0, 0.5, 1.0, 1.0),
                    region_bbox_pdf=(9.0, 10.0, 11.0, 12.0),
                    region_bbox_provider=(90.0, 100.0, 110.0, 120.0),
                    manual_review_notes=(
                        "Image 2 shows one complete course-map diagram spanning the full crop, composed of four grade columns connected by arrows.",
                    ),
                ),
            ),
            course_maps=(
                CourseMapFinding(
                    map_index=1,
                    map_title="主图",
                    stage_labels=("一年级上学期",),
                    nodes=(CourseMapNode(node_label="法学导论", stage_label="一年级上学期"),),
                    edges=(),
                    manual_review_notes=(),
                ),
                CourseMapFinding(
                    map_index=2,
                    map_title=None,
                    stage_labels=("二年级上学期",),
                    nodes=(CourseMapNode(node_label="刑法总论", stage_label="二年级上学期"),),
                    edges=(),
                    manual_review_notes=(
                        "存在少量遮挡",
                        "at least one detected map region does not have a clearly visible title",
                    ),
                ),
            ),
            manual_review_required=True,
            global_manual_review_notes=("本页含自动抽取波动",),
        )
        surface_key = build_curriculum_course_map_docs_surface_object_key(
            "curriculum/documents/curriculum_plan/example/current-effective/2022/document-units.jsonl"
        )

        with patch.object(
            _docs_surface_module,
            "_build_rendered_region",
            side_effect=(
                _probe_module.CurriculumCourseMapRenderedRegion(
                    detected_region=page_probe.detected_maps[0],
                    crop_png=b"map-01",
                    tile_pngs=(),
                ),
                _probe_module.CurriculumCourseMapRenderedRegion(
                    detected_region=page_probe.detected_maps[1],
                    crop_png=b"map-02",
                    tile_pngs=(),
                ),
                _probe_module.CurriculumCourseMapRenderedRegion(
                    detected_region=page_probe.detected_maps[2],
                    crop_png=b"map-03",
                    tile_pngs=(),
                ),
            ),
        ):
            artifact = build_curriculum_course_map_docs_surface_artifact(
                document_id="curriculum:test",
                document_title="示例培养方案",
                raw_asset_id="asset:test",
                raw_version_id="sha256:test",
                page_probes=(page_probe,),
                rendered_samples={rendered_sample.sample_id: rendered_sample},
                surface_object_key=surface_key,
                generated_at="2026-04-22T12:00:00+00:00",
            )

        blocks = artifact.surface.blocks
        self.assertEqual(artifact.surface.schema_version, "curriculum_course_map_docs_surface_v2")
        self.assertEqual([block.status for block in blocks], ["partial", "partial", "failed"])
        self.assertEqual(blocks[0].title, "主图")
        self.assertEqual(blocks[1].title, "六、课程地图")
        self.assertEqual(blocks[2].title, "六、课程地图")
        self.assertIn("标题不清晰", blocks[1].extraction_notes)
        self.assertIn("至少有一个检测到的课程地图区域标题不够清晰。", blocks[1].extraction_notes)
        self.assertNotIn(
            "at least one detected map region does not have a clearly visible title",
            blocks[1].extraction_notes,
        )
        self.assertIn(
            "当前裁切区域仅识别到 1 张完整课程地图，未拆分出更多独立子图。",
            blocks[2].extraction_notes,
        )
        self.assertIn("自动抽取未返回可发布的课程节点", blocks[2].extraction_notes[-1])
        self.assertEqual(
            blocks[0].image_object_key,
            build_curriculum_course_map_docs_image_object_key(
                surface_object_key=surface_key,
                block_id=blocks[0].block_id,
            ),
        )
        self.assertEqual(
            [item.image_bytes for item in artifact.image_objects], [b"map-01", b"map-02", b"map-03"]
        )

        roundtrip = load_curriculum_course_map_docs_surface(
            serialize_curriculum_course_map_docs_surface(artifact.surface)
        )
        self.assertEqual(roundtrip.document_id, "curriculum:test")
        self.assertEqual(len(roundtrip.blocks), 3)
        self.assertTrue(roundtrip.blocks[0].nodes[0].node_id.startswith("node-"))
        self.assertTrue(roundtrip.blocks[0].nodes[0].stage_id.startswith("stage-"))

    def test_build_surface_artifact_keeps_id_edges_and_drops_ambiguous_label_edges(
        self,
    ) -> None:
        rendered_sample = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p0513-row-1",
            page_number=513,
            document_id="curriculum:test",
            document_title="示例培养方案",
            row_id="page-0513-block-2-0003",
            parent_heading_hint="六、课程地图",
            provider_bbox=(100.0, 200.0, 900.0, 1000.0),
            provider_canvas=(1200.0, 1600.0),
            pdf_bbox=(50.0, 80.0, 450.0, 480.0),
            full_page_png=b"full-page-png",
            crop_png=b"crop-png",
        )
        page_probe = CurriculumCourseMapPageProbe(
            sample_id=rendered_sample.sample_id,
            page_number=513,
            document_id="curriculum:test",
            document_title="示例培养方案",
            parent_heading_hint="六、课程地图",
            detected_maps=(
                DetectedCourseMapRegion(
                    map_index=1,
                    map_title="主图",
                    title_confidence="visible",
                    region_bbox_normalized=(0.0, 0.0, 1.0, 1.0),
                    region_bbox_pdf=(1.0, 2.0, 3.0, 4.0),
                    region_bbox_provider=(10.0, 20.0, 30.0, 40.0),
                    manual_review_notes=(),
                ),
            ),
            course_maps=(
                CourseMapFinding(
                    map_index=1,
                    map_title="主图",
                    stage_labels=("一年级", "二年级"),
                    nodes=(
                        CourseMapNode(
                            node_id="node-programming",
                            node_label="程序设计基础",
                            stage_id="stage-1",
                            stage_label="一年级",
                        ),
                        CourseMapNode(
                            node_id="node-elective-1",
                            node_label="选修模块",
                            stage_id="stage-1",
                            stage_label="一年级",
                        ),
                        CourseMapNode(
                            node_id="node-elective-2",
                            node_label="选修模块",
                            stage_id="stage-2",
                            stage_label="二年级",
                        ),
                        CourseMapNode(
                            node_id="node-thesis",
                            node_label="毕业论文",
                            stage_id="stage-2",
                            stage_label="二年级",
                        ),
                    ),
                    edges=(
                        CourseMapEdge(
                            edge_id="edge-programming-elective",
                            source_node_id="node-programming",
                            source_label="程序设计基础",
                            target_node_id="node-elective-2",
                            target_label="选修模块",
                        ),
                        CourseMapEdge(source_label="选修模块", target_label="毕业论文"),
                    ),
                    manual_review_notes=(),
                ),
            ),
            manual_review_required=False,
            global_manual_review_notes=(),
        )
        surface_key = build_curriculum_course_map_docs_surface_object_key(
            "curriculum/documents/curriculum_plan/example/current-effective/2022/document-units.jsonl"
        )

        with patch.object(
            _docs_surface_module,
            "_build_rendered_region",
            return_value=_probe_module.CurriculumCourseMapRenderedRegion(
                detected_region=page_probe.detected_maps[0],
                crop_png=b"map-01",
                tile_pngs=(),
            ),
        ):
            artifact = build_curriculum_course_map_docs_surface_artifact(
                document_id="curriculum:test",
                document_title="示例培养方案",
                raw_asset_id="asset:test",
                raw_version_id="sha256:test",
                page_probes=(page_probe,),
                rendered_samples={rendered_sample.sample_id: rendered_sample},
                surface_object_key=surface_key,
                generated_at="2026-04-22T12:00:00+00:00",
            )

        block = artifact.surface.blocks[0]
        self.assertEqual(len(block.edges), 1)
        self.assertEqual(block.edges[0].edge_id, "edge-programming-elective")
        self.assertEqual(block.edges[0].source_node_id, "node-programming")
        self.assertEqual(block.edges[0].target_node_id, "node-elective-2")
        self.assertIn(
            "存在同名课程节点导致无法唯一定位的关系端点，已从结构化关系中移除：选修模块（source）。",
            block.extraction_notes,
        )

    def test_build_surface_artifact_marks_nodes_without_stage_buckets_failed(self) -> None:
        rendered_sample = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p0513-row-1",
            page_number=513,
            document_id="curriculum:test",
            document_title="示例培养方案",
            row_id="page-0513-block-2-0003",
            parent_heading_hint="六、课程地图",
            provider_bbox=(100.0, 200.0, 900.0, 1000.0),
            provider_canvas=(1200.0, 1600.0),
            pdf_bbox=(50.0, 80.0, 450.0, 480.0),
            full_page_png=b"full-page-png",
            crop_png=b"crop-png",
        )
        page_probe = CurriculumCourseMapPageProbe(
            sample_id=rendered_sample.sample_id,
            page_number=513,
            document_id="curriculum:test",
            document_title="示例培养方案",
            parent_heading_hint="六、课程地图",
            detected_maps=(
                DetectedCourseMapRegion(
                    map_index=1,
                    map_title="主图",
                    title_confidence="visible",
                    region_bbox_normalized=(0.0, 0.0, 1.0, 1.0),
                    region_bbox_pdf=(1.0, 2.0, 3.0, 4.0),
                    region_bbox_provider=(10.0, 20.0, 30.0, 40.0),
                    manual_review_notes=(),
                ),
            ),
            course_maps=(
                CourseMapFinding(
                    map_index=1,
                    map_title="主图",
                    stage_labels=(),
                    nodes=(CourseMapNode(node_label="管理学原理"),),
                    edges=(),
                    manual_review_notes=(),
                ),
            ),
            manual_review_required=False,
            global_manual_review_notes=(),
        )
        surface_key = build_curriculum_course_map_docs_surface_object_key(
            "curriculum/documents/curriculum_plan/example/current-effective/2022/document-units.jsonl"
        )

        with patch.object(
            _docs_surface_module,
            "_build_rendered_region",
            return_value=_probe_module.CurriculumCourseMapRenderedRegion(
                detected_region=page_probe.detected_maps[0],
                crop_png=b"map-01",
                tile_pngs=(),
            ),
        ):
            artifact = build_curriculum_course_map_docs_surface_artifact(
                document_id="curriculum:test",
                document_title="示例培养方案",
                raw_asset_id="asset:test",
                raw_version_id="sha256:test",
                page_probes=(page_probe,),
                rendered_samples={rendered_sample.sample_id: rendered_sample},
                surface_object_key=surface_key,
                generated_at="2026-04-22T12:00:00+00:00",
            )

        block = artifact.surface.blocks[0]
        self.assertEqual(block.status, "failed")
        self.assertEqual(block.display_stage_labels, ())
        self.assertIn(
            "未识别到可用于阅读分组的阶段信息，当前仅发布原始区域图。",
            block.extraction_notes,
        )

    def test_purge_scope_keeps_other_reader_assets(self) -> None:
        surface_key = (
            "curriculum/documents/curriculum_plan/example/current-effective/2022/"
            "reader-assets/course-maps.json"
        )
        store = _RecordingObjectStore()

        _purge_course_map_docs_surface_assets(
            object_store=store,
            bucket="campus-rag-derived",
            surface_object_key=surface_key,
        )

        self.assertEqual(
            store.deleted_prefixes,
            [
                ("campus-rag-derived", surface_key),
                (
                    "campus-rag-derived",
                    "curriculum/documents/curriculum_plan/example/current-effective/2022/"
                    "reader-assets/course-maps/",
                ),
            ],
        )
        self.assertNotIn(
            (
                "campus-rag-derived",
                "curriculum/documents/curriculum_plan/example/current-effective/2022/reader-assets",
            ),
            store.deleted_prefixes,
        )


if __name__ == "__main__":
    unittest.main()
