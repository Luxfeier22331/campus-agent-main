from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.check_docs_frontmatter_tracked import docs_markdown_files

_INVENTORY_PATH = "docs/reference/documentation-inventory.md"
_SNAPSHOT_COUNT_PATTERN = re.compile(
    r"^- Current-worktree docs Markdown files: (?P<count>\d+)$", re.M
)
_TRACKED_COUNT_PATTERN = re.compile(r"^- Git tracked docs Markdown files: (?P<count>\d+)$", re.M)
_UNTRACKED_COUNT_PATTERN = re.compile(
    r"^- Untracked docs Markdown files included: (?P<count>\d+)$", re.M
)
_REQUIRED_SECTIONS = (
    "## Snapshot",
    "## Governance Rules",
    "## Cleanup Hotspots",
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
    issues: list[DocsInventoryIssue] = []
    text = inventory.read_text(encoding="utf-8")

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

    tracked_count = _tracked_count(inventory)
    if tracked_count is not None and tracked_count != len(current_paths):
        issues.append(
            DocsInventoryIssue(
                path=_INVENTORY_PATH,
                message=(
                    f"tracked docs file count {tracked_count} does not match "
                    f"current count {len(current_paths)}"
                ),
            )
        )

    untracked_count = _untracked_count(inventory)
    if untracked_count is not None and untracked_count != 0:
        issues.append(
            DocsInventoryIssue(
                path=_INVENTORY_PATH,
                message=f"untracked docs file count must be 0, found {untracked_count}",
            )
        )

    for section in _REQUIRED_SECTIONS:
        if section not in text:
            issues.append(
                DocsInventoryIssue(
                    path=_INVENTORY_PATH,
                    message=f"missing required documentation inventory section: {section}",
                )
            )
    return tuple(issues)


def _snapshot_count(path: Path) -> int | None:
    text = path.read_text(encoding="utf-8")
    match = _SNAPSHOT_COUNT_PATTERN.search(text)
    if match is None:
        return None
    return int(match.group("count"))


def _tracked_count(path: Path) -> int | None:
    text = path.read_text(encoding="utf-8")
    match = _TRACKED_COUNT_PATTERN.search(text)
    if match is None:
        return None
    return int(match.group("count"))


def _untracked_count(path: Path) -> int | None:
    text = path.read_text(encoding="utf-8")
    match = _UNTRACKED_COUNT_PATTERN.search(text)
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
