from __future__ import annotations

import json
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


class RepoCollaborationTest(unittest.TestCase):
    def test_repo_has_basic_collaboration_scaffolding(self) -> None:
        expected_files = {
            ROOT / ".editorconfig",
            ROOT / ".pre-commit-config.yaml",
            ROOT / ".gitleaks.toml",
            ROOT / "osv-scanner.toml",
            ROOT / "CODE_OF_CONDUCT.md",
            ROOT / "CONTRIBUTING.md",
            ROOT / ".github" / "CODEOWNERS",
            ROOT / ".github" / "dependabot.yml",
            ROOT / ".github" / "workflows" / "pr-checks.yml",
            ROOT / ".github" / "workflows" / "scorecard.yml",
            ROOT / ".github" / "workflows" / "scheduled-checks.yml",
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

    def test_repo_uses_pre_commit_as_single_local_hook_system(self) -> None:
        contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
        lanes = (ROOT / "docs/reference/testing-and-verification-lanes.md").read_text(
            encoding="utf-8"
        )
        pre_commit = (ROOT / ".pre-commit-config.yaml").read_text(encoding="utf-8")
        root_package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

        self.assertIn("pre-commit install", contributing)
        self.assertIn("不使用 Husky / lint-staged / lefthook", contributing)
        self.assertIn("only repository-level local hook system", lanes)
        self.assertIn("Not a typecheck", lanes)
        self.assertIn("check-toml", pre_commit)
        self.assertIn("https://github.com/gitleaks/gitleaks", pre_commit)
        self.assertFalse((ROOT / ".husky").exists())
        self.assertNotIn("lint-staged", json.dumps(root_package, ensure_ascii=False))
        self.assertNotIn("lefthook", json.dumps(root_package, ensure_ascii=False))
        self.assertNotIn("simple-git-hooks", json.dumps(root_package, ensure_ascii=False))
        self.assertNotIn("prepare", root_package.get("scripts", {}))

    def test_codeowners_records_repository_ownership(self) -> None:
        codeowners = (ROOT / ".github" / "CODEOWNERS").read_text(encoding="utf-8")

        self.assertIn("* @Linear27", codeowners)
        self.assertIn("/.github/ @Linear27", codeowners)
        self.assertIn("/docs/ @Linear27", codeowners)
        self.assertIn("/apps/ @Linear27", codeowners)
        self.assertIn("/packages/ @Linear27", codeowners)
        self.assertIn("/scripts/ @Linear27", codeowners)
        self.assertIn("/tests/ @Linear27", codeowners)

    def test_dependabot_covers_supported_dependency_surfaces(self) -> None:
        config = yaml.safe_load((ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8"))
        updates = config.get("updates", [])
        surfaces = {
            (entry.get("package-ecosystem"), entry.get("directory"))
            for entry in updates
            if isinstance(entry, dict)
        }

        self.assertEqual(config.get("version"), 2)
        self.assertIn(("github-actions", "/"), surfaces)
        self.assertIn(("npm", "/"), surfaces)
        self.assertIn(("gomod", "/apps/execution-control"), surfaces)
        for entry in updates:
            self.assertEqual(entry.get("schedule", {}).get("interval"), "weekly")
            self.assertGreater(entry.get("open-pull-requests-limit", 0), 0)

    def test_scorecard_is_non_blocking_security_posture_signal(self) -> None:
        workflow = yaml.safe_load(
            (ROOT / ".github" / "workflows" / "scorecard.yml").read_text(encoding="utf-8")
        )
        workflow_text = (ROOT / ".github" / "workflows" / "scorecard.yml").read_text(
            encoding="utf-8"
        )
        lanes = (ROOT / "docs/reference/testing-and-verification-lanes.md").read_text(
            encoding="utf-8"
        )

        triggers = workflow.get(True) or workflow.get("on")
        self.assertIn("workflow_dispatch", triggers)
        self.assertIn("schedule", triggers)
        self.assertNotIn("pull_request", triggers)
        self.assertIn("ossf/scorecard-action@v2.4.3", workflow_text)
        self.assertIn("publish_results: false", workflow_text)
        self.assertIn("security-events: write", workflow_text)
        self.assertIn("not a PR blocker", lanes)

    def test_scheduled_checks_run_full_non_release_health_lanes(self) -> None:
        workflow_path = ROOT / ".github" / "workflows" / "scheduled-checks.yml"
        workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
        workflow_text = workflow_path.read_text(encoding="utf-8")
        lanes = (ROOT / "docs/reference/testing-and-verification-lanes.md").read_text(
            encoding="utf-8"
        )
        normalized_lanes = " ".join(lanes.split())

        triggers = workflow.get(True) or workflow.get("on")
        self.assertIn("workflow_dispatch", triggers)
        self.assertIn("schedule", triggers)
        self.assertNotIn("pull_request", triggers)
        self.assertIn("pnpm ci:repo-static", workflow_text)
        self.assertIn("pnpm ci:web-graph:full", workflow_text)
        self.assertIn(
            "uv run --all-packages python -m unittest discover -s tests -t .",
            workflow_text,
        )
        self.assertIn("pnpm ci:go", workflow_text)
        self.assertIn("pnpm ci:deps:vuln", workflow_text)
        self.assertIn("golangci-lint@v2.11.4", workflow_text)
        self.assertIn("osv-scanner@v2.3.8", workflow_text)
        self.assertNotIn("secrets.", workflow_text)
        self.assertIn("drift / regression detection", normalized_lanes)
        self.assertIn("not a PR blocker", lanes)

    def test_dependabot_pr_verification_discipline_is_documented(self) -> None:
        template = (ROOT / ".github" / "pull_request_template.md").read_text(encoding="utf-8")
        contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
        lanes = (ROOT / "docs/reference/testing-and-verification-lanes.md").read_text(
            encoding="utf-8"
        )
        combined = "\n".join((template, contributing, lanes))

        self.assertIn("Dependabot PR", combined)
        self.assertIn("GitHub Actions", combined)
        self.assertIn("pnpm ci:config:lint", combined)
        self.assertIn("npm / pnpm", combined)
        self.assertIn("pnpm ci:web-graph:affected", combined)
        self.assertIn("Go module", combined)
        self.assertIn("pnpm ci:go", combined)

    def test_security_supply_chain_lane_posture_is_documented(self) -> None:
        template = (ROOT / ".github" / "pull_request_template.md").read_text(encoding="utf-8")
        contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
        lanes = (ROOT / "docs/reference/testing-and-verification-lanes.md").read_text(
            encoding="utf-8"
        )
        combined = "\n".join((template, contributing, lanes))

        self.assertIn("Security / Supply Chain Lanes", lanes)
        self.assertIn("pnpm ci:secrets", combined)
        self.assertIn("pnpm ci:deps:vuln", combined)
        self.assertIn("actionlint", combined)
        self.assertIn("CodeQL", combined)
        self.assertIn("Dependency Review", combined)
        self.assertIn("artifact attestation", combined)
        self.assertIn("GitHub Code Security", lanes)
        self.assertIn("Advanced Security", lanes)
        self.assertIn("real release artifacts", lanes)
        self.assertIn("无条件 PR blocker", contributing)

    def test_secret_and_dependency_security_lanes_are_documented(self) -> None:
        lanes = (ROOT / "docs/reference/testing-and-verification-lanes.md").read_text(
            encoding="utf-8"
        )
        pr_checks = (ROOT / ".github" / "workflows" / "pr-checks.yml").read_text(encoding="utf-8")
        root_package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        scripts = root_package.get("scripts", {})

        self.assertIn("ci:secrets", scripts)
        self.assertIn("ci:deps:vuln", scripts)
        self.assertIn("secret-scan", pr_checks)
        self.assertIn("pnpm ci:secrets", pr_checks)
        self.assertIn("Gitleaks", lanes)
        self.assertIn("OSV-Scanner", lanes)
        self.assertIn("pnpm-lock.yaml", lanes)
        self.assertIn("full commit SHA", lanes)

    def test_dining_image_workflow_scans_and_generates_sbom_before_push(self) -> None:
        workflow_text = (ROOT / ".github" / "workflows" / "dining-sync-image.yml").read_text(
            encoding="utf-8"
        )
        lanes = (ROOT / "docs/reference/testing-and-verification-lanes.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("aquasecurity/trivy-action@v0.36.0", workflow_text)
        self.assertIn("anchore/sbom-action@v0.24.0", workflow_text)
        self.assertIn('exit-code: "1"', workflow_text)
        self.assertIn("severity: HIGH,CRITICAL", workflow_text)
        self.assertIn("dependency-snapshot: false", workflow_text)
        self.assertIn("SBOM artifact", lanes)

    def test_security_supply_chain_lanes_are_not_unconditional_pr_workflows(self) -> None:
        workflow_dir = ROOT / ".github" / "workflows"
        guarded_keywords = ("codeql", "dependency-review", "attestation")

        for workflow_path in workflow_dir.glob("*.yml"):
            workflow_text = workflow_path.read_text(encoding="utf-8")
            if not any(keyword in workflow_text.lower() for keyword in guarded_keywords):
                continue

            workflow = yaml.safe_load(workflow_text)
            triggers = workflow.get(True) or workflow.get("on") or {}
            self.assertNotIn(
                "pull_request",
                triggers,
                f"{workflow_path.relative_to(ROOT)} must not add an unconditional "
                "CodeQL / Dependency Review / attestation PR blocker before the "
                "private repository prerequisite is confirmed.",
            )

    def test_contributing_records_private_repo_merge_discipline(self) -> None:
        contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")

        self.assertIn("branch protection / rulesets", contributing)
        self.assertIn("pr-checks / required-checks", contributing)
        self.assertIn("failed、cancelled、missing", contributing)
        self.assertIn("changed-surface", contributing)
        self.assertIn("manual、staging、eval lane", contributing)

    def test_verification_lanes_document_manual_required_checks_fallback(self) -> None:
        lanes = (ROOT / "docs/reference/testing-and-verification-lanes.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("private repository", lanes)
        self.assertIn("branch protection / rulesets", lanes)
        self.assertIn("pr-checks / required-checks", lanes)
        self.assertIn("changed-surface detection", lanes)


if __name__ == "__main__":
    unittest.main()
