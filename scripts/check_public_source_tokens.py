from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

SCAN_PATHS = (
    "apps",
    "configs",
    "docs",
    "packages",
    "tests",
    "THIRD_PARTY_NOTICES.md",
)
TEXT_SUFFIXES = frozenset(
    {
        ".env",
        ".example",
        ".go",
        ".json",
        ".jsonl",
        ".md",
        ".mjs",
        ".mts",
        ".py",
        ".toml",
        ".ts",
        ".tsx",
        ".txt",
        ".yaml",
        ".yml",
    }
)
FORBIDDEN_SOURCE_TOKENS = (
    "my.muc.edu.cn",
    "portal.muc.edu.cn",
    "www.muc.edu.cn",
    "xxgk.muc.edu.cn",
    "met.muc.edu.cn",
    "jwc.muc.edu.cn",
    "muc.edu.cn",
    "muc_internal_portal",
    "official_web:muc_public",
    "institutional_regulation:muc",
    "asset:curriculum-plan-2022",
    "asset:student-handbook-pdf",
    "student-handbook-pdf",
    "curriculum-plan-2022",
    "campus-agent://promotion/internal_notice",
    "药学院2021年硕博连读博士研究生招生实施细则",
    "历史文化学院2021年硕博连读博士研究生",
    "民族学与社会学学院2021年硕博连读博士研究生",
    "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
    "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
    "中华民族共同体学院",
    "MUC出行快讯",
    "MUCer注意啦",
    "I_0ji-iVJWm_ukb6UNDMiw",
    "EphU4RgS59GGvGuTgg62pw",
    "kHOaEpryJ9oy_A6NXNAhGw",
    "xtybxO4eKRzImzIreOLSRg",
    "6ZpX2byjb5j8UJ5XYiR5OA",
    "7ZwKk37lvAnOGJcU89j2dg",
    "nkWA_2jlmS-e9yTfbEfmyw",
    "849087992",
    "116.10859555",
    "116.108483",
    "116.10855328",
    "116.108,",
    "116.3211",
    "116.3222",
)
TOKEN_OWNER_PATHS = frozenset(
    {
        "scripts/check_public_source_tokens.py",
        "tests/test_check_public_fixture_source_clean.py",
        "tests/test_check_source_derived_config_clean.py",
        "tests/test_check_public_source_tokens.py",
    }
)
PUBLIC_WEB_SEARCH_SOURCE_TOKEN_PATHS = frozenset(
    {
        "apps/app-api/src/modules/chat/model.ts",
        "apps/app-api/src/modules/provider-config/validators.ts",
        "apps/app-api/src/modules/runtime-command/service/normalize-source-items.ts",
        "apps/app-api/test/chat-structured-parts.test.ts",
        "apps/app-api/test/provider-config.search-validator.test.ts",
        "apps/campus-web/test/source-items.test.tsx",
        "apps/execution-control/internal/httpapi/public_web_search.go",
        "apps/execution-control/internal/httpapi/public_web_search_test.go",
        "apps/execution-control/internal/provider/gemini_google_search_client_test.go",
        "apps/execution-control/internal/provider/openai_web_search_client_test.go",
        "apps/execution-control/internal/httpapi/provider_config_resolver_public_web_search_test.go",
        "apps/execution-control/internal/provider/perplexity_search_client_test.go",
        "docs/decisions/adr-0067-public-web-search-provider-boundary.md",
        "docs/domains/public-web-search.md",
        "docs/runbooks/execution-smoke.md",
        "packages/eval-langfuse/src/public-web-search-agent-runner.ts",
        "packages/eval-langfuse/src/public-web-search-eval.ts",
        "packages/eval-langfuse/test/public-web-search-agent-runner.test.ts",
        "packages/eval-langfuse/test/public-web-search-eval.test.ts",
    }
)
PUBLIC_WEB_SEARCH_SOURCE_TOKEN_PREFIXES = (
    "packages/eval-langfuse/assets/datasets/agent/public_web_search/",
)
PUBLIC_WEB_SEARCH_ALLOWED_SOURCE_TOKENS = frozenset(
    {
        "muc.edu.cn",
        "my.muc.edu.cn",
        "www.muc.edu.cn",
    }
)


@dataclass(frozen=True, slots=True)
class PublicSourceTokenFailure:
    path: Path
    line_number: int
    token: str

    def render(self) -> str:
        return f"{self.path}: line {self.line_number}: forbidden public source token {self.token!r}"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def public_source_token_candidate_paths(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(*SCAN_PATHS, root=base)
        for relative_path in [path.relative_to(base).as_posix()]
        if path.is_file()
        and path.suffix.lower() in TEXT_SUFFIXES
        and relative_path not in TOKEN_OWNER_PATHS
    )


def scan_public_source_tokens(
    *,
    root: Path | None = None,
) -> tuple[PublicSourceTokenFailure, ...]:
    base = root or repo_root()
    failures: list[PublicSourceTokenFailure] = []
    for path in public_source_token_candidate_paths(root=base):
        relative_path = path.relative_to(base)
        relative_text = relative_path.as_posix()
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for token in FORBIDDEN_SOURCE_TOKENS:
                if _allowed_public_web_search_source_token(relative_text, token):
                    continue
                if token in line:
                    failures.append(
                        PublicSourceTokenFailure(
                            path=relative_path,
                            line_number=line_number,
                            token=token,
                        )
                    )
    return tuple(failures)


def _allowed_public_web_search_source_token(relative_path: str, token: str) -> bool:
    if token not in PUBLIC_WEB_SEARCH_ALLOWED_SOURCE_TOKENS:
        return False
    if relative_path in PUBLIC_WEB_SEARCH_SOURCE_TOKEN_PATHS:
        return True
    return relative_path.startswith(PUBLIC_WEB_SEARCH_SOURCE_TOKEN_PREFIXES)


def main() -> int:
    failures = scan_public_source_tokens()
    if failures:
        print("Public source-token check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure.render()}", file=sys.stderr)
        return 1
    print(f"Validated {len(public_source_token_candidate_paths())} public text files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
