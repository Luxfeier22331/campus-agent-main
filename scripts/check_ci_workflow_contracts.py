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
    "ci:langfuse",
    "ci:go",
    "ci:web-graph:full",
    "ci:config:lint",
)
REQUIRED_CI_SCRIPT_VALUES = {
    "ci:langfuse": (
        "pnpm --dir packages/eval-langfuse typecheck && "
        "pnpm --dir packages/eval-langfuse test && "
        "pnpm --dir apps/app-api exec tsx ./scripts/check-langfuse-trace-id-vectors.ts"
    ),
}

REQUIRED_WORKFLOW_SCRIPT_CALLS = {
    ".github/workflows/lint.yml": (
        "pnpm ci:repo-static",
        "pnpm ci:langfuse",
        "pnpm ci:go",
    ),
}
REQUIRED_GOLANGCI_LINT_INSTALL = (
    "go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.4"
)
REQUIRED_UV_SETUP = "astral-sh/setup-uv@v6"
REQUIRED_WORKFLOW_CONCURRENCY = (".github/workflows/lint.yml", ".github/workflows/repo-guard.yml")
MANUAL_ONLY_WORKFLOWS = (".github/workflows/eval-ragas-score.yml",)
MANUAL_ONLY_IF_PRESENT_WORKFLOWS = (".github/workflows/public-docs-rolling-publish.yml",)
INTERNAL_SECRET_WORKFLOW_ENVS = {
    ".github/workflows/eval-ragas-score.yml": "eval-internal",
}
PATH_FILTERED_JOBS = {
    ".github/workflows/lint.yml": {
        "execution-control-go": "go",
        "langfuse-integration": "langfuse",
    }
}


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
    for script_name, required_value in REQUIRED_CI_SCRIPT_VALUES.items():
        if script_name in scripts and str(scripts.get(script_name) or "").strip() != required_value:
            issues.append(
                CiWorkflowContractIssue(
                    path="package.json",
                    message=(
                        f"{script_name} must call its underlying checker directly; "
                        "do not route CI through removable root aliases"
                    ),
                )
            )

    if root_pnpm_version:
        issues.extend(_audit_package_manager_versions(base, root_pnpm_version))
        issues.extend(_audit_workflow_pnpm_versions(base, root_pnpm_version))
    issues.extend(_audit_workflow_script_calls(base))
    issues.extend(_audit_workflow_concurrency(base))
    issues.extend(_audit_manual_only_workflows(base))
    issues.extend(_audit_secret_workflow_exposure(base))
    issues.extend(_audit_public_docs_publish_workflow(base))
    issues.extend(_audit_path_filtered_jobs(base))
    issues.extend(_audit_repo_static_lane_tooling(base))
    issues.extend(_audit_langfuse_lane_tooling(base))
    issues.extend(_audit_eval_ragas_score_contract(base))
    issues.extend(_audit_go_lane_tooling(base))
    return tuple(issues)


def _audit_package_manager_versions(
    root: Path,
    root_pnpm_version: str,
) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    package_paths = (
        sorted(root.glob("apps/*/package.json"))
        + sorted(root.glob("jobs/*/package.json"))
        + sorted(root.glob("packages/*/package.json"))
    )
    for package_path in package_paths:
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


