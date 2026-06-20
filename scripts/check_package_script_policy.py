from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ROOT_SCRIPT_ALLOWLIST = frozenset(
    {
        "repo:guard",
        "repo:static",
        "ci:repo-guard",
        "ci:repo-static",
        "ci:intent",
        "ci:langfuse",
        "ci:go",
        "ci:web-graph:full",
        "ci:config:lint",
        "web:build",
        "web:check",
        "web:lint",
        "web:test",
        "web:test:worker",
        "web:test:integration",
        "web:typecheck",
        "contracts:generate",
        "contracts:check",
        "go:check",
    }
)

APP_API_OPS_PREFIXES = (
    "collection-rename:",
    "db:",
    "dining:",
    "docs:",
    "federation:",
    "local:",
    "official-web:",
    "projection:",
    "provider-config:",
    "smoke-identity:",
)
DEPLOY_INTERNAL_PREFIXES = (
    "deploy:check-secrets:",
    "deploy:preflight:",
    "deploy:verify-config",
)


@dataclass(frozen=True, slots=True)
class PackageScriptPolicyIssue:
    path: str
    script: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_package_script_policy(
    *, root: Path | None = None
) -> tuple[PackageScriptPolicyIssue, ...]:
    base = root or repo_root()
    issues: list[PackageScriptPolicyIssue] = []
    issues.extend(_audit_root_scripts(base))
    for package_path in _package_paths(base):
        issues.extend(_audit_package_scripts(base, package_path))
    return tuple(issues)


def _audit_root_scripts(root: Path) -> tuple[PackageScriptPolicyIssue, ...]:
    package_path = root / "package.json"
    scripts = _read_scripts(package_path)
    issues: list[PackageScriptPolicyIssue] = []
    for script in sorted(scripts):
        if script not in ROOT_SCRIPT_ALLOWLIST:
            issues.append(
                PackageScriptPolicyIssue(
                    path="package.json",
                    script=script,
                    message=(
                        "root package.json may only expose repo, ci, web, contracts, "
                        "and go public lanes"
                    ),
                )
            )
    return tuple(issues)


def _audit_package_scripts(root: Path, package_path: Path) -> tuple[PackageScriptPolicyIssue, ...]:
    scripts = _read_scripts(package_path)
    relpath = package_path.relative_to(root).as_posix()
    issues: list[PackageScriptPolicyIssue] = []
    for script in sorted(scripts):
        if script.startswith(DEPLOY_INTERNAL_PREFIXES):
            issues.append(
                PackageScriptPolicyIssue(
                    path=relpath,
                    script=script,
                    message=(
                        "deploy internals must be owned by deploy scripts instead of "
                        "package.json aliases"
                    ),
                )
            )
        if ":smoke:" in script or script.endswith(":smoke"):
            issues.append(
                PackageScriptPolicyIssue(
                    path=relpath,
                    script=script,
                    message=(
                        "staging smoke helpers must be invoked directly from runbooks or CI, "
                        "not exposed as package scripts"
                    ),
                )
            )
        if script.endswith(":audit") or ":audit:" in script:
            issues.append(
                PackageScriptPolicyIssue(
                    path=relpath,
                    script=script,
                    message="one-off audit helpers must not be exposed as package scripts",
                )
            )
        if relpath == "apps/app-api/package.json" and script.startswith(APP_API_OPS_PREFIXES):
            issues.append(
                PackageScriptPolicyIssue(
                    path=relpath,
                    script=script,
                    message=(
                        "app-api package scripts must not expose DB/data/backfill/provider "
                        "ops commands"
                    ),
                )
            )
    return tuple(dict.fromkeys(issues))


def _package_paths(root: Path) -> tuple[Path, ...]:
    return tuple(
        sorted(root.glob("apps/*/package.json")) + sorted(root.glob("packages/*/package.json"))
    )


def _read_scripts(package_path: Path) -> dict[str, str]:
    if not package_path.exists():
        return {}
    package = json.loads(package_path.read_text(encoding="utf-8"))
    scripts = package.get("scripts")
    if not isinstance(scripts, dict):
        return {}
    return {str(name): str(value) for name, value in scripts.items()}


def main() -> int:
    issues = audit_package_script_policy()
    for issue in issues:
        print(f"{issue.path}: {issue.script}: {issue.message}")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
