from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_shell_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return worktree_paths("*.sh", root=base)


def build_local_shellcheck_command(path: Path, *, root: Path | None = None) -> list[str]:
    base = root or repo_root()
    relative_or_absolute = str(path.relative_to(base)) if path.is_relative_to(base) else str(path)
    return [
        "shellcheck",
        "-x",
        "-s",
        "bash",
        relative_or_absolute,
    ]


def build_docker_shellcheck_command(path: Path, *, root: Path | None = None) -> list[str]:
    base = root or repo_root()
    return [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{base}:/work",
        "-w",
        "/work",
        "koalaman/shellcheck:stable",
        "-x",
        "-s",
        "bash",
        str(path.relative_to(base)),
    ]


def resolve_shellcheck_command_builder():
    if shutil.which("shellcheck"):
        return build_local_shellcheck_command
    if shutil.which("docker"):
        return build_docker_shellcheck_command
    raise FileNotFoundError(
        "Shell lint requires a local 'shellcheck' binary or Docker with the official shellcheck image."
    )


def validate_shell_file(path: Path, *, command_builder=None, root: Path | None = None) -> None:
    base = root or repo_root()
    builder = command_builder or resolve_shellcheck_command_builder()
    subprocess.run(
        builder(path, root=base),
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )


def main() -> int:
    files = tracked_shell_files()
    try:
        command_builder = resolve_shellcheck_command_builder()
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    failures: list[str] = []
    for path in files:
        try:
            validate_shell_file(path, command_builder=command_builder)
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            failures.append(f"{path.relative_to(repo_root())}: {stderr}")
        except (OSError, ValueError) as exc:
            failures.append(f"{path.relative_to(repo_root())}: {exc}")
    if failures:
        print("Shell lint failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} shell files from current worktree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
