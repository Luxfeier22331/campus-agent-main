from __future__ import annotations

import unittest

from .curriculum_course_map_multimodal_probe_test_support import *  # noqa: F401,F403


class CurriculumCourseMapMultimodalProbeParsingTest(unittest.TestCase):
    def test_default_curriculum_provider_response_key_uses_curriculum_mineru_slug(self) -> None:
        self.assertEqual(
            default_curriculum_provider_response_key(),
            (
                "official_pdf/curriculum-plan/2022/sha256/"
                "0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/"
                "provider/vlm/provider-response.jsonl"
            ),
        )

    def test_normalize_prompt_runtime_transport_accepts_chat_completion_aliases(self) -> None:
        self.assertEqual(_normalize_prompt_runtime_transport("responses"), "responses")
        self.assertEqual(
            _normalize_prompt_runtime_transport("chat_completions"), "chat_completions"
        )
        self.assertEqual(
            _normalize_prompt_runtime_transport("chat/completions"), "chat_completions"
        )
        with self.assertRaisesRegex(ValueError, "PROMPT_RUNTIME_TRANSPORT"):
            _normalize_prompt_runtime_transport("invalid")

    def test_extract_chat_completions_output_parsed_reads_string_message(self) -> None:
        payload = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": '{"detected_maps":[]}',
                    }
                }
            ]
        }

        parsed = _extract_chat_completions_output_parsed(payload)
        self.assertEqual(parsed["detected_maps"], [])

    def test_extract_chat_completions_output_parsed_reads_fenced_json(self) -> None:
        payload = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": '```json\n{"detected_maps":[]}\n```',
                    }
                }
            ]
        }

        parsed = _extract_chat_completions_output_parsed(payload)
        self.assertEqual(parsed["detected_maps"], [])

    def test_coerce_detected_regions_payload_sorts_by_top_left_and_projects_bboxes(self) -> None:
        rendered_sample = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p513",
            page_number=513,
            document_id="curriculum:计算机类本科人才培养方案",
            document_title="计算机类本科人才培养方案",
            row_id="row-1",
            parent_heading_hint="计算机类本科课程结构拓扑图",
            provider_bbox=(100.0, 200.0, 900.0, 1000.0),
            provider_canvas=(1200.0, 1600.0),
            pdf_bbox=(50.0, 80.0, 450.0, 480.0),
            full_page_png=b"full",
            crop_png=b"crop",
        )

        payload = {
            "detected_maps": [
                {
                    "map_title": "右侧地图",
                    "title_confidence": "visible",
                    "region_bbox_normalized": [0.6, 0.3, 1.0, 0.9],
                    "manual_review_notes": [],
                },
                {
                    "map_title": "左侧地图",
                    "title_confidence": "visible",
                    "region_bbox_normalized": [0.0, 0.2, 0.4, 0.8],
                    "manual_review_notes": [],
                },
            ]
        }

        regions = _coerce_detected_regions_payload(rendered_sample=rendered_sample, payload=payload)
        self.assertEqual([region.map_index for region in regions], [1, 2])
        self.assertEqual([region.map_title for region in regions], ["左侧地图", "右侧地图"])
        self.assertEqual(regions[0].region_bbox_pdf, (50.0, 160.0, 210.0, 400.0))
        self.assertEqual(regions[1].region_bbox_provider, (580.0, 440.0, 900.0, 920.0))

    def test_coerce_detected_regions_payload_accepts_gateway_alias_keys(self) -> None:
        rendered_sample = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p349",
            page_number=349,
            document_id="curriculum:law",
            document_title="法学方案",
            row_id="row-1",
            parent_heading_hint="六、课程地图",
            provider_bbox=(100.0, 200.0, 900.0, 1000.0),
            provider_canvas=(1200.0, 1600.0),
            pdf_bbox=(50.0, 80.0, 450.0, 480.0),
            full_page_png=b"full",
            crop_png=b"crop",
        )

        payload = {
            "regions": [
                {
                    "title": None,
                    "title_confidence": "partial",
                    "bbox": [0.0, 0.0, 1.0, 1.0],
                    "manual_review_notes": "single diagram occupies the whole crop",
                }
            ]
        }

        regions = _coerce_detected_regions_payload(rendered_sample=rendered_sample, payload=payload)
        self.assertEqual(len(regions), 1)
        self.assertEqual(regions[0].region_bbox_normalized, (0.0, 0.0, 1.0, 1.0))
        self.assertEqual(regions[0].title_confidence, "partial")
        self.assertEqual(
            regions[0].manual_review_notes, ("single diagram occupies the whole crop",)
        )

    def test_coerce_course_map_finding_drops_empty_nodes_and_edges(self) -> None:
        finding = _coerce_course_map_finding(
            {
                "map_index": 1,
                "map_title": None,
                "stage_labels": [],
                "nodes": [
                    {"node_label": "有效节点", "stage_label": "", "category_label": ""},
                    {"node_label": "", "stage_label": "", "category_label": ""},
                ],
                "edges": [
                    {"source_label": "有效节点", "target_label": "目标节点"},
                    {"source_label": "", "target_label": "目标节点"},
                ],
                "manual_review_notes": [],
            }
        )

        self.assertEqual([node.node_label for node in finding.nodes], ["有效节点"])
        self.assertEqual(
            [(edge.source_label, edge.target_label) for edge in finding.edges],
            [("有效节点", "目标节点")],
        )
        self.assertIn("empty node_label", " ".join(finding.manual_review_notes))

    def test_coerce_course_map_finding_accepts_gateway_alias_node_and_edge_keys(self) -> None:
        finding = _coerce_course_map_finding(
            {
                "map_index": 1,
                "map_title": "课程地图",
                "nodes": [
                    {"label": "民法（一）", "stage": "本科一年级", "type": "专业核心课"},
                    {"name": "民法（二）", "stage": "本科二年级"},
                ],
                "edges": [
                    {"from": "民法（一）", "to": "民法（二）"},
                ],
                "notes": ["gateway ignored strict schema"],
            }
        )

        self.assertEqual([node.node_label for node in finding.nodes], ["民法（一）", "民法（二）"])
        self.assertEqual(
            [(edge.source_label, edge.target_label) for edge in finding.edges],
            [("民法（一）", "民法（二）")],
        )
        self.assertEqual(finding.stage_labels, ("本科一年级", "本科二年级"))
        self.assertIn("gateway ignored strict schema", finding.manual_review_notes)
