from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import yaml

from scripts.check_ci_workflow_contracts import audit_ci_workflow_contracts
from scripts.ci_workflow_contract_types import CiWorkflowContractIssue
from tests.ci_workflow_contract_test_support import required_scripts, write_minimal_workflows


class CheckCiWorkflowContractsTest(unittest.TestCase):
    def test_current_repo_ci_contracts_are_aligned(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(audit_ci_workflow_contracts(root=repo_root), ())

    def test_pr_checks_uses_single_repo_checks_job(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        workflow = yaml.safe_load(
            (repo_root / ".github/workflows/pr-checks.yml").read_text(encoding="utf-8")
        )
        jobs = workflow["jobs"]

        self.assertIn("repo-checks", jobs)
        self.assertNotIn("repo-guard", jobs)
        self.assertNotIn("repo-static", jobs)
        self.assertNotIn("config-lint", jobs)

    def test_audit_reports_pnpm_version_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "apps/app-api").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            (root / "apps/app-api/package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.17.1"}), encoding="utf-8"
            )
            write_minimal_workflows(root, pnpm_version="10.17.1")

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path="apps/app-api/package.json",
                message="packageManager pnpm version 10.17.1 does not match root 10.26.1",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="pnpm/action-setup version 10.17.1 does not match root 10.26.1",
            ),
            issues,
        )

    def test_audit_reports_nested_domain_package_pnpm_version_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "packages/domains/dining").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            (root / "packages/domains/dining/package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.17.1"}), encoding="utf-8"
            )
            write_minimal_workflows(root, pnpm_version="10.26.1")

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path="packages/domains/dining/package.json",
                message="packageManager pnpm version 10.17.1 does not match root 10.26.1",
            ),
            issues,
        )

    def test_audit_reports_missing_lane_script_and_workflow_call(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            scripts = {
                key: value
                for key, value in required_scripts().items()
                if key != "ci:repo-static:affected"
            }
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": scripts}),
                encoding="utf-8",
            )
            write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                omit_pr_check_call="pnpm ci:repo-static:affected",
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path="package.json",
                message="missing required CI lane script: ci:repo-static:affected",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="workflow does not call required script: pnpm ci:repo-static:affected",
            ),
            issues,
        )

    def test_audit_does_not_treat_prefixed_script_as_required_call(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                omit_pr_check_call="pnpm ci:repo-static",
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="workflow does not call required script: pnpm ci:repo-static",
            ),
            issues,
        )

    def test_audit_rejects_retired_automatic_workflows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1")
            (root / ".github/workflows/lint.yml").write_text("name: lint\n", encoding="utf-8")
            (root / ".github/workflows/repo-guard.yml").write_text(
                "name: repo-guard\n", encoding="utf-8"
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/lint.yml",
                message="retired automatic workflow must not exist; use pr-checks.yml",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/repo-guard.yml",
                message="retired automatic workflow must not exist; use pr-checks.yml",
            ),
            issues,
        )

    def test_audit_requires_pr_checks_concurrency_and_aggregate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                include_concurrency=False,
                include_required_checks=False,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="workflow must configure concurrency to cancel superseded runs",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="pr-checks workflow must define required-checks aggregate job",
            ),
            issues,
        )

    def test_audit_requires_all_path_filtered_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1", include_path_filters=False)

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="pr-checks workflow must define a changes job for path-filtered heavy lanes",
            ),
            issues,
        )

    def test_audit_requires_langfuse_lane_to_check_trace_vectors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            scripts = required_scripts()
            scripts["ci:langfuse"] = "pnpm langfuse:check"
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": scripts}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1")

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path="package.json",
                message=(
                    "ci:langfuse must match the required CI command shape; "
                    "do not route CI through removable or base-ambiguous aliases"
                ),
            ),
            issues,
        )

    def test_audit_requires_config_lint_to_run_actionlint_and_action_policy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            scripts = required_scripts()
            scripts["ci:config:lint"] = (
                "uv run --all-packages python -m scripts.check_ci_workflow_contracts"
            )
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": scripts}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1")

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path="package.json",
                message=(
                    "ci:config:lint must match the required CI command shape; "
                    "do not route CI through removable or base-ambiguous aliases"
                ),
            ),
            issues,
        )

    def test_audit_requires_repo_checks_go_tooling_before_conftest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                setup_repo_static_go=False,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="repo-checks must setup Go before installing conftest",
            ),
            issues,
        )

    def test_audit_requires_secret_scan_lane_tooling(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1", install_gitleaks=False)

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="secret-scan must install gitleaks v8.30.1 before pnpm ci:secrets",
            ),
            issues,
        )

    def test_audit_requires_secret_scan_uv_tooling(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1", setup_secret_scan_uv=False)

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="secret-scan must setup uv before pnpm ci:secrets",
            ),
            issues,
        )

    def test_audit_requires_secret_scan_go_bin_on_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                export_secret_scan_go_bin=False,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="secret-scan must add Go bin to PATH before pnpm ci:secrets",
            ),
            issues,
        )

    def test_audit_requires_dependency_vulnerability_lane_tooling(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                install_osv_scanner=False,
                export_osv_go_bin=False,
                setup_osv_uv=False,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/scheduled-checks.yml",
                message="dependency-vulnerability-full must setup uv before pnpm ci:deps:vuln",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/scheduled-checks.yml",
                message=(
                    "dependency-vulnerability-full must install osv-scanner v2.3.8 "
                    "before pnpm ci:deps:vuln"
                ),
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/scheduled-checks.yml",
                message=(
                    "dependency-vulnerability-full must add Go bin to PATH before pnpm ci:deps:vuln"
                ),
            ),
            issues,
        )

    def test_audit_requires_tooling_before_ci_lane_calls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                install_golangci_lint=False,
                install_langfuse_dependencies=False,
                setup_repo_static_uv=False,
                install_repo_static_conftest=False,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="execution-control-go must install golangci-lint v2.11.4 before pnpm ci:go",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="repo-checks must setup uv before uv sync",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="repo-checks must install conftest v0.65.0 before pnpm ci:repo-static",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="repo-checks must add Go bin to PATH before pnpm ci:repo-static",
            ),
            issues,
        )

    def test_audit_requires_setup_cache_for_node_and_uv(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1", setup_cache=False)

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message="astral-sh/setup-uv steps must enable uv cache",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/pr-checks.yml",
                message=(
                    "actions/setup-node steps must enable pnpm cache "
                    "when the job installs the pnpm workspace"
                ),
            ),
            issues,
        )

    def test_audit_requires_pnpm_setup_before_setup_node_pnpm_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            workflow_dir = root / ".github/workflows"
            workflow_dir.mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1")
            (workflow_dir / "broken-pnpm-cache.yml").write_text(
                "\n".join(
                    (
                        "name: broken-pnpm-cache",
                        "on: workflow_dispatch",
                        "jobs:",
                        "  check:",
                        "    steps:",
                        "      - uses: actions/setup-node@v6",
                        "        with:",
                        '          node-version: "24"',
                        "          cache: pnpm",
                        "          cache-dependency-path: pnpm-lock.yaml",
                        "      - uses: pnpm/action-setup@v6",
                        "        with:",
                        "          version: 10.26.1",
                        "      - run: pnpm install --frozen-lockfile",
                        "",
                    )
                ),
                encoding="utf-8",
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/broken-pnpm-cache.yml",
                message=(
                    "pnpm/action-setup must run before actions/setup-node "
                    "when setup-node enables pnpm cache"
                ),
            ),
            issues,
        )

    def test_audit_rejects_pnpm_cache_without_workspace_install(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            workflow_dir = root / ".github/workflows"
            workflow_dir.mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1")
            (workflow_dir / "broken-unused-pnpm-cache.yml").write_text(
                "\n".join(
                    (
                        "name: broken-unused-pnpm-cache",
                        "on: workflow_dispatch",
                        "jobs:",
                        "  check:",
                        "    steps:",
                        "      - uses: pnpm/action-setup@v6",
                        "        with:",
                        "          version: 10.26.1",
                        "      - uses: actions/setup-node@v6",
                        "        with:",
                        '          node-version: "24"',
                        "          cache: pnpm",
                        "          cache-dependency-path: pnpm-lock.yaml",
                        "      - run: pnpm ci:go",
                        "",
                    )
                ),
                encoding="utf-8",
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/broken-unused-pnpm-cache.yml",
                message=(
                    "actions/setup-node must not enable pnpm cache "
                    "when the job does not run pnpm install"
                ),
            ),
            issues,
        )

    def test_audit_does_not_require_retired_eval_ragas_workflow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1")

            issues = audit_ci_workflow_contracts(root=root)

        self.assertEqual(issues, ())

    def test_audit_allows_turbo_cache_secret_on_automatic_turbo_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1")
            pr_checks = root / ".github/workflows/pr-checks.yml"
            pr_checks.write_text(
                pr_checks.read_text(encoding="utf-8").replace(
                    "      TURBO_SCM_BASE: ${{ needs.changes.outputs.base_sha }}",
                    "\n".join(
                        (
                            "      TURBO_SCM_BASE: ${{ needs.changes.outputs.base_sha }}",
                            "      TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}",
                            "      TURBO_TEAM: ${{ vars.TURBO_TEAM }}",
                        )
                    ),
                ),
                encoding="utf-8",
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertEqual(issues, ())

    def test_audit_requires_dining_image_workflow_to_be_manual_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(root, pnpm_version="10.26.1", dining_schedule=True)

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/dining-sync-image.yml",
                message="manual-only workflow must not define automatic triggers: schedule",
            ),
            issues,
        )

    def test_audit_requires_dining_image_push_to_be_input_guarded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.26.1", "scripts": required_scripts()}),
                encoding="utf-8",
            )
            write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                dining_unconditional_push=True,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/dining-sync-image.yml",
                message="dining-sync image workflow must gate GHCR login and image push behind inputs.push_image",
            ),
            issues,
        )


if __name__ == "__main__":
    unittest.main()
