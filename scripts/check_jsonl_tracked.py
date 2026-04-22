from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_jsonl_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", "ls-files", "-z", "*.jsonl"],
        check=True,
        capture_output=True,
        cwd=base,
    )
    return tuple(
        base / decoded
        for item in result.stdout.split(b"\0")
        if item
        and not (decoded := item.decode("utf-8")).startswith(".planning/")
        and "/vendor/" not in decoded
    )


def validate_jsonl_file(path: Path) -> tuple[str, ...]:
    failures: list[str] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw_line.strip():
            continue
        try:
            json.loads(raw_line)
        except json.JSONDecodeError as exc:
            failures.append(f"{path}: line {line_number}: JSON parse error: {exc.msg}")
    return tuple(failures)


def main() -> int:
    failures: list[str] = []
    files = tracked_jsonl_files()
    for path in files:
        failures.extend(validate_jsonl_file(path))
    if failures:
        print("JSONL structure check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} tracked JSONL files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
