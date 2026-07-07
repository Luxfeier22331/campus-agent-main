from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

FORBIDDEN_PROJECT_NAMING_TOKENS = (
    "campus-map-data",
    "campus-rag-",
    "campusrag://",
    "campusrag_ingestion",
)
SCAN_PATHS = (
    ".github",
    "*.md",
    "*.json",
    "*.lock",
    "apps",
    "configs",
    "docs",
    "env",
    "infra",
    "packages",
    "scripts",
    "tests",
)
ALLOWLISTED_TOKEN_OWNER_PATHS = frozenset(
    {
        "scripts/check_object_store_bucket_policy.py",
        "tests/test_check_object_store_bucket_policy.py",
    }
)
TEXT_SUFFIXES = frozenset(
    {
        ".cjs",
        ".env",
        ".example",
        ".go",
        ".json",
        ".jsonl",
        ".js",
        ".lock",
        ".md",
        ".mjs",
        ".py",
        ".sh",
        ".sql",
        ".toml",
        ".ts",
        ".tsx",
        ".txt",
        ".yaml",
        ".yml",
    }
)


@dataclass(frozen=True, slots=True)
class ObjectStoreBucketPolicyFailure:
    path: Path
    line_number: int
    token: str

    def render(self) -> str:
        return f"{self.path}: line {self.line_number}: forbidden retired object-store/project token {self.token!r}"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def scan_object_store_bucket_policy(
    *,
    root: Path | None = None,
) -> tuple[ObjectStoreBucketPolicyFailure, ...]:
    base = root or repo_root()
    failures: list[ObjectStoreBucketPolicyFailure] = []
    for path in worktree_paths(*SCAN_PATHS, root=base):
        if not _is_scannable_text_file(path):
            continue
        relative_path = path.relative_to(base)
        if relative_path.as_posix() in ALLOWLISTED_TOKEN_OWNER_PATHS:
            continue
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for token in FORBIDDEN_PROJECT_NAMING_TOKENS:
                if token in line:
                    failures.append(
                        ObjectStoreBucketPolicyFailure(
                            path=relative_path,
                            line_number=line_number,
                            token=token,
                        )
                    )
    return tuple(failures)


def _is_scannable_text_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in TEXT_SUFFIXES


def main() -> int:
    failures = scan_object_store_bucket_policy()
    if failures:
        print("Object-store bucket policy check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure.render()}", file=sys.stderr)
        return 1
    print("Validated object-store bucket policy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
