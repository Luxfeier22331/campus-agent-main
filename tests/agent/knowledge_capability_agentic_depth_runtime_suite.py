from __future__ import annotations

import importlib
import unittest

from tests.agent.knowledge_capability_agentic_depth_runtime_suite_support import *

"""Split into focused modules next to knowledge_capability_agentic_depth_runtime_suite.py."""

CASE_MODULES = (
    "tests.agent.cases_knowledge_capability_agentic_depth_runtime_suite_part01",
    "tests.agent.cases_knowledge_capability_agentic_depth_runtime_suite_part02",
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
