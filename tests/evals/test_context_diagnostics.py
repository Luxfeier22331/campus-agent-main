from __future__ import annotations

from contextlib import redirect_stdout
from dataclasses import asdict
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_contracts import EvidenceSource
from campus_evals.context_diagnostics import build_context_diagnostics, main as context_diagnostics_main


def _source(
    doc_id: str,
    *,
    chunk_id: str,
    source_title: str,
    snippet: str,
    collection: str = "curriculum_plan",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id="v1",
        chunk_id=chunk_id,
        anchor={"page": 1},
        canonical_url=f"https://example.edu/{doc_id}",
        latest_url=f"https://example.edu/{doc_id}",
        source_channel="pdf_ocr",
        collection=collection,
        is_current=True,
        snippet=snippet,
        score=0.91,
        source_title=source_title,
    )


class ContextDiagnosticsTest(unittest.TestCase):
    def test_build_context_diagnostics_reconstructs_projection_for_curriculum_completed_case(self) -> None:
        completed_sources = (
            _source(
                "curriculum:民族学本科人才培养方案",
                chunk_id="chunk-1",
                source_title="三、学制、总学分和学位授予",
                snippet="总学分 159，授予法学学士学位。",
            ),
            _source(
                "curriculum:民族学本科人才培养方案",
                chunk_id="chunk-2",
                source_title="四、各教学环节学时学分",
                snippet="总学分 | 159",
            ),
        )
        case_results_payload = {
            "schema_version": 1,
            "benchmark_type": "curriculum_live_gate",
            "run_number": 1,
            "results": [
                {
                    "case_id": "curriculum-release-gate-total-credits",
                    "passed": True,
                    "status_result": {"passed": True, "reason": "ok"},
                    "retrieval_result": {"passed": True, "reason": "ok"},
                    "answer_result": {"passed": True, "reason": "ok"},
                    "trace_result": {"passed": True, "reason": "ok"},
                    "metric_results": {},
                    "observed_trace": {
                        "selected_scope": {"corpus": "curriculum", "collection": "curriculum_plan"},
                        "retrieval_called": True,
                        "clarification_emitted": False,
                        "error_path": False,
                        "retrieved_sources": [asdict(source) for source in completed_sources],
                        "supporting_sources": [asdict(source) for source in completed_sources],
                    },
                    "supplemental_results": [
                        {
                            "adapter_id": "ragas",
                            "metric_name": "context_precision",
                            "score": 0.0,
                            "verdict": None,
                            "rationale": "artifact warning sample",
                            "gating": False,
                            "metadata": {
                                "case_id": "curriculum-release-gate-total-credits",
                                "expected_status": "completed",
                                "response_status": "completed",
                            },
                        },
                        {
                            "adapter_id": "ragas",
                            "metric_name": "context_recall",
                            "score": 0.0,
                            "verdict": None,
                            "rationale": "artifact warning sample",
                            "gating": False,
                            "metadata": {
                                "case_id": "curriculum-release-gate-total-credits",
                                "expected_status": "completed",
                                "response_status": "completed",
                            },
                        },
                    ],
                },
                {
                    "case_id": "curriculum-release-gate-no-answer",
                    "passed": True,
                    "status_result": {"passed": True, "reason": "ok"},
                    "retrieval_result": {"passed": True, "reason": "ok"},
                    "answer_result": {"passed": True, "reason": "ok"},
                    "trace_result": {"passed": True, "reason": "ok"},
                    "metric_results": {},
                    "observed_trace": {
                        "selected_scope": {"corpus": "curriculum", "collection": "curriculum_plan"},
                        "retrieval_called": True,
                        "clarification_emitted": False,
                        "error_path": False,
                        "retrieved_sources": [],
                        "supporting_sources": [],
                    },
                    "supplemental_results": [
                        {
                            "adapter_id": "ragas",
                            "metric_name": "context_precision",
                            "score": None,
                            "verdict": "not_applicable",
                            "rationale": "completed-only metric",
                            "gating": False,
                            "metadata": {
                                "case_id": "curriculum-release-gate-no-answer",
                                "expected_status": "no_answer",
                                "response_status": "no_answer",
                            },
                        }
                    ],
                },
            ],
        }

        diagnostics = build_context_diagnostics(
            case_results_payload=case_results_payload,
            scenario_set="curriculum_live_gate",
        )

        completed_case = next(item for item in diagnostics["cases"] if item["case_id"] == "curriculum-release-gate-total-credits")
        self.assertEqual(completed_case["context_metric_applicability"]["context_precision"], True)
        self.assertEqual(completed_case["artifact_scores"]["context_precision"], 0.0)
        self.assertEqual(completed_case["projection"]["metric_route"], "id_based")
        self.assertEqual(
            completed_case["projection"]["retrieved_context_ids"],
            ["curriculum:民族学本科人才培养方案"],
        )
        self.assertEqual(
            completed_case["projection"]["reference_context_ids"],
            ["curriculum:民族学本科人才培养方案"],
        )
        self.assertEqual(completed_case["projection"]["missing_reference_context_ids"], [])
        self.assertEqual(completed_case["projection"]["extra_retrieved_context_ids"], [])
        self.assertEqual(completed_case["projection"]["supporting_source_count"], 2)

        no_answer_case = next(item for item in diagnostics["cases"] if item["case_id"] == "curriculum-release-gate-no-answer")
        self.assertEqual(no_answer_case["context_metric_applicability"]["context_precision"], False)
        self.assertIsNone(no_answer_case["projection"])

    def test_build_context_diagnostics_uses_internal_course_fact_reference_ids(self) -> None:
        completed_sources = (
            _source(
                "course_facts:muc.xigai-semester",
                chunk_id="course-facts:xigai-semester",
                source_title="中央民族大学通识课程思想政治理论课教学计划",
                snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                collection="course_facts",
            ),
        )
        case_results_payload = {
            "schema_version": 1,
            "benchmark_type": "curriculum_live_gate",
            "run_number": 1,
            "results": [
                {
                    "case_id": "curriculum-release-gate-course-single-schedule",
                    "passed": True,
                    "status_result": {"passed": True, "reason": "ok"},
                    "retrieval_result": {"passed": True, "reason": "ok"},
                    "answer_result": {"passed": True, "reason": "ok"},
                    "trace_result": {"passed": True, "reason": "ok"},
                    "metric_results": {},
                    "observed_trace": {
                        "selected_scope": {"corpus": "curriculum", "collection": "curriculum_plan"},
                        "retrieval_called": True,
                        "clarification_emitted": False,
                        "error_path": False,
                        "retrieved_sources": [asdict(source) for source in completed_sources],
                        "supporting_sources": [asdict(source) for source in completed_sources],
                    },
                    "supplemental_results": [
                        {
                            "adapter_id": "ragas",
                            "metric_name": "context_precision",
                            "score": 1.0,
                            "verdict": None,
                            "rationale": "internal course_facts sample",
                            "gating": False,
                            "metadata": {
                                "case_id": "curriculum-release-gate-course-single-schedule",
                                "expected_status": "completed",
                                "response_status": "completed",
                            },
                        },
                        {
                            "adapter_id": "ragas",
                            "metric_name": "context_recall",
                            "score": 1.0,
                            "verdict": None,
                            "rationale": "internal course_facts sample",
                            "gating": False,
                            "metadata": {
                                "case_id": "curriculum-release-gate-course-single-schedule",
                                "expected_status": "completed",
                                "response_status": "completed",
                            },
                        },
                    ],
                },
            ],
        }

        diagnostics = build_context_diagnostics(
            case_results_payload=case_results_payload,
            scenario_set="curriculum_live_gate",
        )

        completed_case = diagnostics["cases"][0]
        self.assertEqual(completed_case["projection"]["metric_route"], "id_based")
        self.assertEqual(
            completed_case["projection"]["retrieved_context_ids"],
            ["course_facts:muc.xigai-semester"],
        )
        self.assertEqual(
            completed_case["projection"]["reference_context_ids"],
            ["course_facts:muc.xigai-semester"],
        )
        self.assertEqual(completed_case["projection"]["missing_reference_context_ids"], [])
        self.assertEqual(completed_case["projection"]["extra_retrieved_context_ids"], [])

    def test_context_diagnostics_main_supports_json_output(self) -> None:
        payload = {
            "schema_version": 1,
            "benchmark_type": "curriculum_live_gate",
            "run_number": 1,
            "results": [],
        }
        with TemporaryDirectory() as temp_dir:
            case_results_path = Path(temp_dir) / "run-01-case-results.json"
            case_results_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            buffer = io.StringIO()
            with redirect_stdout(buffer):
                exit_code = context_diagnostics_main(
                    [
                        "--case-results",
                        str(case_results_path),
                        "--scenario-set",
                        "curriculum_live_gate",
                        "--format",
                        "json",
                    ]
                )

        self.assertEqual(exit_code, 0)
        rendered = json.loads(buffer.getvalue())
        self.assertEqual(rendered["scenario_set"], "curriculum_live_gate")
        self.assertEqual(rendered["case_count"], 0)

    def test_context_diagnostics_main_loads_repo_env(self) -> None:
        payload = {
            "schema_version": 1,
            "benchmark_type": "curriculum_live_gate",
            "run_number": 1,
            "results": [],
        }
        with TemporaryDirectory() as temp_dir:
            case_results_path = Path(temp_dir) / "run-01-case-results.json"
            case_results_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            buffer = io.StringIO()
            with (
                patch("campus_evals.context_diagnostics.load_repo_env") as load_repo_env,
                redirect_stdout(buffer),
            ):
                exit_code = context_diagnostics_main(
                    [
                        "--case-results",
                        str(case_results_path),
                        "--scenario-set",
                        "curriculum_live_gate",
                        "--format",
                        "json",
                    ]
                )

        self.assertEqual(exit_code, 0)
        load_repo_env.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
