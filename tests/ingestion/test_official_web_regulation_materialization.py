from __future__ import annotations

import importlib
import unittest

from tests.ingestion.test_official_web_regulation_materialization_support import *

"""Split into focused modules next to test_official_web_regulation_materialization.py."""

CASE_MODULES = (
    "tests.ingestion.cases_test_official_web_regulation_materialization_part01",
    "tests.ingestion.cases_test_official_web_regulation_materialization_part02",
    "tests.ingestion.cases_test_official_web_regulation_materialization_part03",
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
