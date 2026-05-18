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

    def test_combine_ragas_diagnostic_reports_merges_metric_scores_and_low_cases(self) -> None:
        combined = combine_ragas_diagnostic_reports(
            [
                _report(
                    metric_name="context_recall",
                    cases=[
                        _case("student", "a", "context_recall", 1.0),
                        _case("student", "b", "context_recall", 0.25),
                    ],
                ),
                _report(
                    metric_name="answer_relevancy",
                    cases=[
                        _case("student", "a", "answer_relevancy", 0.91),
                        _case("student", "b", "answer_relevancy", 0.48),
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

    def test_cli_combines_existing_metric_reports_without_running_retrieval(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            (output_dir / "ragas-diagnostic.context_recall.json").write_text(
                json.dumps(
                    _report(
                        metric_name="context_recall",
                        cases=[_case("student", "a", "context_recall", 0.25)],
                    )
                ),
                encoding="utf-8",
            )
            (output_dir / "ragas-diagnostic.answer_relevancy.json").write_text(
                json.dumps(
                    _report(
                        metric_name="answer_relevancy",
                        cases=[_case("student", "a", "answer_relevancy", 0.48)],
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
        self.assertEqual(summary["metrics"]["context_recall"]["min"], 0.25)


if __name__ == "__main__":
    unittest.main()
