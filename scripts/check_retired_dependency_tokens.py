from __future__ import annotations

import sys
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

_TEXT_SUFFIXES = {
    ".md",
    ".mdx",
    ".mjs",
    ".mts",
    ".py",
    ".sh",
    ".lock",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}
_FORBIDDEN_TOKENS = (
    "PyMuPDF",
    "pymupdf",
    "fitz",
    "psycopg[binary]",
    "psycopg-binary",
    "psycopg-pool",
    "psycopg_pool",
    "import psycopg",
    "from psycopg",
    "campus_shared.provider_config",
    "postgres_runtime.py",
    "_postgres_connection",
    "PostgresDocumentRegistry",
    "PostgresRawAssetRegistry",
    "PostgresAuthenticatedNotice",
    "PostgresInternalNotice",
    "PostgresNoticeConsumption",
    "PostgresStructuredProjection",
    "PostgresScheduleImageOcr",
    "PostgresWeChatPublicNotice",
)
_ALLOWED_PATHS = {
    "scripts/check_retired_dependency_tokens.py",
    "scripts/doctor_env.py",
    "scripts/execution_control_process_smoke_runtime.py",
    "tests/ingestion/test_ingestion_clean_target_boundary.py",
    "tests/ingestion/test_worker_env_bootstrap.py",
    "tests/test_doctor_env.py",
    "tests/test_execution_control_process_smoke_structured_seed.py",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def retired_dependency_candidate_paths(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(root=base)
        for relative_path in [path.relative_to(base).as_posix()]
        if relative_path not in _ALLOWED_PATHS and path.suffix in _TEXT_SUFFIXES
    )


def retired_dependency_token_failures(*, root: Path | None = None) -> tuple[str, ...]:
    base = root or repo_root()
    failures: list[str] = []
    for path in retired_dependency_candidate_paths(root=base):
        text = path.read_text(encoding="utf-8")
        relative_path = path.relative_to(base).as_posix()
        for token in _FORBIDDEN_TOKENS:
            if token in text:
                failures.append(f"{relative_path}: retired dependency token {token!r}")
    return tuple(failures)


def main() -> int:
    failures = retired_dependency_token_failures()
    if failures:
        print("Retired dependency token check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("Validated retired dependency tokens are absent from active tracked text files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
