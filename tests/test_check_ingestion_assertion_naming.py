from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.check_ingestion_assertion_naming import audit_ingestion_assertion_naming


class CheckIngestionAssertionNamingTest(unittest.TestCase):
    def test_audit_reports_forbidden_terms_in_path_and_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            content_path = root / "apps/ingestion-control/src/runtime.ts"
            content_path.parent.mkdir(parents=True, exist_ok=True)
            forbidden_term = "fix" + "ture"
            forbidden_path_text = (
                f"packages/ingestion-contracts/src/{forbidden_term}-catalog/example.json"
            )
            content_path.write_text(f"const value = '{forbidden_term}';\n", encoding="utf-8")
            forbidden_path = root / forbidden_path_text
            forbidden_path.parent.mkdir(parents=True, exist_ok=True)
            forbidden_path.write_text("{}\n", encoding="utf-8")

            with mock.patch(
                "scripts.check_ingestion_assertion_naming.tracked_ingestion_paths",
                return_value=(
                    "apps/ingestion-control/src/runtime.ts",
                    forbidden_path_text,
                ),
            ):
                findings = audit_ingestion_assertion_naming(root=root)

        self.assertEqual(
            findings,
            (
                "apps/ingestion-control/src/runtime.ts:1: "
                "contains forbidden ingestion assertion term",
                f"{forbidden_path_text}: path contains forbidden ingestion assertion term",
            ),
        )

    def test_allows_fixture_terms_in_tests_and_fixture_roots(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            forbidden_term = "fix" + "ture"
            test_path_text = (
                f"apps/source-collector/adapters/official-web/test/core/config-{forbidden_term}s.ts"
            )
            fixture_path_text = f"packages/ingestion-contracts/{forbidden_term}s/example.json"
            for path_text in (test_path_text, fixture_path_text):
                path = root / path_text
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(f"const value = '{forbidden_term}';\n", encoding="utf-8")

            with mock.patch(
                "scripts.check_ingestion_assertion_naming.tracked_ingestion_paths",
                return_value=(test_path_text, fixture_path_text),
            ):
                findings = audit_ingestion_assertion_naming(root=root)

        self.assertEqual(findings, ())

    def test_repo_inventory_has_no_ingestion_fixture_terms(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(audit_ingestion_assertion_naming(root=repo_root), ())


if __name__ == "__main__":
    unittest.main()
