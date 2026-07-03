from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml

from scripts.ci_workflow_contract_types import CiWorkflowContractIssue
from scripts.ci_workflow_manual_contracts import audit_manual_release_workflow_contracts

REQUIRED_CI_SCRIPTS = (
    "repo:guard",
    "repo:static",
    "ci:repo-guard",
    "ci:repo-static",
    "ci:repo-static:affected",
    "ci:contracts",
    "ci:ingestion",
    "ci:langfuse",
    "ci:go",
    "ci:web-graph:affected",
    "ci:web-graph:full",
    "ci:worker-runtime",
    "ci:config:lint",
    "ci:actions:lint",
    "ci:secrets",
    "ci:deps:vuln",
)
REQUIRED_CI_SCRIPT_VALUES = {
    "ci:repo-static:affected": (
        'uv run --all-packages python -m scripts.check_repo_static --affected --base "${CI_BASE_REF:-origin/develop}"'
    ),
    "ci:langfuse": (
        "pnpm --dir packages/eval-langfuse typecheck && "
        "pnpm --dir packages/eval-langfuse test && "
        "pnpm --dir apps/app-api exec tsx ./scripts/check-langfuse-trace-id-vectors.ts"
    ),
    "ci:config:lint": (
        "pnpm ci:actions:lint && "
        "uv run --all-packages python -m scripts.check_ci_workflow_contracts && "
        "uv run --all-packages python -m scripts.check_workflow_action_policy"
    ),
    "ci:actions:lint": "go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7",
    "ci:secrets": "uv run --all-packages python -m scripts.run_gitleaks_scan",
    "ci:deps:vuln": "uv run --all-packages python -m scripts.run_osv_scan",
}

REQUIRED_WORKFLOW_SCRIPT_CALLS = {
    ".github/workflows/pr-checks.yml": (
        "pnpm ci:repo-guard",
        "pnpm ci:repo-static",
        "pnpm ci:repo-static:affected",
        "pnpm ci:config:lint",
        "pnpm ci:secrets",
        "pnpm ci:web-graph:affected",
        "pnpm ci:worker-runtime",
        "pnpm ci:contracts",
        "pnpm ci:langfuse",
        "pnpm ci:go",
        "pnpm ci:ingestion",
    ),
}
REQUIRED_PR_CHECK_JOBS = (
    "changes",
    "repo-guard",
    "repo-static",
    "config-lint",
    "secret-scan",
    "web-graph",
    "worker-runtime",
    "contracts",
    "execution-control-go",
    "langfuse-integration",
    "ingestion",
    "required-checks",
)
REQUIRED_GOLANGCI_LINT_INSTALL = (
    "go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.4"
)
REQUIRED_GITLEAKS_INSTALL = "go install github.com/zricethezav/gitleaks/v8@v8.30.1"
REQUIRED_OSV_SCANNER_INSTALL = "go install github.com/google/osv-scanner/v2/cmd/osv-scanner@v2.3.8"
REQUIRED_GO_BIN_PATH_EXPORT = 'echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"'
REQUIRED_UV_SETUP = "astral-sh/setup-uv@v6"
PR_CHECKS_WORKFLOW = ".github/workflows/pr-checks.yml"
RETIRED_AUTOMATIC_WORKFLOWS = (".github/workflows/lint.yml", ".github/workflows/repo-guard.yml")
REQUIRED_WORKFLOW_CONCURRENCY = (PR_CHECKS_WORKFLOW,)
PATH_FILTERED_JOBS = {
    PR_CHECKS_WORKFLOW: {
        "contracts": "contracts",
        "execution-control-go": "go",
        "ingestion": "ingestion",
        "langfuse-integration": "langfuse",
        "web-graph": "web_graph",
        "worker-runtime": "worker_runtime",
    }
}


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
                        f"{script_name} must match the required CI command shape; "
                        "do not route CI through removable or base-ambiguous aliases"
                    ),
                )
            )

    if root_pnpm_version:
        issues.extend(_audit_package_manager_versions(base, root_pnpm_version))
        issues.extend(_audit_workflow_pnpm_versions(base, root_pnpm_version))
    issues.extend(_audit_workflow_script_calls(base))
    issues.extend(_audit_retired_automatic_workflows_absent(base))
    issues.extend(_audit_pr_checks_required_jobs(base))
    issues.extend(_audit_workflow_concurrency(base))
    issues.extend(audit_manual_release_workflow_contracts(root=base))
    issues.extend(_audit_path_filtered_jobs(base))
    issues.extend(_audit_pr_checks_aggregate_job(base))
    issues.extend(_audit_pr_checks_base_sha_flow(base))
    issues.extend(_audit_workflow_setup_cache(base))
    issues.extend(_audit_secret_scan_lane_tooling(base))
    issues.extend(_audit_dependency_vulnerability_lane_tooling(base))
    issues.extend(_audit_repo_static_lane_tooling(base))
    issues.extend(_audit_langfuse_lane_tooling(base))
    issues.extend(_audit_go_lane_tooling(base))
    return tuple(issues)


