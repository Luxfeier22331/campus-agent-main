from __future__ import annotations

from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_ROOT = REPO_ROOT / "docs"
PLANNING_ROOT = REPO_ROOT / ".planning"

EXPECTED_DOC_TYPES = {
    "architecture": "architecture",
    "contracts": "contract",
    "data": "data",
    "decisions": "decision",
    "environment": "index",
    "plans": "plan",
    "runbooks": "runbook",
    "reference": "reference",
    "policies": "policy",
}
ALLOWED_STATUSES = {"active", "accepted"}


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

    def test_completed_docs_are_not_kept_in_active_docs_path(self) -> None:
        completed_docs = []

        for path in sorted(DOCS_ROOT.rglob("*.md")):
            front_matter = _read_front_matter(path)
            if front_matter.get("status") == "completed":
                completed_docs.append(path)

        self.assertEqual(completed_docs, [])

    def test_decisions_include_decision_id(self) -> None:
        for path in sorted((DOCS_ROOT / "decisions").glob("*.md")):
            front_matter = _read_front_matter(path)
            self.assertTrue(front_matter.get("decision_id"), path)

    def test_historical_bootstrap_plans_are_removed_from_active_docs_path(self) -> None:
        historical_plan_names = {
            "agentic-rag-foundation.md",
            "app-api-initial-execution-plan.md",
            "domain-bounded-answering-and-refusal-foundation.md",
            "env-bootstrap-and-provider-configuration-governance.md",
            "app-api-worker-foundation.md",
            "golden-dataset-schema-and-bootstrap.md",
            "official-web-app-api-control-plane-foundation.md",
            "public-chat-web-chatbot-replatform.md",
            "public-chat-web-donor-first-reset.md",
            "public-chat-web-vendor-runtime-full-transplant.md",
            "source-truth-normalization-refactor.md",
            "student-handbook-retrieval-eval-bootstrap.md",
        }

        actual_plan_names = {path.name for path in (DOCS_ROOT / "plans").glob("*.md")}
        self.assertTrue(historical_plan_names.isdisjoint(actual_plan_names))

    def test_docs_index_lists_current_env_governance_docs(self) -> None:
        docs_index = (DOCS_ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn("environment/README.md", docs_index)
        self.assertIn("runbooks/provider-secret-governance.md", docs_index)

    def test_decision_ids_are_unique(self) -> None:
        decision_ids: dict[str, Path] = {}

        for path in sorted((DOCS_ROOT / "decisions").glob("*.md")):
            front_matter = _read_front_matter(path)
            decision_id = front_matter.get("decision_id")
            self.assertIsNotNone(decision_id, path)
            self.assertNotIn(decision_id, decision_ids, f"{path} duplicates {decision_ids.get(decision_id)}")
            decision_ids[decision_id] = path

    def test_historical_roadmap_does_not_assert_current_runtime_truth(self) -> None:
        roadmap = (PLANNING_ROOT / "ROADMAP.md").read_text(encoding="utf-8")

        self.assertNotIn("Current roadmap truth still centers", roadmap)
        self.assertNotIn("Current serving truth is profile-driven", roadmap)


if __name__ == "__main__":
    unittest.main()
