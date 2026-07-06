from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_workflow_action_policy import (
    WorkflowActionPolicyIssue,
    audit_workflow_action_policy,
)


class CheckWorkflowActionPolicyTest(unittest.TestCase):
    def test_current_repo_workflow_actions_match_policy(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(audit_workflow_action_policy(root=repo_root), ())

    def test_audit_rejects_unpinned_untrusted_action(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            workflow_dir = root / ".github" / "workflows"
            workflow_dir.mkdir(parents=True)
            (workflow_dir / "example.yml").write_text(
                "\n".join(
                    (
                        "name: example",
                        "on: workflow_dispatch",
                        "jobs:",
                        "  check:",
                        "    runs-on: ubuntu-latest",
                        "    steps:",
                        "      - uses: third-party/example-action@v1",
                        "",
                    )
                ),
                encoding="utf-8",
            )

            issues = audit_workflow_action_policy(root=root)

        self.assertEqual(
            issues,
            (
                WorkflowActionPolicyIssue(
                    path=".github/workflows/example.yml",
                    action="third-party/example-action@v1",
                    message=(
                        "new or untrusted third-party actions must be pinned to a full commit SHA "
                        "or added to TRUSTED_TAG_ACTIONS with a documented reason"
                    ),
                ),
            ),
        )

    def test_audit_allows_trusted_version_tags_and_full_sha_refs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            workflow_dir = root / ".github" / "workflows"
            workflow_dir.mkdir(parents=True)
            (workflow_dir / "example.yml").write_text(
                "\n".join(
                    (
                        "name: example",
                        "on: workflow_dispatch",
                        "jobs:",
                        "  check:",
                        "    runs-on: ubuntu-latest",
                        "    steps:",
                        "      - uses: actions/checkout@v7",
                        "      - uses: actions/setup-node@v6",
                        "      - uses: third-party/example-action@0123456789abcdef0123456789abcdef01234567",
                        "",
                    )
                ),
                encoding="utf-8",
            )

            issues = audit_workflow_action_policy(root=root)

        self.assertEqual(issues, ())

    def test_audit_rejects_retired_node20_action_refs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            workflow_dir = root / ".github" / "workflows"
            workflow_dir.mkdir(parents=True)
            (workflow_dir / "example.yml").write_text(
                "\n".join(
                    (
                        "name: example",
                        "on: workflow_dispatch",
                        "jobs:",
                        "  check:",
                        "    runs-on: ubuntu-latest",
                        "    steps:",
                        "      - uses: actions/setup-node@v4",
                        "",
                    )
                ),
                encoding="utf-8",
            )

            issues = audit_workflow_action_policy(root=root)

        self.assertEqual(
            issues,
            (
                WorkflowActionPolicyIssue(
                    path=".github/workflows/example.yml",
                    action="actions/setup-node@v4",
                    message=(
                        "workflow action ref uses a retired Node 20 runtime; "
                        "upgrade to a Node 24 action"
                    ),
                ),
            ),
        )


if __name__ == "__main__":
    unittest.main()
