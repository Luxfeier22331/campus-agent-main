from __future__ import annotations

import importlib
import unittest

from tests.evals.workflow_trace_gate_suite_support import *

"""Split into focused modules next to workflow_trace_gate_suite.py."""

CASE_MODULES = (
    "tests.evals.cases_workflow_trace_gate_suite_part01",
    "tests.evals.cases_workflow_trace_gate_suite_part02",
    "tests.evals.cases_workflow_trace_gate_suite_part03",
    "tests.evals.cases_workflow_trace_gate_suite_part04",
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
