from __future__ import annotations

import subprocess
import sys
import tomllib
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_toml_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    result = subprocess.run(
        ["git", "ls-files", "*.toml"],
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )
    return tuple(base / line for line in result.stdout.splitlines() if line.strip())


def validate_toml_file(path: Path) -> None:
    tomllib.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    failures: list[str] = []
    for path in tracked_toml_files():
        try:
            validate_toml_file(path)
        except (OSError, tomllib.TOMLDecodeError) as exc:
            failures.append(f"{path.relative_to(repo_root())}: {exc}")
    if failures:
        print("TOML syntax check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(tracked_toml_files())} tracked TOML files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
