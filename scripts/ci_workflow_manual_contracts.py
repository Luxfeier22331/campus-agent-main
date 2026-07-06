from __future__ import annotations

from pathlib import Path
from typing import Any

from scripts.ci_workflow_contract_types import CiWorkflowContractIssue

REQUIRED_UV_SETUP = "astral-sh/setup-uv@v8.3.0"
MANUAL_ONLY_WORKFLOWS = (
    ".github/workflows/dining-sync-image.yml",
    ".github/workflows/eval-ragas-score.yml",
)
MANUAL_ONLY_IF_PRESENT_WORKFLOWS = (".github/workflows/public-docs-rolling-publish.yml",)
INTERNAL_SECRET_WORKFLOW_ENVS = {
    ".github/workflows/eval-ragas-score.yml": "eval-internal",
}
AUTOMATIC_WORKFLOW_SECRET_ALLOWLIST = {
    (
        ".github/workflows/pr-checks.yml",
        ("jobs", "web-graph", "env", "TURBO_TOKEN"),
        "${{ secrets.TURBO_TOKEN }}",
    ),
    (
        ".github/workflows/scheduled-checks.yml",
        ("jobs", "web-graph-full", "env", "TURBO_TOKEN"),
        "${{ secrets.TURBO_TOKEN }}",
    ),
}


def audit_manual_release_workflow_contracts(*, root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    issues: list[CiWorkflowContractIssue] = []
    issues.extend(_audit_manual_only_workflows(root))
    issues.extend(_audit_secret_workflow_exposure(root))
    issues.extend(_audit_turbo_remote_cache_env(root))
    issues.extend(_audit_public_docs_publish_workflow(root))
    issues.extend(_audit_eval_ragas_score_contract(root))
    issues.extend(_audit_dining_sync_image_contract(root))
    return tuple(issues)


def _audit_turbo_remote_cache_env(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    targets = (
        (
            ".github/workflows/pr-checks.yml",
            ("jobs", "web-graph", "env"),
            "web-graph must expose TURBO_TOKEN and TURBO_TEAM for Turbo Remote Cache",
        ),
        (
            ".github/workflows/scheduled-checks.yml",
            ("jobs", "web-graph-full", "env"),
            "web-graph-full must expose TURBO_TOKEN and TURBO_TEAM for Turbo Remote Cache",
        ),
    )
    issues: list[CiWorkflowContractIssue] = []
    for workflow_relpath, env_path, message in targets:
        workflow_path = root / workflow_relpath
        if not workflow_path.exists():
            continue
        workflow = _read_yaml(workflow_path)
        env = _nested_dict(workflow, env_path)
        if (
            not isinstance(env, dict)
            or env.get("TURBO_TOKEN") != ("${{ secrets.TURBO_TOKEN }}")
            or env.get("TURBO_TEAM") != "${{ vars.TURBO_TEAM }}"
        ):
            issues.append(CiWorkflowContractIssue(path=workflow_relpath, message=message))
    return tuple(issues)


def _nested_dict(value: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any] | None:
    current: Any = value
    for part in path:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current if isinstance(current, dict) else None


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
        secret_refs = _secret_refs(workflow)
        if not secret_refs:
            continue
        triggers = _workflow_triggers(workflow)
        automatic_triggers = sorted(
            trigger for trigger in triggers if trigger != "workflow_dispatch"
        )
        disallowed_secret_refs = tuple(
            ref
            for ref in secret_refs
            if (
                relpath,
                ref[0],
                ref[1],
            )
            not in AUTOMATIC_WORKFLOW_SECRET_ALLOWLIST
        )
        if automatic_triggers and disallowed_secret_refs:
            issues.append(
                CiWorkflowContractIssue(
                    path=relpath,
                    message=(
                        "workflow references non-CI-cache secrets and must not define automatic triggers: "
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


def _secret_refs(value: Any, path: tuple[str, ...] = ()) -> tuple[tuple[tuple[str, ...], str], ...]:
    refs: list[tuple[tuple[str, ...], str]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            refs.extend(_secret_refs(child, (*path, str(key))))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            refs.extend(_secret_refs(child, (*path, str(index))))
    elif isinstance(value, str) and "secrets." in value:
        refs.append((path, value.strip()))
    return tuple(refs)


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
    workflow = _read_yaml(workflow_path)
    inputs = _workflow_dispatch_inputs(workflow)
    dry_run = inputs.get("dry_run")
    issues: list[CiWorkflowContractIssue] = []
    if not isinstance(dry_run, dict) or dry_run.get("default") is not True:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="public docs manual workflow dry_run input must default to true",
            )
        )
    run_text = "\n".join(str(step.get("run") or "") for step in _workflow_steps(workflow))
    if 'inputs.dry_run }}" != "true"' not in run_text:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="public docs manual workflow must fail closed when dry_run is not true",
            )
        )
    forbidden_tokens = (
        "deploy:staging",
        " apps/campus-web deploy",
        "pnpm --dir apps/campus-web deploy",
    )
    if any(token in run_text for token in forbidden_tokens):
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="public docs manual workflow must stay build-only and must not deploy",
            ),
        )
    return tuple(issues)


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
    workflow = _read_yaml(workflow_path)
    workflow_text = workflow_path.read_text(encoding="utf-8")
    required = (
        "actions/setup-python@v6",
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
    inputs = _workflow_dispatch_inputs(workflow)
    publish = inputs.get("publish_langfuse_scores")
    if not isinstance(publish, dict) or publish.get("default") is not False:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="publish_langfuse_scores must default to false",
            )
        )
    if "--validate-only" not in workflow_text:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="eval-ragas-score workflow must validate-only unless score publishing is enabled",
            )
        )
    return tuple(issues)


