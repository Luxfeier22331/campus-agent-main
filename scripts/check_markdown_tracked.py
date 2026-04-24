from __future__ import annotations

import subprocess
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

_MARKDOWN_TRACKED_PATHS = (
    "README.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    ".github/pull_request_template.md",
    "docs",
    "apps",
    "packages",
    "configs",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_markdown_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(*_MARKDOWN_TRACKED_PATHS, root=base)
        for decoded in [path.relative_to(base).as_posix()]
        if _is_tracked_markdown_candidate(decoded) and path.exists()
    )


def _is_tracked_markdown_candidate(path: str) -> bool:
    if path.startswith(".planning/"):
        return False
    if "/vendor/" in path or "/node_modules/" in path:
        return False
    if path.startswith("docs/"):
        if "/archive/" in path or path.startswith("docs/plans/"):
            return False
        return path.endswith(".md")
    if path in {"README.md", "AGENTS.md", "CONTRIBUTING.md", ".github/pull_request_template.md"}:
        return True
    if path.startswith("apps/public-docs/docs/"):
        return False
    if path.startswith(("apps/", "packages/", "configs/")):
        return path.endswith(".md")
    return False


def main() -> int:
    files = tracked_markdown_files()
    if not files:
        print("No current-worktree Markdown files matched the live-surface pathspecs.")
        return 0
    command = [
        "pnpm",
        "exec",
        "markdownlint-cli2",
        "--config",
        ".markdownlint-cli2.jsonc",
        *(str(path.relative_to(repo_root())) for path in files),
    ]
    completed = subprocess.run(command, cwd=repo_root())
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
