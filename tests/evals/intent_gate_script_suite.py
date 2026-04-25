from __future__ import annotations

import json
import unittest

from scripts.intent_gate import main as intent_gate_main
from tests.evals.formal_benchmark_test_support import Path, TemporaryDirectory


class IntentGateScriptTest(unittest.TestCase):
    def test_default_intent_gate_runs_release_context_version_and_observed_suites(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "intent-gate.json"

            exit_code = intent_gate_main(["--output", str(output_path)])

            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["runner"], "supervisor-api-go")
        self.assertEqual(payload["case_set_version"], "intent-case-set-v1")
        self.assertEqual(payload["policy_artifact"]["policy_version"], "runtime-policy-v1")
        self.assertEqual(payload["policy_artifact"]["classifier_version"], "go-runtime-policy-v1")
        self.assertEqual(payload["policy_artifact"]["intent_schema_version"], "intent-schema-1.0.0")
        self.assertEqual(
            tuple(payload["suites"].keys()),
            ("release_gate", "context_follow_up", "version_compat", "observed_regression"),
        )
        self.assertEqual(payload["failed"], 0)
        self.assertGreater(payload["suites"]["observed_regression"]["total"], 0)


if __name__ == "__main__":
    unittest.main()
