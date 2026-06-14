from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


class PublicDocsTruthDocsTest(unittest.TestCase):
    def test_active_document_site_truth_no_longer_depends_on_workstream_archive(self) -> None:
        planning_files = tuple(
            (REPO_ROOT / ".planning" / filename).read_text(encoding="utf-8")
            for filename in ("PROJECT.md", "WORKSTREAMS.md")
        )

        self.assertFalse((REPO_ROOT / ".planning" / "workstreams").exists())
        for text in planning_files:
            self.assertNotIn("public-docs-web", text)
            self.assertNotIn("public-docs-rspress", text)
            self.assertNotIn("当前 `public-docs` app 还不存在", text)
            self.assertNotIn("当前 docs site 还不存在", text)

    def test_repo_current_truth_uses_campus_web_docs_surface(self) -> None:
        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        project = (REPO_ROOT / ".planning" / "PROJECT.md").read_text(encoding="utf-8")
        workstreams = (REPO_ROOT / ".planning" / "WORKSTREAMS.md").read_text(encoding="utf-8")
        current_architecture = (
            REPO_ROOT / "docs" / "architecture" / "current-architecture.md"
        ).read_text(encoding="utf-8")
        product_runtime = (
            REPO_ROOT / "docs" / "architecture" / "system" / "product-runtime-architecture.md"
        ).read_text(encoding="utf-8")

        self.assertNotIn("apps/public-docs", readme)
        self.assertIn("campus-web /docs/*", readme)
        self.assertIn("campus-web /docs/*", project)
        self.assertIn("campus-web", workstreams)
        self.assertNotIn("document-site-and-canonical-reader", workstreams)
        self.assertNotIn("browser -> public-docs", current_architecture)
        self.assertNotIn("apps/public-docs", current_architecture)
        self.assertIn("browser -> campus-web /docs/*", current_architecture)
        self.assertNotIn("retired/reference package", product_runtime)
        self.assertNotIn("during deletion window", product_runtime)
        self.assertIn("campus-web /docs/*", product_runtime)

    def test_campus_web_docs_copy_does_not_present_local_object_store_paths_as_product_truth(
        self,
    ) -> None:
        docs_root = REPO_ROOT / "apps" / "campus-web" / "docs"
        checked_in_docs = tuple(
            path.read_text(encoding="utf-8")
            for path in sorted(docs_root.rglob("*"))
            if path.suffix in {".md", ".mdx"}
        )

        self.assertNotEqual(checked_in_docs, ())

        for text in checked_in_docs:
            self.assertNotIn("campus-rag-derived", text)
            self.assertNotIn("canonical.md", text)
            self.assertNotIn("document-units.jsonl", text)


if __name__ == "__main__":
    unittest.main()
