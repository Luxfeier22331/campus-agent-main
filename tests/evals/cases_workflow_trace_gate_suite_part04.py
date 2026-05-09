# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.evals.workflow_trace_gate_suite_support import *


class WorkflowTraceGatePublicExportTestPart04(unittest.TestCase):
    def test_public_package_exports_workflow_trace_gate_types(self) -> None:
        import campus_evals

        self.assertIs(campus_evals.WorkflowTraceCase, WorkflowTraceCase)
        self.assertIs(campus_evals.WorkflowTraceExpectation, WorkflowTraceExpectation)
        self.assertTrue(callable(campus_evals.evaluate_workflow_trace_case))
        self.assertIsInstance(
            evaluate_workflow_trace_case(_workflow_case(), _trace_summary()).handoff_correctness,
            DimensionResult,
        )


if __name__ == "__main__":
    unittest.main()
