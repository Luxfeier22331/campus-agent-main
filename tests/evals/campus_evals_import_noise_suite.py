from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path


class CampusEvalsImportNoiseSuite(unittest.TestCase):
    def test_importing_campus_evals_rag_eval_coverage_is_quiet(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        env = os.environ.copy()
        env["PYTHONPATH"] = os.pathsep.join(
            [
                *(
                    str(path / "src")
                    for path in sorted((repo_root / "packages").iterdir())
                    if path.is_dir() and (path / "src").exists()
                ),
                str(repo_root),
                env.get("PYTHONPATH", ""),
            ]
        )
        script = """
import contextlib
import importlib
import io

stderr = io.StringIO()
with contextlib.redirect_stderr(stderr):
    module = importlib.import_module("campus_evals.rag_eval_coverage")
    report = module.build_rag_eval_coverage_report()

print(stderr.getvalue())
print(report.passed)
"""

        completed = subprocess.run(
            [sys.executable, "-c", script],
            cwd=repo_root,
            env=env,
            text=True,
            capture_output=True,
            check=True,
        )

        self.assertNotIn("PyTorch was not found", completed.stdout)
        self.assertNotIn("PyTorch was not found", completed.stderr)
        self.assertIn("True", completed.stdout)


if __name__ == "__main__":
    unittest.main()
