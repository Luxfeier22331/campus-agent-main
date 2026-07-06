from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

FORBIDDEN_TERMS = (
    "start-execution-control-staging.sh",
    "status-execution-control-staging.sh",
    "stop-execution-control-staging.sh",
    "execution-control-staging-env.sh",
    "execution-control-staging-common.sh",
    "preflight-execution-runtime-k8s-docker-bridge.sh",
    "preflight-execution-runtime-k8s-full.sh",
    "render-execution-runtime-k8s-ingress-tls.sh",
    "start-execution-control-runtime.sh",
    "smoke-execution-control-runtime.sh",
    "start-qdrant-local.sh",
    "check-qdrant-local.sh",
    "qdrant-native-snapshot.sh",
    "project-local-runtime-env.mjs",
    "ensure-runtime-secrets.mjs",
    "infra/local/.generated/runtime.env",
    "--restart-execution-control-runtime",
)

RETIRED_PATHS = (
    "infra/local/staging",
    "infra/local/scripts/project-local-runtime-env.mjs",
    "infra/local/scripts/project-local-runtime-env-keys.mjs",
    "infra/local/scripts/ensure-runtime-secrets.mjs",
    "infra/local/start-execution-control-runtime.sh",
    "infra/local/smoke-execution-control-runtime.sh",
    "infra/local/start-qdrant-local.sh",
    "infra/local/check-qdrant-local.sh",
    "infra/local/qdrant-native-snapshot.sh",
    "infra/local/minio/create_buckets.sh",
    "infra/k8s/execution-runtime/overlays/nc-arm-6c-staging",
    "infra/local/docker-compose.execution-control-runtime.k8s-host.yml",
    "infra/local/docker-compose.execution-control-runtime.staging.yml",
    "infra/local/docker-compose.execution-control-runtime.langfuse.staging.yml",
    "infra/local/docker-compose.postgres-k8s-host.yml",
    "infra/local/docker-compose.qdrant-k8s-host.yml",
    "configs/runtime/k8s-execution-runtime-env-boundary.v1.json",
    "scripts/sync_worker_observability_env.py",
    "scripts/sync_app_api_local_db_env.py",
)

ALLOWED_REFERENCE_PATHS = {
    "scripts/check_retired_runtime_helpers.py",
    "tests/test_check_retired_runtime_helpers.py",
    "tests/infra/test_execution_runtime_k8s_env_governance.py",
}


@dataclass(frozen=True, slots=True)
class RetiredRuntimeHelperIssue:
    path: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_retired_runtime_helpers(
    *,
    root: Path | None = None,
) -> tuple[RetiredRuntimeHelperIssue, ...]:
    base = root or repo_root()
    issues: list[RetiredRuntimeHelperIssue] = []

    for retired_path in RETIRED_PATHS:
        if (base / retired_path).exists():
            issues.append(
                RetiredRuntimeHelperIssue(
                    path=retired_path,
                    message="retired runtime helper path must not exist",
                )
            )

    for path in _candidate_paths(base):
        relative = path.relative_to(base).as_posix()
        if relative in ALLOWED_REFERENCE_PATHS or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for term in FORBIDDEN_TERMS:
            if term in text:
                issues.append(
                    RetiredRuntimeHelperIssue(
                        path=relative,
                        message=f"retired runtime helper reference is forbidden: {term}",
                    )
                )

    return tuple(issues)


def _candidate_paths(base: Path) -> tuple[Path, ...]:
    if (base / ".git").exists():
        return worktree_paths("README.md", "apps", "docs", "infra", "scripts", "tests", root=base)

    roots = [
        base / "README.md",
        *(base / item for item in ("apps", "docs", "infra", "scripts", "tests")),
    ]
    paths: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        if root.is_file():
            paths.append(root)
            continue
        paths.extend(path for path in root.rglob("*") if path.is_file())
    return tuple(paths)


def main() -> int:
    issues = audit_retired_runtime_helpers()
    for issue in issues:
        print(f"{issue.path}: {issue.message}", file=sys.stderr)
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
