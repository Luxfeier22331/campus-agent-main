from __future__ import annotations

import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_contracts import EvidenceBundle
from campus_evals.ragas_diagnostic_runner import (
    DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    build_ragas_diagnostic_sample_manifest,
    combine_ragas_diagnostic_reports,
    main,
    run_ragas_diagnostic,
)

from tests.evals.retrieval_benchmark_test_support import _source


class RagasDiagnosticRunnerSuite(unittest.TestCase):
    def test_build_sample_manifest_selects_fixed_core_surface_cases(self) -> None:
        manifest = build_ragas_diagnostic_sample_manifest(sample_limit_per_surface=3)

        self.assertEqual(
            manifest["schema_version"],
            "ragas-diagnostic-sample-manifest.v1",
        )
        self.assertEqual(manifest["sample_limit_per_surface"], 3)
        self.assertEqual(len(manifest["cases"]), 9)
        self.assertEqual(
            {case["surface_key"] for case in manifest["cases"]},
            {
                "regulations/student_rules",
                "regulations/institutional_rules",
                "curriculum/curriculum_plan",
            },
        )
        self.assertEqual(
            manifest["cases"][0]["case_id"],
            "policy-title-scholarship",
        )

    def test_run_ragas_diagnostic_uses_retrieved_evidence_and_fake_scorer(self) -> None:
        seen_bundles: list[EvidenceBundle] = []

        class FakeBackend:
            def retrieve(self, request):
                bundle = EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_source(doc_id=f"{request.collection}:doc"),),
                )
                seen_bundles.append(bundle)
                return bundle

        def fake_scorer(projection):
            return {
                "faithfulness": 0.91,
            }

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=fake_scorer,
            sample_limit_per_surface=1,
            metric_names=("faithfulness",),
        )

        self.assertTrue(report["passed"])
        self.assertEqual(report["summary"]["total_cases"], 3)
        self.assertEqual(report["summary"]["failed_cases"], 0)
        self.assertEqual(report["run_config"]["sample_limit_per_surface"], 1)
        self.assertEqual(report["run_config"]["top_k"], 5)
        self.assertEqual(report["run_config"]["metric_names"], ["faithfulness"])
        self.assertEqual(len(seen_bundles), 3)
        self.assertTrue(report["cases"][0]["answer_text"])
        self.assertEqual(report["cases"][0]["answer_shape"], "general_summary")
        self.assertEqual(report["cases"][0]["scores"]["faithfulness"], 0.91)
        self.assertNotIn("answer_relevancy", report["cases"][0]["scores"])
        self.assertEqual(report["cases"][0]["retrieved_context_count"], 1)
        self.assertEqual(report["cases"][0]["raw_retrieved_doc_ids"], ["student_rules:doc"])
        self.assertEqual(report["cases"][0]["selected_support_doc_ids"], ["student_rules:doc"])
        self.assertIn("duration_ms", report["cases"][0])
        self.assertEqual(
            set(report["cases"][0]["performance_breakdown"]),
            {
                "retrieval_ms",
                "answer_ms",
                "scorer_ms",
                "diagnostic_ms",
                "dependency_wait_ms",
            },
        )
        self.assertEqual(
            report["cases"][0]["failure_attribution"]["primary_stage"],
            "passed",
        )

    def test_run_ragas_diagnostic_attributes_low_scores_to_retrieval_or_synthesis(
        self,
    ) -> None:
        class WrongBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_source(doc_id="wrong:doc"),),
                )

        report = run_ragas_diagnostic(
            backend=WrongBackend(),
            scorer=lambda projection: {"context_recall": 0.2, "answer_relevancy": 0.4},
            sample_limit_per_surface=1,
            metric_names=("context_recall", "answer_relevancy"),
        )

        first_case = report["cases"][0]
        self.assertEqual(
            first_case["failure_attribution"]["metric_failures"],
            {
                "answer_relevancy": "synthesis",
                "context_recall": "retrieval",
            },
        )
        self.assertEqual(first_case["failure_attribution"]["primary_stage"], "retrieval")
        self.assertEqual(report["summary"]["failure_attribution"]["retrieval"], 3)
        self.assertEqual(report["summary"]["performance_breakdown"]["case_count"], 3)
        self.assertIn("retrieval_ms", report["summary"]["performance_breakdown"])

    def test_run_ragas_diagnostic_respects_case_workers_and_preserves_order(self) -> None:
        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_source(doc_id=f"{request.collection}:{request.query_text}"),),
                )

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=lambda projection: {"context_precision": 1.0},
            sample_limit_per_surface=2,
            metric_names=("context_precision",),
            case_workers=2,
        )

        self.assertTrue(report["passed"])
        self.assertEqual(report["run_config"]["case_workers"], 2)
        self.assertEqual(len(report["cases"]), 6)
        self.assertEqual(report["cases"][0]["case_id"], "policy-title-scholarship")
        self.assertEqual(
            report["cases"][1]["case_id"], "policy-alias-national-scholarship-article-nine"
        )

    def test_run_ragas_diagnostic_rejects_invalid_case_workers(self) -> None:
        with self.assertRaisesRegex(ValueError, "case_workers must be greater than zero"):
            run_ragas_diagnostic(
                backend=object(),
                scorer=lambda projection: {"context_precision": 1.0},
                sample_limit_per_surface=1,
                metric_names=("context_precision",),
                case_workers=0,
            )

    def test_cli_writes_manifest_and_report_with_fake_runtime(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            with redirect_stdout(StringIO()):
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
                    ]
                )
            manifest = json.loads((output_dir / "sample-manifest.json").read_text())
            report = json.loads((output_dir / "ragas-diagnostic.current.json").read_text())
            metric_report = json.loads(
                (output_dir / "ragas-diagnostic.context_precision.json").read_text()
            )
            summary = json.loads((output_dir / "ragas-diagnostic.summary.json").read_text())

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(manifest["cases"]), 3)
        self.assertTrue(report["passed"])
        self.assertEqual(report["run_config"]["metric_names"], ["context_precision"])
        self.assertEqual(report["run_config"]["case_workers"], 2)
        self.assertEqual(metric_report["summary"]["metrics"]["context_precision"]["count"], 3)
        self.assertEqual(summary["total_cases"], 3)
        self.assertEqual(summary["metrics"]["context_precision"]["count"], 3)
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


def _report(*, metric_name: str, cases: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schema_version": "ragas-diagnostic-report.v1",
        "report_id": "ragas_diagnostic",
        "passed": True,
        "mode": "diagnostic_non_blocking",
        "run_config": {"metric_names": [metric_name]},
        "sample_manifest": {"metric_names": [metric_name]},
        "summary": {},
        "cases": cases,
    }


def _case(
    surface_key: str,
    case_id: str,
    metric_name: str,
    score: float,
) -> dict[str, object]:
    return {
        "surface_key": surface_key,
        "case_id": case_id,
        "split": "release_gate",
        "query": f"query {case_id}",
        "expected_doc_ids": [f"{case_id}:expected"],
        "forbidden_doc_ids": [],
        "status": "completed",
        "answer_text": f"answer {case_id}",
        "retrieved_context_count": 1,
        "retrieved_context_ids": [f"{case_id}:retrieved"],
        "raw_retrieved_doc_ids": [f"{case_id}:retrieved"],
        "selected_support_doc_ids": [f"{case_id}:retrieved"],
        "duration_ms": 1,
        "scores": {metric_name: score},
    }


if __name__ == "__main__":
    unittest.main()
