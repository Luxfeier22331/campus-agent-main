from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class RepoCollaborationTest(unittest.TestCase):
    def test_repo_has_basic_collaboration_scaffolding(self) -> None:
        expected_files = {
            ROOT / ".editorconfig",
            ROOT / ".pre-commit-config.yaml",
            ROOT / "CODE_OF_CONDUCT.md",
            ROOT / "CONTRIBUTING.md",
            ROOT / ".github" / "pull_request_template.md",
            ROOT / ".github" / "ISSUE_TEMPLATE" / "bug_report.md",
            ROOT / ".github" / "ISSUE_TEMPLATE" / "docs_issue.md",
            ROOT / ".github" / "ISSUE_TEMPLATE" / "feature_request.md",
            ROOT / ".github" / "workflows" / "repo-guard.yml",
            ROOT / "SECURITY.md",
            ROOT / "SUPPORT.md",
        }

        missing = sorted(
            str(path.relative_to(ROOT)) for path in expected_files if not path.exists()
        )
        self.assertEqual(missing, [])

    def test_readme_and_contributing_reference_collaboration_flow(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")

        self.assertIn("CONTRIBUTING.md", readme)
        self.assertIn("SECURITY.md", readme)
        self.assertIn("public-source-data.md", contributing)
        self.assertIn("develop", contributing)
        self.assertIn("main", contributing)
        self.assertIn("uv sync --all-packages --dev", contributing)
        self.assertIn("pnpm web:typecheck", contributing)

    def test_pull_request_template_checks_public_source_data_boundary(self) -> None:
        template = (ROOT / ".github" / "pull_request_template.md").read_text(encoding="utf-8")

        self.assertIn("Public Source / Data Boundary", template)
        self.assertIn("source-derived documents", template)
        self.assertIn("No internal publish/deploy workflow", template)


if __name__ == "__main__":
    unittest.main()
