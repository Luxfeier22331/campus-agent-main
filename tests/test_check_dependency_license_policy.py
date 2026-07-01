from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_dependency_license_policy import audit_dependency_license_policy


class CheckDependencyLicensePolicyTest(unittest.TestCase):
    def test_repo_dependency_license_policy_is_clean(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(audit_dependency_license_policy(root=repo_root), ())

    def test_reports_forbidden_lockfile_license_token(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / "pnpm-lock.yaml").write_text("license: AGPL-3.0-only\n", encoding="utf-8")

            failures = audit_dependency_license_policy(root=root)

        self.assertEqual(len(failures), 1)
        self.assertEqual(
            failures[0].render(), "pnpm-lock.yaml: forbidden dependency license token 'AGPL'"
        )


if __name__ == "__main__":
    unittest.main()
