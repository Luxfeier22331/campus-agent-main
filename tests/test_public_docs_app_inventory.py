from __future__ import annotations

import unittest
from pathlib import Path


class PublicDocsAppInventoryTest(unittest.TestCase):
    def test_public_docs_app_is_removed_after_campus_web_docs_cutover(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        retired_app = repo_root / "apps" / "public-docs"
        legacy_rspress_app = repo_root / "apps" / "public-docs-rspress"
        legacy_fumadocs_app = repo_root / "apps" / "public-docs-web"
        campus_web_app = repo_root / "apps" / "campus-web"

        self.assertFalse(retired_app.exists())
        self.assertFalse(legacy_rspress_app.exists())
        self.assertFalse(legacy_fumadocs_app.exists())
        self.assertTrue(campus_web_app.is_dir())
        self.assertTrue((campus_web_app / "rspress.config.ts").is_file())
        self.assertTrue((campus_web_app / "scripts" / "sync-campus-published-reader.mjs").is_file())

    def test_root_scripts_do_not_reference_retired_public_docs_package(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        package_json = (repo_root / "package.json").read_text(encoding="utf-8")

        self.assertIn("turbo run dev --filter=campus-web", package_json)
        self.assertNotIn("public-docs:lint", package_json)
        self.assertNotIn("--filter=public-docs", package_json)


if __name__ == "__main__":
    unittest.main()