def _audit_workflow_concurrency(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    for workflow_relpath in REQUIRED_WORKFLOW_CONCURRENCY:
        workflow_path = root / workflow_relpath
        if not workflow_path.exists():
            continue
        workflow = _read_yaml(workflow_path)
        concurrency = workflow.get("concurrency")
        if not isinstance(concurrency, dict):
            issues.append(
                CiWorkflowContractIssue(
                    path=workflow_relpath,
                    message="workflow must configure concurrency to cancel superseded runs",
                )
            )
            continue
        if concurrency.get("cancel-in-progress") is not True:
            issues.append(
                CiWorkflowContractIssue(
                    path=workflow_relpath,
                    message="workflow concurrency must set cancel-in-progress: true",
                )
            )
    return tuple(issues)


def _audit_manual_only_workflows(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    for workflow_relpath in MANUAL_ONLY_WORKFLOWS:
        workflow_path = root / workflow_relpath
        if not workflow_path.exists():
            issues.append(
                CiWorkflowContractIssue(
                    path=workflow_relpath, message="required workflow is missing"
                )
            )
            continue
        issues.extend(_audit_manual_only_workflow(root, workflow_path))
    for workflow_relpath in MANUAL_ONLY_IF_PRESENT_WORKFLOWS:
        workflow_path = root / workflow_relpath
        if workflow_path.exists():
            issues.extend(_audit_manual_only_workflow(root, workflow_path))
    return tuple(issues)


def _audit_manual_only_workflow(
    root: Path, workflow_path: Path
) -> tuple[CiWorkflowContractIssue, ...]:
    workflow = _read_yaml(workflow_path)
    relpath = workflow_path.relative_to(root).as_posix()
    triggers = _workflow_triggers(workflow)
    issues: list[CiWorkflowContractIssue] = []
    if "workflow_dispatch" not in triggers:
        issues.append(
            CiWorkflowContractIssue(
                path=relpath,
                message="manual-only workflow must expose workflow_dispatch",
            )
        )
    automatic_triggers = sorted(trigger for trigger in triggers if trigger != "workflow_dispatch")
    if automatic_triggers:
        issues.append(
            CiWorkflowContractIssue(
                path=relpath,
                message=(
                    "manual-only workflow must not define automatic triggers: "
                    + ", ".join(automatic_triggers)
                ),
            )
        )
    return tuple(issues)


def _audit_secret_workflow_exposure(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    workflows_dir = root / ".github/workflows"
    if not workflows_dir.exists():
        return ()
    for workflow_path in sorted(workflows_dir.glob("*.yml")):
        relpath = workflow_path.relative_to(root).as_posix()
        workflow = _read_yaml(workflow_path)
        text = workflow_path.read_text(encoding="utf-8")
        if "secrets." not in text:
            continue
        triggers = _workflow_triggers(workflow)
        automatic_triggers = sorted(
            trigger for trigger in triggers if trigger != "workflow_dispatch"
        )
        if automatic_triggers:
            issues.append(
                CiWorkflowContractIssue(
                    path=relpath,
                    message=(
                        "workflow references secrets and must not define automatic triggers: "
                        + ", ".join(automatic_triggers)
                    ),
                )
            )
        required_environment = INTERNAL_SECRET_WORKFLOW_ENVS.get(relpath)
        if required_environment:
            issues.extend(
                _audit_workflow_jobs_environment(
                    workflow,
                    relpath=relpath,
                    required_environment=required_environment,
                )
            )
    return tuple(issues)


def _audit_workflow_jobs_environment(
    workflow: dict[str, Any],
    *,
    relpath: str,
    required_environment: str,
) -> tuple[CiWorkflowContractIssue, ...]:
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    issues: list[CiWorkflowContractIssue] = []
    for job_name, job in jobs.items():
        if not isinstance(job, dict):
            continue
        environment = job.get("environment")
        if environment == required_environment:
            continue
        issues.append(
            CiWorkflowContractIssue(
                path=relpath,
                message=(
                    f"{job_name} must use protected environment {required_environment!r} "
                    "because workflow references secrets"
                ),
            )
        )
    return tuple(issues)


def _audit_public_docs_publish_workflow(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_relpath = ".github/workflows/public-docs-rolling-publish.yml"
    workflow_path = root / workflow_relpath
    if not workflow_path.exists():
        return ()
    run_text = "\n".join(
        str(step.get("run") or "") for step in _workflow_steps(_read_yaml(workflow_path))
    )
    forbidden_tokens = (
        "deploy:staging",
        " apps/campus-web deploy",
        "pnpm --dir apps/campus-web deploy",
    )
    if any(token in run_text for token in forbidden_tokens):
        return (
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="public docs manual workflow must stay build-only and must not deploy",
            ),
        )
    return ()


def _audit_path_filtered_jobs(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    for workflow_relpath, jobs_to_outputs in PATH_FILTERED_JOBS.items():
        workflow_path = root / workflow_relpath
        if not workflow_path.exists():
            continue
        workflow = _read_yaml(workflow_path)
        jobs = workflow.get("jobs")
        if not isinstance(jobs, dict):
            continue
        changes_job = jobs.get("changes")
        if not isinstance(changes_job, dict):
            issues.append(
                CiWorkflowContractIssue(
                    path=workflow_relpath,
                    message="lint workflow must define a changes job for path-filtered heavy lanes",
                )
            )
            continue
        outputs = changes_job.get("outputs")
        if not isinstance(outputs, dict):
            outputs = {}
        for job_name, output_name in jobs_to_outputs.items():
            if output_name not in outputs:
                issues.append(
                    CiWorkflowContractIssue(
                        path=workflow_relpath,
                        message=f"changes job must expose {output_name} output for {job_name}",
                    )
                )
            job = jobs.get(job_name)
            if not isinstance(job, dict):
                issues.append(
                    CiWorkflowContractIssue(
                        path=workflow_relpath,
                        message=f"workflow is missing path-filtered job: {job_name}",
                    )
                )
                continue
            expected_if = f"needs.changes.outputs.{output_name} == 'true'"
            if job.get("needs") != "changes":
                issues.append(
                    CiWorkflowContractIssue(
                        path=workflow_relpath,
                        message=f"{job_name} must depend on the changes job",
                    )
                )
            if str(job.get("if") or "").strip() != expected_if:
                issues.append(
                    CiWorkflowContractIssue(
                        path=workflow_relpath,
                        message=f"{job_name} must be gated by {expected_if}",
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


def _audit_repo_static_lane_tooling(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_relpath = ".github/workflows/lint.yml"
    workflow_path = root / workflow_relpath
    if not workflow_path.exists():
        return ()
    workflow = _read_yaml(workflow_path)
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    job = jobs.get("repo-static")
    if not isinstance(job, dict):
        return ()
    raw_steps = job.get("steps")
    if not isinstance(raw_steps, list):
        return ()
    setup_uv_step_index = _first_step_index_using(raw_steps, REQUIRED_UV_SETUP)
    uv_sync_step_index = _first_step_index_containing(raw_steps, "uv sync --all-packages --dev")
    if uv_sync_step_index is None:
        return ()
    if setup_uv_step_index is None or setup_uv_step_index >= uv_sync_step_index:
        return (
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="repo-static must setup uv before uv sync",
            ),
        )
    return ()


def _audit_langfuse_lane_tooling(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_relpath = ".github/workflows/lint.yml"
    workflow_path = root / workflow_relpath
    if not workflow_path.exists():
        return ()
    workflow = _read_yaml(workflow_path)
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    job = jobs.get("langfuse-integration")
    if not isinstance(job, dict):
        return ()
    raw_steps = job.get("steps")
    if not isinstance(raw_steps, list):
        return ()
    install_step_index = _first_step_index_containing(raw_steps, "pnpm install --frozen-lockfile")
    ci_langfuse_step_index = _first_step_index_containing(raw_steps, "pnpm ci:langfuse")
    if ci_langfuse_step_index is None:
        return ()
    if install_step_index is None or install_step_index >= ci_langfuse_step_index:
        return (
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="langfuse-integration must run pnpm install before pnpm ci:langfuse",
            ),
        )
    return ()


def _audit_eval_ragas_score_contract(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_relpath = ".github/workflows/eval-ragas-score.yml"
    workflow_path = root / workflow_relpath
    if not workflow_path.exists():
        return (
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="required workflow is missing",
            ),
        )
    workflow_text = workflow_path.read_text(encoding="utf-8")
    required = (
        "actions/setup-python@v5",
        REQUIRED_UV_SETUP,
        "uv sync --all-packages --dev",
        "pnpm --dir packages/eval-langfuse langfuse ragas-score-traces",
        "pnpm --dir packages/eval-langfuse langfuse ragas-score-dataset",
    )
    issues: list[CiWorkflowContractIssue] = []
    for snippet in required:
        if snippet not in workflow_text:
            issues.append(
                CiWorkflowContractIssue(
                    path=workflow_relpath,
                    message=f"eval-ragas-score workflow must call: {snippet}",
                )
            )
    if "--allow-failures" in workflow_text:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="eval-ragas-score workflow must not accept --allow-failures",
            )
        )
    return tuple(issues)


def _first_step_index_using(steps: list[Any], uses: str) -> int | None:
    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            continue
        if step.get("uses") == uses:
            return index
    return None


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


def _workflow_triggers(workflow: dict[str, Any]) -> set[str]:
    raw_triggers = workflow.get(True)
    if raw_triggers is None:
        raw_triggers = workflow.get("on")
    if isinstance(raw_triggers, str):
        return {raw_triggers}
    if isinstance(raw_triggers, list):
        return {str(trigger) for trigger in raw_triggers}
    if isinstance(raw_triggers, dict):
        return {str(trigger) for trigger in raw_triggers}
    return set()


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
