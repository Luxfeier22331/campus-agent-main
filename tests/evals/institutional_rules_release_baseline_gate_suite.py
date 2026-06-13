from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_evals.institutional_rules_release_baseline_gate import (
    CommandResult,
    run_institutional_rules_release_baseline_gate,
)

from scripts.eval_gate import run_eval_acceptance


class InstitutionalRulesReleaseBaselineGateSuite(unittest.TestCase):
    def test_eval_gate_accept_supports_institutional_rules_release_baseline_profile(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "institutional-baseline"
            observations_path = Path(temp_dir) / "observations.json"
            observations_path.write_text("{}", encoding="utf-8")
            with patch(
                "campus_evals.institutional_rules_release_baseline_gate.main",
                return_value=0,
            ) as runner:
                summary = run_eval_acceptance(
                    profile="institutional-rules-release-baseline",
                    output_dir=output_dir,
                    reruns=1,
                    observations_path=observations_path,
                )

        self.assertEqual(summary["profile"], "institutional-rules-release-baseline")
        self.assertEqual(summary["exit_code"], 0)
        runner.assert_called_once_with(
            [
                "accept",
                "--output-dir",
                str(output_dir),
                "--reruns",
                "1",
                "--observations-path",
                str(observations_path),
            ]
        )

    def test_gate_runs_release_retrieval_golden_answer_no_hit_and_product_path_checks(
        self,
    ) -> None:
        commands: list[tuple[str, ...]] = []

        def fake_runner(command: tuple[str, ...], *, cwd: Path | None = None) -> CommandResult:
            del cwd
            commands.append(command)
            command_text = " ".join(command)
            if "retrieval_live_benchmark" in command_text:
                total_cases = (
                    89
                    if "institutional_rules_golden_retrieval_qrels.v1.json" in command_text
                    else 45
                )
                return CommandResult(
                    returncode=0,
                    stdout=json.dumps(
                        {
                            "total_cases": total_cases,
                            "doc_hit_at_1": 1.0,
                            "doc_recall_at_5": 1.0,
                            "forbidden_hit_rate": 0.0,
                        },
                        ensure_ascii=False,
                    ),
                )
            if "answer_quality_contract" in command_text:
                return CommandResult(
                    returncode=0,
                    stdout=json.dumps(
                        {
                            "passed": True,
                            "summary": {"total": 42, "passed": 42, "failed": 0},
                        },
                        ensure_ascii=False,
                    ),
                )
            if "execution_control_process_smoke" in command_text:
                return CommandResult(
                    returncode=0,
                    stdout=json.dumps(
                        {"passed": True, "profile": "rag_delegate_institutional_rules"}
                    ),
                )
            return CommandResult(returncode=0, stdout="OK")

        with TemporaryDirectory() as temp_dir:
            report = run_institutional_rules_release_baseline_gate(
                output_dir=Path(temp_dir),
                answer_observations_path=Path(temp_dir) / "observations.json",
                command_runner=fake_runner,
            )

        self.assertTrue(report["passed"], report)
        self.assertEqual(
            [check["check_id"] for check in report["checks"]],
            [
                "release_retrieval_live",
                "golden_retrieval_live",
                "answer_quality_contract",
                "backend_qdrant_no_hit_suite",
                "rag_delegate_institutional_rules_product_path_smoke",
            ],
        )
        flattened_commands = [" ".join(command) for command in commands]
        self.assertTrue(
            any("institutional_rules_retrieval_qrels.json" in item for item in flattened_commands)
        )
        self.assertTrue(
            any(
                "institutional_rules_golden_retrieval_qrels.v1.json" in item
                for item in flattened_commands
            )
        )
        self.assertTrue(
            any(
                "institutional_rules_answer_quality_cases.v1.json" in item
                for item in flattened_commands
            )
        )
        self.assertTrue(
            any(
                "tests.retrieval.backend_qdrant_no_hit_suite" in item for item in flattened_commands
            )
        )
        self.assertTrue(
            any("rag_delegate_institutional_rules" in item for item in flattened_commands)
        )


if __name__ == "__main__":
    unittest.main()
