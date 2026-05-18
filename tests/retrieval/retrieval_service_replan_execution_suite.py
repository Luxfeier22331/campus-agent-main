from __future__ import annotations

import importlib
import unittest

from tests.retrieval.retrieval_service_replan_execution_suite_support import *

"""Split into focused modules next to retrieval_service_replan_execution_suite.py."""

CASE_MODULES = (
    "tests.retrieval.cases_retrieval_service_replan_execution_suite_part01",
    "tests.retrieval.cases_retrieval_service_replan_execution_suite_part02",
    "tests.retrieval.cases_retrieval_service_replan_execution_suite_part03",
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
