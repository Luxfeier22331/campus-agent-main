from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.check_docs_frontmatter_tracked import docs_markdown_files

_INVENTORY_PATH = "docs/reference/documentation-inventory.md"
_DOCS_PATH_PATTERN = re.compile(r"`(?P<path>docs/[^`]+?\.md)`")
_SNAPSHOT_COUNT_PATTERN = re.compile(
    r"^- Current-worktree docs Markdown files: (?P<count>\d+)$", re.M
)


@dataclass(frozen=True)
class DocsInventoryIssue:
    path: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_docs_inventory(*, root: Path | None = None) -> tuple[DocsInventoryIssue, ...]:
    base = root or repo_root()
    inventory = base / _INVENTORY_PATH
    if not inventory.exists():
        return (
            DocsInventoryIssue(
                path=_INVENTORY_PATH,
                message="documentation inventory file is missing",
            ),
        )

    current_paths = {
        path.relative_to(base).as_posix()
        for path in docs_markdown_files(root=base)
        if path.exists()
    }
    inventory_paths = _inventory_paths(inventory)
    issues: list[DocsInventoryIssue] = []
    snapshot_count = _snapshot_count(inventory)
    if snapshot_count is not None and snapshot_count != len(current_paths):
        issues.append(
            DocsInventoryIssue(
                path=_INVENTORY_PATH,
                message=(
                    f"snapshot docs file count {snapshot_count} does not match "
                    f"current count {len(current_paths)}"
                ),
            )
        )

    for path in sorted(current_paths - inventory_paths):
        issues.append(
            DocsInventoryIssue(
                path=path,
                message="current docs file missing from documentation inventory",
            )
        )
    for path in sorted(inventory_paths - current_paths):
        issues.append(
            DocsInventoryIssue(
                path=path,
                message="documentation inventory references missing docs file",
            )
        )
    return tuple(issues)


def _inventory_paths(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    return {match.group("path") for match in _DOCS_PATH_PATTERN.finditer(text)}


def _snapshot_count(path: Path) -> int | None:
    text = path.read_text(encoding="utf-8")
    match = _SNAPSHOT_COUNT_PATTERN.search(text)
    if match is None:
        return None
    return int(match.group("count"))


def main() -> int:
    issues = audit_docs_inventory()
    if not issues:
        print("Validated documentation inventory coverage.")
        return 0
    for issue in issues:
        print(f"{issue.path}: {issue.message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
