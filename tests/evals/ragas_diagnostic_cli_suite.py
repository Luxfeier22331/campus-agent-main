from __future__ import annotations

import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_contracts import EvidenceBundle
from campus_evals.ragas_diagnostic_runner import (
    DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    combine_ragas_diagnostic_reports,
    main,
)

from tests.evals.ragas_diagnostic_test_support import (
    _case,
    _diagnostic_source_for_request,
    _report,
)


class RagasDiagnosticCliSuite(unittest.TestCase):
    def test_cli_writes_manifest_and_report_with_fake_runtime(self) -> None:
        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_diagnostic_source_for_request(request),),
                )

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            with (
                patch(
                    "campus_evals.ragas_diagnostic_runner.build_retrieval_backend",
                    return_value=FakeBackend(),
                ),
                redirect_stdout(StringIO()),
            ):
                exit_code = main(
                    [
                        "--output-dir",
                        str(output_dir),
                        "--sample-limit-per-surface",
                        "1",
                        "--fake-scorer",
                        "--metric-name",
                        "context_precision",
                        "--case-workers",
                        "2",
                        "--case-id",
                        "policy-title-scholarship",
                    ]
                )
            manifest = json.loads((output_dir / "sample-manifest.json").read_text())
            report = json.loads((output_dir / "ragas-diagnostic.current.json").read_text())
            metric_report = json.loads(
                (output_dir / "ragas-diagnostic.context_precision.json").read_text()
            )
            summary = json.loads((output_dir / "ragas-diagnostic.summary.json").read_text())

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(manifest["cases"]), 1)
        self.assertEqual(manifest["case_ids"], ["policy-title-scholarship"])
        self.assertTrue(report["passed"])
        self.assertEqual(report["run_config"]["metric_names"], ["context_precision"])
        self.assertEqual(report["run_config"]["case_workers"], 2)
        self.assertEqual(report["run_config"]["case_ids"], ["policy-title-scholarship"])
        self.assertEqual(metric_report["summary"]["metrics"]["context_precision"]["count"], 1)
        self.assertEqual(summary["total_cases"], 1)
        self.assertEqual(summary["metrics"]["context_precision"]["count"], 1)
        self.assertNotIn("faithfulness", summary["metrics"])
        self.assertEqual(
            DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
            12,
        )

    def test_cli_writes_full_denominator_manifest_with_excluded_cases(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            with (
                patch(
                    "campus_evals.ragas_diagnostic_runner.build_retrieval_backend",
                    return_value=object(),
                ),
                patch(
                    "campus_evals.ragas_diagnostic_runner.run_ragas_diagnostic",
                    return_value={
                        "schema_version": "ragas-diagnostic-report.v1",
                        "report_id": "ragas_diagnostic",
                        "passed": True,
                        "mode": "diagnostic_non_blocking",
                        "run_config": {
                            "case_selection": "full-denominator",
                            "metric_names": ["identity_grounding"],
                        },
                        "sample_manifest": {},
                        "summary": {"total_cases": 152},
                        "cases": [],
                    },
                ),
                redirect_stdout(StringIO()),
            ):
                exit_code = main(
                    [
                        "--output-dir",
                        str(output_dir),
                        "--case-selection",
                        "full-denominator",
                        "--fake-scorer",
                        "--metric-name",
                        "identity_grounding",
                    ]
                )
            manifest = json.loads((output_dir / "sample-manifest.json").read_text())
            report = json.loads((output_dir / "ragas-diagnostic.current.json").read_text())

        self.assertEqual(exit_code, 0)
        self.assertEqual(manifest["case_selection"], "full-denominator")
        self.assertEqual(manifest["sample_limit_per_surface"], None)
        self.assertEqual(len(manifest["cases"]), 152)
        self.assertEqual(len(manifest["excluded_cases"]), 10)
        self.assertEqual(report["run_config"]["case_selection"], "full-denominator")
        self.assertEqual(report["run_config"]["metric_names"], ["identity_grounding"])

    def test_combine_ragas_diagnostic_reports_merges_metric_scores_and_low_cases(self) -> None:
        low_recall_case = _case("student", "b", "context_recall", 0.25)
        low_recall_case["failure_attribution"] = {
            "primary_stage": "retrieval",
            "metric_failures": {"context_recall": "retrieval"},
        }
        low_relevancy_case = _case("student", "b", "answer_relevancy", 0.48)
        low_relevancy_case["failure_attribution"] = {
            "primary_stage": "synthesis",
            "metric_failures": {"answer_relevancy": "synthesis"},
        }
        combined = combine_ragas_diagnostic_reports(
            [
                _report(
                    metric_name="context_recall",
                    cases=[
                        _case("student", "a", "context_recall", 1.0),
                        low_recall_case,
                    ],
                ),
                _report(
                    metric_name="answer_relevancy",
                    cases=[
                        _case("student", "a", "answer_relevancy", 0.91),
                        low_relevancy_case,
                    ],
                ),
            ]
        )

        self.assertTrue(combined["passed"])
        self.assertEqual(combined["summary"]["total_reports"], 2)
        self.assertEqual(
            combined["summary"]["run_configs"],
            [
                {"metric_names": ["context_recall"]},
                {"metric_names": ["answer_relevancy"]},
            ],
        )
        self.assertEqual(combined["summary"]["total_cases"], 2)
        self.assertEqual(combined["summary"]["metrics"]["context_recall"]["min"], 0.25)
        self.assertEqual(combined["summary"]["metrics"]["answer_relevancy"]["min"], 0.48)
        self.assertEqual(
            [item["metric_name"] for item in combined["summary"]["low_score_cases"]],
            ["context_recall", "answer_relevancy"],
        )
        self.assertEqual(
            combined["cases"][1]["scores"],
            {"answer_relevancy": 0.48, "context_recall": 0.25},
        )
        self.assertEqual(
            combined["cases"][1]["failure_attribution"],
            {
                "primary_stage": "retrieval",
                "metric_failures": {
                    "answer_relevancy": "synthesis",
                    "context_recall": "retrieval",
                },
            },
        )

    def test_combine_ragas_diagnostic_reports_requires_low_score_failure_attribution(
        self,
    ) -> None:
        case = _case("student", "a", "faithfulness", 0.31)
        case["failure_attribution"] = {"primary_stage": "passed", "metric_failures": {}}

        with self.assertRaisesRegex(ValueError, "low-score metric faithfulness"):
            combine_ragas_diagnostic_reports([_report(metric_name="faithfulness", cases=[case])])

    def test_combine_ragas_diagnostic_reports_promotes_diagnostic_fields_from_scored_case(
        self,
    ) -> None:
        not_applicable_case = _case("student", "a", "answer_relevancy", None)
        not_applicable_case["scores"] = {}
        not_applicable_case["diagnostic_reason"] = "metric_not_applicable"
        not_applicable_case["answer_text"] = ""
        not_applicable_case["retrieved_context_ids"] = []
        not_applicable_case["raw_retrieved_doc_ids"] = []
        not_applicable_case["selected_support_doc_ids"] = []
        not_applicable_case["selected_support_chunk_ids"] = []
        not_applicable_case["metric_applicability"] = {"answer_relevancy": False}
        scored_case = _case("student", "a", "faithfulness", 0.31)
        scored_case["answer_text"] = "answer with support"
        scored_case["answer_shape"] = "fact_lookup"
        scored_case["diagnostic_reason"] = ""
        scored_case["retrieved_context_ids"] = ["chunk:faithful"]
        scored_case["raw_retrieved_doc_ids"] = ["doc:faithful"]
        scored_case["selected_support_doc_ids"] = ["doc:faithful"]
        scored_case["selected_support_chunk_ids"] = ["chunk:faithful"]
        scored_case["failure_attribution"] = {
            "primary_stage": "synthesis",
            "metric_failures": {"faithfulness": "synthesis"},
        }

        combined = combine_ragas_diagnostic_reports(
            [
                _report(metric_name="answer_relevancy", cases=[not_applicable_case]),
                _report(metric_name="faithfulness", cases=[scored_case]),
            ]
        )

        case = combined["cases"][0]
        self.assertEqual(case["answer_text"], "answer with support")
        self.assertEqual(case["answer_shape"], "fact_lookup")
        self.assertEqual(case["retrieved_context_ids"], ["chunk:faithful"])
        self.assertEqual(case["raw_retrieved_doc_ids"], ["doc:faithful"])
        self.assertEqual(case["selected_support_doc_ids"], ["doc:faithful"])
        self.assertEqual(case["selected_support_chunk_ids"], ["chunk:faithful"])
        self.assertEqual(case["diagnostic_reason"], "")

    def test_combine_ragas_diagnostic_reports_marks_null_requested_metric_as_failure(self) -> None:
        combined = combine_ragas_diagnostic_reports(
            [
                _report(
                    metric_name="answer_relevancy",
                    cases=[_case("student", "a", "answer_relevancy", None)],
                )
            ]
        )

        self.assertFalse(combined["passed"])
        self.assertEqual(combined["summary"]["failed_cases"], 1)
        self.assertEqual(combined["summary"]["metrics"]["answer_relevancy"]["count"], 0)
        self.assertEqual(combined["cases"][0]["status"], "failed")
        self.assertEqual(combined["cases"][0]["scores"], {"answer_relevancy": None})
        self.assertEqual(
            combined["cases"][0]["metric_failures"],
            [
                {
                    "metric_names": ["answer_relevancy"],
                    "error_type": "RagasMetricUnavailable",
                    "error_message": (
                        "requested RAGAS metric answer_relevancy did not return a numeric score"
                    ),
                }
            ],
        )

    def test_combine_ragas_diagnostic_reports_respects_metric_applicability(self) -> None:
        case = _case("student", "a", "identity_grounding", None)
        case["scores"] = {}
        case["metric_applicability"] = {"identity_grounding": False}

        combined = combine_ragas_diagnostic_reports(
            [_report(metric_name="identity_grounding", cases=[case])]
        )

        self.assertTrue(combined["passed"])
        self.assertEqual(combined["summary"]["failed_cases"], 0)
        self.assertEqual(combined["summary"]["metrics"]["identity_grounding"]["count"], 0)
        self.assertEqual(combined["cases"][0]["scores"], {})
        self.assertEqual(
            combined["cases"][0]["metric_applicability"],
            {"identity_grounding": False},
        )

    def test_cli_combines_existing_metric_reports_without_running_retrieval(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            (output_dir / "ragas-diagnostic.all.json").write_text(
                json.dumps(
                    _report(
                        metric_name="faithfulness",
                        cases=[_case("student", "a", "faithfulness", None)],
                    )
                ),
                encoding="utf-8",
            )
            low_recall_case = _case("student", "a", "context_recall", 0.25)
            low_recall_case["failure_attribution"] = {
                "primary_stage": "retrieval",
                "metric_failures": {"context_recall": "retrieval"},
            }
            low_relevancy_case = _case("student", "a", "answer_relevancy", 0.48)
            low_relevancy_case["failure_attribution"] = {
                "primary_stage": "synthesis",
                "metric_failures": {"answer_relevancy": "synthesis"},
            }
            (output_dir / "ragas-diagnostic.context_recall.json").write_text(
                json.dumps(
                    _report(
                        metric_name="context_recall",
                        cases=[low_recall_case],
                    )
                ),
                encoding="utf-8",
            )
            (output_dir / "ragas-diagnostic.answer_relevancy.json").write_text(
                json.dumps(
                    _report(
                        metric_name="answer_relevancy",
                        cases=[low_relevancy_case],
                    )
                ),
                encoding="utf-8",
            )

            with redirect_stdout(StringIO()):
                exit_code = main(["--output-dir", str(output_dir), "--combine-existing-reports"])
            combined = json.loads((output_dir / "ragas-diagnostic.combined.json").read_text())
            summary = json.loads((output_dir / "ragas-diagnostic.summary.json").read_text())

        self.assertEqual(exit_code, 0)
        self.assertEqual(combined["summary"]["total_reports"], 2)
        self.assertNotIn("faithfulness", combined["summary"]["metrics"])
        self.assertEqual(summary["metrics"]["context_recall"]["min"], 0.25)


if __name__ == "__main__":
    unittest.main()
