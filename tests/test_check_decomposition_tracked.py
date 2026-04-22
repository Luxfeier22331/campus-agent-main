from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.check_decomposition_tracked import (
    DEFAULT_THRESHOLD,
    DecompositionBaseline,
    DecompositionFinding,
    audit_decomposition,
    load_decomposition_baseline,
    tracked_decomposition_paths,
)


class CheckDecompositionTrackedTest(unittest.TestCase):
    def test_tracked_decomposition_paths_include_handwritten_code_surfaces(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        candidates = set(tracked_decomposition_paths(root=repo_root))

        self.assertIn("scripts/check_sql_tracked.py", candidates)
        self.assertIn("tests/test_check_yaml_tracked.py", candidates)
        self.assertIn("apps/app-api/src/app/request-scope.ts", candidates)
        self.assertNotIn("docs/architecture/current-architecture.md", candidates)
        self.assertNotIn("package.json", candidates)

    def test_load_decomposition_baseline_reads_admitted_budget(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            baseline_path = root / "configs/lint/decomposition-baseline.json"
            baseline_path.parent.mkdir(parents=True, exist_ok=True)
            baseline_path.write_text(
                json.dumps(
                    {
                        "threshold": DEFAULT_THRESHOLD,
                        "admitted": {
                            "src/oversized.py": {
                                "max_lines": 812,
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            baseline = load_decomposition_baseline(root=root, path=baseline_path)

        self.assertEqual(
            baseline,
            DecompositionBaseline(
                threshold=DEFAULT_THRESHOLD,
                admitted={"src/oversized.py": 812},
            ),
        )

    def test_audit_decomposition_reports_new_over_threshold_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            candidate = root / "src/new_file.py"
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_text(
                "\n".join("line" for _ in range(DEFAULT_THRESHOLD + 5)), encoding="utf-8"
            )
            baseline_path = root / "configs/lint/decomposition-baseline.json"
            baseline_path.parent.mkdir(parents=True, exist_ok=True)
            baseline_path.write_text(
                json.dumps({"threshold": DEFAULT_THRESHOLD, "admitted": {}}),
                encoding="utf-8",
            )

            with mock.patch(
                "scripts.check_decomposition_tracked.tracked_decomposition_paths",
                return_value=("src/new_file.py",),
            ):
                findings = audit_decomposition(root=root, baseline_path=baseline_path)

        self.assertEqual(
            findings,
            (
                DecompositionFinding(
                    path="src/new_file.py",
                    reason="new_over_threshold",
                    lines=DEFAULT_THRESHOLD + 5,
                    max_lines=DEFAULT_THRESHOLD,
                ),
            ),
        )

    def test_audit_decomposition_reports_baseline_growth_and_missing_entry_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            growing = root / "src/growing.py"
            resolved = root / "src/resolved.py"
            growing.parent.mkdir(parents=True, exist_ok=True)
            growing.write_text("\n".join("line" for _ in range(813)), encoding="utf-8")
            resolved.write_text("\n".join("line" for _ in range(799)), encoding="utf-8")
            baseline_path = root / "configs/lint/decomposition-baseline.json"
            baseline_path.parent.mkdir(parents=True, exist_ok=True)
            baseline_path.write_text(
                json.dumps(
                    {
                        "threshold": DEFAULT_THRESHOLD,
                        "admitted": {
                            "src/growing.py": {"max_lines": 810},
                            "src/resolved.py": {"max_lines": 808},
                            "src/missing.py": {"max_lines": 820},
                        },
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch(
                "scripts.check_decomposition_tracked.tracked_decomposition_paths",
                return_value=("src/growing.py", "src/resolved.py"),
            ):
                findings = audit_decomposition(root=root, baseline_path=baseline_path)

        self.assertEqual(
            findings,
            (
                DecompositionFinding(
                    path="src/growing.py",
                    reason="baseline_grew",
                    lines=813,
                    max_lines=810,
                ),
                DecompositionFinding(
                    path="src/missing.py",
                    reason="baseline_missing",
                    lines=None,
                    max_lines=820,
                ),
                DecompositionFinding(
                    path="src/resolved.py",
                    reason="baseline_resolved",
                    lines=799,
                    max_lines=808,
                ),
            ),
        )

    def test_repo_inventory_matches_current_baseline_contract(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        findings = audit_decomposition(root=repo_root)

        self.assertEqual(findings, ())


if __name__ == "__main__":
    unittest.main()
