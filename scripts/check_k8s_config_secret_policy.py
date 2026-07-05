from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

DEFAULT_OVERLAYS = (
    Path("infra/k8s/execution-runtime/overlays/nc-arm-6c-staging"),
    Path("infra/k8s/execution-runtime/overlays/staging"),
    Path("infra/k8s/dining-sync/overlays/staging"),
)
POLICY_DIR = Path("infra/policies")


@dataclass(frozen=True, slots=True)
class K8sPolicyIssue:
    path: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_k8s_config_secret_policy(
    *,
    root: Path | None = None,
    overlays: Sequence[Path] = DEFAULT_OVERLAYS,
) -> tuple[K8sPolicyIssue, ...]:
    base = root or repo_root()
    issues: list[K8sPolicyIssue] = []

    if shutil.which("kubectl") is None:
        return (
            K8sPolicyIssue(
                path="kubectl", message="kubectl is required to render Kustomize overlays"
            ),
        )
    if shutil.which("conftest") is None:
        return (
            K8sPolicyIssue(
                path="conftest",
                message=(
                    "conftest is required for Kubernetes config/secret policy checks; "
                    "install Conftest from https://www.conftest.dev/"
                ),
            ),
        )

    policy_dir = base / POLICY_DIR
    if not policy_dir.exists():
        return (K8sPolicyIssue(path=POLICY_DIR.as_posix(), message="policy directory is required"),)

    with tempfile.TemporaryDirectory(prefix="campus-k8s-policy-") as tmp:
        tmp_dir = Path(tmp)
        for overlay in overlays:
            overlay_path = base / overlay
            if not overlay_path.exists():
                issues.append(
                    K8sPolicyIssue(path=overlay.as_posix(), message="Kustomize overlay is missing")
                )
                continue
            rendered_path = tmp_dir / f"{overlay.name}.yaml"
            render = subprocess.run(
                ("kubectl", "kustomize", overlay.as_posix()),
                cwd=base,
                capture_output=True,
                text=True,
                check=False,
            )
            if render.returncode != 0:
                issues.append(
                    K8sPolicyIssue(
                        path=overlay.as_posix(),
                        message=render.stderr.strip()
                        or render.stdout.strip()
                        or "kubectl kustomize failed",
                    )
                )
                continue
            rendered_path.write_text(render.stdout, encoding="utf-8")
            result = subprocess.run(
                (
                    "conftest",
                    "test",
                    "--policy",
                    POLICY_DIR.as_posix(),
                    rendered_path.as_posix(),
                ),
                cwd=base,
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                issues.append(
                    K8sPolicyIssue(
                        path=overlay.as_posix(),
                        message=result.stdout.strip() or result.stderr.strip() or "conftest failed",
                    )
                )
    return tuple(issues)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render repo Kustomize overlays and check config/secret policy with Conftest."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=repo_root(),
        help="Repo root. Defaults to this script's repo root.",
    )
    parser.add_argument(
        "--overlay",
        action="append",
        default=None,
        help="Optional overlay path. Can be passed multiple times.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    overlays = tuple(Path(item) for item in args.overlay) if args.overlay else DEFAULT_OVERLAYS
    issues = audit_k8s_config_secret_policy(root=args.repo_root.resolve(), overlays=overlays)
    if issues:
        print("K8s config/secret policy check failed:", file=sys.stderr)
        for issue in issues:
            print(f"- {issue.path}: {issue.message}", file=sys.stderr)
        return 1
    print("Validated K8s config/secret policy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
