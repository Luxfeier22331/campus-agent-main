from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from campus_ingestion_core.curriculum_course_map_multimodal_probe import (
    CourseMapEdge,
    CourseMapFinding,
    CourseMapNode,
    CurriculumCourseMapGoldExpectation,
    CurriculumCourseMapInventoryEntry,
    CurriculumCourseMapPageProbe,
    CurriculumCourseMapProbeRun,
    CurriculumCourseMapRenderedSample,
    _extract_chat_completions_output_parsed,
    _extract_output_parsed,
    _normalize_prompt_runtime_transport,
    _request_course_map_probe_payload,
    _request_course_map_probe_response,
    build_curriculum_course_map_admission_summary,
    build_curriculum_course_map_gold_report,
    build_curriculum_course_map_inventory,
    build_curriculum_course_map_repeatability_report,
    derive_provider_canvas,
    project_provider_bbox_to_pdf_rect,
    render_curriculum_course_map_sample,
    run_curriculum_course_map_multimodal_probe,
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
    map_title: str,
    nodes: tuple[str, ...],
    edges: tuple[tuple[str, str], ...],
) -> CurriculumCourseMapPageProbe:
    return CurriculumCourseMapPageProbe(
        sample_id=sample_id,
        page_number=page_number,
        document_id=document_id,
        document_title=document_title,
        parent_heading_hint=map_title,
        course_maps=(
            CourseMapFinding(
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
            _normalize_prompt_runtime_transport("chat_completions"),
            "chat_completions",
        )
        self.assertEqual(
            _normalize_prompt_runtime_transport("chat/completions"),
            "chat_completions",
        )
        with self.assertRaisesRegex(ValueError, "PROMPT_RUNTIME_TRANSPORT"):
            _normalize_prompt_runtime_transport("invalid")

    def test_extract_chat_completions_output_parsed_reads_string_message(self) -> None:
        payload = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": (
                            '{"course_maps":[],"manual_review_required":false,'
                            '"global_manual_review_notes":[]}'
                        ),
                    }
                }
            ]
        }

        parsed = _extract_chat_completions_output_parsed(payload)
        self.assertEqual(parsed["course_maps"], [])
        self.assertFalse(parsed["manual_review_required"])

    def test_request_payload_uses_chat_completions_transport(self) -> None:
        rendered_sample = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p287",
            page_number=287,
            document_id="curriculum:国际经济与贸易本科人才培养方案",
            document_title="国际经济与贸易本科人才培养方案",
            row_id="page-0287-block-0001",
            parent_heading_hint="国际经济与贸易专业本科课程结构拓扑图",
            provider_bbox=(1.0, 2.0, 3.0, 4.0),
            provider_canvas=(100.0, 200.0),
            pdf_bbox=(1.0, 2.0, 3.0, 4.0),
            full_page_png=b"full-page",
            crop_png=b"crop-page",
        )

        with patch(
            "campus_ingestion_core.curriculum_course_map_multimodal_probe._request_course_map_probe_chat_completion",
            return_value={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": (
                                '{"course_maps":[],"manual_review_required":false,'
                                '"global_manual_review_notes":[]}'
                            ),
                        }
                    }
                ]
            },
        ) as chat_request:
            payload = _request_course_map_probe_payload(
                transport="chat_completions",
                api_key="test-key",
                model_name="gpt-test",
                base_url="https://example.test/v1",
                reasoning_effort=None,
                max_output_tokens=256,
                rendered_sample=rendered_sample,
            )

        chat_request.assert_called_once()
        self.assertEqual(payload["course_maps"], [])
        self.assertFalse(payload["manual_review_required"])

    def test_request_response_falls_back_to_plain_json_when_schema_multimodal_5xx(self) -> None:
        first_response = httpx.Response(
            502,
            request=httpx.Request("POST", "https://example.test/v1/responses"),
            text="bad gateway",
        )
        second_response = httpx.Response(
            200,
            request=httpx.Request("POST", "https://example.test/v1/responses"),
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": (
                                    '{"course_maps":[],"manual_review_required":false,'
                                    '"global_manual_review_notes":[]}'
                                ),
                            }
                        ],
                    }
                ],
            },
        )

        class _FakeClient:
            def __init__(self, responses: list[httpx.Response]) -> None:
                self._responses = list(responses)
                self.calls: list[dict[str, object]] = []

            def __enter__(self) -> "_FakeClient":
                return self

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

            def post(self, url: str, *, json: dict[str, object], headers: dict[str, str]):
                self.calls.append(json)
                return self._responses.pop(0)

        fake_client = _FakeClient([first_response, second_response])
        rendered_sample = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p287",
            page_number=287,
            document_id="curriculum:国际经济与贸易本科人才培养方案",
            document_title="国际经济与贸易本科人才培养方案",
            row_id="page-0287-block-0001",
            parent_heading_hint="国际经济与贸易专业本科课程结构拓扑图",
            provider_bbox=(1.0, 2.0, 3.0, 4.0),
            provider_canvas=(100.0, 200.0),
            pdf_bbox=(1.0, 2.0, 3.0, 4.0),
            full_page_png=b"full-page",
            crop_png=b"crop-page",
        )

        with patch(
            "campus_ingestion_core.curriculum_course_map_multimodal_probe.httpx.Client",
            return_value=fake_client,
        ):
            payload = _request_course_map_probe_response(
                api_key="test-key",
                model_name="gpt-test",
                base_url="https://example.test/v1",
                reasoning_effort=None,
                max_output_tokens=256,
                rendered_sample=rendered_sample,
            )

        self.assertEqual(len(fake_client.calls), 2)
        self.assertIn("text", fake_client.calls[0])
        self.assertNotIn("text", fake_client.calls[1])
        parsed = _extract_output_parsed(payload)
        self.assertEqual(parsed["course_maps"], [])
        self.assertFalse(parsed["manual_review_required"])

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
            source_pdf_key="official_pdf/curriculum-plan/2022/sha256/test/capture/curriculum-plan-2022.pdf",
            provider_response_key=(
                "official_pdf/curriculum-plan/2022/sha256/test/provider/paddleocr-vl-1-5/provider-response.jsonl"
            ),
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            raw_asset_id="asset:curriculum-plan-2022",
            raw_version_id="sha256:test",
        )

        self.assertEqual([item.page_number for item in inventory], [287, 297])
        self.assertEqual(inventory[0].document_id, "curriculum:国际经济与贸易本科人才培养方案")
        self.assertEqual(inventory[0].parent_heading_hint, "国际经济与贸易专业本科课程结构拓扑图")
        self.assertEqual(inventory[0].provider_page_height, 1561.0)
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
        self.assertAlmostEqual(pdf_bbox[2], 552.8827674567584)
        self.assertAlmostEqual(pdf_bbox[3], 399.1543882126841)

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

            self.assertEqual(rendered.page_number, 1)
            self.assertTrue(rendered.full_page_png.startswith(b"\x89PNG"))
            self.assertTrue(rendered.crop_png.startswith(b"\x89PNG"))
            self.assertIsNotNone(rendered.full_page_image_path)
            self.assertIsNotNone(rendered.crop_image_path)

    def test_repeatability_and_gold_reports_score_stable_surface(self) -> None:
        run_one = CurriculumCourseMapProbeRun(
            run_index=1,
            pages=(
                _make_page_probe(
                    sample_id="course-map-p287",
                    page_number=287,
                    document_id="curriculum:国际经济与贸易本科人才培养方案",
                    document_title="国际经济与贸易本科人才培养方案",
                    map_title="国际经济与贸易专业本科课程结构拓扑图",
                    nodes=("政治经济学（资）", "政治经济学（社）", "国际经济学"),
                    edges=(("政治经济学（资）", "政治经济学（社）"),),
                ),
            ),
        )
        run_two = CurriculumCourseMapProbeRun(
            run_index=2,
            pages=(
                _make_page_probe(
                    sample_id="course-map-p287",
                    page_number=287,
                    document_id="curriculum:国际经济与贸易本科人才培养方案",
                    document_title="国际经济与贸易本科人才培养方案",
                    map_title="国际经济与贸易专业本科课程结构拓扑图",
                    nodes=("政治经济学（资）", "政治经济学（社）", "国际经济学"),
                    edges=(("政治经济学（资）", "政治经济学（社）"),),
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
                    page_number=287,
                    document_id="curriculum:国际经济与贸易本科人才培养方案",
                    document_title="国际经济与贸易本科人才培养方案",
                    expected_map_titles=("国际经济与贸易专业本科课程结构拓扑图",),
                    expected_node_labels=("政治经济学（资）", "国际经济学"),
                    expected_edges=(("政治经济学（资）", "政治经济学（社）"),),
                ),
            ),
        )
        admission = build_curriculum_course_map_admission_summary(
            repeatability=repeatability,
            gold=gold,
        )

        self.assertEqual(repeatability.page_scores[0].overall_score, 1.0)
        self.assertTrue(repeatability.page_scores[0].passed)
        self.assertEqual(gold.page_scores[0].title_recall, 1.0)
        self.assertEqual(gold.page_scores[0].node_recall, 1.0)
        self.assertEqual(gold.page_scores[0].edge_recall, 1.0)
        self.assertEqual(admission.recommendation, "bounded_candidate_for_follow_up")

    def test_run_probe_builds_artifacts_with_mocked_page_probe(self) -> None:
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
            "manifest_version": "curriculum_course_map_probe_gold_v1",
            "entries": [
                {
                    "page_number": 1,
                    "document_id": "curriculum:英语本科人才培养方案",
                    "document_title": "英语本科人才培养方案",
                    "expected_map_titles": ["英语专业本科课程结构拓扑图"],
                    "expected_node_labels": ["综合英语（一）", "综合英语（二）"],
                    "expected_edges": [["综合英语（一）", "综合英语（二）"]],
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
            split_manifest_path.write_text(
                json.dumps(split_manifest, ensure_ascii=False), encoding="utf-8"
            )
            sample_manifest_path.write_text(
                json.dumps(sample_manifest, ensure_ascii=False), encoding="utf-8"
            )
            gold_manifest_path.write_text(
                json.dumps(gold_manifest, ensure_ascii=False), encoding="utf-8"
            )

            with patch(
                "campus_ingestion_core.curriculum_course_map_multimodal_probe.probe_curriculum_course_map_page",
                return_value=_make_page_probe(
                    sample_id="course-map-p001",
                    page_number=1,
                    document_id="curriculum:英语本科人才培养方案",
                    document_title="英语本科人才培养方案",
                    map_title="英语专业本科课程结构拓扑图",
                    nodes=("综合英语（一）", "综合英语（二）"),
                    edges=(("综合英语（一）", "综合英语（二）"),),
                ),
            ):
                report = run_curriculum_course_map_multimodal_probe(
                    source={"PROMPT_RUNTIME_API_KEY": "test", "PROMPT_RUNTIME_MODEL": "gpt-test"},
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
                    output_dir=tmp_path / "probe-output",
                    prompt_runs=2,
                )

            self.assertEqual(report.inventory_count, 1)
            self.assertEqual(report.selected_sample_count, 1)
            self.assertEqual(report.run_count, 2)
            self.assertEqual(report.repeatability.overall_score, 1.0)
            self.assertEqual(report.gold.pass_rate, 1.0)
            self.assertTrue((tmp_path / "probe-output" / "probe-report.json").exists())


if __name__ == "__main__":
    unittest.main()
