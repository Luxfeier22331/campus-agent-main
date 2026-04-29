from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.eval_gate import run_eval_acceptance


class CampusServicesProductPathEvalGateProfileTest(unittest.TestCase):
    def test_eval_gate_accept_supports_campus_services_product_path_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "campus-services-product-path-gate"
            with patch(
                "campus_evals.campus_services_product_path_opening_gate.main",
                return_value=0,
            ) as runner:
                summary = run_eval_acceptance(
                    profile="campus-services-product-path",
                    output_dir=output_dir,
                    reruns=1,
                )

        self.assertEqual(summary["profile"], "campus-services-product-path")
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

    def test_eval_gate_rejects_publish_dry_run_for_campus_services_product_path_profile(
        self,
    ) -> None:
        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(
                ValueError,
                "campus-services-product-path does not produce live case-results artifacts",
            ),
        ):
            run_eval_acceptance(
                profile="campus-services-product-path",
                output_dir=Path(temp_dir),
                reruns=1,
                publish_dry_run=True,
                publish_grade_source="eval_release_gate",
                publish_grader_version="grader@2026-04-27",
            )


if __name__ == "__main__":
    unittest.main()
