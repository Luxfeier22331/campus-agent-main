from __future__ import annotations

import posixpath
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.check_docs_frontmatter_tracked import docs_markdown_files

_CONTROL_MARKDOWN_PATHS = (
    "AGENTS.md",
    "README.md",
    ".planning/PROJECT.md",
    ".planning/WORKSTREAMS.md",
)
_EXEMPT_SOURCE_PATHS: set[str] = set()
_RETIRED_COMPATIBILITY_PATHS = {
    "docs/architecture/system/execution-and-agents-architecture.md",
}
_REFERENCE_PATTERN = re.compile(
    r"(?<![/\w.-])(?P<target>(?:\.{1,2}/|docs/|AGENTS\.md|README\.md)[^\s)`'\"<>]*?\.md)"
)
_LOCAL_ABSOLUTE_REPO_PATH_PATTERN = re.compile(
    r"(?P<target>/home/[^\s)`'\"<>]*/code/[^\s)`'\"<>]*?\.md)"
)
_MIGRATION_PROCESS_MARKERS = (
    "Split from the former mega-doc",
    "former mega-doc",
)
_HISTORICAL_CONTEXT_TERMS = (
    "archive",
    "historical",
    "history",
    "superseded",
    "background",
    "retired",
    "deprecated",
    "legacy",
    "追溯",
    "历史",
    "旧",
    "已退役",
    "已被",
    "背景",
)


@dataclass(frozen=True)
class DocsReferenceGraphIssue:
    path: str
    target: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_docs_reference_graph(*, root: Path | None = None) -> tuple[DocsReferenceGraphIssue, ...]:
    base = root or repo_root()
    doc_status = _doc_status_map(base)
    active_sources = _active_source_files(base, doc_status)
    issues: list[DocsReferenceGraphIssue] = []

    for source in docs_markdown_files(root=base):
        source_relative = source.relative_to(base).as_posix()
        for target in _split_markdown_paths(source, source_relative=source_relative):
            issues.append(
                DocsReferenceGraphIssue(
                    path=source_relative,
                    target=target,
                    message="markdown path appears split across lines",
                )
            )

    for source in active_sources:
        source_relative = source.relative_to(base).as_posix()
        if source_relative in _EXEMPT_SOURCE_PATHS or "/archive/" in source_relative:
            continue
        for issue in _active_text_issues(source, source_relative=source_relative):
            issues.append(issue)
        for reference in _references_from_file(source, base):
            if reference.target in _RETIRED_COMPATIBILITY_PATHS:
                issues.append(
                    DocsReferenceGraphIssue(
                        path=source_relative,
                        target=reference.target,
                        message="active document references retired compatibility path",
                    )
                )
                continue

            if not (base / reference.target).exists():
                issues.append(
                    DocsReferenceGraphIssue(
                        path=source_relative,
                        target=reference.target,
                        message="active document references missing markdown file",
                    )
                )
                continue

            target_status = doc_status.get(reference.target)
            if target_status == "historical" and not _has_historical_context(reference.context):
                issues.append(
                    DocsReferenceGraphIssue(
                        path=source_relative,
                        target=reference.target,
                        message="active document references historical document without historical context",
                    )
                )
            if target_status in {"superseded", "deprecated"} and not _has_historical_context(
                reference.context
            ):
                issues.append(
                    DocsReferenceGraphIssue(
                        path=source_relative,
                        target=reference.target,
                        message=f"active document references {target_status} document without historical context",
                    )
                )

    return tuple(issues)


@dataclass(frozen=True)
class _Reference:
    target: str
    context: str


def _doc_status_map(root: Path) -> dict[str, str]:
    statuses: dict[str, str] = {}
    for path in docs_markdown_files(root=root):
        relative = path.relative_to(root).as_posix()
        fields = _frontmatter_fields(path)
        if fields is not None and "status" in fields:
            statuses[relative] = fields["status"]
    return statuses


def _active_source_files(root: Path, statuses: dict[str, str]) -> tuple[Path, ...]:
    sources: list[Path] = []
    for relative, status in statuses.items():
        if status in {"active", "accepted"}:
            sources.append(root / relative)
    for relative in _CONTROL_MARKDOWN_PATHS:
        path = root / relative
        if path.exists():
            sources.append(path)
    return tuple(dict.fromkeys(sources))


def _references_from_file(path: Path, root: Path) -> tuple[_Reference, ...]:
    source_relative = path.relative_to(root).as_posix()
    references: list[_Reference] = []
    lines = path.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines):
        context = _paragraph_context(lines, index)
        for match in _REFERENCE_PATTERN.finditer(line):
            target = _normalize_reference(
                match.group("target"),
                source_path=source_relative,
            )
            if target is not None:
                references.append(_Reference(target=target, context=context))
    return tuple(references)


def _active_text_issues(path: Path, *, source_relative: str) -> tuple[DocsReferenceGraphIssue, ...]:
    text = path.read_text(encoding="utf-8")
    issues: list[DocsReferenceGraphIssue] = []
    for match in _LOCAL_ABSOLUTE_REPO_PATH_PATTERN.finditer(text):
        issues.append(
            DocsReferenceGraphIssue(
                path=source_relative,
                target=match.group("target"),
                message="active document references local absolute repo path",
            )
        )
    for marker in _MIGRATION_PROCESS_MARKERS:
        if marker in text:
            issues.append(
                DocsReferenceGraphIssue(
                    path=source_relative,
                    target=marker,
                    message="active document contains documentation migration process marker",
                )
            )
            break
    return tuple(issues)


def _split_markdown_paths(path: Path, *, source_relative: str) -> tuple[str, ...]:
    lines = path.read_text(encoding="utf-8").splitlines()
    targets: list[str] = []
    for index, line in enumerate(lines[:-1]):
        if not line.rstrip().endswith(".m"):
            continue
        next_line = lines[index + 1]
        if not next_line.strip().startswith("d"):
            continue
        prefix = line.rsplit("`", 1)[-1]
        suffix = next_line.strip().split("`", 1)[0]
        target = _normalize_reference(f"{prefix}{suffix}", source_path=source_relative)
        if target is not None:
            targets.append(target)
    return tuple(targets)


def _normalize_reference(raw_target: str, *, source_path: str) -> str | None:
    target = raw_target.split("#", 1)[0].rstrip(".,;:")
    if not target.endswith(".md"):
        return None
    if any(marker in target for marker in ("*", ":", "{", "}")):
        return None
    if target.startswith("docs/") or target in {"AGENTS.md", "README.md"}:
        normalized = posixpath.normpath(target)
    elif target.startswith(("./", "../")):
        normalized = posixpath.normpath(posixpath.join(posixpath.dirname(source_path), target))
    else:
        return None
    if normalized.startswith("../"):
        return None
    return normalized


def _paragraph_context(lines: list[str], index: int) -> str:
    start = index
    while start > 0 and lines[start - 1].strip():
        start -= 1
    end = index
    while end + 1 < len(lines) and lines[end + 1].strip():
        end += 1
    return "\n".join(lines[start : end + 1])


def _has_historical_context(context: str) -> bool:
    lower_context = context.lower()
    return any(term in lower_context for term in _HISTORICAL_CONTEXT_TERMS)


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


def main() -> int:
    issues = audit_docs_reference_graph()
    if not issues:
        print("Validated docs reference graph.")
        return 0
    for issue in issues:
        print(f"{issue.path}: {issue.target}: {issue.message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
