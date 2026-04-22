from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_shell_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    result = subprocess.run(
        ["git", "ls-files", "*.sh"],
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )
    return tuple(base / line for line in result.stdout.splitlines() if line.strip())


def validate_shell_file(path: Path) -> None:
    subprocess.run(
        ["bash", "-n", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )


def main() -> int:
    failures: list[str] = []
    for path in tracked_shell_files():
        try:
            validate_shell_file(path)
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            failures.append(f"{path.relative_to(repo_root())}: {stderr}")
        except OSError as exc:
            failures.append(f"{path.relative_to(repo_root())}: {exc}")
    if failures:
        print("Shell syntax check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(tracked_shell_files())} tracked shell files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
