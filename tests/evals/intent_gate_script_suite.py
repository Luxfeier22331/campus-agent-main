from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from scripts.intent_gate import main as intent_gate_main
from tests.evals.formal_benchmark_test_support import Path, TemporaryDirectory


class IntentGateScriptTest(unittest.TestCase):
    def test_default_intent_gate_runs_release_context_version_observed_and_synthetic_suites(
        self,
    ) -> None:
        with TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "intent-gate.json"

            exit_code = intent_gate_main(["--output", str(output_path)])

            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["runner"], "execution-control-go")
        self.assertEqual(payload["case_set_version"], "intent-case-set-v2")
        self.assertEqual(payload["policy_artifact"]["policy_version"], "runtime-policy-v1")
        self.assertEqual(payload["policy_artifact"]["classifier_version"], "go-runtime-policy-v2")
        self.assertEqual(payload["policy_artifact"]["intent_schema_version"], "intent-schema-1.0.0")
        self.assertEqual(
            tuple(payload["suites"].keys()),
            (
                "release_gate",
                "context_follow_up",
                "version_compat",
                "observed_regression",
                "synthetic_regression",
            ),
        )
        self.assertEqual(payload["failed"], 0)
        self.assertGreater(payload["suites"]["observed_regression"]["total"], 0)
        self.assertGreaterEqual(payload["suites"]["synthetic_regression"]["total"], 100)

    def test_report_only_intent_gate_writes_failures_without_failing_process(self) -> None:
        payload = {
            "schema_version": 1,
            "runner": "execution-control-go",
            "case_set_version": "intent-case-set-v2",
            "policy_artifact": {
                "schema_version": "intent-policy-artifact-v1",
                "policy_version": "runtime-policy-v1",
                "classifier_version": "go-runtime-policy-v2",
                "intent_schema_version": "intent-schema-1.0.0",
            },
            "total": 2,
            "passed": 1,
            "failed": 1,
            "critical_total": 1,
            "critical_passed": 0,
            "suites": {"synthetic_exploratory": {"total": 2, "passed": 1, "failed": 1}},
        }
        with TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "intent-gate.json"

            with patch("scripts.intent_gate.run_intent_gate", return_value=payload):
                exit_code = intent_gate_main(
                    [
                        "--suite",
                        "synthetic_exploratory",
                        "--report-only",
                        "--output",
                        str(output_path),
                    ]
                )

            written_payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(written_payload["failed"], 1)


if __name__ == "__main__":
    unittest.main()
