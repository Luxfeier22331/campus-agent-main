from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_docs_inventory_tracked import (
    DocsInventoryIssue,
    audit_docs_inventory,
)


def _write_doc(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        "doc_type: index\n"
        "truth_scope: repository\n"
        "owner_boundary: docs\n"
        "status: active\n"
        "created: 2026-06-14\n"
        "updated: 2026-06-14\n"
        "---\n"
        "# Docs\n",
        encoding="utf-8",
    )


def _write_inventory(path: Path, *, current: int, tracked: int, untracked: int = 0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        "doc_type: reference\n"
        "truth_scope: repository\n"
        "owner_boundary: docs\n"
        "status: active\n"
        "created: 2026-06-14\n"
        "updated: 2026-06-14\n"
        "---\n"
        "# Documentation Inventory\n\n"
        "## Snapshot\n\n"
        f"- Current-worktree docs Markdown files: {current}\n"
        f"- Git tracked docs Markdown files: {tracked}\n"
        f"- Untracked docs Markdown files included: {untracked}\n\n"
        "## Governance Rules\n\n"
        "- Keep docs owner-clean.\n\n"
        "## Cleanup Hotspots\n\n"
        "- Archive material must keep earning its branch-tip body.\n",
        encoding="utf-8",
    )


class CheckDocsInventoryTrackedTest(unittest.TestCase):
    def test_inventory_accepts_compact_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            _write_doc(root / "docs" / "README.md")
            _write_inventory(
                root / "docs" / "reference" / "documentation-inventory.md",
                current=2,
                tracked=2,
            )

            self.assertEqual(audit_docs_inventory(root=root), ())

    def test_inventory_reports_snapshot_count_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            _write_doc(root / "docs" / "README.md")
            _write_inventory(
                root / "docs" / "reference" / "documentation-inventory.md",
                current=3,
                tracked=2,
            )

            self.assertEqual(
                audit_docs_inventory(root=root),
                (
                    DocsInventoryIssue(
                        path="docs/reference/documentation-inventory.md",
                        message="snapshot docs file count 3 does not match current count 2",
                    ),
                ),
            )

    def test_inventory_reports_tracked_count_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            _write_doc(root / "docs" / "README.md")
            _write_inventory(
                root / "docs" / "reference" / "documentation-inventory.md",
                current=2,
                tracked=3,
            )

            self.assertEqual(
                audit_docs_inventory(root=root),
                (
                    DocsInventoryIssue(
                        path="docs/reference/documentation-inventory.md",
                        message="tracked docs file count 3 does not match current count 2",
                    ),
                ),
            )

    def test_inventory_rejects_untracked_docs_count(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            _write_doc(root / "docs" / "README.md")
            _write_inventory(
                root / "docs" / "reference" / "documentation-inventory.md",
                current=2,
                tracked=2,
                untracked=1,
            )

            self.assertEqual(
                audit_docs_inventory(root=root),
                (
                    DocsInventoryIssue(
                        path="docs/reference/documentation-inventory.md",
                        message="untracked docs file count must be 0, found 1",
                    ),
                ),
            )

    def test_inventory_requires_governance_sections(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            _write_doc(root / "docs" / "README.md")
            inventory = root / "docs" / "reference" / "documentation-inventory.md"
            inventory.parent.mkdir(parents=True)
            inventory.write_text(
                "---\n"
                "doc_type: reference\n"
                "truth_scope: repository\n"
                "owner_boundary: docs\n"
                "status: active\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Documentation Inventory\n\n"
                "## Snapshot\n\n"
                "- Current-worktree docs Markdown files: 2\n"
                "- Git tracked docs Markdown files: 2\n"
                "- Untracked docs Markdown files included: 0\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_inventory(root=root),
                (
                    DocsInventoryIssue(
                        path="docs/reference/documentation-inventory.md",
                        message=(
                            "missing required documentation inventory section: ## Governance Rules"
                        ),
                    ),
                    DocsInventoryIssue(
                        path="docs/reference/documentation-inventory.md",
                        message=(
                            "missing required documentation inventory section: ## Cleanup Hotspots"
                        ),
                    ),
                ),
            )


if __name__ == "__main__":
    unittest.main()
