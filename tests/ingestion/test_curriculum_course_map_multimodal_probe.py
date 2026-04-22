from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from tests.ingestion._curriculum_course_map_probe_test_support import (
    load_curriculum_course_map_probe_module,
)

_probe_module = load_curriculum_course_map_probe_module()
CourseMapEdge = _probe_module.CourseMapEdge
CourseMapFinding = _probe_module.CourseMapFinding
CourseMapNode = _probe_module.CourseMapNode
CurriculumCourseMapGoldExpectation = _probe_module.CurriculumCourseMapGoldExpectation
CurriculumCourseMapGoldMapExpectation = _probe_module.CurriculumCourseMapGoldMapExpectation
CurriculumCourseMapInventoryEntry = _probe_module.CurriculumCourseMapInventoryEntry
CurriculumCourseMapPageProbe = _probe_module.CurriculumCourseMapPageProbe
CurriculumCourseMapProbeRun = _probe_module.CurriculumCourseMapProbeRun
CurriculumCourseMapRenderedSample = _probe_module.CurriculumCourseMapRenderedSample
DetectedCourseMapRegion = _probe_module.DetectedCourseMapRegion
_coerce_course_map_finding = _probe_module._coerce_course_map_finding
_coerce_detected_regions_payload = _probe_module._coerce_detected_regions_payload
_extract_chat_completions_output_parsed = _probe_module._extract_chat_completions_output_parsed
_extract_output_parsed = _probe_module._extract_output_parsed
_request_course_map_detector_payload_async = (
    _probe_module._request_course_map_detector_payload_async
)
_normalize_prompt_runtime_transport = _probe_module._normalize_prompt_runtime_transport
build_curriculum_course_map_admission_summary = (
    _probe_module.build_curriculum_course_map_admission_summary
)
build_curriculum_course_map_gold_report = _probe_module.build_curriculum_course_map_gold_report
build_curriculum_course_map_inventory = _probe_module.build_curriculum_course_map_inventory
build_curriculum_course_map_repeatability_report = (
    _probe_module.build_curriculum_course_map_repeatability_report
)
derive_provider_canvas = _probe_module.derive_provider_canvas
project_provider_bbox_to_pdf_rect = _probe_module.project_provider_bbox_to_pdf_rect
render_curriculum_course_map_sample = _probe_module.render_curriculum_course_map_sample
run_curriculum_course_map_multimodal_probe = (
    _probe_module.run_curriculum_course_map_multimodal_probe
)


def _provider_response_bytes(*, page_count: int, page_height: int = 1561) -> bytes:
    line = {
        "logId": "fixture-batch-001",
        "result": {
            "layoutParsingResults": [
                {
                    "prunedResult": {
                        "height": page_height,
                        "parsing_res_list": [],
                    },
                    "markdown": {"text": "", "images": {}},
                }
                for _ in range(page_count)
            ]
        },
    }
    return (json.dumps(line, ensure_ascii=False) + "\n").encode("utf-8")


