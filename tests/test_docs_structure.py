from __future__ import annotations

from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_ROOT = REPO_ROOT / "docs"
PLANNING_ROOT = REPO_ROOT / ".planning"

EXPECTED_DOC_TYPES = {
    "architecture": "architecture",
    "decisions": "decision",
    "environment": "index",
    "plans": "plan",
    "runbooks": "runbook",
    "reference": "reference",
    "policies": "policy",
}
ALLOWED_STATUSES = {"active", "accepted", "completed"}


def _read_front_matter(path: Path) -> dict[str, str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        raise AssertionError(f"{path} is missing YAML front matter")

    front_matter: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return front_matter
        key, separator, value = line.partition(":")
        if not separator:
            continue
        front_matter[key.strip()] = value.strip()
    raise AssertionError(f"{path} has an unterminated YAML front matter block")


class DocsStructureTest(unittest.TestCase):
    def test_docs_root_has_expected_top_level_categories(self) -> None:
        expected_dirs = set(EXPECTED_DOC_TYPES) | {"docs"}
        actual_dirs = {path.name for path in DOCS_ROOT.iterdir() if path.is_dir()}

        self.assertEqual(actual_dirs, set(EXPECTED_DOC_TYPES))
        self.assertNotIn("verification", actual_dirs)
        self.assertNotIn("archive", actual_dirs)

    def test_docs_index_uses_index_doc_type(self) -> None:
        front_matter = _read_front_matter(DOCS_ROOT / "README.md")

        self.assertEqual(front_matter.get("doc_type"), "index")
        self.assertIn(front_matter.get("status"), ALLOWED_STATUSES)

    def test_docs_in_each_directory_match_expected_doc_type(self) -> None:
        for directory_name, expected_doc_type in EXPECTED_DOC_TYPES.items():
            directory = DOCS_ROOT / directory_name
            self.assertTrue(directory.is_dir(), directory)
            for path in sorted(directory.glob("*.md")):
                front_matter = _read_front_matter(path)
                self.assertEqual(front_matter.get("doc_type"), expected_doc_type, path)
                self.assertIn(front_matter.get("status"), ALLOWED_STATUSES, path)
                self.assertNotIn(front_matter.get("status"), {"archived", "superseded"}, path)

    def test_decisions_include_decision_id(self) -> None:
        for path in sorted((DOCS_ROOT / "decisions").glob("*.md")):
            front_matter = _read_front_matter(path)
            self.assertTrue(front_matter.get("decision_id"), path)

    def test_completed_bootstrap_plans_do_not_remain_active(self) -> None:
        eval_bootstrap = _read_front_matter(DOCS_ROOT / "plans" / "student-handbook-retrieval-eval-bootstrap.md")
        golden_bootstrap = _read_front_matter(DOCS_ROOT / "plans" / "golden-dataset-schema-and-bootstrap.md")

        self.assertEqual(eval_bootstrap.get("status"), "completed")
        self.assertEqual(golden_bootstrap.get("status"), "completed")

    def test_historical_roadmap_does_not_assert_current_runtime_truth(self) -> None:
        roadmap = (PLANNING_ROOT / "ROADMAP.md").read_text(encoding="utf-8")

        self.assertNotIn("Current roadmap truth still centers", roadmap)
        self.assertNotIn("Current serving truth is profile-driven", roadmap)


if __name__ == "__main__":
    unittest.main()
