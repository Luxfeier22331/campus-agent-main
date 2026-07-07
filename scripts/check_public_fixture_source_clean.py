from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

FIXTURE_ROOTS = (
    "tests/fixtures/",
    "packages/contracts/fixtures/",
    "packages/eval-langfuse/assets/",
    "packages/eval-langfuse/fixtures/",
    "apps/source-collector/adapters/official-web/test/",
    "apps/source-collector/adapters/official-web/test/assertions/pages/",
    "apps/campus-web/test/fixtures/",
)
PUBLIC_WEB_SEARCH_AGENT_ASSET_PREFIX = (
    "packages/eval-langfuse/assets/datasets/agent/public_web_search/"
)
TEXT_SUFFIXES = frozenset({".html", ".json", ".jsonl", ".md", ".ts", ".txt", ".yaml", ".yml"})
FORBIDDEN_SOURCE_TOKENS = (
    "中央民族大学",
    "my.muc.edu.cn",
    "www.muc.edu.cn",
    "campus-agent://promotion/internal_notice",
    "muc_internal_portal",
    "institutional_regulation:muc",
    "official_web:muc_public",
    "849087992",
    "116.108483",
    "116.10859555",
    "116.3211",
    "116.3222",
)


@dataclass(frozen=True, slots=True)
class FixtureSourceCleanFailure:
    path: Path
    line_number: int
    token: str

    def render(self) -> str:
        return f"{self.path}: line {self.line_number}: forbidden source token {self.token!r}"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def public_fixture_text_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(
            "tests/fixtures/**",
            "packages/contracts/fixtures/**",
            "packages/eval-langfuse/assets/**",
            "packages/eval-langfuse/fixtures/**",
            "apps/source-collector/adapters/official-web/test/**",
            "apps/source-collector/adapters/official-web/test/assertions/pages/**",
            "apps/campus-web/test/fixtures/**",
            root=base,
        )
        if path.is_file()
        and path.suffix.lower() in TEXT_SUFFIXES
        and _is_public_fixture_path(path.relative_to(base).as_posix())
    )


def scan_public_fixture_source_tokens(
    *,
    root: Path | None = None,
) -> tuple[FixtureSourceCleanFailure, ...]:
    base = root or repo_root()
    failures: list[FixtureSourceCleanFailure] = []
    for path in public_fixture_text_files(root=base):
        relative_path = path.relative_to(base)
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for token in FORBIDDEN_SOURCE_TOKENS:
                if _allowed_public_web_search_agent_token(relative_path.as_posix(), token):
                    continue
                if token in line:
                    failures.append(
                        FixtureSourceCleanFailure(
                            path=relative_path,
                            line_number=line_number,
                            token=token,
                        )
                    )
    return tuple(failures)


def _is_public_fixture_path(relative_path: str) -> bool:
    return any(relative_path.startswith(root) for root in FIXTURE_ROOTS)


def _allowed_public_web_search_agent_token(relative_path: str, token: str) -> bool:
    return relative_path.startswith(PUBLIC_WEB_SEARCH_AGENT_ASSET_PREFIX) and token in {
        "中央民族大学",
        "muc.edu.cn",
    }


def main() -> int:
    failures = scan_public_fixture_source_tokens()
    if failures:
        print("Public fixture source-clean check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure.render()}", file=sys.stderr)
        return 1
    print(f"Validated {len(public_fixture_text_files())} public fixture text files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
