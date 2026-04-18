from __future__ import annotations

from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_ROOT = REPO_ROOT / "docs"
PLANNING_ROOT = REPO_ROOT / ".planning"

EXPECTED_DOC_DIRECTORIES = {
    "architecture": "architecture",
    "contracts": "contract",
    "data": "data",
    "decisions": "decision",
    "domains": "index",
    "environment": "index",
    "plans": "plan",
    "policies": "policy",
    "reference": "reference",
    "runbooks": "runbook",
}

DECISION_STATUSES = {"accepted", "deprecated", "proposed", "superseded"}
PLAN_STATUSES = {"active", "completed", "deferred", "historical", "superseded"}
ACTIVE_ONLY_STATUSES = {"active"}
HISTORICAL_REFERENCE_STATUSES = {"active", "historical"}


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

        self.assertEqual(actual_dirs, set(EXPECTED_DOC_DIRECTORIES))
        self.assertNotIn("verification", actual_dirs)
        self.assertNotIn("archive", actual_dirs)

    def test_docs_index_uses_index_doc_type(self) -> None:
        front_matter = _read_front_matter(DOCS_ROOT / "README.md")

        self.assertEqual(front_matter.get("doc_type"), "index")
        self.assertIn(front_matter.get("status"), ACTIVE_ONLY_STATUSES)

    def test_docs_in_each_directory_match_expected_doc_type(self) -> None:
        for directory_name, expected_doc_type in EXPECTED_DOC_DIRECTORIES.items():
            directory = DOCS_ROOT / directory_name
            self.assertTrue(directory.is_dir(), directory)
            for path in sorted(directory.glob("*.md")):
                front_matter = _read_front_matter(path)
                if path.name == "README.md":
                    self.assertEqual(front_matter.get("doc_type"), "index", path)
                    self.assertIn(front_matter.get("status"), ACTIVE_ONLY_STATUSES, path)
                    continue

                self.assertEqual(front_matter.get("doc_type"), expected_doc_type, path)
                if directory_name == "decisions":
                    self.assertIn(front_matter.get("status"), DECISION_STATUSES, path)
                elif directory_name == "plans":
                    self.assertIn(front_matter.get("status"), PLAN_STATUSES, path)
                elif directory_name in {"reference", "runbooks"}:
                    self.assertIn(front_matter.get("status"), HISTORICAL_REFERENCE_STATUSES, path)
                else:
                    self.assertIn(front_matter.get("status"), ACTIVE_ONLY_STATUSES, path)

    def test_completed_plans_are_not_listed_in_default_docs_entry(self) -> None:
        docs_index = (DOCS_ROOT / "README.md").read_text(encoding="utf-8")
        completed_plans = []

        for path in sorted((DOCS_ROOT / "plans").glob("*.md")):
            front_matter = _read_front_matter(path)
            if front_matter.get("status") == "completed":
                completed_plans.append(path.name)
                self.assertNotIn(path.name, docs_index)

        self.assertNotEqual(completed_plans, [])

    def test_decisions_include_decision_id(self) -> None:
        for path in sorted((DOCS_ROOT / "decisions").glob("*.md")):
            if path.name == "README.md":
                continue
            front_matter = _read_front_matter(path)
            self.assertTrue(front_matter.get("decision_id"), path)

    def test_historical_bootstrap_plans_are_removed_from_active_docs_path(self) -> None:
        historical_plan_names = {
            "agentic-rag-foundation.md",
            "app-api-initial-execution-plan.md",
            "authenticated-notice-source-attachment-key-reorganization.md",
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

        self.assertIn("runbooks/README.md", docs_index)
        self.assertIn("environment/README.md", docs_index)
        self.assertIn("domains/README.md", docs_index)

    def test_decision_ids_are_unique(self) -> None:
        decision_ids: dict[str, Path] = {}

        for path in sorted((DOCS_ROOT / "decisions").glob("*.md")):
            if path.name == "README.md":
                continue
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
