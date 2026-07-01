from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

CONFIG_PATTERNS = (
    "configs/ingestion/**",
    "configs/sources/**",
)
TEXT_SUFFIXES = frozenset({".json", ".jsonl", ".md", ".sql", ".toml", ".txt", ".yaml", ".yml"})
FORBIDDEN_SOURCE_TOKENS = (
    "中央民族大学",
    "muc.edu.cn",
    "my.muc.edu.cn",
    "www.muc.edu.cn",
    "institutional_regulation:muc",
    "official_web:muc_public",
    "asset:curriculum-plan-2022",
    "asset:student-handbook-pdf",
    "student-handbook-pdf",
    "curriculum-plan-2022",
    "campus-agent://regulations/student_rules/docs",
    "campus-agent://promotion/internal_notice",
    "central-minzu",
    "campus-rag",
)


@dataclass(frozen=True, slots=True)
class SourceDerivedConfigCleanFailure:
    path: Path
    line_number: int
    token: str

    def render(self) -> str:
        return f"{self.path}: line {self.line_number}: forbidden source token {self.token!r}"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def source_config_text_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(*CONFIG_PATTERNS, root=base)
        if path.is_file()
        and path.suffix.lower() in TEXT_SUFFIXES
        and _is_source_config_path(path.relative_to(base).as_posix())
    )


def scan_source_derived_config_tokens(
    *,
    root: Path | None = None,
) -> tuple[SourceDerivedConfigCleanFailure, ...]:
    base = root or repo_root()
    failures: list[SourceDerivedConfigCleanFailure] = []
    for path in source_config_text_files(root=base):
        relative_path = path.relative_to(base)
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for token in FORBIDDEN_SOURCE_TOKENS:
                if token in line:
                    failures.append(
                        SourceDerivedConfigCleanFailure(
                            path=relative_path,
                            line_number=line_number,
                            token=token,
                        )
                    )
    return tuple(failures)


def _is_source_config_path(relative_path: str) -> bool:
    return relative_path.startswith(("configs/ingestion/", "configs/sources/"))


def main() -> int:
    failures = scan_source_derived_config_tokens()
    if failures:
        print("Source-derived config cleanliness check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure.render()}", file=sys.stderr)
        return 1
    print(f"Validated {len(source_config_text_files())} source config text files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
