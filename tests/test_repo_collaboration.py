from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class RepoCollaborationTest(unittest.TestCase):
    def test_repo_has_basic_collaboration_scaffolding(self) -> None:
        expected_files = {
            ROOT / ".editorconfig",
            ROOT / ".pre-commit-config.yaml",
            ROOT / "CONTRIBUTING.md",
            ROOT / ".github" / "pull_request_template.md",
            ROOT / ".github" / "workflows" / "repo-guard.yml",
        }

        missing = sorted(str(path.relative_to(ROOT)) for path in expected_files if not path.exists())
        self.assertEqual(missing, [])

    def test_readme_and_contributing_reference_collaboration_flow(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")

        self.assertIn("CONTRIBUTING.md", readme)
        self.assertIn("develop", contributing)
        self.assertIn("main", contributing)
        self.assertIn("uv sync --all-packages --dev", contributing)
        self.assertIn("pnpm web:typecheck", contributing)


if __name__ == "__main__":
    unittest.main()
