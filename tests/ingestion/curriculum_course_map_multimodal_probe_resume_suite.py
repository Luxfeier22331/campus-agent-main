from __future__ import annotations

import unittest

from .curriculum_course_map_multimodal_probe_test_support import *


class CurriculumCourseMapMultimodalProbeResumeTest(unittest.TestCase):
    def test_run_probe_fails_closed_after_pdf_rendering_probe_retirement(self) -> None:
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

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
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
                        "source_bucket": "campus-agent-source",
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

            with (
                patch.object(
                    _probe_module,
                    "_probe_curriculum_course_map_page_async",
                    side_effect=AssertionError("retired renderer must fail before remote probe"),
                ),
                self.assertRaisesRegex(RuntimeError, "PDF rendering probe is retired"),
            ):
                run_curriculum_course_map_multimodal_probe(
                    source={
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_API_KEY": "test",
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_MODEL": "gpt-test",
                    },
                    source_bucket="campus-agent-source",
                    split_manifest_path=split_manifest_path,
                    sample_manifest_path=sample_manifest_path,
                    gold_manifest_path=gold_manifest_path,
                    pdf_bytes=b"%PDF-fixture%",
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
                    prompt_transport="chat_completions",
                    resume=True,
                )
