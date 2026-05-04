from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_contracts import EvidenceBundle
from campus_evals.ragas_diagnostic_runner import (
    DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    build_ragas_diagnostic_sample_manifest,
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
                "answer_relevancy": 0.82,
                "context_precision": 1.0,
                "context_recall": 1.0,
            }

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=fake_scorer,
            sample_limit_per_surface=1,
        )

        self.assertTrue(report["passed"])
        self.assertEqual(report["summary"]["total_cases"], 3)
        self.assertEqual(report["summary"]["failed_cases"], 0)
        self.assertEqual(len(seen_bundles), 3)
        self.assertTrue(report["cases"][0]["answer_text"])
        self.assertEqual(report["cases"][0]["scores"]["faithfulness"], 0.91)
        self.assertEqual(report["cases"][0]["retrieved_context_count"], 1)

    def test_cli_writes_manifest_and_report_with_fake_runtime(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            exit_code = main(
                [
                    "--output-dir",
                    str(output_dir),
                    "--sample-limit-per-surface",
                    "1",
                    "--fake-scorer",
                ]
            )
            manifest = json.loads((output_dir / "sample-manifest.json").read_text())
            report = json.loads((output_dir / "ragas-diagnostic.current.json").read_text())
            summary = json.loads((output_dir / "ragas-diagnostic.summary.json").read_text())

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(manifest["cases"]), 3)
        self.assertTrue(report["passed"])
        self.assertEqual(summary["total_cases"], 3)
        self.assertEqual(summary["metrics"]["faithfulness"]["count"], 3)
        self.assertEqual(
            DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
            12,
        )


if __name__ == "__main__":
    unittest.main()