def _audit_dining_sync_image_contract(root: Path) -> tuple[CiWorkflowContractIssue, ...]:
    workflow_relpath = ".github/workflows/dining-sync-image.yml"
    workflow_path = root / workflow_relpath
    if not workflow_path.exists():
        return (
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="required workflow is missing",
            ),
        )
    workflow = _read_yaml(workflow_path)
    workflow_text = workflow_path.read_text(encoding="utf-8")
    inputs = _workflow_dispatch_inputs(workflow)
    push_image = inputs.get("push_image")
    issues: list[CiWorkflowContractIssue] = []
    if not isinstance(push_image, dict) or push_image.get("default") is not False:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="dining-sync image workflow push_image input must default to false",
            )
        )
    if "packages: write" not in workflow_text:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="dining-sync image workflow must declare packages: write for explicit GHCR push",
            )
        )
    steps = _workflow_steps(workflow)
    login_step = _first_step_using(steps, "docker/login-action@v4")
    build_steps = _steps_using(steps, "docker/build-push-action@v7")
    trivy_step = _first_step_using(steps, "aquasecurity/trivy-action@v0.36.0")
    sbom_step = _first_step_using(steps, "anchore/sbom-action@v0.24.0")
    login_if = str(login_step.get("if") or "") if login_step else ""
    scan_build_with = build_steps[0].get("with") if build_steps else None
    push_build = _first_guarded_step_using(
        steps, "docker/build-push-action@v7", "inputs.push_image"
    )
    push_build_with = push_build.get("with") if push_build else None
    if "inputs.push_image" not in login_if or push_build is None:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="dining-sync image workflow must gate GHCR login and image push behind inputs.push_image",
            )
        )
    if not isinstance(scan_build_with, dict) or scan_build_with.get("load") is not True:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="dining-sync image workflow must build a local image for vulnerability scanning",
            )
        )
    if not isinstance(push_build_with, dict) or push_build_with.get("push") is not True:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="dining-sync image workflow guarded push step must set push: true",
            )
        )
    if trivy_step is None or 'exit-code: "1"' not in workflow_text:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="dining-sync image workflow must scan the image with blocking Trivy HIGH/CRITICAL checks",
            )
        )
    if sbom_step is None or "dependency-snapshot: false" not in workflow_text:
        issues.append(
            CiWorkflowContractIssue(
                path=workflow_relpath,
                message="dining-sync image workflow must generate an SBOM artifact without Dependency Graph submission",
            )
        )
    return tuple(issues)


def _first_step_using(steps: tuple[dict[str, Any], ...], uses: str) -> dict[str, Any] | None:
    for step in steps:
        if step.get("uses") == uses:
            return step
    return None


def _steps_using(steps: tuple[dict[str, Any], ...], uses: str) -> tuple[dict[str, Any], ...]:
    return tuple(step for step in steps if step.get("uses") == uses)


def _first_guarded_step_using(
    steps: tuple[dict[str, Any], ...], uses: str, guard: str
) -> dict[str, Any] | None:
    for step in steps:
        if step.get("uses") != uses:
            continue
        if guard in str(step.get("if") or ""):
            return step
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


def _workflow_dispatch_inputs(workflow: dict[str, Any]) -> dict[str, Any]:
    raw_triggers = workflow.get(True)
    if raw_triggers is None:
        raw_triggers = workflow.get("on")
    if not isinstance(raw_triggers, dict):
        return {}
    workflow_dispatch = raw_triggers.get("workflow_dispatch")
    if not isinstance(workflow_dispatch, dict):
        return {}
    inputs = workflow_dispatch.get("inputs")
    if not isinstance(inputs, dict):
        return {}
    return inputs


def _read_yaml(path: Path) -> dict[str, Any]:
    import yaml

    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a YAML object")
    return payload