def _split_manifest_bytes() -> bytes:
    payload = {
        "manifest_version": "curriculum_plan_split_manifest_v1",
        "documents": [
            {
                "document_id": "curriculum:国际经济与贸易本科人才培养方案",
                "title": "国际经济与贸易本科人才培养方案",
                "page_start": 278,
                "page_end": 288,
            },
            {
                "document_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                "title": "经济学拔尖人才创新班人才培养方案",
                "page_start": 289,
                "page_end": 297,
            },
        ],
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _make_page_probe(
    *,
    sample_id: str,
    page_number: int,
    document_id: str,
    document_title: str,
    map_title: str | None,
    nodes: tuple[str, ...],
    edges: tuple[tuple[str, str], ...],
) -> CurriculumCourseMapPageProbe:
    return CurriculumCourseMapPageProbe(
        sample_id=sample_id,
        page_number=page_number,
        document_id=document_id,
        document_title=document_title,
        parent_heading_hint=map_title or "",
        detected_maps=(
            DetectedCourseMapRegion(
                map_index=1,
                map_title=map_title,
                title_confidence="visible" if map_title else "absent",
                region_bbox_normalized=(0.0, 0.0, 1.0, 1.0),
                region_bbox_pdf=(1.0, 2.0, 3.0, 4.0),
                region_bbox_provider=(10.0, 20.0, 30.0, 40.0),
                manual_review_notes=(),
            ),
        ),
        course_maps=(
            CourseMapFinding(
                map_index=1,
                map_title=map_title,
                stage_labels=("本科一年级", "本科二年级"),
                nodes=tuple(CourseMapNode(node_label=value) for value in nodes),
                edges=tuple(
                    CourseMapEdge(source_label=left, target_label=right) for left, right in edges
                ),
                manual_review_notes=(),
            ),
        ),
        manual_review_required=False,
        global_manual_review_notes=(),
    )


class CurriculumCourseMapMultimodalProbeTest(unittest.TestCase):
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

    def test_async_run_preserves_sample_order_even_when_completion_is_out_of_order(self) -> None:
        sample_one = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p001",
            page_number=1,
            document_id="curriculum:one",
            document_title="方案一",
            row_id="row-1",
            parent_heading_hint="课程地图一",
            provider_bbox=(1.0, 2.0, 3.0, 4.0),
            provider_canvas=(100.0, 200.0),
            pdf_bbox=(1.0, 2.0, 3.0, 4.0),
            full_page_png=b"one-full",
            crop_png=b"one-crop",
        )
        sample_two = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p002",
            page_number=2,
            document_id="curriculum:two",
            document_title="方案二",
            row_id="row-2",
            parent_heading_hint="课程地图二",
            provider_bbox=(1.0, 2.0, 3.0, 4.0),
            provider_canvas=(100.0, 200.0),
            pdf_bbox=(1.0, 2.0, 3.0, 4.0),
            full_page_png=b"two-full",
            crop_png=b"two-crop",
        )

        async def fake_probe(**kwargs):
            rendered_sample = kwargs["rendered_sample"]
            if rendered_sample.sample_id == "course-map-p001":
                await asyncio.sleep(0.02)
            return _make_page_probe(
                sample_id=rendered_sample.sample_id,
                page_number=rendered_sample.page_number,
                document_id=rendered_sample.document_id,
                document_title=rendered_sample.document_title,
                map_title=rendered_sample.parent_heading_hint,
                nodes=("节点一",),
                edges=(),
            )

        with patch.object(
            _probe_module, "_probe_curriculum_course_map_page_async", side_effect=fake_probe
        ):
            run = asyncio.run(
                _probe_module._run_curriculum_course_map_probe_run_async(
                    run_index=1,
                    source={"PROMPT_RUNTIME_API_KEY": "test", "PROMPT_RUNTIME_MODEL": "gpt-test"},
                    rendered_samples=(sample_one, sample_two),
                    output_dir=None,
                    prompt_transport="chat_completions",
                    max_inflight_pages=2,
                    max_request_attempts=1,
                    resume=False,
                    http_client=None,
                )
            )

        self.assertEqual(
            [page.sample_id for page in run.pages], ["course-map-p001", "course-map-p002"]
        )

    def test_post_probe_json_async_retries_cloudflare_520(self) -> None:
        first_response = httpx.Response(
            520,
            request=httpx.Request("POST", "https://example.test/v1/chat/completions"),
            text="unknown error",
        )
        second_response = httpx.Response(
            200,
            request=httpx.Request("POST", "https://example.test/v1/chat/completions"),
            json={"ok": True},
        )

        class _FakeAsyncClient:
            def __init__(self, responses: list[httpx.Response]) -> None:
                self._responses = list(responses)

            async def post(
                self, url: str, *, json: dict[str, object], headers: dict[str, str]
            ) -> httpx.Response:
                return self._responses.pop(0)

        fake_client = _FakeAsyncClient([first_response, second_response])
        attempts: list[dict[str, object]] = []

        async def record_attempt(row: dict[str, object]) -> None:
            attempts.append(row)

        async def fake_sleep(_: float) -> None:
            return None

        with patch.object(_probe_module.asyncio, "sleep", new=fake_sleep):
            payload = asyncio.run(
                _probe_module._post_probe_json_async(
                    http_client=fake_client,
                    path="/chat/completions",
                    payload={"model": "gpt-5.4"},
                    api_key="test-key",
                    max_request_attempts=2,
                    on_attempt=record_attempt,
                    run_index=3,
                    sample_id="course-map-p601",
                    transport="chat_completions",
                    stage="extract",
                    map_index=1,
                )
            )

        self.assertEqual(payload, {"ok": True})
        self.assertEqual([row["status"] for row in attempts], [520, 200])

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

    def test_request_course_map_detector_payload_async_sends_chat_completion_response_format(
        self,
    ) -> None:
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
        captured_payloads: list[dict[str, object]] = []

        async def fake_post_probe_json_async(**kwargs):
            captured_payloads.append(kwargs["payload"])
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": '{"detected_maps":[]}',
                        }
                    }
                ]
            }

        with patch.object(
            _probe_module, "_post_probe_json_async", side_effect=fake_post_probe_json_async
        ):
            payload = asyncio.run(
                _request_course_map_detector_payload_async(
                    transport="chat_completions",
                    source={"PROMPT_RUNTIME_API_KEY": "test", "PROMPT_RUNTIME_MODEL": "gpt-test"},
                    rendered_sample=rendered_sample,
                    http_client=object(),
                    max_request_attempts=1,
                    on_attempt=lambda row: asyncio.sleep(0),
                    run_index=1,
                )
            )

        self.assertEqual(payload["detected_maps"], [])
        self.assertEqual(captured_payloads[0]["response_format"]["type"], "json_schema")

    def test_run_probe_reuses_resume_checkpoint_without_new_probe_request(self) -> None:
        split_manifest = {
            "manifest_version": "curriculum_plan_split_manifest_v1",
            "documents": [
                {
                    "document_id": "curriculum:英语本科人才培养方案",
                    "title": "英语本科人才培养方案",
                    "page_start": 1,
                    "page_end": 1,
                }
            ],
        }
        layout_row = {
            "page_start": 1,
            "row_id": "page-0001-block-0001",
            "row_type": "image",
            "bbox": [100, 200, 700, 800],
            "parent_heading_hint": "英语专业本科课程结构拓扑图",
        }
        sample_manifest = {
            "manifest_version": "curriculum_course_map_probe_samples_v1",
            "entries": [
                {
                    "sample_id": "course-map-p001",
                    "page_number": 1,
                    "document_id": "curriculum:英语本科人才培养方案",
                    "document_title": "英语本科人才培养方案",
                }
            ],
        }
        gold_manifest = {
            "manifest_version": "curriculum_course_map_probe_gold_v2",
            "entries": [
                {
                    "page_number": 1,
                    "document_id": "curriculum:英语本科人才培养方案",
                    "document_title": "英语本科人才培养方案",
                    "expected_maps": [
                        {
                            "map_index": 1,
                            "expected_title": "英语专业本科课程结构拓扑图",
                            "title_required": True,
                            "expected_node_labels": ["综合英语（一）", "综合英语（二）"],
                            "expected_edges": [["综合英语（一）", "综合英语（二）"]],
                        }
                    ],
                    "min_map_detection_recall": 1.0,
                    "min_slot_pass_rate": 1.0,
                }
            ],
        }

        try:
            import fitz
        except ImportError:  # pragma: no cover
            self.skipTest("pymupdf not installed")
            return

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            pdf_path = tmp_path / "course-map.pdf"
            with fitz.open() as document:
                page = document.new_page(width=600, height=800)
                page.draw_rect((60, 120, 360, 420), color=(0, 0, 0), fill=(0.9, 0.9, 0.9))
                document.save(pdf_path)

            split_manifest_path = tmp_path / "split.json"
            sample_manifest_path = tmp_path / "samples.json"
            gold_manifest_path = tmp_path / "gold.json"
            output_dir = tmp_path / "probe-output"
            sample_dir = output_dir / "page-results" / "run-01" / "course-map-p001"
            sample_dir.mkdir(parents=True, exist_ok=True)
            split_manifest_path.write_text(
                json.dumps(split_manifest, ensure_ascii=False), encoding="utf-8"
            )
            sample_manifest_path.write_text(
                json.dumps(sample_manifest, ensure_ascii=False), encoding="utf-8"
            )
            gold_manifest_path.write_text(
                json.dumps(gold_manifest, ensure_ascii=False), encoding="utf-8"
            )
            (output_dir / "probe-config.json").write_text(
                json.dumps(
                    {
                        "schema_version": "curriculum_course_map_multimodal_probe_v2",
                        "prompt_transport": "chat_completions",
                        "prompt_runs": 1,
                        "max_inflight_pages": 3,
                        "max_request_attempts": 3,
                        "source_bucket": "campus-rag-source",
                        "source_pdf_key": "source.pdf",
                        "provider_response_key": "provider-response.jsonl",
                        "layout_elements_key": "layout-elements.jsonl",
                        "split_manifest_path": str(split_manifest_path.resolve()),
                        "sample_manifest_path": str(sample_manifest_path.resolve()),
                        "gold_manifest_path": str(gold_manifest_path.resolve()),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            checkpoint = {
                "sample_id": "course-map-p001",
                "page_number": 1,
                "document_id": "curriculum:英语本科人才培养方案",
                "document_title": "英语本科人才培养方案",
                "parent_heading_hint": "英语专业本科课程结构拓扑图",
                "detected_maps": [
                    {
                        "map_index": 1,
                        "map_title": "英语专业本科课程结构拓扑图",
                        "title_confidence": "visible",
                        "region_bbox_normalized": [0.0, 0.0, 1.0, 1.0],
                        "region_bbox_pdf": [10.0, 20.0, 30.0, 40.0],
                        "region_bbox_provider": [100.0, 200.0, 300.0, 400.0],
                        "manual_review_notes": [],
                    }
                ],
                "course_maps": [
                    {
                        "map_index": 1,
                        "map_title": "英语专业本科课程结构拓扑图",
                        "stage_labels": ["本科一年级"],
                        "nodes": [
                            {
                                "node_label": "综合英语（一）",
                                "stage_label": "本科一年级",
                                "category_label": "专业课",
                            },
                            {
                                "node_label": "综合英语（二）",
                                "stage_label": "本科一年级",
                                "category_label": "专业课",
                            },
                        ],
                        "edges": [
                            {"source_label": "综合英语（一）", "target_label": "综合英语（二）"}
                        ],
                        "manual_review_notes": [],
                    }
                ],
                "manual_review_required": False,
                "global_manual_review_notes": [],
            }
            (sample_dir / "page-summary.json").write_text(
                json.dumps(checkpoint, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            with patch.object(
                _probe_module,
                "_probe_curriculum_course_map_page_async",
                side_effect=AssertionError("resume should skip remote probe"),
            ):
                report = run_curriculum_course_map_multimodal_probe(
                    source={
                        "PROMPT_RUNTIME_API_KEY": "test",
                        "PROMPT_RUNTIME_MODEL": "gpt-test",
                        "PROMPT_RUNTIME_TRANSPORT": "chat_completions",
                    },
                    source_bucket="campus-rag-source",
                    split_manifest_path=split_manifest_path,
                    sample_manifest_path=sample_manifest_path,
                    gold_manifest_path=gold_manifest_path,
                    pdf_bytes=pdf_path.read_bytes(),
                    provider_response_bytes=_provider_response_bytes(
                        page_count=1, page_height=1600
                    ),
                    layout_elements_bytes=(
                        json.dumps(layout_row, ensure_ascii=False) + "\n"
                    ).encode("utf-8"),
                    source_pdf_key="source.pdf",
                    provider_response_key="provider-response.jsonl",
                    layout_elements_key="layout-elements.jsonl",
                    output_dir=output_dir,
                    prompt_runs=1,
                    resume=True,
                )

            self.assertEqual(report.run_count, 1)
            self.assertEqual(report.gold.pass_rate, 1.0)
            self.assertTrue((output_dir / "progress.json").exists())


if __name__ == "__main__":
    unittest.main()
