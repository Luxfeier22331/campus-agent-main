from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

_FORBIDDEN_PATTERN = re.compile(r"fixture|fixtures", re.IGNORECASE)
_TEXT_SUFFIXES = {
    ".json",
    ".jsonc",
    ".jsonl",
    ".md",
    ".py",
    ".toml",
    ".ts",
}
_SCAN_ROOTS = (
    "apps/ingestion-control",
    "apps/source-collector",
    "packages/ingestion-contracts",
    "tests/ingestion",
    "configs/ingestion",
    "docs/architecture/system/data-plane.md",
    "docs/runbooks/ingestion-control-clean-target.md",
)
_ALLOWED_FIXTURE_PATH_PARTS = {"test", "tests", "testdata", "fixtures"}
_ALLOWED_FIXTURE_FILENAME_SUFFIXES = (
    ".test.ts",
    ".suite.ts",
    "_test.py",
    "_suite.py",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_ingestion_paths(*, root: Path | None = None) -> tuple[str, ...]:
    base = root or repo_root()
    result = subprocess.run(
        [
            "git",
            "-c",
            "core.quotePath=false",
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            *_SCAN_ROOTS,
        ],
        check=True,
        capture_output=True,
        cwd=base,
    )
    return tuple(
        path
        for item in result.stdout.split(b"\0")
        if item
        for path in [item.decode("utf-8")]
        if (base / path).exists()
    )


def _allows_fixture_term(path: str) -> bool:
    parts = set(Path(path).parts)
    if parts & _ALLOWED_FIXTURE_PATH_PARTS:
        return True
    return path.endswith(_ALLOWED_FIXTURE_FILENAME_SUFFIXES)


def audit_ingestion_assertion_naming(*, root: Path | None = None) -> tuple[str, ...]:
    base = root or repo_root()
    findings: list[str] = []
    for path in tracked_ingestion_paths(root=base):
        if _allows_fixture_term(path):
            continue
        if _FORBIDDEN_PATTERN.search(path):
            findings.append(f"{path}: path contains forbidden ingestion assertion term")
        file_path = base / path
        if not file_path.is_file() or file_path.suffix.lower() not in _TEXT_SUFFIXES:
            continue
        for line_number, line in enumerate(
            file_path.read_text(encoding="utf-8", errors="ignore").splitlines(),
            start=1,
        ):
            if _FORBIDDEN_PATTERN.search(line):
                findings.append(
                    f"{path}:{line_number}: contains forbidden ingestion assertion term"
                )
    return tuple(findings)


def main() -> int:
    findings = audit_ingestion_assertion_naming()
    if findings:
        print("Ingestion assertion naming check failed:", file=sys.stderr)
        for finding in findings:
            print(f"- {finding}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
