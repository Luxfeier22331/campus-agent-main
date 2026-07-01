from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.check_ci_workflow_contracts import (
    CiWorkflowContractIssue,
    audit_ci_workflow_contracts,
)


class CheckCiWorkflowContractsTest(unittest.TestCase):
    def test_current_repo_ci_contracts_are_aligned(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(audit_ci_workflow_contracts(root=repo_root), ())

    def test_audit_reports_pnpm_version_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "apps/app-api").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": _required_scripts(),
                    }
                ),
                encoding="utf-8",
            )
            (root / "apps/app-api/package.json").write_text(
                json.dumps({"packageManager": "pnpm@10.17.1"}),
                encoding="utf-8",
            )
            _write_minimal_workflows(root, pnpm_version="10.17.1")

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
                path=".github/workflows/lint.yml",
                message="pnpm/action-setup version 10.17.1 does not match root 10.26.1",
            ),
            issues,
        )

    def test_audit_reports_missing_lane_script_and_workflow_call(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": {
                            key: value
                            for key, value in _required_scripts().items()
                            if key != "ci:repo-static"
                        },
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(root, pnpm_version="10.26.1", lint_run="pnpm repo:static")

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path="package.json",
                message="missing required CI lane script: ci:repo-static",
            ),
            issues,
        )

    def test_audit_requires_superseded_run_cancellation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": _required_scripts(),
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(root, pnpm_version="10.26.1", include_concurrency=False)

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/lint.yml",
                message="workflow must configure concurrency to cancel superseded runs",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/repo-guard.yml",
                message="workflow must configure concurrency to cancel superseded runs",
            ),
            issues,
        )

    def test_audit_requires_public_docs_publish_to_be_manual_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": _required_scripts(),
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(root, pnpm_version="10.26.1", public_docs_schedule=True)

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/public-docs-rolling-publish.yml",
                message="manual-only workflow must not define automatic triggers: schedule",
            ),
            issues,
        )

    def test_audit_forbids_secret_workflow_automatic_triggers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": _required_scripts(),
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                eval_schedule=True,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/eval-ragas-score.yml",
                message=(
                    "workflow references secrets and must not define automatic triggers: schedule"
                ),
            ),
            issues,
        )

    def test_audit_requires_secret_workflow_protected_environment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": _required_scripts(),
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                include_eval_environment=False,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/eval-ragas-score.yml",
                message=(
                    "eval-ragas-score must use protected environment 'eval-internal' "
                    "because workflow references secrets"
                ),
            ),
            issues,
        )

    def test_audit_forbids_public_docs_workflow_deploy_commands(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": _required_scripts(),
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(root, pnpm_version="10.26.1", public_docs_deploy=True)

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/public-docs-rolling-publish.yml",
                message="public docs manual workflow must stay build-only and must not deploy",
            ),
            issues,
        )

    def test_audit_requires_heavy_lanes_to_be_path_filtered(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": _required_scripts(),
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(root, pnpm_version="10.26.1", include_path_filters=False)

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/lint.yml",
                message="lint workflow must define a changes job for path-filtered heavy lanes",
            ),
            issues,
        )

    def test_audit_requires_langfuse_integration_check_lane(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            scripts = _required_scripts()
            scripts.pop("ci:langfuse")
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": scripts,
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                lint_run="pnpm ci:repo-static && pnpm ci:go",
                include_langfuse_job=False,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path="package.json",
                message="missing required CI lane script: ci:langfuse",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/lint.yml",
                message="workflow does not call required script: pnpm ci:langfuse",
            ),
            issues,
        )

    def test_audit_requires_langfuse_lane_to_check_trace_vectors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            scripts = _required_scripts()
            scripts["ci:langfuse"] = "pnpm langfuse:check"
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": scripts,
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(root, pnpm_version="10.26.1")

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path="package.json",
                message=(
                    "ci:langfuse must call its underlying checker directly; "
                    "do not route CI through removable root aliases"
                ),
            ),
            issues,
        )

    def test_audit_requires_langfuse_job_to_install_pnpm_dependencies(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": _required_scripts(),
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                install_langfuse_dependencies=False,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/lint.yml",
                message="langfuse-integration must run pnpm install before pnpm ci:langfuse",
            ),
            issues,
        )

    def test_audit_requires_golangci_lint_setup_before_go_lane(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": _required_scripts(),
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                lint_run="pnpm ci:repo-static && pnpm ci:go",
                install_golangci_lint=False,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/lint.yml",
                message="execution-control-go must install golangci-lint v2.11.4 before pnpm ci:go",
            ),
            issues,
        )

    def test_audit_requires_repo_static_lane_to_setup_uv_before_sync(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "packageManager": "pnpm@10.26.1",
                        "scripts": _required_scripts(),
                    }
                ),
                encoding="utf-8",
            )
            _write_minimal_workflows(
                root,
                pnpm_version="10.26.1",
                setup_repo_static_uv=False,
            )

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/lint.yml",
                message="repo-static must setup uv before uv sync",
            ),
            issues,
        )


def _required_scripts() -> dict[str, str]:
    return {
        "repo:guard": "uv run --all-packages python -m unittest tests.test_docs_structure tests.test_workspace_layout tests.test_repo_collaboration -q",
        "repo:static": "pnpm web:lint",
        "ci:repo-guard": "pnpm repo:guard",
        "ci:repo-static": "pnpm repo:static",
        "ci:langfuse": (
            "pnpm --dir packages/eval-langfuse typecheck && "
            "pnpm --dir packages/eval-langfuse test && "
            "pnpm --dir apps/app-api exec tsx ./scripts/check-langfuse-trace-id-vectors.ts"
        ),
        "ci:go": "pnpm go:check",
        "ci:web-graph:full": "pnpm web:check",
        "ci:config:lint": "uv run --all-packages python -m scripts.check_ci_workflow_contracts",
    }


