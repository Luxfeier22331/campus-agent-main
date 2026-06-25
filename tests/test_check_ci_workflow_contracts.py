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
                lint_run="pnpm ci:repo-static && pnpm ci:intent && pnpm ci:go",
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

    def test_audit_requires_intent_lane_to_call_checker_directly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".github/workflows").mkdir(parents=True)
            scripts = _required_scripts()
            scripts["ci:intent"] = "pnpm eval:intent"
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
                    "ci:intent must call its underlying checker directly; "
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
                lint_run="pnpm ci:repo-static && pnpm ci:intent && pnpm ci:go",
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
        "ci:intent": "uv run --all-packages python -m scripts.intent_gate",
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
    lint_run: str = "pnpm ci:repo-static && pnpm ci:intent && pnpm ci:langfuse && pnpm ci:go",
    install_golangci_lint: bool = True,
    include_langfuse_job: bool = True,
    install_langfuse_dependencies: bool = True,
    setup_repo_static_uv: bool = True,
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
    langfuse_job_steps = (
        (
            "  langfuse-integration:",
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
    repo_static_uv_steps = ("      - uses: astral-sh/setup-uv@v6",) if setup_repo_static_uv else ()
    (root / ".github/workflows/lint.yml").write_text(
        "\n".join(
            (
                "name: lint",
                "jobs:",
                "  repo-static:",
                "    steps:",
                *repo_static_uv_steps,
                "      - uses: pnpm/action-setup@v4",
                "        with:",
                f"          version: {pnpm_version}",
                "      - run: uv sync --all-packages --dev",
                f"      - run: {lint_run}",
                "  intent-release-gate:",
                "    steps:",
                "      - uses: pnpm/action-setup@v4",
                "        with:",
                f"          version: {pnpm_version}",
                "      - run: pnpm ci:intent",
                *langfuse_job_steps,
                "  execution-control-go:",
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
                "jobs:",
                "  docs-and-collaboration-guard:",
                "    steps:",
                "      - run: pnpm ci:repo-guard",
                "",
            )
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    unittest.main()
