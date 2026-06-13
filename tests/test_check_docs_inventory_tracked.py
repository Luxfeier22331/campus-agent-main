from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_docs_inventory_tracked import (
    DocsInventoryIssue,
    audit_docs_inventory,
)


class CheckDocsInventoryTrackedTest(unittest.TestCase):
    def test_inventory_reports_missing_current_docs_entry(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            doc = root / "docs" / "architecture" / "target-architecture.md"
            inventory = root / "docs" / "reference" / "documentation-inventory.md"
            doc.parent.mkdir(parents=True)
            inventory.parent.mkdir(parents=True)
            doc.write_text(
                "---\n"
                "doc_type: architecture\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/architecture\n"
                "status: active\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Target\n",
                encoding="utf-8",
            )
            inventory.write_text(
                "---\n"
                "doc_type: reference\n"
                "truth_scope: repository\n"
                "owner_boundary: docs\n"
                "status: active\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Documentation Inventory\n",
                encoding="utf-8",
            )
            inventory.write_text(
                inventory.read_text(encoding="utf-8")
                + "\n- `docs/reference/documentation-inventory.md`\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_inventory(root=root),
                (
                    DocsInventoryIssue(
                        path="docs/architecture/target-architecture.md",
                        message="current docs file missing from documentation inventory",
                    ),
                ),
            )

    def test_inventory_reports_stale_deleted_docs_entry(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
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
                "- `docs/reference/documentation-inventory.md`\n"
                "- `docs/old.md`\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_inventory(root=root),
                (
                    DocsInventoryIssue(
                        path="docs/old.md",
                        message="documentation inventory references missing docs file",
                    ),
                ),
            )

    def test_inventory_accepts_current_docs_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            doc = root / "docs" / "README.md"
            inventory = root / "docs" / "reference" / "documentation-inventory.md"
            inventory.parent.mkdir(parents=True)
            doc.write_text(
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
                "- `docs/README.md`\n"
                "- `docs/reference/documentation-inventory.md`\n",
                encoding="utf-8",
            )

            self.assertEqual(audit_docs_inventory(root=root), ())

    def test_inventory_reports_snapshot_count_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            doc = root / "docs" / "README.md"
            inventory = root / "docs" / "reference" / "documentation-inventory.md"
            inventory.parent.mkdir(parents=True)
            doc.write_text(
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
                "- Current-worktree docs Markdown files: 3\n"
                "- `docs/README.md`\n"
                "- `docs/reference/documentation-inventory.md`\n",
                encoding="utf-8",
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


if __name__ == "__main__":
    unittest.main()