def _write_minimal_workflows(
    root: Path,
    *,
    pnpm_version: str,
    lint_run: str = "pnpm ci:repo-static && pnpm ci:langfuse && pnpm ci:go",
    install_golangci_lint: bool = True,
    include_langfuse_job: bool = True,
    install_langfuse_dependencies: bool = True,
    setup_repo_static_uv: bool = True,
    include_concurrency: bool = True,
    include_path_filters: bool = True,
    public_docs_schedule: bool = False,
    public_docs_deploy: bool = False,
    eval_schedule: bool = False,
    include_eval_environment: bool = True,
) -> None:
    go_lint_install_steps = (
        (
            "      - name: Install golangci-lint",
            "        run: go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.4",
        )
        if install_golangci_lint
        else ()
    )
    langfuse_install_steps = (
        ("      - run: pnpm install --frozen-lockfile",) if install_langfuse_dependencies else ()
    )
    repo_static_uv_steps = ("      - uses: astral-sh/setup-uv@v6",) if setup_repo_static_uv else ()
    concurrency_lines = (
        (
            "concurrency:",
            "  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
            "  cancel-in-progress: true",
        )
        if include_concurrency
        else ()
    )
    changes_job = (
        (
            "  changes:",
            "    outputs:",
            "      go: ${{ steps.filter.outputs.go }}",
            "      langfuse: ${{ steps.filter.outputs.langfuse }}",
            "    steps:",
            "      - id: filter",
            "        run: |",
            '          echo go=true >> "$GITHUB_OUTPUT"',
            '          echo langfuse=true >> "$GITHUB_OUTPUT"',
        )
        if include_path_filters
        else ()
    )
    langfuse_job_gate = (
        ("    needs: changes", "    if: needs.changes.outputs.langfuse == 'true'")
        if include_path_filters
        else ()
    )
    go_job_gate = (
        ("    needs: changes", "    if: needs.changes.outputs.go == 'true'")
        if include_path_filters
        else ()
    )
    langfuse_job_steps = (
        (
            "  langfuse-integration:",
            *langfuse_job_gate,
            "    steps:",
            "      - uses: pnpm/action-setup@v4",
            "        with:",
            f"          version: {pnpm_version}",
            *langfuse_install_steps,
            "      - run: pnpm ci:langfuse",
        )
        if include_langfuse_job
        else ()
    )
    (root / ".github/workflows/lint.yml").write_text(
        "\n".join(
            (
                "name: lint",
                *concurrency_lines,
                "jobs:",
                *changes_job,
                "  repo-static:",
                "    steps:",
                *repo_static_uv_steps,
                "      - uses: pnpm/action-setup@v4",
                "        with:",
                f"          version: {pnpm_version}",
                "      - run: uv sync --all-packages --dev",
                f"      - run: {lint_run}",
                *langfuse_job_steps,
                "  execution-control-go:",
                *go_job_gate,
                "    steps:",
                "      - uses: pnpm/action-setup@v4",
                "        with:",
                f"          version: {pnpm_version}",
                *go_lint_install_steps,
                "      - run: pnpm ci:go",
                "",
            )
        ),
        encoding="utf-8",
    )
    (root / ".github/workflows/repo-guard.yml").write_text(
        "\n".join(
            (
                "name: repo-guard",
                *concurrency_lines,
                "jobs:",
                "  docs-and-collaboration-guard:",
                "    steps:",
                "      - run: uv run --all-packages python -m unittest tests.test_docs_structure tests.test_workspace_layout tests.test_repo_collaboration tests.test_package_script_policy -q",
                "",
            )
        ),
        encoding="utf-8",
    )
    public_docs_triggers = (
        (
            "on:",
            "  schedule:",
            "    - cron: '7 4,10,16,22 * * *'",
            "  workflow_dispatch:",
        )
        if public_docs_schedule
        else ("on:", "  workflow_dispatch:")
    )
    public_docs_command = (
        "pnpm --dir apps/campus-web deploy"
        if public_docs_deploy
        else "pnpm --dir apps/campus-web build"
    )
    (root / ".github/workflows/public-docs-rolling-publish.yml").write_text(
        "\n".join(
            (
                "name: public-docs-rolling-publish",
                *public_docs_triggers,
                "jobs:",
                "  publish:",
                "    steps:",
                "      - uses: pnpm/action-setup@v4",
                "        with:",
                f"          version: {pnpm_version}",
                f"      - run: {public_docs_command}",
                "",
            )
        ),
        encoding="utf-8",
    )
    eval_triggers = (
        (
            "on:",
            "  schedule:",
            "    - cron: '9 4 * * *'",
            "  workflow_dispatch:",
        )
        if eval_schedule
        else ("on:", "  workflow_dispatch:")
    )
    eval_environment_lines = ("    environment: eval-internal",) if include_eval_environment else ()
    (root / ".github/workflows/eval-ragas-score.yml").write_text(
        "\n".join(
            (
                "name: eval-ragas-score",
                *eval_triggers,
                "jobs:",
                "  eval-ragas-score:",
                *eval_environment_lines,
                "    env:",
                "      LLM_API_KEY: ${{ secrets.LLM_API_KEY }}",
                "    steps:",
                "      - uses: actions/setup-python@v5",
                "      - uses: astral-sh/setup-uv@v6",
                "      - run: uv sync --all-packages --dev",
                "      - run: pnpm --dir packages/eval-langfuse langfuse ragas-score-traces",
                "      - run: pnpm --dir packages/eval-langfuse langfuse ragas-score-dataset",
                "",
            )
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    unittest.main()
