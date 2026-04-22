from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

_KEY_PATTERN = re.compile(r"^[A-Z0-9_]+$")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_env_example_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", "ls-files", "-z", ".env.example", "env"],
        check=True,
        capture_output=True,
        cwd=base,
    )
    paths = [
        Path(decoded)
        for item in result.stdout.split(b"\0")
        if item and (decoded := item.decode("utf-8")).endswith(".env.example")
    ]
    return tuple(base / path for path in paths)


def validate_env_example_file(path: Path) -> tuple[str, ...]:
    seen_keys: set[str] = set()
    failures: list[str] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in raw_line:
            failures.append(f"{path}:{line_number}: expected KEY=VALUE entry")
            continue
        key, _value = raw_line.split("=", 1)
        if key != key.strip():
            failures.append(f"{path}:{line_number}: key must not contain surrounding whitespace")
            continue
        if not _KEY_PATTERN.fullmatch(key):
            failures.append(f"{path}:{line_number}: invalid env key '{key}'")
            continue
        if key in seen_keys:
            failures.append(f"{path}:{line_number}: duplicate env key '{key}'")
            continue
        seen_keys.add(key)
    return tuple(failures)


def main() -> int:
    failures: list[str] = []
    files = tracked_env_example_files()
    for path in files:
        failures.extend(validate_env_example_file(path))
    if failures:
        print("Env example structure check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} tracked env example files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
