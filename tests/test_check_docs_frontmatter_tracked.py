from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_docs_frontmatter_tracked import (
    DocsFrontmatterIssue,
    audit_docs_frontmatter,
    docs_markdown_files,
)


class CheckDocsFrontmatterTrackedTest(unittest.TestCase):
    def test_docs_markdown_files_include_all_docs_and_skip_non_docs(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            architecture_doc = root / "docs" / "architecture" / "target.md"
            architecture_doc.parent.mkdir(parents=True)
            architecture_doc.write_text(
                "---\ndoc_type: architecture\n---\n# Target\n", encoding="utf-8"
            )
            archive_doc = root / "docs" / "reference" / "archive" / "sample.md"
            archive_doc.parent.mkdir(parents=True)
            archive_doc.write_text("---\ndoc_type: reference\n---\n# Sample\n", encoding="utf-8")
            package_doc = root / "packages" / "sample" / "README.md"
            package_doc.parent.mkdir(parents=True)
            package_doc.write_text("# Package\n", encoding="utf-8")

            self.assertEqual(docs_markdown_files(root=root), (architecture_doc, archive_doc))

    def test_audit_reports_missing_required_docs_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            doc = root / "docs" / "contracts" / "tool-execution.md"
            doc.parent.mkdir(parents=True)
            doc.write_text(
                "---\n"
                "doc_type: contract\n"
                "status: active\n"
                "created: 2026-06-13\n"
                "updated: 2026-06-13\n"
                "---\n"
                "# Tool Execution\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_frontmatter(root=root),
                (
                    DocsFrontmatterIssue(
                        path="docs/contracts/tool-execution.md",
                        message="missing required frontmatter field: truth_scope",
                    ),
                    DocsFrontmatterIssue(
                        path="docs/contracts/tool-execution.md",
                        message="missing required frontmatter field: owner_boundary",
                    ),
                ),
            )

    def test_audit_rejects_active_non_readme_archive_documents(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            doc = root / "docs" / "runbooks" / "archive" / "old-runbook.md"
            doc.parent.mkdir(parents=True)
            doc.write_text(
                "---\n"
                "doc_type: runbook\n"
                "truth_scope: ops\n"
                "owner_boundary: docs/runbooks/archive\n"
                "status: active\n"
                "created: 2026-06-13\n"
                "updated: 2026-06-13\n"
                "---\n"
                "# Old Runbook\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_frontmatter(root=root),
                (
                    DocsFrontmatterIssue(
                        path="docs/runbooks/archive/old-runbook.md",
                        message="archive documents must be historical unless they are README.md indexes",
                    ),
                ),
            )

    def test_audit_accepts_complete_frontmatter_for_archive_indexes(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            doc = root / "docs" / "reference" / "archive" / "README.md"
            doc.parent.mkdir(parents=True)
            doc.write_text(
                "---\n"
                "doc_type: index\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/reference/archive\n"
                "status: active\n"
                "created: 2026-06-13\n"
                "updated: 2026-06-13\n"
                "---\n"
                "# Archive\n",
                encoding="utf-8",
            )

            self.assertEqual(audit_docs_frontmatter(root=root), ())


if __name__ == "__main__":
    unittest.main()
