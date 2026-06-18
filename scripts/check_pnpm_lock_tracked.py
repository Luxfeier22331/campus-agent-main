from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

from scripts.worktree_file_discovery import worktree_paths


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_pnpm_lock_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths("pnpm-lock.yaml", "**/pnpm-lock.yaml", root=base)
        for line in [path.relative_to(base).as_posix()]
        if not line.startswith(".planning/")
        and "/vendor/" not in line
        and "/node_modules/" not in line
        and path.exists()
    )


def build_root_pnpm_lock_check_command() -> list[str]:
    return [
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--lockfile-only",
    ]


def app_package_manifest_for_lockfile(lockfile: Path, *, root: Path | None = None) -> Path:
    base = root or repo_root()
    manifest = lockfile.parent / "package.json"
    if not manifest.exists():
        raise FileNotFoundError(
            f"app-local pnpm lockfile requires sibling package.json: {lockfile.relative_to(base)}"
        )
    return manifest


def validate_app_manifest_has_no_workspace_dependencies(
    manifest: dict[str, Any],
    manifest_path: Path,
    *,
    root: Path | None = None,
) -> None:
    base = root or repo_root()
    offenders: list[str] = []
    for section in (
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
    ):
        dependencies = manifest.get(section)
        if not isinstance(dependencies, dict):
            continue
        for name, specifier in dependencies.items():
            if str(specifier).strip().startswith("workspace:"):
                offenders.append(f"{section}.{name}")
    if offenders:
        raise ValueError(
            f"{manifest_path.relative_to(base)} cannot use workspace protocol dependencies "
            f"with an app-local pnpm-lock.yaml: {', '.join(sorted(offenders))}"
        )


def validate_app_manifest_for_lockfile(lockfile: Path, *, root: Path | None = None) -> None:
    manifest_path = app_package_manifest_for_lockfile(lockfile, root=root)
    import json

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError(f"{manifest_path.relative_to(root or repo_root())} must be an object")
    validate_app_manifest_has_no_workspace_dependencies(manifest, manifest_path, root=root)


def build_app_pnpm_lock_check_command(lockfile: Path, *, root: Path | None = None) -> list[str]:
    base = root or repo_root()
    app_dir = str(lockfile.parent.relative_to(base))
    return [
        "pnpm",
        "install",
        "--dir",
        app_dir,
        "--ignore-workspace",
        "--lockfile-dir",
        app_dir,
        "--frozen-lockfile",
        "--ignore-scripts",
        "--lockfile-only",
    ]


def validate_pnpm_lockfile(path: Path, *, root: Path | None = None) -> None:
    base = root or repo_root()
    if path.parent == base:
        command = build_root_pnpm_lock_check_command()
    else:
        validate_app_manifest_for_lockfile(path, root=base)
        command = build_app_pnpm_lock_check_command(path, root=base)
    subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )


def main(*, root: Path | None = None) -> int:
    base = root or repo_root()
    failures: list[str] = []
    files = tracked_pnpm_lock_files(root=base)
    for path in files:
        try:
            validate_pnpm_lockfile(path, root=base)
        except (FileNotFoundError, OSError) as exc:
            failures.append(f"{path.relative_to(base)}: {exc}")
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            failures.append(f"{path.relative_to(base)}: {stderr}")
    if failures:
        print("pnpm lock integrity check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} pnpm lockfiles from current worktree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
