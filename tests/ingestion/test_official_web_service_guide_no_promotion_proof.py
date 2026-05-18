from __future__ import annotations

import importlib
import unittest

from tests.ingestion.test_official_web_service_guide_no_promotion_proof_support import *

"""Split into focused modules next to test_official_web_service_guide_no_promotion_proof.py."""

CASE_MODULES = (
    "tests.ingestion.cases_test_official_web_service_guide_no_promotion_proof_part01",
    "tests.ingestion.cases_test_official_web_service_guide_no_promotion_proof_part02",
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
