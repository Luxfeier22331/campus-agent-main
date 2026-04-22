from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKSTREAM_ROOT = REPO_ROOT / ".planning" / "workstreams" / "document-site-and-canonical-reader"


class PublicDocsTruthDocsTest(unittest.TestCase):
    def test_active_document_site_workstream_uses_promoted_public_docs_truth(self) -> None:
        checked_files = tuple(sorted(WORKSTREAM_ROOT.rglob("*.md")))

        self.assertNotEqual(checked_files, ())

        for path in checked_files:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("public-docs-web", text, path)
            self.assertNotIn("public-docs-rspress", text, path)
            self.assertNotIn("当前 `public-docs` app 还不存在", text, path)
            self.assertNotIn("当前 docs site 还不存在", text, path)

    def test_repo_current_truth_promotes_public_docs_as_formal_surface(self) -> None:
        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        project = (REPO_ROOT / ".planning" / "PROJECT.md").read_text(encoding="utf-8")
        workstreams = (REPO_ROOT / ".planning" / "WORKSTREAMS.md").read_text(encoding="utf-8")
        current_architecture = (
            REPO_ROOT / "docs" / "architecture" / "current-architecture.md"
        ).read_text(encoding="utf-8")
        product_runtime = (
            REPO_ROOT
            / "docs"
            / "architecture"
            / "system"
            / "product-runtime-architecture.md"
        ).read_text(encoding="utf-8")

        self.assertIn("apps/public-docs", readme)
        self.assertIn("apps/public-docs", project)
        self.assertIn("document-site-and-canonical-reader", workstreams)
        self.assertIn("public-docs", workstreams)
        self.assertIn("browser -> public-docs", current_architecture)
        self.assertIn("apps/public-docs", current_architecture)
        self.assertIn("public-docs", product_runtime)

    def test_public_docs_copy_does_not_present_local_object_store_paths_as_product_truth(
        self,
    ) -> None:
        public_docs_readme = (REPO_ROOT / "apps" / "public-docs" / "README.md").read_text(
            encoding="utf-8"
        )
        handbook_index = (
            REPO_ROOT / "apps" / "public-docs" / "docs" / "student-handbook" / "index.md"
        ).read_text(encoding="utf-8")
        curriculum_index = (
            REPO_ROOT / "apps" / "public-docs" / "docs" / "curriculum-plan" / "index.md"
        ).read_text(encoding="utf-8")

        for text in (public_docs_readme, handbook_index, curriculum_index):
            self.assertNotIn("campus-rag-derived", text)
            self.assertNotIn("canonical.md", text)
            self.assertNotIn("document-units.jsonl", text)


if __name__ == "__main__":
    unittest.main()
