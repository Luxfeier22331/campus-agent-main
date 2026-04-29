from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_evals.quality_calibration import run_quality_calibration_profile


class QualityCalibrationSuite(unittest.TestCase):
    def test_quality_calibration_is_report_only_and_surfaces_review_candidates(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            observations_path = root / "quality-calibration-observations.json"
            observations_path.write_text(
                json.dumps(
                    {
                        "observations": [
                            {
                                "case_id": "public-chat-usefulness-1",
                                "rubric": "public_chat_usefulness",
                                "score": 0.72,
                                "verdict": "needs_review",
                                "rationale": "answer is useful but citation clarity is weak",
                            },
                            {
                                "case_id": "ocr-quality-1",
                                "rubric": "ocr_semantic_quality",
                                "score": 0.91,
                                "verdict": "pass",
                                "rationale": "semantic spans preserved",
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )

            report = run_quality_calibration_profile(
                output_dir=root / "out",
                observations_path=observations_path,
                git_head_resolver=lambda: "abc123",
            )
            payload = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertTrue(payload["report_only"])
        self.assertEqual(payload["summary"]["pending_review"], 1)
        self.assertEqual(
            payload["pending_review_candidates"],
            [
                {
                    "case_id": "public-chat-usefulness-1",
                    "rubric": "public_chat_usefulness",
                    "score": 0.72,
                    "rationale": "answer is useful but citation clarity is weak",
                }
            ],
        )
        self.assertEqual(payload["version_summary"]["git_head"], "abc123")

    def test_quality_calibration_can_ingest_profile_report_results_as_observations(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            profile_report_path = root / "profile-report.json"
            profile_report_path.write_text(
                json.dumps(
                    {
                        "schema_version": "eval_profile_gate.v1",
                        "profile_id": "public_chat_product_path",
                        "sanitized_results": [
                            {
                                "case_id": "public-chat-service-guide-happy-path",
                                "passed": False,
                                "reason": "source_url_present expected true, got false",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            report = run_quality_calibration_profile(
                output_dir=root / "out",
                artifact_paths=(profile_report_path,),
                git_head_resolver=lambda: "abc123",
            )
            payload = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertEqual(payload["summary"]["total"], 1)
        self.assertEqual(payload["observations"][0]["rubric"], "public_chat_usefulness")
        self.assertEqual(payload["observations"][0]["verdict"], "needs_review")


if __name__ == "__main__":
    unittest.main()
