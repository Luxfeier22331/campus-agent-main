from __future__ import annotations

import importlib
import unittest

from tests.agent.test_campus_services_agent_support import *

"""Split into focused modules next to test_campus_services_agent.py."""

CASE_MODULES = (
    "tests.agent.cases_test_campus_services_agent_part01",
    "tests.agent.cases_test_campus_services_agent_part02",
    "tests.agent.cases_test_campus_services_agent_part03",
    "tests.agent.cases_test_campus_services_agent_part04",
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
