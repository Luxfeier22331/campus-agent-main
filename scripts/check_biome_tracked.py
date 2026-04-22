from __future__ import annotations

import subprocess
from pathlib import Path

_BIOME_TRACKED_PATHS = (
    ".markdownlint-cli2.jsonc",
    "biome.jsonc",
    "package.json",
    "turbo.json",
    "apps",
    "packages",
    "configs",
    "scripts",
    "tests",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_biome_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    result = subprocess.run(
        ["git", "ls-files", *_BIOME_TRACKED_PATHS],
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )
    return tuple(
        path
        for line in result.stdout.splitlines()
        if line.strip()
        for path in [base / line]
        if path.exists()
    )


def main() -> int:
    files = tracked_biome_files()
    if not files:
        print("No tracked files matched the Biome live-surface pathspecs.")
        return 0
    command = [
        "pnpm",
        "exec",
        "biome",
        "check",
        "--files-ignore-unknown=true",
        *(str(path.relative_to(repo_root())) for path in files),
    ]
    completed = subprocess.run(command, cwd=repo_root())
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
