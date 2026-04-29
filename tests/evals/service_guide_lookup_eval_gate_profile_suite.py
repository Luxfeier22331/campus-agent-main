from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.eval_gate import run_eval_acceptance


class ServiceGuideLookupEvalGateProfileTest(unittest.TestCase):
    def test_eval_gate_accept_supports_service_guide_lookup_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "service-guide-gate"
            with patch(
                "campus_evals.service_guide_lookup_release_gate.main",
                return_value=0,
            ) as runner:
                summary = run_eval_acceptance(
                    profile="service-guide-lookup",
                    output_dir=output_dir,
                    reruns=1,
                )

        self.assertEqual(summary["profile"], "service-guide-lookup")
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

    def test_eval_gate_rejects_publish_dry_run_for_service_guide_lookup_profile(self) -> None:
        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(
                ValueError,
                "service-guide-lookup does not produce live case-results artifacts",
            ),
        ):
            run_eval_acceptance(
                profile="service-guide-lookup",
                output_dir=Path(temp_dir),
                reruns=1,
                publish_dry_run=True,
                publish_grade_source="eval_release_gate",
                publish_grader_version="grader@2026-04-26",
            )


if __name__ == "__main__":
    unittest.main()