def _audit_retired_automatic_workflows_absent(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    for workflow_relpath in RETIRED_AUTOMATIC_WORKFLOWS:
        if (root / workflow_relpath).exists():
            issues.append(
                CiWorkflowContractIssue(
                    path=workflow_relpath,
                    message="retired automatic workflow must not exist; use pr-checks.yml",
                )
            )
    return tuple(issues)


def _audit_pr_checks_required_jobs(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_path = root / PR_CHECKS_WORKFLOW
    if not workflow_path.exists():
        return ()
    workflow = _read_yaml(workflow_path)
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    missing = sorted(job_name for job_name in REQUIRED_PR_CHECK_JOBS if job_name not in jobs)
    if not missing:
        return ()
    return (
        CiWorkflowContractIssue(
            path=PR_CHECKS_WORKFLOW,
            message="pr-checks workflow is missing required jobs: " + ", ".join(missing),
        ),
    )


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
            if not _run_text_contains_command(run_text, required_call):
                issues.append(
                    CiWorkflowContractIssue(
                        path=workflow_relpath,
                        message=f"workflow does not call required script: {required_call}",
                    )
                )
    return tuple(issues)


def _run_text_contains_command(run_text: str, command: str) -> bool:
    boundary = r"[A-Za-z0-9_:-]"
    return re.search(rf"(?<!{boundary}){re.escape(command)}(?!{boundary})", run_text) is not None


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
                    message="pr-checks workflow must define a changes job for path-filtered heavy lanes",
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


def _audit_pr_checks_aggregate_job(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_path = root / PR_CHECKS_WORKFLOW
    if not workflow_path.exists():
        return ()
    workflow = _read_yaml(workflow_path)
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    aggregate = jobs.get("required-checks")
    if not isinstance(aggregate, dict):
        return (
            CiWorkflowContractIssue(
                path=PR_CHECKS_WORKFLOW,
                message="pr-checks workflow must define required-checks aggregate job",
            ),
        )
    needs = aggregate.get("needs")
    if not isinstance(needs, list):
        needs = []
    required = sorted(job_name for job_name in jobs if job_name != "required-checks")
    missing = sorted(job_name for job_name in required if job_name not in needs)
    issues: list[CiWorkflowContractIssue] = []
    if missing:
        issues.append(
            CiWorkflowContractIssue(
                path=PR_CHECKS_WORKFLOW,
                message="required-checks must depend on every PR check job: " + ", ".join(missing),
            )
        )
    if str(aggregate.get("if") or "").strip() != "always()":
        issues.append(
            CiWorkflowContractIssue(
                path=PR_CHECKS_WORKFLOW,
                message="required-checks must use if: always() so skipped conditional jobs are summarized",
            )
        )
    run_text = "\n".join(str(step.get("run") or "") for step in _job_steps(aggregate))
    if "success|skipped" not in run_text:
        issues.append(
            CiWorkflowContractIssue(
                path=PR_CHECKS_WORKFLOW,
                message="required-checks must accept only successful or skipped dependent jobs",
            )
        )
    return tuple(issues)


def _audit_pr_checks_base_sha_flow(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_path = root / PR_CHECKS_WORKFLOW
    if not workflow_path.exists():
        return ()
    workflow = _read_yaml(workflow_path)
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    issues: list[CiWorkflowContractIssue] = []
    changes = jobs.get("changes")
    changes_outputs = changes.get("outputs") if isinstance(changes, dict) else None
    if not isinstance(changes_outputs, dict) or "base_sha" not in changes_outputs:
        issues.append(
            CiWorkflowContractIssue(
                path=PR_CHECKS_WORKFLOW,
                message="changes job must expose base_sha for affected lanes",
            )
        )
    repo_static = jobs.get("repo-static")
    repo_static_env = repo_static.get("env") if isinstance(repo_static, dict) else None
    if not isinstance(repo_static_env, dict) or repo_static_env.get("CI_BASE_REF") != (
        "${{ needs.changes.outputs.base_sha }}"
    ):
        issues.append(
            CiWorkflowContractIssue(
                path=PR_CHECKS_WORKFLOW,
                message="repo-static must pass changes base_sha through CI_BASE_REF",
            )
        )
    web_graph = jobs.get("web-graph")
    web_graph_env = web_graph.get("env") if isinstance(web_graph, dict) else None
    if not isinstance(web_graph_env, dict) or web_graph_env.get("TURBO_SCM_BASE") != (
        "${{ needs.changes.outputs.base_sha }}"
    ):
        issues.append(
            CiWorkflowContractIssue(
                path=PR_CHECKS_WORKFLOW,
                message="web-graph must pass changes base_sha through TURBO_SCM_BASE",
            )
        )
    return tuple(issues)


def _audit_go_lane_tooling(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_relpath = PR_CHECKS_WORKFLOW
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


def _audit_workflow_setup_cache(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    for workflow_path in sorted((root / ".github/workflows").glob("*.yml")):
        workflow = _read_yaml(workflow_path)
        relpath = workflow_path.relative_to(root).as_posix()

        def add_issue(message: str, path: str = relpath) -> None:
            issues.append(CiWorkflowContractIssue(path=path, message=message))

        for steps in _workflow_job_steps(workflow):
            installs_pnpm = any(
                "pnpm install --frozen-lockfile" in str(s.get("run") or "") for s in steps
            )
            pnpm_setup_seen = False
            for step in steps:
                uses = step.get("uses")
                with_block = step.get("with")
                if uses == "pnpm/action-setup@v4":
                    pnpm_setup_seen = True
                if uses == "actions/setup-node@v4":
                    cache_enabled = (
                        isinstance(with_block, dict) and with_block.get("cache") == "pnpm"
                    )
                    if installs_pnpm and not cache_enabled:
                        add_issue(
                            "actions/setup-node steps must enable pnpm cache "
                            "when the job installs the pnpm workspace"
                        )
                    elif not installs_pnpm and cache_enabled:
                        add_issue(
                            "actions/setup-node must not enable pnpm cache "
                            "when the job does not run pnpm install"
                        )
                    elif cache_enabled and with_block.get("cache-dependency-path") != (
                        "pnpm-lock.yaml"
                    ):
                        add_issue("actions/setup-node pnpm cache must use root pnpm-lock.yaml")
                    elif cache_enabled and not pnpm_setup_seen:
                        add_issue(
                            "pnpm/action-setup must run before actions/setup-node "
                            "when setup-node enables pnpm cache"
                        )
        for step in _workflow_steps(workflow):
            uses = step.get("uses")
            with_block = step.get("with")
            if uses == REQUIRED_UV_SETUP and (
                not isinstance(with_block, dict) or with_block.get("enable-cache") is not True
            ):
                add_issue("astral-sh/setup-uv steps must enable uv cache")
    return tuple(dict.fromkeys(issues))


def _audit_secret_scan_lane_tooling(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_relpath = PR_CHECKS_WORKFLOW
    workflow_path = root / workflow_relpath
    if not workflow_path.exists():
        return ()
    workflow = _read_yaml(workflow_path)
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    job = jobs.get("secret-scan")
    if not isinstance(job, dict):
        return ()
    raw_steps = job.get("steps")
    if not isinstance(raw_steps, list):
        return ()
    install_step_index = _first_step_index_containing(raw_steps, REQUIRED_GITLEAKS_INSTALL)
    path_export_step_index = _first_step_index_containing(raw_steps, REQUIRED_GO_BIN_PATH_EXPORT)
    setup_uv_step_index = _first_step_index_using(raw_steps, REQUIRED_UV_SETUP)
    scan_step_index = _first_step_index_containing(raw_steps, "pnpm ci:secrets")
    if scan_step_index is None:
        return ()
    issues: list[CiWorkflowContractIssue] = []
    if setup_uv_step_index is None or setup_uv_step_index >= scan_step_index:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="secret-scan must setup uv before pnpm ci:secrets",
            )
        )
    if install_step_index is None or install_step_index >= scan_step_index:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="secret-scan must install gitleaks v8.30.1 before pnpm ci:secrets",
            )
        )
    if path_export_step_index is None or path_export_step_index >= scan_step_index:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="secret-scan must add Go bin to PATH before pnpm ci:secrets",
            )
        )
    return tuple(issues)


def _audit_dependency_vulnerability_lane_tooling(
    root: Path,
) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_relpath = ".github/workflows/scheduled-checks.yml"
    workflow_path = root / workflow_relpath
    if not workflow_path.exists():
        return ()
    workflow = _read_yaml(workflow_path)
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    job = jobs.get("dependency-vulnerability-full")
    if not isinstance(job, dict):
        return ()
    raw_steps = job.get("steps")
    if not isinstance(raw_steps, list):
        return ()
    install_step_index = _first_step_index_containing(raw_steps, REQUIRED_OSV_SCANNER_INSTALL)
    setup_uv_step_index = _first_step_index_using(raw_steps, REQUIRED_UV_SETUP)
    path_export_step_index = _first_step_index_containing(raw_steps, REQUIRED_GO_BIN_PATH_EXPORT)
    scan_step_index = _first_step_index_containing(raw_steps, "pnpm ci:deps:vuln")
    if scan_step_index is None:
        return ()
    issues: list[CiWorkflowContractIssue] = []
    if setup_uv_step_index is None or setup_uv_step_index >= scan_step_index:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="dependency-vulnerability-full must setup uv before pnpm ci:deps:vuln",
            )
        )
    if install_step_index is None or install_step_index >= scan_step_index:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message=(
                    "dependency-vulnerability-full must install osv-scanner v2.3.8 "
                    "before pnpm ci:deps:vuln"
                ),
            )
        )
    if path_export_step_index is None or path_export_step_index >= scan_step_index:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message=(
                    "dependency-vulnerability-full must add Go bin to PATH before pnpm ci:deps:vuln"
                ),
            )
        )
    return tuple(issues)


def _audit_repo_static_lane_tooling(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_relpath = PR_CHECKS_WORKFLOW
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
    workflow_relpath = PR_CHECKS_WORKFLOW
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
    return tuple(step for steps in _workflow_job_steps(workflow) for step in steps)


def _workflow_job_steps(workflow: dict[str, Any]) -> tuple[tuple[dict[str, Any], ...], ...]:
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        return ()
    return tuple(
        tuple(step for step in job["steps"] if isinstance(step, dict))
        for job in jobs.values()
        if isinstance(job, dict) and isinstance(job.get("steps"), list)
    )


def _job_steps(job: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    raw_steps = job.get("steps")
    if not isinstance(raw_steps, list):
        return ()
    return tuple(step for step in raw_steps if isinstance(step, dict))


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
