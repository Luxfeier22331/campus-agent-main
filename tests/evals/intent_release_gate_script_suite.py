from __future__ import annotations

import json
import unittest

from scripts.intent_release_gate import run_release_gate, write_release_gate_report
from tests.evals.formal_benchmark_test_support import Path, TemporaryDirectory


class IntentReleaseGateScriptTest(unittest.TestCase):
    def test_release_gate_runs_go_intent_gate_and_cross_layer_suites(self) -> None:
        commands: list[tuple[str, ...]] = []

        def fake_runner(command: tuple[str, ...]) -> dict[str, object]:
            commands.append(command)
            return {"command": list(command), "exit_code": 0, "stdout": "", "stderr": ""}

        payload = run_release_gate(command_runner=fake_runner)

        self.assertTrue(payload["passed"])
        self.assertEqual(payload["runner"], "execution-control-go")
        command_text = [" ".join(command) for command in commands]
        self.assertTrue(any("scripts.intent_gate" in item for item in command_text))
        self.assertTrue(any("--runner execution-control-go" in item for item in command_text))
        self.assertTrue(any("go test ./..." in item for item in command_text))
        self.assertTrue(any("execution-control-durable-adapter.test.ts" in item for item in command_text))
        self.assertTrue(any("tests.evals.eval_admission_suite" in item for item in command_text))

    def test_release_gate_writes_json_report(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "intent-release-gate.json"
            payload = {
                "schema_version": 1,
                "passed": True,
                "runner": "execution-control-go",
                "command_results": [],
            }

            write_release_gate_report(payload, output_path)

            written = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(written["runner"], "execution-control-go")


if __name__ == "__main__":
    unittest.main()
