from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_ISSUE_FORMS = {
    "bug_report.yml",
    "config.yml",
    "documentation.yml",
    "feature_request.yml",
}


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
            ROOT / ".github" / "workflows" / "pr.yml",
            ROOT / ".github" / "workflows" / "scorecard.yml",
            ROOT / ".github" / "workflows" / "scheduled-health.yml",
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
        self.assertIn("feature/worktree -> PR -> main", contributing)
        self.assertIn("main", contributing)
        self.assertIn("release tag", contributing)
        self.assertIn("GitHub Environment", contributing)
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
        self.assertNotIn("security-events: write", workflow_text)
        self.assertNotIn("id-token: write", workflow_text)
        self.assertIn("not a PR blocker", lanes)

    def test_scheduled_health_runs_full_non_release_health_lanes(self) -> None:
        workflow_path = ROOT / ".github" / "workflows" / "scheduled-health.yml"
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
        self.assertIn("pnpm ci:repo:full", workflow_text)
        self.assertIn("pnpm ci:web:full", workflow_text)
        self.assertIn(
            "uv run --all-packages python -m unittest discover -s tests -t .",
            workflow_text,
        )
        self.assertIn("pnpm ci:go", workflow_text)
        self.assertIn(
            "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.8",
            workflow_text,
        )
        self.assertIn("golangci-lint@v2.11.4", workflow_text)
        secret_refs = sorted(set(re.findall(r"secrets\.[A-Z0-9_]+", workflow_text)))
        self.assertEqual(secret_refs, ["secrets.TURBO_TOKEN"])
        self.assertIn("TURBO_TEAM: ${{ vars.TURBO_TEAM }}", workflow_text)
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
        self.assertIn("pnpm ci:config", combined)
        self.assertIn("npm / pnpm", combined)
        self.assertIn("pnpm ci:web", combined)
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
        self.assertIn("gitleaks/gitleaks-action@v3", combined)
        self.assertIn("pnpm ci:deps", combined)
        self.assertIn("actionlint", combined)
        self.assertIn("zizmor", combined)
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
        pr_checks = (ROOT / ".github" / "workflows" / "pr.yml").read_text(encoding="utf-8")
        root_package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        scripts = root_package.get("scripts", {})

        self.assertNotIn("ci:secrets", scripts)
        self.assertIn("ci:deps", scripts)
        self.assertIn("gitleaks/gitleaks-action@v3", pr_checks)
        self.assertIn("GITLEAKS_LICENSE", pr_checks)
        self.assertIn("osv-scanner-reusable-pr.yml@v2.3.8", pr_checks)
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

    def test_execution_runtime_image_workflow_publishes_first_party_runtime_images(
        self,
    ) -> None:
        workflow_text = (ROOT / ".github" / "workflows" / "execution-runtime-image.yml").read_text(
            encoding="utf-8"
        )
        lanes = (ROOT / "docs/reference/testing-and-verification-lanes.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("apps/execution-control/Dockerfile", workflow_text)
        self.assertIn("apps/agent-runtime/Dockerfile", workflow_text)
        self.assertIn("ghcr.io/${{ github.repository }}/${{ matrix.image }}", workflow_text)
        self.assertIn("name=${IMAGE_NAME,,}", workflow_text)
        self.assertIn("${{ steps.image.outputs.name }}:${{ github.sha }}", workflow_text)
        self.assertIn("${{ steps.image.outputs.name }}:staging", workflow_text)
        self.assertIn("aquasecurity/trivy-action@v0.36.0", workflow_text)
        self.assertIn("anchore/sbom-action@v0.24.0", workflow_text)
        self.assertIn('exit-code: "1"', workflow_text)
        self.assertIn("severity: HIGH,CRITICAL", workflow_text)
        self.assertIn("dependency-snapshot: false", workflow_text)
        self.assertIn("execution-runtime-image", lanes)
        self.assertIn("execution-control:staging", lanes)
        self.assertIn("agent-runtime:staging", lanes)

    def test_execution_runtime_dockerfiles_use_fixed_security_patch_inputs(self) -> None:
        agent_runtime_dockerfile = (ROOT / "apps" / "agent-runtime" / "Dockerfile").read_text(
            encoding="utf-8"
        )
        execution_control_dockerfile = (
            ROOT / "apps" / "execution-control" / "Dockerfile"
        ).read_text(encoding="utf-8")

        self.assertIn("FROM node:24.15-bookworm-slim AS build", agent_runtime_dockerfile)
        self.assertIn("FROM node:24.15-bookworm-slim AS runtime", agent_runtime_dockerfile)
        self.assertNotIn("node:24-bookworm-slim", agent_runtime_dockerfile)
        self.assertIn("corepack@0.35.0", agent_runtime_dockerfile)
        self.assertNotIn("corepack@latest", agent_runtime_dockerfile)
        self.assertIn("apt-get upgrade -y", agent_runtime_dockerfile)
        self.assertIn("rm -rf /usr/local/lib/node_modules/corepack", agent_runtime_dockerfile)
        self.assertIn("/usr/local/lib/node_modules/npm", agent_runtime_dockerfile)
        self.assertIn("/usr/local/bin/npm", agent_runtime_dockerfile)
        self.assertIn("FROM golang:1.26.4-bookworm AS build", execution_control_dockerfile)
        self.assertNotIn("golang:1.26.2-bookworm", execution_control_dockerfile)

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
        self.assertIn("pr / required", contributing)
        self.assertIn("failed、cancelled、missing", contributing)
        self.assertIn("changed-surface", contributing)
        self.assertIn("manual、staging、eval lane", contributing)

    def test_github_templates_use_official_repository_paths(self) -> None:
        issue_template_root = ROOT / ".github" / "ISSUE_TEMPLATE"
        template_names = {path.name for path in issue_template_root.iterdir() if path.is_file()}
        template = (ROOT / ".github" / "pull_request_template.md").read_text(encoding="utf-8")

        self.assertIn("# Pull Request", template)
        self.assertEqual(template_names, EXPECTED_ISSUE_FORMS)
        self.assertNotIn("bug_report.md", template_names)
        self.assertNotIn("docs_issue.md", template_names)
        self.assertNotIn("feature_request.md", template_names)

    def test_github_issue_forms_use_yaml_schema_without_markdown_duplicates(self) -> None:
        issue_template_root = ROOT / ".github" / "ISSUE_TEMPLATE"
        template_names = sorted(
            path.name for path in issue_template_root.iterdir() if path.is_file()
        )
        config = yaml.safe_load((issue_template_root / "config.yml").read_text(encoding="utf-8"))

        self.assertEqual(set(template_names), EXPECTED_ISSUE_FORMS)
        self.assertEqual([name for name in template_names if name.endswith(".md")], [])
        self.assertFalse(config["blank_issues_enabled"])

        for form_name in sorted(EXPECTED_ISSUE_FORMS - {"config.yml"}):
            form_path = issue_template_root / form_name
            form = yaml.safe_load(form_path.read_text(encoding="utf-8"))
            form_label = str(form_path.relative_to(ROOT))

            self.assertIsInstance(form.get("name"), str, form_label)
            self.assertIsInstance(form.get("description"), str, form_label)
            self.assertIsInstance(form.get("title"), str, form_label)
            self.assertIsInstance(form.get("labels"), list, form_label)
            self.assertIsInstance(form.get("body"), list, form_label)
            self.assertGreater(len(form["body"]), 0, form_label)
            self.assertIn(
                "checkboxes",
                [entry.get("type") for entry in form["body"] if isinstance(entry, dict)],
                form_label,
            )

    def test_pull_request_template_stays_github_native_without_audit_checklist(self) -> None:
        template = (ROOT / ".github" / "pull_request_template.md").read_text(encoding="utf-8")
        headings = [
            line.strip() for line in template.splitlines() if line.strip().startswith("## ")
        ]
        forbidden_phrases = [
            "/kind ",
            "/release-note-none",
            "Public Source / Data Boundary",
            "Data Boundary",
            "CI 与合并纪律",
            "CodeQL",
            "Dependency Review",
            "artifact attestation",
            "branch protection",
            "changed-surface",
            "manual / staging / eval lane",
            "private repo",
            "pr / required",
            "source-derived documents",
            "No internal publish/deploy workflow",
            "explicitly redistributable",
            "Kubernetes / Prow",
        ]

        self.assertEqual(
            headings,
            [
                "## Why is this change needed?",
                "## What changed?",
                "## How was this verified?",
                "## Related issue(s)",
                "## Change category",
                "## User-facing change",
                "## API / contract / migration impact",
                "## Documentation",
            ],
        )
        self.assertIn("- [ ] Feature", template)
        self.assertIn("- [ ] API / contract change", template)
        self.assertIn("- [ ] Cleanup / refactor", template)
        self.assertIn("```release-note", template)
        self.assertIn("NONE", template)
        self.assertIn("```docs", template)
        self.assertIn('If there is no associated issue, then write "N/A".', template)
        self.assertNotIn("Reviewer Notes", template)

        for phrase in forbidden_phrases:
            self.assertNotIn(phrase, template)

    def test_verification_lanes_document_manual_required_checks_fallback(self) -> None:
        lanes = (ROOT / "docs/reference/testing-and-verification-lanes.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("private repository", lanes)
        self.assertIn("branch protection / rulesets", lanes)
        self.assertIn("pr / required", lanes)
        self.assertIn("changed-surface detection", lanes)


if __name__ == "__main__":
    unittest.main()
