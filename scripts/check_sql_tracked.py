from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_sql_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", "ls-files", "*.sql"],
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )
    return tuple(
        base / line
        for line in result.stdout.splitlines()
        if line.strip() and not line.startswith(".planning/")
    )


def validate_sql_file(path: Path, *, root: Path | None = None) -> None:
    base = root or repo_root()
    subprocess.run(
        [
            "sqlfluff",
            "parse",
            "--dialect",
            "postgres",
            str(path.relative_to(base)),
        ],
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )


def main() -> int:
    failures: list[str] = []
    files = tracked_sql_files()
    for path in files:
        try:
            validate_sql_file(path)
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            failures.append(f"{path.relative_to(repo_root())}: {stderr}")
        except OSError as exc:
            failures.append(f"{path.relative_to(repo_root())}: {exc}")

    if failures:
        print("SQL parse check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} tracked SQL files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
