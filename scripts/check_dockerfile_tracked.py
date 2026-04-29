from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_dockerfiles(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return worktree_paths("Dockerfile*", "*.dockerfile", "apps/**/Dockerfile*", root=base)


def build_local_hadolint_command(path: Path, *, root: Path | None = None) -> list[str]:
    base = root or repo_root()
    return [
        "hadolint",
        "-c",
        str(base / ".hadolint.yaml"),
        str(path.relative_to(base)),
    ]


def build_docker_hadolint_command(path: Path, *, root: Path | None = None) -> list[str]:
    base = root or repo_root()
    return [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{base}:/work",
        "-w",
        "/work",
        "hadolint/hadolint",
        "hadolint",
        "-c",
        "/work/.hadolint.yaml",
        str(path.relative_to(base)),
    ]


def main() -> int:
    files = tracked_dockerfiles()
    if not files:
        print("No current-worktree Dockerfiles matched the live-surface pathspecs.")
        return 0

    if shutil.which("hadolint"):
        command_builder = build_local_hadolint_command
    elif shutil.which("docker"):
        command_builder = build_docker_hadolint_command
    else:
        print(
            "Dockerfile lint requires a local 'hadolint' binary or Docker with the official hadolint image.",
            file=sys.stderr,
        )
        return 1

    for path in files:
        completed = subprocess.run(command_builder(path), cwd=repo_root())
        if completed.returncode != 0:
            return completed.returncode
    print(f"Validated {len(files)} Dockerfiles from current worktree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
