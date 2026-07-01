from __future__ import annotations

import json
import unittest

from .curriculum_course_map_multimodal_probe_test_support import *


class CurriculumCourseMapMultimodalProbeParsingTest(unittest.TestCase):
    def test_default_curriculum_provider_response_key_uses_curriculum_mineru_slug(self) -> None:
        self.assertEqual(
            default_curriculum_provider_response_key(),
            (
                "official_pdf/synthetic-curriculum-plan/2022/sha256/"
                "0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/"
                "provider/vlm/provider-response.jsonl"
            ),
        )

    def test_normalize_course_map_multimodal_transport_accepts_chat_completion_aliases(
        self,
    ) -> None:
        self.assertEqual(_normalize_course_map_multimodal_transport("responses"), "responses")
        self.assertEqual(
            _normalize_course_map_multimodal_transport("chat_completions"), "chat_completions"
        )
        self.assertEqual(
            _normalize_course_map_multimodal_transport("chat/completions"), "chat_completions"
        )
        with self.assertRaisesRegex(ValueError, "CURRICULUM_COURSE_MAP_MULTIMODAL_TRANSPORT"):
            _normalize_course_map_multimodal_transport("invalid")

    def test_responses_multimodal_content_uses_responses_input_item_shape(self) -> None:
        converted = _to_responses_multimodal_content(
            [
                {"type": "text", "text": "说明"},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64,abc",
                        "detail": "high",
                    },
                },
            ]
        )

        self.assertEqual(
            converted,
            [
                {"type": "input_text", "text": "说明"},
                {
                    "type": "input_image",
                    "image_url": "data:image/png;base64,abc",
                    "detail": "high",
                },
            ],
        )

    def test_responses_multimodal_input_keeps_system_content_as_plain_string(self) -> None:
        messages = _build_responses_multimodal_input(
            system_prompt="系统提示",
            user_content=[
                {"type": "text", "text": "用户说明"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            ],
        )

        self.assertEqual(messages[0]["role"], "system")
        self.assertEqual(messages[0]["content"], "系统提示")
        self.assertEqual(messages[1]["content"][0]["type"], "input_text")
        self.assertEqual(messages[1]["content"][1]["type"], "input_image")

    def test_non_json_provider_body_is_retryable(self) -> None:
        exc = json.JSONDecodeError("Expecting value", "", 0)

        self.assertTrue(_is_retryable_probe_exception(exc))

    def test_multimodal_request_rejects_legacy_llm_api_key_alias(self) -> None:
        async def record_attempt(_attempt: object) -> None:
            return None

        async def run_request() -> None:
            async with httpx.AsyncClient(
                base_url="https://example.invalid",
                transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={})),
            ) as http_client:
                await _probe_module._request_structured_multimodal_payload_async(
                    transport="responses",
                    source={
                        "LLM_API_KEY": "legacy-key",
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_MODEL": "gpt-test",
                    },
                    path_label="detector",
                    schema={},
                    system_prompt="system",
                    user_content=[],
                    rendered_sample=_rendered_sample(),
                    http_client=http_client,
                    max_request_attempts=1,
                    on_attempt=record_attempt,
                    run_index=1,
                    map_index=None,
                )

        with self.assertRaisesRegex(
            ValueError,
            "CURRICULUM_COURSE_MAP_MULTIMODAL_API_KEY is required",
        ):
            asyncio.run(run_request())

    def test_probe_runtime_base_url_rejects_legacy_llm_base_url_alias(self) -> None:
        self.assertEqual(
            _resolve_base_url({"LLM_BASE_URL": "https://legacy.example/v1"}),
            "https://api.openai.com/v1",
        )

    def test_probe_runtime_base_url_ignores_domain_env_override(self) -> None:
        self.assertEqual(
            _resolve_base_url(
                {"CURRICULUM_COURSE_MAP_MULTIMODAL_BASE_URL": "https://domain.example/v1"}
            ),
            "https://api.openai.com/v1",
        )

    def test_responses_request_ignores_optional_tuning_env(self) -> None:
        requests: list[dict[str, object]] = []

        async def record_attempt(_attempt: object) -> None:
            return None

        async def run_request() -> None:
            async def handler(request: httpx.Request) -> httpx.Response:
                requests.append(json.loads(request.content.decode("utf-8")))
                return httpx.Response(200, json={"output_parsed": {"detected_maps": []}})

            async with httpx.AsyncClient(
                base_url="https://example.invalid",
                transport=httpx.MockTransport(handler),
            ) as http_client:
                await _probe_module._request_structured_multimodal_payload_async(
                    transport="responses",
                    source={
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_API_KEY": "test-key",
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_MODEL": "gpt-test",
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_REASONING_EFFORT": "high",
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_MAX_OUTPUT_TOKENS": "123",
                    },
                    path_label="detector",
                    schema={},
                    system_prompt="system",
                    user_content=[],
                    rendered_sample=_rendered_sample(),
                    http_client=http_client,
                    max_request_attempts=1,
                    on_attempt=record_attempt,
                    run_index=1,
                    map_index=None,
                )

        asyncio.run(run_request())

        self.assertEqual(len(requests), 1)
        self.assertNotIn("reasoning", requests[0])
        self.assertNotIn("max_output_tokens", requests[0])

    def test_projection_extractor_runtime_rejects_legacy_llm_base_url_alias(self) -> None:
        from campus_ingestion_core.handbook_service_navigation_projection_support import (
            _resolve_projection_extractor_runtime,
        )

        runtime = _resolve_projection_extractor_runtime(
            {
                "LLM_BASE_URL": "https://legacy.example/v1",
                "HANDBOOK_SERVICE_NAVIGATION_MODEL": "gpt-test",
            }
        )

        self.assertEqual(runtime["base_url"], "https://api.openai.com/v1")

    def test_request_uses_explicit_course_map_multimodal_api_key(self) -> None:
        async def record_attempt(_attempt: object) -> None:
            return None

        async def run_request() -> None:
            async with httpx.AsyncClient(
                base_url="https://example.invalid",
                transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={})),
            ) as http_client:
                with self.assertRaisesRegex(ValueError, "parsed payload must be a JSON object"):
                    await _probe_module._request_structured_multimodal_payload_async(
                        transport="responses",
                        source={
                            "CURRICULUM_COURSE_MAP_MULTIMODAL_API_KEY": "test-key",
                            "CURRICULUM_COURSE_MAP_MULTIMODAL_MODEL": "gpt-test",
                        },
                        path_label="detector",
                        schema={},
                        system_prompt="system",
                        user_content=[],
                        rendered_sample=_rendered_sample(),
                        http_client=http_client,
                        max_request_attempts=1,
                        on_attempt=record_attempt,
                        run_index=1,
                        map_index=None,
                    )

            asyncio.run(run_request())

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
        self.assertEqual(finding.edges, ())
        self.assertIn("empty node_label", " ".join(finding.manual_review_notes))
        self.assertIn("without a matching node", " ".join(finding.manual_review_notes))

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
        self.assertTrue(finding.nodes[0].node_id.startswith("node-"))
        self.assertTrue(finding.nodes[0].stage_id.startswith("stage-"))
        self.assertEqual(finding.edges[0].source_node_id, finding.nodes[0].node_id)
        self.assertEqual(finding.edges[0].target_node_id, finding.nodes[1].node_id)
        self.assertTrue(finding.edges[0].edge_id.startswith("edge-"))
        self.assertEqual(finding.stage_labels, ("本科一年级", "本科二年级"))
        self.assertIn("gateway ignored strict schema", finding.manual_review_notes)

    def test_coerce_course_map_finding_prefers_node_id_edges_for_duplicate_labels(self) -> None:
        finding = _coerce_course_map_finding(
            {
                "map_index": 1,
                "map_title": "课程地图",
                "stage_labels": ["一年级", "二年级"],
                "nodes": [
                    {
                        "node_id": "node-programming",
                        "node_label": "程序设计基础",
                        "stage_id": "stage-1",
                        "stage_label": "一年级",
                    },
                    {
                        "node_id": "node-elective-1",
                        "node_label": "选修模块",
                        "stage_id": "stage-1",
                        "stage_label": "一年级",
                    },
                    {
                        "node_id": "node-elective-2",
                        "node_label": "选修模块",
                        "stage_id": "stage-2",
                        "stage_label": "二年级",
                    },
                    {
                        "node_id": "node-thesis",
                        "node_label": "毕业论文",
                        "stage_id": "stage-2",
                        "stage_label": "二年级",
                    },
                ],
                "edges": [
                    {
                        "edge_id": "edge-programming-elective",
                        "source_node_id": "node-programming",
                        "source_label": "程序设计基础",
                        "target_node_id": "node-elective-2",
                        "target_label": "选修模块",
                    },
                    {"source_label": "选修模块", "target_label": "毕业论文"},
                ],
                "manual_review_notes": [],
            }
        )

        self.assertEqual(len(finding.edges), 1)
        self.assertEqual(finding.edges[0].edge_id, "edge-programming-elective")
        self.assertEqual(finding.edges[0].source_node_id, "node-programming")
        self.assertEqual(finding.edges[0].target_node_id, "node-elective-2")
        self.assertIn(
            "ambiguous duplicate-label edge source endpoint",
            " ".join(finding.manual_review_notes),
        )


def _rendered_sample() -> CurriculumCourseMapRenderedSample:
    return CurriculumCourseMapRenderedSample(
        sample_id="course-map-p001",
        page_number=1,
        document_id="curriculum:test",
        document_title="测试培养方案",
        row_id="row-1",
        parent_heading_hint="课程结构图",
        provider_bbox=(0.0, 0.0, 100.0, 100.0),
        provider_canvas=(100.0, 100.0),
        pdf_bbox=(0.0, 0.0, 100.0, 100.0),
        full_page_png=b"full",
        crop_png=b"crop",
    )
