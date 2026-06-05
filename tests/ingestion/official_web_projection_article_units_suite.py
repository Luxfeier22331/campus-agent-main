from __future__ import annotations

import importlib
import unittest

"""Loads focused official web article unit projection case modules."""

CASE_MODULES = (
    "tests.ingestion.cases_official_web_projection_article_units_suite_part01",
    "tests.ingestion.cases_official_web_projection_article_units_suite_part02",
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
