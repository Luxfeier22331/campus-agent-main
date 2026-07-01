from __future__ import annotations

import unittest
from pathlib import Path

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
    "policies": "policy",
    "product": "product_requirement",
    "reference": "reference",
    "runbooks": "runbook",
}

DECISION_STATUSES = {"accepted", "deprecated", "proposed", "superseded"}
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

                if directory_name == "environment":
                    self.assertIn(front_matter.get("doc_type"), {"index", "reference"}, path)
                else:
                    self.assertEqual(front_matter.get("doc_type"), expected_doc_type, path)
                if directory_name == "decisions":
                    self.assertIn(front_matter.get("status"), DECISION_STATUSES, path)
                elif directory_name in {"reference", "runbooks"}:
                    self.assertIn(front_matter.get("status"), HISTORICAL_REFERENCE_STATUSES, path)
                else:
                    self.assertIn(front_matter.get("status"), ACTIVE_ONLY_STATUSES, path)

    def test_docs_plans_archive_namespace_is_removed_from_branch_tip(self) -> None:
        self.assertFalse((DOCS_ROOT / "plans").exists())

    def test_reference_and_runbook_archive_namespaces_are_removed_from_branch_tip(self) -> None:
        for root in (DOCS_ROOT / "reference" / "archive", DOCS_ROOT / "runbooks" / "archive"):
            self.assertFalse(root.exists(), root)

    def test_reference_and_runbook_root_namespaces_are_active_only(self) -> None:
        for directory_name, expected_doc_type in {
            "reference": "reference",
            "runbooks": "runbook",
        }.items():
            for path in sorted((DOCS_ROOT / directory_name).glob("*.md")):
                if path.name == "README.md":
                    continue
                front_matter = _read_front_matter(path)
                self.assertEqual(front_matter.get("doc_type"), expected_doc_type, path)
                self.assertIn(front_matter.get("status"), {"active"}, path)

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
        self.assertIn("policies/public-source-data.md", docs_index)

    def test_public_source_data_policy_defines_provenance_classes(self) -> None:
        policy = (DOCS_ROOT / "policies" / "public-source-data.md").read_text(encoding="utf-8")

        for token in (
            "synthetic",
            "self-authored",
            "source-derived-publicly-redistributable",
            "internal-only-not-for-public-repo",
            "Runtime content is not read from git",
        ):
            self.assertIn(token, policy)

    def test_contracts_index_lists_eval_ingress_contract(self) -> None:
        contracts_index = (DOCS_ROOT / "contracts" / "README.md").read_text(encoding="utf-8")

        self.assertIn("app-api/eval-benchmark.md", contracts_index)

    def test_contracts_index_lists_durable_agent_runtime_contract(self) -> None:
        contracts_index = (DOCS_ROOT / "contracts" / "README.md").read_text(encoding="utf-8")

        self.assertIn("durable-runtime.md", contracts_index)

    def test_data_index_lists_durable_agent_runtime_schema(self) -> None:
        data_index = (DOCS_ROOT / "data" / "README.md").read_text(encoding="utf-8")

        self.assertIn("durable-runtime.md", data_index)

    def test_contracts_index_lists_eval_benchmark_artifact_contract(self) -> None:
        contracts_index = (DOCS_ROOT / "contracts" / "README.md").read_text(encoding="utf-8")

        self.assertIn("eval-artifact.md", contracts_index)

    def test_reference_index_does_not_list_removed_run_projection_gap_matrix(self) -> None:
        reference_index = (DOCS_ROOT / "reference" / "README.md").read_text(encoding="utf-8")

        self.assertNotIn("durable-agent-runtime-gap-matrix.md", reference_index)

    def test_run_projection_phase0_phase1_docs_are_linked(self) -> None:
        architecture = (DOCS_ROOT / "architecture" / "system" / "durable-runtime.md").read_text(
            encoding="utf-8"
        )
        contract = (DOCS_ROOT / "contracts" / "durable-runtime.md").read_text(encoding="utf-8")
        schema = (DOCS_ROOT / "data" / "durable-runtime.md").read_text(encoding="utf-8")

        self.assertIn("adr-0048-temporal.md", architecture)
        self.assertIn("docs/contracts/durable-runtime.md", architecture)
        self.assertIn("docs/data/durable-runtime.md", architecture)
        self.assertIn("durable-agent-runtime-contract-v1", contract)
        self.assertIn("runtime.agent_runs", schema)

    def test_run_projection_contract_freezes_temporal_run_projection_terms(self) -> None:
        contract = (DOCS_ROOT / "contracts" / "durable-runtime.md").read_text(encoding="utf-8")

        for token in (
            "`run_id`",
            "`conversation_id`",
            "Temporal-backed run command/query",
            "repo-owned projection",
            "`conversation_active_run`",
            "`tool.started`",
            "`tool.completed`",
            "`tool.failed`",
        ):
            self.assertIn(token, contract)

    def test_testing_reference_matches_current_repo_lint_semantics(self) -> None:
        verification_reference = (
            DOCS_ROOT / "reference" / "testing-and-verification-lanes.md"
        ).read_text(encoding="utf-8")

        self.assertIn("pnpm repo:static", verification_reference)
        self.assertIn("Repo-wide static gate for live tracked surfaces", verification_reference)
        self.assertIn("JSON/YAML/TOML/HTML/SQL/XML/JSONL/shell/Dockerfile", verification_reference)
        self.assertIn("Biome, Ruff format", verification_reference)
        self.assertIn("decomposition guard", verification_reference)
        self.assertIn(
            "Not a typecheck, unit test, integration test or E2E proof", verification_reference
        )

    def test_decision_ids_are_unique(self) -> None:
        decision_ids: dict[str, Path] = {}

        for path in sorted((DOCS_ROOT / "decisions").glob("*.md")):
            if path.name == "README.md":
                continue
            front_matter = _read_front_matter(path)
            decision_id = front_matter.get("decision_id")
            self.assertIsNotNone(decision_id, path)
            self.assertNotIn(
                decision_id, decision_ids, f"{path} duplicates {decision_ids.get(decision_id)}"
            )
            decision_ids[decision_id] = path

    def test_historical_planning_archive_tree_is_removed_from_branch_tip(self) -> None:
        self.assertFalse((PLANNING_ROOT / "legacy-flat").exists())


if __name__ == "__main__":
    unittest.main()
