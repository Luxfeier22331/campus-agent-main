from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_yaml_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", "ls-files", "-z", "*.yml", "*.yaml"],
        check=True,
        capture_output=True,
        cwd=base,
    )
    paths = [
        Path(item.decode("utf-8"))
        for item in result.stdout.split(b"\0")
        if item and not item.decode("utf-8").startswith(".planning/")
    ]
    return tuple(base / path for path in paths)


def main() -> int:
    files = tracked_yaml_files()
    if not files:
        print("No tracked YAML files matched the live-surface pathspecs.")
        return 0
    command = [
        "pre-commit",
        "run",
        "check-yaml",
        "--files",
        *(str(path.relative_to(repo_root())) for path in files),
    ]
    completed = subprocess.run(command, cwd=repo_root())
    if completed.returncode == 0:
        print(f"Validated {len(files)} tracked YAML files outside .planning/.")
        return 0
    print("YAML structure check failed.", file=sys.stderr)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
