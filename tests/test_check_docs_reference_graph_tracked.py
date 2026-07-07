from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_docs_reference_graph_tracked import (
    DocsReferenceGraphIssue,
    audit_docs_reference_graph,
)


class CheckDocsReferenceGraphTrackedTest(unittest.TestCase):
    def test_active_doc_rejects_historical_reference_without_context(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            active = root / "docs" / "architecture" / "current.md"
            historical = root / "docs" / "reference" / "old-contract.md"
            active.parent.mkdir(parents=True)
            historical.parent.mkdir(parents=True)
            active.write_text(
                "---\n"
                "doc_type: architecture\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/architecture\n"
                "status: active\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Current\n\n"
                "Current contract: `docs/reference/old-contract.md`.\n",
                encoding="utf-8",
            )
            historical.write_text(
                "---\n"
                "doc_type: reference\n"
                "truth_scope: data\n"
                "owner_boundary: docs/reference\n"
                "status: historical\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Old Contract\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_reference_graph(root=root),
                (
                    DocsReferenceGraphIssue(
                        path="docs/architecture/current.md",
                        target="docs/reference/old-contract.md",
                        message="active document references historical document without historical context",
                    ),
                ),
            )

    def test_active_doc_rejects_missing_markdown_reference(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            active = root / "docs" / "architecture" / "current.md"
            active.parent.mkdir(parents=True)
            active.write_text(
                "---\n"
                "doc_type: architecture\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/architecture\n"
                "status: active\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Current\n\n"
                "Current owner: `docs/architecture/system/missing-owner.md`.\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_reference_graph(root=root),
                (
                    DocsReferenceGraphIssue(
                        path="docs/architecture/current.md",
                        target="docs/architecture/system/missing-owner.md",
                        message="active document references missing markdown file",
                    ),
                ),
            )

    def test_active_doc_rejects_local_legacy_repo_absolute_markdown_path(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            active = root / "docs" / "reference" / "normalization.md"
            active.parent.mkdir(parents=True)
            active.write_text(
                "---\n"
                "doc_type: reference\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/reference\n"
                "status: active\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Normalization\n\n"
                "External legacy source: "
                "`/home/reptilian/code/campusRag/docs/rag/schema.md`.\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_reference_graph(root=root),
                (
                    DocsReferenceGraphIssue(
                        path="docs/reference/normalization.md",
                        target="/home/reptilian/code/campusRag/docs/rag/schema.md",
                        message="active document references local absolute repo path",
                    ),
                ),
            )

    def test_active_doc_rejects_split_from_mega_doc_process_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            active = root / "docs" / "contracts" / "app-api" / "operator.md"
            active.parent.mkdir(parents=True)
            active.write_text(
                "---\n"
                "doc_type: contract\n"
                "truth_scope: product\n"
                "owner_boundary: docs/contracts\n"
                "status: active\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Operator\n\n"
                "Split from the former mega-doc during documentation SoT cleanup.\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_reference_graph(root=root),
                (
                    DocsReferenceGraphIssue(
                        path="docs/contracts/app-api/operator.md",
                        target="Split from the former mega-doc",
                        message="active document contains documentation migration process marker",
                    ),
                ),
            )

    def test_active_doc_ignores_glob_and_placeholder_markdown_patterns(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            active = root / "docs" / "reference" / "verification-lanes.md"
            active.parent.mkdir(parents=True)
            active.write_text(
                "---\n"
                "doc_type: reference\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/reference\n"
                "status: active\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Verification Lanes\n\n"
                "- Glob: `docs/decisions/adr-*.md`.\n"
                "- Placeholder: `docs/docs/:corpus/:collection/*.md`.\n",
                encoding="utf-8",
            )

            self.assertEqual(audit_docs_reference_graph(root=root), ())

    def test_doc_rejects_split_markdown_path(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            doc = root / "docs" / "reference" / "index.md"
            target = root / "docs" / "reference" / "long-owner.md"
            doc.parent.mkdir(parents=True)
            doc.write_text(
                "---\n"
                "doc_type: reference\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/reference\n"
                "status: historical\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Index\n\n"
                "- `docs/reference/long-owner.m\n"
                "  d`\n",
                encoding="utf-8",
            )
            target.write_text(
                "---\n"
                "doc_type: reference\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/reference\n"
                "status: historical\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Long Owner\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_reference_graph(root=root),
                (
                    DocsReferenceGraphIssue(
                        path="docs/reference/index.md",
                        target="docs/reference/long-owner.md",
                        message="markdown path appears split across lines",
                    ),
                ),
            )

    def test_archive_readme_may_reference_historical_documents(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            index = root / "docs" / "reference" / "archive" / "README.md"
            historical = root / "docs" / "reference" / "archive" / "old.md"
            index.parent.mkdir(parents=True)
            index.write_text(
                "---\n"
                "doc_type: index\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/reference/archive\n"
                "status: active\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Archive\n\n"
                "- `old.md`\n",
                encoding="utf-8",
            )
            historical.write_text(
                "---\n"
                "doc_type: reference\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/reference/archive\n"
                "status: historical\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Old\n",
                encoding="utf-8",
            )

            self.assertEqual(audit_docs_reference_graph(root=root), ())

    def test_active_doc_allows_superseded_adr_with_historical_context(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            active = root / "docs" / "architecture" / "target.md"
            superseded = root / "docs" / "decisions" / "adr-0001-old.md"
            active.parent.mkdir(parents=True)
            superseded.parent.mkdir(parents=True)
            active.write_text(
                "---\n"
                "doc_type: architecture\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/architecture\n"
                "status: active\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Target\n\n"
                "Historical background only: `../decisions/adr-0001-old.md`.\n",
                encoding="utf-8",
            )
            superseded.write_text(
                "---\n"
                "doc_type: decision\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/decisions\n"
                "status: superseded\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Old ADR\n",
                encoding="utf-8",
            )

            self.assertEqual(audit_docs_reference_graph(root=root), ())

    def test_sot_entry_rejects_known_compatibility_path(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            agents = root / "AGENTS.md"
            agents.write_text(
                "# AGENTS\n\n"
                "## Source Of Truth\n\n"
                "- `docs/architecture/system/execution-and-agents-architecture.md`\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_reference_graph(root=root),
                (
                    DocsReferenceGraphIssue(
                        path="AGENTS.md",
                        target="docs/architecture/system/execution-and-agents-architecture.md",
                        message="active document references retired compatibility path",
                    ),
                ),
            )

    def test_accepted_adr_rejects_known_compatibility_path(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            adr = root / "docs" / "decisions" / "adr-0001-current.md"
            adr.parent.mkdir(parents=True)
            adr.write_text(
                "---\n"
                "doc_type: decision\n"
                "truth_scope: repository\n"
                "owner_boundary: docs/decisions\n"
                "status: accepted\n"
                "created: 2026-06-14\n"
                "updated: 2026-06-14\n"
                "---\n"
                "# Current ADR\n\n"
                "Current owner: `../architecture/system/execution-and-agents-architecture.md`.\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_docs_reference_graph(root=root),
                (
                    DocsReferenceGraphIssue(
                        path="docs/decisions/adr-0001-current.md",
                        target="docs/architecture/system/execution-and-agents-architecture.md",
                        message="active document references retired compatibility path",
                    ),
                ),
            )


if __name__ == "__main__":
    unittest.main()
