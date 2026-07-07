from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

_DOC_ROOT = "docs"
_REQUIRED_FIELDS = (
    "doc_type",
    "truth_scope",
    "owner_boundary",
    "status",
    "created",
    "updated",
)
_ALLOWED_TRUTH_SCOPES = {
    "product",
    "execution",
    "data",
    "ops",
    "eval",
    "repository",
}
_ALLOWED_STATUS = {
    "active",
    "historical",
    "proposed",
    "accepted",
    "superseded",
    "deprecated",
}


@dataclass(frozen=True)
class DocsFrontmatterIssue:
    path: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def docs_markdown_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    try:
        files = worktree_paths(_DOC_ROOT, root=base)
    except subprocess.CalledProcessError:
        files = tuple((base / _DOC_ROOT).rglob("*"))
    return tuple(
        path
        for path in files
        if path.suffix == ".md" and path.exists() and _is_docs_markdown_path(path, base)
    )


def audit_docs_frontmatter(*, root: Path | None = None) -> tuple[DocsFrontmatterIssue, ...]:
    base = root or repo_root()
    issues: list[DocsFrontmatterIssue] = []
    for path in docs_markdown_files(root=base):
        relative_path = path.relative_to(base).as_posix()
        fields = _frontmatter_fields(path)
        if fields is None:
            issues.append(
                DocsFrontmatterIssue(
                    path=relative_path,
                    message="missing YAML frontmatter block",
                )
            )
            continue

        for field in _REQUIRED_FIELDS:
            if field not in fields:
                issues.append(
                    DocsFrontmatterIssue(
                        path=relative_path,
                        message=f"missing required frontmatter field: {field}",
                    )
                )

        truth_scope = fields.get("truth_scope")
        if truth_scope is not None and truth_scope not in _ALLOWED_TRUTH_SCOPES:
            issues.append(
                DocsFrontmatterIssue(
                    path=relative_path,
                    message=f"invalid truth_scope: {truth_scope}",
                )
            )

        status = fields.get("status")
        if status is not None and status not in _ALLOWED_STATUS:
            issues.append(
                DocsFrontmatterIssue(
                    path=relative_path,
                    message=f"invalid status: {status}",
                )
            )

        if _is_non_readme_archive_path(relative_path) and status == "active":
            issues.append(
                DocsFrontmatterIssue(
                    path=relative_path,
                    message="archive documents must be historical unless they are README.md indexes",
                )
            )

    return tuple(issues)


def _is_docs_markdown_path(path: Path, root: Path) -> bool:
    relative_path = path.relative_to(root).as_posix()
    return relative_path == _DOC_ROOT or relative_path.startswith(f"{_DOC_ROOT}/")


def _frontmatter_fields(path: Path) -> dict[str, str] | None:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end == -1:
        return None
    fields: dict[str, str] = {}
    for line in text[4:end].splitlines():
        if not line or line.startswith(" ") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip()
    return fields


def _is_non_readme_archive_path(path: str) -> bool:
    return "/archive/" in path and not path.endswith("/README.md")


def main() -> int:
    issues = audit_docs_frontmatter()
    if not issues:
        print("Validated docs frontmatter.")
        return 0
    for issue in issues:
        print(f"{issue.path}: {issue.message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
