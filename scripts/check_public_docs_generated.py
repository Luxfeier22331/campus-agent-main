from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from scripts.worktree_file_discovery import worktree_paths

_PUBLIC_DOCS_ROOT = "apps/public-docs/docs"
_CONFLICT_MARKERS = ("<<<<<<<", "=======", ">>>>>>>")
_INTERNAL_LOCATOR_MARKERS = (
    "campusrag://",
    "campus-rag-derived",
    "minio://",
    "s3://",
)
_RESTRICTED_PUBLIC_DOCS_MARKERS = (
    "institutional_rules",
    "scoped_rules",
    "internal_notice",
)


@dataclass(frozen=True)
class PublicDocsGeneratedIssue:
    path: Path
    message: str

    def display(self, *, root: Path | None = None) -> str:
        base = root or repo_root()
        try:
            path = self.path.relative_to(base)
        except ValueError:
            path = self.path
        return f"{path}: {self.message}"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def public_docs_generated_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(_PUBLIC_DOCS_ROOT, root=base)
        for decoded in [path.relative_to(base).as_posix()]
        if _is_public_docs_generated_candidate(decoded) and path.exists()
    )


def validate_public_docs_generated_file(
    path: Path,
    *,
    root: Path | None = None,
) -> tuple[PublicDocsGeneratedIssue, ...]:
    issues: list[PublicDocsGeneratedIssue] = []
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        issues.append(PublicDocsGeneratedIssue(path, "empty generated document"))
        return tuple(issues)

    issues.extend(_conflict_marker_issues(path, text))
    issues.extend(_restricted_marker_issues(path, text))
    frontmatter, body, frontmatter_error = _split_frontmatter(text)
    if frontmatter_error is not None:
        issues.append(PublicDocsGeneratedIssue(path, frontmatter_error))
        return tuple(issues)

    metadata = _parse_frontmatter(path, frontmatter, issues)
    if isinstance(metadata, dict):
        title = metadata.get("title")
        page_type = metadata.get("pageType")
        if (not isinstance(title, str) or not title.strip()) and page_type != "home":
            issues.append(
                PublicDocsGeneratedIssue(
                    path,
                    "frontmatter must include non-empty title or pageType: home",
                )
            )
        if not body.strip() and page_type != "home":
            issues.append(PublicDocsGeneratedIssue(path, "missing generated document body"))

    return tuple(issues)


def validate_public_docs_generated_files(
    paths: tuple[Path, ...] | None = None,
    *,
    root: Path | None = None,
) -> tuple[PublicDocsGeneratedIssue, ...]:
    files = paths if paths is not None else public_docs_generated_files(root=root)
    issues: list[PublicDocsGeneratedIssue] = []
    for path in files:
        issues.extend(validate_public_docs_generated_file(path, root=root))
    return tuple(issues)


def _is_public_docs_generated_candidate(path: str) -> bool:
    if not path.startswith(f"{_PUBLIC_DOCS_ROOT}/"):
        return False
    if path.startswith(f"{_PUBLIC_DOCS_ROOT}/.generated/"):
        return False
    return path.endswith((".md", ".mdx"))


def _split_frontmatter(text: str) -> tuple[str, str, str | None]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return "", "", "missing frontmatter block"
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return "\n".join(lines[1:index]), "\n".join(lines[index + 1 :]), None
    return "", "", "unterminated frontmatter block"


def _parse_frontmatter(
    path: Path,
    frontmatter: str,
    issues: list[PublicDocsGeneratedIssue],
) -> Any:
    try:
        metadata = yaml.safe_load(frontmatter) if frontmatter.strip() else {}
    except yaml.YAMLError as exc:
        issues.append(PublicDocsGeneratedIssue(path, f"invalid frontmatter YAML: {exc}"))
        return None
    if metadata is None:
        return {}
    if not isinstance(metadata, dict):
        issues.append(PublicDocsGeneratedIssue(path, "frontmatter must be a mapping"))
        return None
    return metadata


def _conflict_marker_issues(path: Path, text: str) -> tuple[PublicDocsGeneratedIssue, ...]:
    issues: list[PublicDocsGeneratedIssue] = []
    for line in text.splitlines():
        for marker in _CONFLICT_MARKERS:
            if line.startswith(marker):
                issues.append(
                    PublicDocsGeneratedIssue(path, f"contains git conflict marker: {marker}")
                )
                break
    return tuple(issues)


def _restricted_marker_issues(path: Path, text: str) -> tuple[PublicDocsGeneratedIssue, ...]:
    issues: list[PublicDocsGeneratedIssue] = []
    for marker in _RESTRICTED_PUBLIC_DOCS_MARKERS:
        if marker in text:
            issues.append(
                PublicDocsGeneratedIssue(
                    path,
                    f"contains restricted public-docs marker: {marker}",
                )
            )
    for marker in _INTERNAL_LOCATOR_MARKERS:
        if marker in text:
            issues.append(
                PublicDocsGeneratedIssue(path, f"contains internal locator marker: {marker}")
            )
    return tuple(issues)


def main() -> int:
    root = repo_root()
    issues = validate_public_docs_generated_files(root=root)
    if issues:
        print("Generated public docs lint failed:", file=sys.stderr)
        for issue in issues:
            print(f"- {issue.display(root=root)}", file=sys.stderr)
        return 1
    print(
        f"Validated generated public docs for {len(public_docs_generated_files(root=root))} files."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
