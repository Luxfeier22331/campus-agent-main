from __future__ import annotations

import importlib
import unittest

from tests.evals.multi_agent_product_path_eval_gate_profile_suite_support import *

"""Split into focused modules next to multi_agent_product_path_eval_gate_profile_suite.py."""

CASE_MODULES = ("tests.evals.cases_multi_agent_product_path_eval_gate_profile_suite_part01",)


def load_tests(
    loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None
) -> unittest.TestSuite:
    suite = unittest.TestSuite()
    for module_name in CASE_MODULES:
        suite.addTests(loader.loadTestsFromModule(importlib.import_module(module_name)))
    return suite


if __name__ == "__main__":
    unittest.main()
