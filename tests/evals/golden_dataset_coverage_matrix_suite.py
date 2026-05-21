from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.golden_dataset_coverage_matrix import (
    GoldenDatasetCoverageMatrixDriftError,
    check_golden_dataset_coverage_matrix,
    main,
    render_golden_dataset_coverage_matrix,
)


class GoldenDatasetCoverageMatrixSuite(unittest.TestCase):
    def test_rendered_matrix_covers_current_rag_denominator_and_exclusions(self) -> None:
        rendered = render_golden_dataset_coverage_matrix()

        self.assertIn("generated_by: campus_evals.golden_dataset_coverage_matrix", rendered)
        self.assertIn(
            "| `regulations/student_rules` | `handbook` | `case_results` | 52 | 46 | 25 | 5 | 0 | 4 | `baseline_ready` |",
            rendered,
        )
        self.assertIn(
            "| `regulations/institutional_rules` | `institutional-rules-release-baseline` | `composite_gate` | 46 | 42 | 45 | 42 | 89 | 0 | `baseline_ready` |",
            rendered,
        )
        self.assertIn(
            "| `curriculum/curriculum_plan` | `curriculum` | `case_results` | 60 | 49 | 30 | 5 | 0 | 0 | `baseline_ready` |",
            rendered,
        )
        self.assertIn(
            "| `official_web/stable_reference` | `official-web-stable-reference` | `case_results` | 4 | 3 | 5 | 0 | 0 | 0 | `baseline_ready` |",
            rendered,
        )
        self.assertIn(
            "| `official_web/fresh_news` | `not_current_rag_consumption_surface` |",
            rendered,
        )
        self.assertIn("Answer quality cases | 0", rendered)
        self.assertIn("Known-gap cases | 4", rendered)
        self.assertIn("## Operator Readiness Matrix", rendered)
        self.assertIn("## RAGAS Diagnostic Matrix", rendered)
        self.assertIn("## Answer Quality Coverage Notes", rendered)
        self.assertIn("## Known Boundaries", rendered)
        self.assertIn(
            "`official_web/stable_reference` is stable reference coverage, not generic official-web QA.",
            rendered,
        )
        self.assertIn(
            "RAGAS diagnostics are supplemental and non-blocking; they do not author golden truth.",
            rendered,
        )

    def test_tracked_matrix_matches_generated_content(self) -> None:
        check_golden_dataset_coverage_matrix(Path("docs/reference/golden-dataset-case-matrix.md"))

    def test_check_fails_closed_on_document_drift(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "golden-dataset-case-matrix.md"
            path.write_text("# stale\n", encoding="utf-8")

            with self.assertRaises(GoldenDatasetCoverageMatrixDriftError):
                check_golden_dataset_coverage_matrix(path)

    def test_cli_can_write_then_check_matrix(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "golden-dataset-case-matrix.md"

            write_exit_code = main(["--write", str(path)])
            check_exit_code = main(["--check", str(path)])

            payload = path.read_text(encoding="utf-8")

        self.assertEqual(write_exit_code, 0)
        self.assertEqual(check_exit_code, 0)
        self.assertIn("# Golden Dataset Coverage Matrix", payload)


if __name__ == "__main__":
    unittest.main()
