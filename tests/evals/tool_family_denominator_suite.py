from __future__ import annotations

import unittest

from campus_evals.tool_family_denominator import (
    TOOL_FAMILY_DENOMINATOR_PATH,
    ToolObservation,
    evaluate_tool_family_denominator,
    load_tool_family_denominator,
    tool_spec_tool_names,
)


class ToolFamilyDenominatorTest(unittest.TestCase):
    def test_fixture_covers_opened_campus_service_and_notice_tools(self) -> None:
        fixture = load_tool_family_denominator()

        self.assertTrue(TOOL_FAMILY_DENOMINATOR_PATH.exists())
        self.assertEqual(fixture.schema_version, 1)
        tools = {tool.tool_name for tool in fixture.tools}
        self.assertTrue(
            {
                "service_status_lookup",
                "transport_schedule_lookup",
                "service_guide_lookup",
                "contact_directory_lookup",
                "campus_notice_discover",
                "campus_notice_get",
                "retrieval.query",
            }.issubset(tools)
        )
        for tool in fixture.tools:
            self.assertTrue(
                {"smoke", "release_gate", "regression_locked", "exploratory"}.issubset(
                    set(tool.denominator_splits)
                )
            )

    def test_fixture_tool_names_match_tool_spec_registry(self) -> None:
        fixture = load_tool_family_denominator()

        self.assertEqual(
            tuple(tool.tool_name for tool in fixture.tools),
            tool_spec_tool_names(),
        )

    def test_priority_tools_have_cases_for_each_required_split(self) -> None:
        fixture = load_tool_family_denominator()
        required_splits = {"smoke", "release_gate", "regression_locked", "exploratory"}
        priority_tools = {
            "service_status_lookup",
            "transport_schedule_lookup",
            "service_guide_lookup",
            "contact_directory_lookup",
            "campus_notice_discover",
            "campus_notice_get",
            "retrieval.query",
        }

        splits_by_tool = {
            tool_name: {case.split for case in fixture.cases if case.tool_name == tool_name}
            for tool_name in priority_tools
        }

        for tool_name, splits in splits_by_tool.items():
            self.assertTrue(
                required_splits.issubset(splits),
                f"{tool_name} missing splits: {sorted(required_splits - splits)}",
            )

    def test_evaluate_tool_family_denominator_distinguishes_failure_classes(self) -> None:
        fixture = load_tool_family_denominator()
        observations = {
            case.case_id: ToolObservation(
                case_id=case.case_id,
                selected_tool=case.tool_name,
                result_status=case.expected_result_status,
                argument_summary=dict(case.expected_arguments),
            )
            for case in fixture.cases
        }
        first_case = fixture.cases[0]
        observations[first_case.case_id] = ToolObservation(
            case_id=first_case.case_id,
            selected_tool="wrong_tool",
            result_status=first_case.expected_result_status,
            argument_summary=dict(first_case.expected_arguments),
        )
        second_case = fixture.cases[1]
        observations[second_case.case_id] = ToolObservation(
            case_id=second_case.case_id,
            selected_tool=second_case.tool_name,
            result_status="not_found",
            argument_summary={},
        )

        report = evaluate_tool_family_denominator(fixture, observations)

        self.assertFalse(report.passed)
        results = {result.case_id: result for result in report.results}
        self.assertEqual(results[first_case.case_id].failure_class, "routing_error")
        self.assertEqual(results[second_case.case_id].failure_class, "read_model_gap")

    def test_auth_fail_close_case_is_classified_separately(self) -> None:
        fixture = load_tool_family_denominator()
        auth_case = next(
            case for case in fixture.cases if case.expected_result_status == "authorization_denied"
        )

        report = evaluate_tool_family_denominator(
            fixture,
            {
                auth_case.case_id: ToolObservation(
                    case_id=auth_case.case_id,
                    selected_tool=auth_case.tool_name,
                    result_status="completed",
                    argument_summary=dict(auth_case.expected_arguments),
                )
            },
        )

        result = next(item for item in report.results if item.case_id == auth_case.case_id)
        self.assertFalse(result.passed)
        self.assertEqual(result.failure_class, "authorization_fail_close")


if __name__ == "__main__":
    unittest.main()
