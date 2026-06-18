from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

REQUIRED_CI_SCRIPTS = (
    "repo:guard",
    "repo:static",
    "ci:repo-guard",
    "ci:repo-static",
    "ci:intent",
    "ci:langfuse",
    "ci:go",
    "ci:web-graph:affected",
    "ci:web-graph:full",
    "ci:config:lint",
)

REQUIRED_WORKFLOW_SCRIPT_CALLS = {
    ".github/workflows/repo-guard.yml": ("pnpm ci:repo-guard",),
    ".github/workflows/lint.yml": (
        "pnpm ci:repo-static",
        "pnpm ci:intent",
        "pnpm ci:langfuse",
        "pnpm ci:go",
    ),
}
REQUIRED_GOLANGCI_LINT_INSTALL = (
    "go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.4"
)


@dataclass(frozen=True, slots=True)
class CiWorkflowContractIssue:
    path: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_ci_workflow_contracts(*, root: Path | None = None) -> tuple[CiWorkflowContractIssue, ...]:
    base = root or repo_root()
    issues: list[CiWorkflowContractIssue] = []
    root_package = _read_json(base / "package.json")
    root_package_manager = str(root_package.get("packageManager") or "")
    root_pnpm_version = _pnpm_version(root_package_manager)
    if not root_pnpm_version:
        issues.append(
            CiWorkflowContractIssue(
                path="package.json",
                message="root packageManager must use pnpm@<version>",
            )
        )
    scripts = root_package.get("scripts")
    if not isinstance(scripts, dict):
        scripts = {}
    for script_name in REQUIRED_CI_SCRIPTS:
        if script_name not in scripts:
            issues.append(
                CiWorkflowContractIssue(
                    path="package.json",
                    message=f"missing required CI lane script: {script_name}",
                )
            )

    if root_pnpm_version:
        issues.extend(_audit_package_manager_versions(base, root_pnpm_version))
        issues.extend(_audit_workflow_pnpm_versions(base, root_pnpm_version))
    issues.extend(_audit_workflow_script_calls(base))
    issues.extend(_audit_go_lane_tooling(base))
    return tuple(issues)


def _audit_package_manager_versions(
    root: Path,
    root_pnpm_version: str,
) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    for package_path in sorted(root.glob("apps/*/package.json")) + sorted(
        root.glob("packages/*/package.json")
    ):
        package = _read_json(package_path)
        package_manager = str(package.get("packageManager") or "")
        if not package_manager:
            continue
        pnpm_version = _pnpm_version(package_manager)
        if pnpm_version != root_pnpm_version:
            issues.append(
                CiWorkflowContractIssue(
                    path=package_path.relative_to(root).as_posix(),
                    message=(
                        f"packageManager pnpm version {pnpm_version or '<missing>'} "
                        f"does not match root {root_pnpm_version}"
                    ),
                )
            )
    return tuple(issues)


def _audit_workflow_pnpm_versions(
    root: Path,
    root_pnpm_version: str,
) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    for workflow_path in sorted((root / ".github/workflows").glob("*.yml")):
        workflow = _read_yaml(workflow_path)
        for step in _workflow_steps(workflow):
            if step.get("uses") != "pnpm/action-setup@v4":
                continue
            with_block = step.get("with")
            version = ""
            if isinstance(with_block, dict):
                version = str(with_block.get("version") or "").strip()
            if version != root_pnpm_version:
                issues.append(
                    CiWorkflowContractIssue(
                        path=workflow_path.relative_to(root).as_posix(),
                        message=(
                            f"pnpm/action-setup version {version or '<missing>'} "
                            f"does not match root {root_pnpm_version}"
                        ),
                    )
                )
    return tuple(issues)


def _audit_workflow_script_calls(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    for workflow_relpath, required_calls in REQUIRED_WORKFLOW_SCRIPT_CALLS.items():
        workflow_path = root / workflow_relpath
        if not workflow_path.exists():
            issues.append(
                CiWorkflowContractIssue(
                    path=workflow_relpath,
                    message="required workflow is missing",
                )
            )
            continue
        run_text = "\n".join(
            str(step.get("run") or "") for step in _workflow_steps(_read_yaml(workflow_path))
        )
        for required_call in required_calls:
            if required_call not in run_text:
                issues.append(
                    CiWorkflowContractIssue(
                        path=workflow_relpath,
                        message=f"workflow does not call required script: {required_call}",
                    )
                )
    return tuple(issues)


def _audit_go_lane_tooling(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_relpath = ".github/workflows/lint.yml"
    workflow_path = root / workflow_relpath
    if not workflow_path.exists():
        return ()
    workflow = _read_yaml(workflow_path)
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    job = jobs.get("execution-control-go")
    if not isinstance(job, dict):
        return ()
    raw_steps = job.get("steps")
    if not isinstance(raw_steps, list):
        return ()
    install_step_index = _first_step_index_containing(raw_steps, REQUIRED_GOLANGCI_LINT_INSTALL)
    ci_go_step_index = _first_step_index_containing(raw_steps, "pnpm ci:go")
    if ci_go_step_index is None:
        return ()
    if install_step_index is None or install_step_index >= ci_go_step_index:
        return (
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="execution-control-go must install golangci-lint v2.11.4 before pnpm ci:go",
            ),
        )
    return ()


def _first_step_index_containing(steps: list[Any], text: str) -> int | None:
    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            continue
        run = str(step.get("run") or "")
        if text in run:
            return index
    return None


def _workflow_steps(workflow: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    steps: list[dict[str, Any]] = []
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    for job in jobs.values():
        if not isinstance(job, dict):
            continue
        raw_steps = job.get("steps")
        if not isinstance(raw_steps, list):
            continue
        steps.extend(step for step in raw_steps if isinstance(step, dict))
    return tuple(steps)


def _pnpm_version(package_manager: str) -> str:
    prefix = "pnpm@"
    if not package_manager.startswith(prefix):
        return ""
    return package_manager.removeprefix(prefix).strip()


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _read_yaml(path: Path) -> dict[str, Any]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a YAML object")
    return payload


def main(*, root: Path | None = None) -> int:
    base = root or repo_root()
    issues = audit_ci_workflow_contracts(root=base)
    if issues:
        print("CI workflow contract check failed:", file=sys.stderr)
        for issue in issues:
            print(f"- {issue.path}: {issue.message}", file=sys.stderr)
        return 1
    print("Validated CI workflow contracts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
