from __future__ import annotations

import unittest

from campus_evals.provider_tool_call_cases import load_provider_tool_call_cases
from campus_evals.tool_family_denominator import tool_spec_tool_names


class ProviderToolCallCasesTest(unittest.TestCase):
    def test_fixture_covers_required_provider_tool_call_outcomes(self) -> None:
        fixture = load_provider_tool_call_cases()

        self.assertEqual(fixture.schema_version, 1)
        self.assertEqual(
            {case.expected_outcome for case in fixture.cases},
            {
                "function_call_selected",
                "no_function_call",
                "wrong_tool_call",
                "invalid_arguments",
                "tool_result_projected",
            },
        )

    def test_fixture_tool_names_match_tool_spec_registry(self) -> None:
        fixture = load_provider_tool_call_cases()
        tool_names = set(tool_spec_tool_names())

        for case in fixture.cases:
            self.assertIn(case.allowed_tools[0], tool_names)
            if case.expected_tool:
                self.assertIn(case.expected_tool, tool_names)


if __name__ == "__main__":
    unittest.main()
