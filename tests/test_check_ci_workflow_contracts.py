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
            _write_minimal_workflows(root, pnpm_version="10.26.1", lint_run="pnpm lint")

            issues = audit_ci_workflow_contracts(root=root)

        self.assertIn(
            CiWorkflowContractIssue(
                path="package.json",
                message="missing required CI lane script: ci:repo-static",
            ),
            issues,
        )
        self.assertIn(
            CiWorkflowContractIssue(
                path=".github/workflows/lint.yml",
                message="workflow does not call required script: pnpm ci:repo-static",
            ),
            issues,
        )


def _required_scripts() -> dict[str, str]:
    return {
        "repo:guard": "uv run --all-packages python -m unittest tests.test_docs_structure tests.test_workspace_layout tests.test_repo_collaboration -q",
        "repo:static": "pnpm web:lint",
        "ci:repo-guard": "pnpm repo:guard",
        "ci:repo-static": "pnpm repo:static",
        "ci:intent": "pnpm eval:intent",
        "ci:go": "pnpm go:check",
        "ci:web-graph:affected": "pnpm web:check:affected",
        "ci:web-graph:full": "pnpm web:check",
        "ci:config:lint": "uv run --all-packages python -m scripts.check_ci_workflow_contracts",
    }


def _write_minimal_workflows(
    root: Path,
    *,
    pnpm_version: str,
    lint_run: str = "pnpm ci:repo-static && pnpm ci:intent && pnpm ci:go",
) -> None:
    (root / ".github/workflows/lint.yml").write_text(
        "\n".join(
            (
                "name: lint",
                "jobs:",
                "  repo-static:",
                "    steps:",
                "      - uses: pnpm/action-setup@v4",
                "        with:",
                f"          version: {pnpm_version}",
                f"      - run: {lint_run}",
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
