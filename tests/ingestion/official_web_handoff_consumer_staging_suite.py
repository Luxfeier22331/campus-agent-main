from __future__ import annotations

import importlib
import unittest

from tests.ingestion.official_web_handoff_consumer_staging_suite_support import *

"""Split into focused modules next to official_web_handoff_consumer_staging_suite.py."""

CASE_MODULES = (
    "tests.ingestion.cases_official_web_handoff_consumer_staging_suite_part01",
    "tests.ingestion.cases_official_web_handoff_consumer_staging_suite_part02",
    "tests.ingestion.cases_official_web_handoff_consumer_staging_suite_part03",
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
