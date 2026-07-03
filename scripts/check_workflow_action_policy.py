from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

TRUSTED_TAG_ACTIONS = frozenset(
    {
        "actions/checkout",
        "actions/setup-go",
        "actions/setup-node",
        "actions/setup-python",
        "actions/upload-artifact",
        "aquasecurity/trivy-action",
        "astral-sh/setup-uv",
        "docker/build-push-action",
        "docker/login-action",
        "docker/setup-buildx-action",
        "ossf/scorecard-action",
        "pnpm/action-setup",
        "anchore/sbom-action",
    }
)
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
VERSION_TAG_RE = re.compile(r"^v\d+(?:\.\d+){0,2}$")


@dataclass(frozen=True, slots=True)
class WorkflowActionPolicyIssue:
    path: str
    action: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_workflow_action_policy(
    *, root: Path | None = None
) -> tuple[WorkflowActionPolicyIssue, ...]:
    base = root or repo_root()
    workflow_dir = base / ".github" / "workflows"
    issues: list[WorkflowActionPolicyIssue] = []
    for workflow_path in sorted(workflow_dir.glob("*.yml")):
        workflow = _read_yaml(workflow_path)
        relpath = workflow_path.relative_to(base).as_posix()
        for action_ref in _workflow_uses(workflow):
            issue = _audit_action_ref(relpath, action_ref)
            if issue is not None:
                issues.append(issue)
    return tuple(issues)


def _audit_action_ref(path: str, action_ref: str) -> WorkflowActionPolicyIssue | None:
    if action_ref.startswith("./"):
        return None
    if "@" not in action_ref:
        return WorkflowActionPolicyIssue(
            path=path,
            action=action_ref,
            message="workflow action must include an explicit ref",
        )
    action, ref = action_ref.rsplit("@", 1)
    normalized_action = action.lower()
    if SHA_RE.fullmatch(ref):
        return None
    if normalized_action in TRUSTED_TAG_ACTIONS and VERSION_TAG_RE.fullmatch(ref):
        return None
    return WorkflowActionPolicyIssue(
        path=path,
        action=action_ref,
        message=(
            "new or untrusted third-party actions must be pinned to a full commit SHA "
            "or added to TRUSTED_TAG_ACTIONS with a documented reason"
        ),
    )


def _workflow_uses(value: Any) -> tuple[str, ...]:
    actions: list[str] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == "uses" and isinstance(nested, str):
                actions.append(nested)
            else:
                actions.extend(_workflow_uses(nested))
    elif isinstance(value, list):
        for nested in value:
            actions.extend(_workflow_uses(nested))
    return tuple(actions)


def _read_yaml(path: Path) -> dict[str, Any]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a YAML object")
    return payload


def main() -> int:
    issues = audit_workflow_action_policy()
    if issues:
        print("Workflow action policy check failed:", file=sys.stderr)
        for issue in issues:
            print(f"- {issue.path}: {issue.action}: {issue.message}", file=sys.stderr)
        return 1
    print("Validated workflow action policy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
