from __future__ import annotations

import json
import unittest
from pathlib import Path


class PublicDocsAppInventoryTest(unittest.TestCase):
    def test_public_docs_app_is_promoted_to_formal_surface(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        promoted_app = repo_root / "apps" / "public-docs"
        legacy_rspress_app = repo_root / "apps" / "public-docs-rspress"
        legacy_fumadocs_app = repo_root / "apps" / "public-docs-web"

        self.assertTrue(promoted_app.is_dir())
        self.assertFalse(legacy_rspress_app.exists())
        self.assertFalse(legacy_fumadocs_app.exists())

        package_json = json.loads((promoted_app / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package_json["name"], "public-docs")

        root_package = json.loads((repo_root / "package.json").read_text(encoding="utf-8"))
        scripts = root_package["scripts"]
        self.assertEqual(scripts["web:dev:docs"], "turbo run dev --filter=public-docs")
        self.assertNotIn("web:dev:docs:rspress", scripts)


if __name__ == "__main__":
    unittest.main()
