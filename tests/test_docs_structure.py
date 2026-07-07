from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_ROOT = REPO_ROOT / "docs"
PLANNING_ROOT = REPO_ROOT / ".planning"
ROOT_DOC_PATHS = (
    REPO_ROOT / "README.md",
    REPO_ROOT / "AGENTS.md",
)

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

    def test_domains_directory_only_keeps_narrow_human_capability_docs(self) -> None:
        actual_domain_docs = {path.name for path in (DOCS_ROOT / "domains").glob("*.md")}

        self.assertEqual(
            actual_domain_docs,
            {
                "README.md",
                "place.md",
                "public-web-search.md",
                "source-card.md",
                "transport.md",
            },
        )

    def test_documentation_architecture_maps_to_mature_standards(self) -> None:
        architecture = (DOCS_ROOT / "documentation-architecture.md").read_text(encoding="utf-8")

        for token in (
            "Mature Standards Mapping",
            "Diataxis",
            "MADR",
            "Nygard",
            "OpenAPI",
            "JSON Schema",
            "RFC 2119",
            "RFC 8174",
            "GitHub Issue Forms",
            "GitHub Markdown pull request template",
            "not a standalone documentation framework",
            "planning_signal",
            "release_closeout_artifact",
        ):
            self.assertIn(token, architecture)
        self.assertNotIn("planning_work_map", architecture)

    def test_repo_entry_and_planning_docs_use_current_planning_terms(self) -> None:
        forbidden_phrases = (
            "planning_work_map",
            "active work map",
            "project work map",
            "staging proof",
            "release evidence",
            "future release evidence",
            "Current Backlog Signals",
        )
        checked_paths = ROOT_DOC_PATHS + tuple(sorted(PLANNING_ROOT.glob("*.md")))

        for path in checked_paths:
            text = path.read_text(encoding="utf-8")
            for phrase in forbidden_phrases:
                self.assertNotIn(phrase, text, path)

    def test_repo_and_reference_docs_do_not_use_proof_as_truth_class(self) -> None:
        forbidden_phrases = (
            "release proof",
            "deployment proof",
            "runtime proof",
            "E2E proof",
            "staging evidence",
        )
        checked_paths = (
            *ROOT_DOC_PATHS,
            DOCS_ROOT / "documentation-architecture.md",
            *sorted((DOCS_ROOT / "reference").glob("*.md")),
        )

        for path in checked_paths:
            text = path.read_text(encoding="utf-8")
            for phrase in forbidden_phrases:
                self.assertNotIn(phrase, text, path)

    def test_active_architecture_and_contract_docs_do_not_use_proof_or_unowned_planning_terms(
        self,
    ) -> None:
        forbidden_phrases = (
            "release proof",
            "deployment proof",
            "runtime proof",
            "local runtime proof",
            "one-shot proof",
            "admission proof",
            "proof-gated",
            "operational proof",
            "canonical proof",
            "materialization proof",
            "diagnostic proof",
            "planned ",
            "if opened later",
            "opened later",
            "backlog intake",
            "repair backlog",
            "monitoring backlog",
            "local-only proof",
            "release-acceptance evidence",
        )
        checked_roots = (
            DOCS_ROOT / "architecture",
            DOCS_ROOT / "contracts",
            DOCS_ROOT / "reference",
            DOCS_ROOT / "policies",
        )

        for root in checked_roots:
            for path in sorted(root.rglob("*.md")):
                text = path.read_text(encoding="utf-8")
                for phrase in forbidden_phrases:
                    self.assertNotIn(phrase, text, path)

    def test_runbooks_use_closeout_artifact_language_for_retained_outputs(self) -> None:
        forbidden_phrases = (
            "建议保留证据",
            "证据目录",
            "记录链路证据",
            "ops proof",
            ".tmp/phase-h-",
        )

        for path in sorted((DOCS_ROOT / "runbooks").glob("*.md")):
            text = path.read_text(encoding="utf-8")
            for phrase in forbidden_phrases:
                self.assertNotIn(phrase, text, path)

    def test_markdown_links_do_not_split_paths_across_lines(self) -> None:
        broken_link_pattern = re.compile(r"\[[^\]]+\]\([^\)]*\n[^\)]*\.md\)")

        for path in (REPO_ROOT / "README.md", *sorted(DOCS_ROOT.rglob("*.md"))):
            text = path.read_text(encoding="utf-8")
            self.assertIsNone(broken_link_pattern.search(text), path)

    def test_completion_ledgers_live_in_reference_not_architecture(self) -> None:
        self.assertFalse(
            (DOCS_ROOT / "architecture" / "system" / "observability-ledger.md").exists()
        )
        self.assertTrue((DOCS_ROOT / "reference" / "observability-ledger.md").exists())

    def test_runbook_headings_do_not_live_outside_runbooks(self) -> None:
        forbidden_headings = (
            "## Eval And Acceptance",
            "## Launch Path",
            "## Verification Commands",
            "Staging provision command",
        )
        checked_roots = (
            DOCS_ROOT / "architecture",
            DOCS_ROOT / "contracts",
            DOCS_ROOT / "data",
            DOCS_ROOT / "reference",
        )

        for root in checked_roots:
            for path in sorted(root.rglob("*.md")):
                text = path.read_text(encoding="utf-8")
                for heading in forbidden_headings:
                    self.assertNotIn(heading, text, path)

    def test_shell_procedure_blocks_live_in_runbooks(self) -> None:
        checked_roots = (
            DOCS_ROOT / "architecture",
            DOCS_ROOT / "contracts",
            DOCS_ROOT / "data",
            DOCS_ROOT / "reference",
        )

        for root in checked_roots:
            for path in sorted(root.rglob("*.md")):
                text = path.read_text(encoding="utf-8")
                for fence in ("```bash", "```sh", "```shell"):
                    self.assertNotIn(fence, text, path)

    def test_active_truth_docs_do_not_use_phase_progress_language(self) -> None:
        forbidden_phrases = (
            "当前剩余验收缺口",
            "剩余验收",
            "不得冒充已完成",
            "未实现",
            "当前 phase",
        )
        forbidden_patterns = (
            "Phase 0",
            "Phase 1",
            "Phase 2",
            "Phase 3",
            "Phase 4",
            "Phase 5",
            "Phase 6",
            "Phase 7",
            "Phase 8",
            "Phase 9",
            "Phase I",
            "Phase II",
            "Phase III",
        )
        checked_roots = (
            DOCS_ROOT / "architecture",
            DOCS_ROOT / "contracts",
            DOCS_ROOT / "data",
        )

        for root in checked_roots:
            for path in sorted(root.rglob("*.md")):
                if path.name == "README.md":
                    continue
                text = path.read_text(encoding="utf-8")
                for phrase in forbidden_phrases + forbidden_patterns:
                    self.assertNotIn(phrase, text, path)

    def test_active_truth_docs_do_not_reintroduce_compatibility_narratives(self) -> None:
        forbidden_phrases = (
            "Current Compatibility",
            "Compatibility Boundary",
            "compatibility path",
            "compatibility ingress",
            "compatibility payload",
            "compatibility summary",
            "compatibility island",
            "compatibility tests",
            "compatibility residue",
            "wire compatibility",
            "compatibility posture",
            "compatibility context",
            "compatibility validation",
            "compatibility lane",
            "dev-backed compatibility",
            "兼容双路径",
        )
        checked_roots = (
            DOCS_ROOT / "architecture",
            DOCS_ROOT / "contracts",
            DOCS_ROOT / "data",
        )

        for root in checked_roots:
            for path in sorted(root.rglob("*.md")):
                text = path.read_text(encoding="utf-8")
                for phrase in forbidden_phrases:
                    self.assertNotIn(phrase, text, path)

    def test_target_architecture_does_not_own_current_or_operational_state(self) -> None:
        target = (DOCS_ROOT / "architecture" / "target.md").read_text(encoding="utf-8")

        forbidden_phrases = (
            "当前已开放",
            "当前实现",
            "已实现",
            "staging proof",
            "staging readiness",
            "release evidence",
            "work map",
            "Phase ",
        )

        for phrase in forbidden_phrases:
            self.assertNotIn(phrase, target)

    def test_contract_and_data_docs_do_not_own_deployment_evidence(self) -> None:
        forbidden_phrases = (
            "staging proof",
            "staging readiness",
            "release evidence",
            "production release closeout",
            "production 前仍必须",
            "staging client provision",
            "Staging client materialization",
            "run-with-staging-db-env",
            "当前代码是否已经实现",
            "当前代码是否已实现",
        )
        checked_roots = (
            DOCS_ROOT / "contracts",
            DOCS_ROOT / "data",
        )

        for root in checked_roots:
            for path in sorted(root.rglob("*.md")):
                text = path.read_text(encoding="utf-8")
                for phrase in forbidden_phrases:
                    self.assertNotIn(phrase, text, path)

    def test_supporting_architecture_does_not_own_deployment_procedure_state(self) -> None:
        forbidden_phrases = (
            "Committed Staging Manifest Shape",
            "Future ",
            "future ",
            "staging proof",
            "staging readiness",
            "staging smoke",
            "release evidence",
            "post-deploy evidence",
            "Release E2E evidence",
            "Post-Deploy Evidence",
            "staging takeover remains unverified",
            "已经上线",
        )

        for path in sorted((DOCS_ROOT / "architecture" / "system").glob("*.md")):
            if path.name == "README.md":
                continue
            text = path.read_text(encoding="utf-8")
            for phrase in forbidden_phrases:
                self.assertNotIn(phrase, text, path)

    def test_current_architecture_does_not_own_planning_or_staging_state(self) -> None:
        current = (DOCS_ROOT / "architecture" / "current.md").read_text(encoding="utf-8")

        forbidden_phrases = (
            "Future ",
            "future ",
            "staging readiness",
            "staging proof",
            "staging smoke",
            "release evidence",
            "work map",
        )

        for phrase in forbidden_phrases:
            self.assertNotIn(phrase, current)

    def test_domain_architecture_does_not_use_future_or_deployment_proof_labels(self) -> None:
        forbidden_phrases = (
            "candidate review report",
            "ingestion staging",
            "Future ",
            "future ",
            "local runtime proof",
            "one-shot proof",
            "staging proof",
            "staging readiness",
            "staging smoke",
            "release evidence",
            "当前已验证",
            "当前已经具备",
        )

        for path in sorted((DOCS_ROOT / "architecture" / "domains").rglob("*.md")):
            if path.name == "README.md":
                continue
            text = path.read_text(encoding="utf-8")
            for phrase in forbidden_phrases:
                self.assertNotIn(phrase, text, path)

    def test_non_runbook_docs_do_not_use_operational_progress_labels(self) -> None:
        forbidden_phrases = (
            "release evidence",
            "staging proof",
            "staging readiness",
            "staging smoke",
            "work map",
            "Future ",
            "future ",
        )
        checked_roots = (
            DOCS_ROOT / "architecture",
            DOCS_ROOT / "contracts",
            DOCS_ROOT / "data",
            DOCS_ROOT / "domains",
            DOCS_ROOT / "environment",
            DOCS_ROOT / "policies",
            DOCS_ROOT / "product",
            DOCS_ROOT / "reference",
        )

        for root in checked_roots:
            for path in sorted(root.rglob("*.md")):
                text = path.read_text(encoding="utf-8")
                for phrase in forbidden_phrases:
                    self.assertNotIn(phrase, text, path)

    def test_environment_docs_do_not_own_release_closeout_state(self) -> None:
        forbidden_phrases = (
            "staging proof",
            "release evidence",
            "post-deploy evidence",
            "pre-deploy evidence",
            "runtime proof",
            "evidence artifact",
            "evidence artifacts",
            "staging readiness",
            "staging state inventory",
        )

        for path in sorted((DOCS_ROOT / "environment").glob("*.md")):
            text = path.read_text(encoding="utf-8")
            for phrase in forbidden_phrases:
                self.assertNotIn(phrase, text, path)

    def test_runbooks_use_closeout_artifact_language_for_release_outputs(self) -> None:
        forbidden_phrases = (
            "Evidence Directory",
            "Pre-Deploy 证据",
            "Post-Deploy Evidence",
            "post-deploy evidence",
            "pre-deploy evidence",
            "evidence file",
            "evidence 完整",
            "evidence artifact",
            "release evidence",
        )

        for path in sorted((DOCS_ROOT / "runbooks").glob("*.md")):
            text = path.read_text(encoding="utf-8")
            for phrase in forbidden_phrases:
                self.assertNotIn(phrase, text, path)

    def test_domain_and_data_docs_do_not_hold_backlog_labels(self) -> None:
        forbidden_phrases = (
            "deferred backlog",
            "later-wave",
            "may later be exposed",
            "planned product work",
            "planned place_card projection",
            "后置到地图实际上线后的 backlog",
        )
        checked_roots = (
            DOCS_ROOT / "architecture" / "domains",
            DOCS_ROOT / "domains",
            DOCS_ROOT / "data",
        )

        for root in checked_roots:
            for path in sorted(root.rglob("*.md")):
                text = path.read_text(encoding="utf-8")
                for phrase in forbidden_phrases:
                    self.assertNotIn(phrase, text, path)

    def test_large_non_adr_docs_have_explicit_boundaries(self) -> None:
        accepted_boundary_headings = (
            "## 文档边界",
            "## Document Boundary",
            "## Boundary",
            "## Contract Boundary",
            "## Source Of Truth",
        )

        for path in sorted(DOCS_ROOT.rglob("*.md")):
            if path.parts[-2] == "decisions" or path.name == "README.md":
                continue
            line_count = len(path.read_text(encoding="utf-8").splitlines())
            if line_count < 300:
                continue
            text = path.read_text(encoding="utf-8")
            self.assertTrue(
                any(heading in text for heading in accepted_boundary_headings),
                path,
            )

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
            "Not a typecheck, unit test, integration test or E2E validation",
            verification_reference,
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
