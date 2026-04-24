from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import yaml
from campus_evals.intent_models import IntentEvalReport

from scripts.intent_gate import DEFAULT_OUTPUT, main

ROOT = Path(__file__).resolve().parents[1]


def _report(*, failed: int) -> IntentEvalReport:
    total = 3
    passed = total - failed
    critical_total = 2
    critical_passed = critical_total - min(failed, critical_total)
    return IntentEvalReport(
        total=total,
        passed=passed,
        failed=failed,
        overall_exact_match_rate=passed / total,
        critical_total=critical_total,
        critical_passed=critical_passed,
        critical_gate_pass_rate=critical_passed / critical_total,
        confusion={},
        results=(),
    )


class IntentGateScriptTest(unittest.TestCase):
    def test_root_package_exposes_intent_eval_script(self) -> None:
        package_json = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

        self.assertEqual(
            package_json["scripts"]["eval:intent"],
            "uv run --all-packages python -m scripts.intent_gate",
        )

    def test_lint_workflow_runs_intent_gate_without_live_eval_gate(self) -> None:
        workflow = yaml.safe_load((ROOT / ".github/workflows/lint.yml").read_text(encoding="utf-8"))
        job = workflow["jobs"]["intent-release-gate"]
        run_steps = "\n".join(step.get("run", "") for step in job["steps"])

        self.assertIn("uv run --all-packages python -m scripts.intent_gate", run_steps)
        self.assertNotIn("scripts.eval_gate", run_steps)

    def test_default_output_is_repo_local_tmp_artifact(self) -> None:
        self.assertEqual(DEFAULT_OUTPUT, Path(".tmp/evals/intent-release-gate.json"))

    def test_main_writes_report_and_prints_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output = Path(tmp_dir) / "intent-report.json"
            stdout = io.StringIO()

            with (
                patch("scripts.intent_gate.intent_release_gate_cases", return_value=("case",)),
                patch("scripts.intent_gate.run_intent_cases", return_value=_report(failed=0)),
                redirect_stdout(stdout),
            ):
                exit_code = main(["--output", str(output)])

            self.assertEqual(exit_code, 0)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["passed"], 3)
            self.assertIn("Intent release gate: PASS", stdout.getvalue())
            self.assertIn("critical=2/2", stdout.getvalue())

    def test_main_returns_nonzero_when_intent_gate_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output = Path(tmp_dir) / "intent-report.json"
            stdout = io.StringIO()

            with (
                patch("scripts.intent_gate.intent_release_gate_cases", return_value=()),
                patch("scripts.intent_gate.run_intent_cases", return_value=_report(failed=1)),
                redirect_stdout(stdout),
            ):
                exit_code = main(["--output", str(output)])

            self.assertEqual(exit_code, 1)
            self.assertIn("Intent release gate: FAIL", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
