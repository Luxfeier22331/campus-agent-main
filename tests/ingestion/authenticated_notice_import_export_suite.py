from __future__ import annotations

import importlib
import unittest

"""Loads focused authenticated notice import/export case modules."""

CASE_MODULES = (
    "tests.ingestion.cases_authenticated_notice_import_export_suite_part01",
    "tests.ingestion.cases_authenticated_notice_import_export_suite_part02",
    "tests.ingestion.cases_authenticated_notice_import_export_suite_part03",
    "tests.ingestion.cases_authenticated_notice_import_export_suite_part04",
)


def load_tests(
    loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None
) -> unittest.TestSuite:
    suite = unittest.TestSuite()
    for module_name in CASE_MODULES:
        suite.addTests(loader.loadTestsFromModule(importlib.import_module(module_name)))
    return suite


if __name__ == "__main__":
    unittest.main()
