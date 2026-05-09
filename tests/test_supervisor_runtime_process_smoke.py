from __future__ import annotations

import importlib
import unittest

from tests.test_supervisor_runtime_process_smoke_support import *  # noqa: F403

"""Split into focused modules next to test_supervisor_runtime_process_smoke.py."""

CASE_MODULES = (
    "tests.cases_test_supervisor_runtime_process_smoke_part01",
    "tests.cases_test_supervisor_runtime_process_smoke_part02",
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
