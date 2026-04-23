from __future__ import annotations

import unittest

from .curriculum_course_map_multimodal_probe_test_support import *


class CurriculumCourseMapMultimodalProbeInventoryTest(unittest.TestCase):
    def test_build_inventory_accepts_mineru_page_info_height_shape(self) -> None:
        provider_response = {
            "result": {
                "dataInfo": {"numPages": 2, "type": "pdf_or_image"},
                "layoutParsingResults": [
                    {
                        "pageInfo": {"height": 1000},
                        "prunedResult": {"parsing_res_list": []},
                    },
                    {
                        "pageInfo": {"height": 1200},
                        "prunedResult": {"parsing_res_list": []},
                    },
                ],
            }
        }
        layout_rows = [
            {
                "page_start": 1,
                "row_id": "page-0001-block-0001",
                "row_type": "image",
                "bbox": [10, 20, 300, 400],
                "parent_heading_hint": "六、课程地图",
            },
            {
                "page_start": 2,
                "row_id": "page-0002-block-0001",
                "row_type": "image",
                "bbox": [10, 20, 300, 400],
                "parent_heading_hint": "课程结构拓扑图",
            },
        ]

        inventory = build_curriculum_course_map_inventory(
            split_manifest_bytes=json.dumps(
                {
                    "manifest_version": "curriculum_plan_split_manifest_v1",
                    "documents": [
                        {
                            "document_id": "curriculum:测试培养方案",
                            "title": "测试培养方案",
                            "page_start": 1,
                            "page_end": 2,
                        }
                    ],
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            provider_response_bytes=(
                json.dumps(provider_response, ensure_ascii=False) + "\n"
            ).encode("utf-8"),
            layout_elements_bytes="\n".join(
                json.dumps(row, ensure_ascii=False) for row in layout_rows
            ).encode("utf-8"),
            source_pdf_key="source.pdf",
            provider_response_key="provider-response.jsonl",
            layout_elements_key="layout-elements.jsonl",
            raw_asset_id="asset:curriculum-plan-2022",
            raw_version_id="sha256:test",
        )

        self.assertEqual([item.provider_page_height for item in inventory], [1000.0, 1200.0])

    def test_build_inventory_maps_image_rows_back_to_declared_documents(self) -> None:
        layout_path = Path("tests/fixtures/curriculum_plan/layout-elements.pages-278-297.jsonl")
        non_course_map_image = {
            "page_start": 1,
            "row_id": "page-0001-block-0001",
            "row_type": "image",
            "bbox": [1, 2, 3, 4],
            "parent_heading_hint": "中央民族大学本科专业人才培养方案",
        }
        layout_bytes = (
            json.dumps(non_course_map_image, ensure_ascii=False)
            + "\n"
            + layout_path.read_text(encoding="utf-8")
        ).encode("utf-8")

        inventory = build_curriculum_course_map_inventory(
            split_manifest_bytes=_split_manifest_bytes(),
            provider_response_bytes=_provider_response_bytes(page_count=297),
            layout_elements_bytes=layout_bytes,
            source_pdf_key="source.pdf",
            provider_response_key="provider-response.jsonl",
            layout_elements_key="layout-elements.jsonl",
            raw_asset_id="asset:curriculum-plan-2022",
            raw_version_id="sha256:test",
        )

        self.assertEqual([item.page_number for item in inventory], [287, 297])
        self.assertEqual(inventory[0].document_id, "curriculum:国际经济与贸易本科人才培养方案")
        self.assertEqual(inventory[1].document_title, "经济学拔尖人才创新班人才培养方案")

    def test_provider_bbox_projection_scales_against_pdf_canvas(self) -> None:
        provider_canvas = derive_provider_canvas(
            pdf_page_width=595,
            pdf_page_height=842,
            provider_page_height=1561,
        )
        pdf_bbox = project_provider_bbox_to_pdf_rect(
            provider_bbox=(151.0, 254.0, 1025.0, 740.0),
            provider_canvas=provider_canvas,
            pdf_page_width=595,
            pdf_page_height=842,
        )

        self.assertAlmostEqual(provider_canvas[0], 1103.081947743468)
        self.assertAlmostEqual(pdf_bbox[0], 81.44907110826392)
        self.assertAlmostEqual(pdf_bbox[1], 137.00704676489428)

    def test_render_sample_outputs_full_page_and_crop_pngs(self) -> None:
        try:
            import fitz
        except ImportError:  # pragma: no cover
            self.skipTest("pymupdf not installed")
            return

        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / "course-map.pdf"
            with fitz.open() as document:
                page = document.new_page(width=600, height=800)
                page.draw_rect((60, 120, 360, 420), color=(0, 0, 0), fill=(0.9, 0.9, 0.9))
                document.save(pdf_path)

            entry = CurriculumCourseMapInventoryEntry(
                document_id="curriculum:test-doc",
                document_title="测试培养方案",
                page_number=1,
                row_id="page-0001-block-1",
                parent_heading_hint="测试课程拓扑图",
                bbox_provider=(120.0, 240.0, 720.0, 840.0),
                provider_page_height=1600.0,
                raw_asset_id="asset:test",
                raw_version_id="sha256:test",
                source_pdf_key="source.pdf",
                provider_response_key="provider-response.jsonl",
                layout_elements_key="layout-elements.jsonl",
            )
            rendered = render_curriculum_course_map_sample(
                pdf_bytes=pdf_path.read_bytes(),
                entry=entry,
                sample_id="sample-01",
                output_dir=Path(tmpdir) / "out",
            )

            self.assertTrue(rendered.full_page_png.startswith(b"\x89PNG"))
            self.assertTrue(rendered.crop_png.startswith(b"\x89PNG"))
            self.assertIsNotNone(rendered.full_page_image_path)
            self.assertIsNotNone(rendered.crop_image_path)

    def test_gold_v2_allows_missing_title_when_slot_does_not_require_it(self) -> None:
        run_one = CurriculumCourseMapProbeRun(
            run_index=1,
            pages=(
                _make_page_probe(
                    sample_id="course-map-p349",
                    page_number=349,
                    document_id="curriculum:法学（民族实验班）本科人才培养方案",
                    document_title="法学（民族实验班）本科人才培养方案",
                    map_title=None,
                    nodes=("民法（一）", "民法（二）", "民事诉讼法"),
                    edges=(("民法（一）", "民法（二）"), ("民法（二）", "民事诉讼法")),
                ),
            ),
        )
        run_two = CurriculumCourseMapProbeRun(
            run_index=2,
            pages=(
                _make_page_probe(
                    sample_id="course-map-p349",
                    page_number=349,
                    document_id="curriculum:法学（民族实验班）本科人才培养方案",
                    document_title="法学（民族实验班）本科人才培养方案",
                    map_title=None,
                    nodes=("民法（一）", "民法（二）", "民事诉讼法"),
                    edges=(("民法（一）", "民法（二）"), ("民法（二）", "民事诉讼法")),
                ),
            ),
        )
        repeatability = build_curriculum_course_map_repeatability_report(
            runs=(run_one, run_two),
            threshold=0.9,
        )
        gold = build_curriculum_course_map_gold_report(
            runs=(run_one, run_two),
            gold_manifest=(
                CurriculumCourseMapGoldExpectation(
                    page_number=349,
                    document_id="curriculum:法学（民族实验班）本科人才培养方案",
                    document_title="法学（民族实验班）本科人才培养方案",
                    expected_maps=(
                        CurriculumCourseMapGoldMapExpectation(
                            map_index=1,
                            expected_title=None,
                            title_required=False,
                            expected_node_labels=("民法（一）", "民法（二）"),
                            expected_edges=(("民法（一）", "民法（二）"),),
                        ),
                    ),
                    min_map_detection_recall=1.0,
                    min_slot_pass_rate=1.0,
                ),
            ),
        )
        admission = build_curriculum_course_map_admission_summary(
            repeatability=repeatability,
            gold=gold,
        )

        self.assertEqual(repeatability.page_scores[0].overall_score, 1.0)
        self.assertEqual(gold.page_scores[0].title_recall, 1.0)
        self.assertEqual(gold.page_scores[0].map_detection_recall, 1.0)
        self.assertEqual(admission.recommendation, "bounded_candidate_for_follow_up")
