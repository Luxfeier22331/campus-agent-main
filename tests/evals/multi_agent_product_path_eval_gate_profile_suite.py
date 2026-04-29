from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import campus_evals.multi_agent_product_path_gate as multi_agent_product_path_gate

from scripts.eval_gate import run_eval_acceptance


class MultiAgentProductPathEvalGateProfileTest(unittest.TestCase):
    def test_eval_gate_accept_supports_multi_agent_product_path_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-product-path-gate"
            with patch.object(
                multi_agent_product_path_gate,
                "main",
                return_value=0,
            ) as runner:
                summary = run_eval_acceptance(
                    profile="multi-agent-product-path",
                    output_dir=output_dir,
                    reruns=1,
                )

        self.assertEqual(summary["profile"], "multi-agent-product-path")
        self.assertEqual(summary["exit_code"], 0)
        runner.assert_called_once_with(
            [
                "accept",
                "--output-dir",
                str(output_dir),
                "--reruns",
                "1",
            ]
        )

    def test_eval_gate_rejects_publish_dry_run_for_multi_agent_product_path_profile(
        self,
    ) -> None:
        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(
                ValueError,
                "multi-agent-product-path does not produce live case-results artifacts",
            ),
        ):
            run_eval_acceptance(
                profile="multi-agent-product-path",
                output_dir=Path(temp_dir),
                reruns=1,
                publish_dry_run=True,
                publish_grade_source="eval_release_gate",
                publish_grader_version="grader@2026-04-29",
            )


if __name__ == "__main__":
    unittest.main()
