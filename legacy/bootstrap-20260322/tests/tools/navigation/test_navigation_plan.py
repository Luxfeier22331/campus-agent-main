from __future__ import annotations

import importlib
import json
from pathlib import Path
import unittest


FIXTURE_ROOT = Path(__file__).resolve().parents[2] / "fixtures" / "navigation"
REQUESTS_DIR = FIXTURE_ROOT / "requests"
RESPONSES_DIR = FIXTURE_ROOT / "responses"
SAMPLE_CASES = (
    "walking-student-center-north-campus",
    "accessible-library-east-main-campus",
)
FORBIDDEN_NAVIGATION_FIELDS = {
    "provider",
    "route",
    "polyline",
    "steps",
    "eta",
    "distance",
    "profile",
    "confirmed",
    "execution_payload",
}


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def import_navigation_symbols() -> tuple[object, object, object]:
    try:
        module = importlib.import_module("campus_agent.tools.navigation")
    except ModuleNotFoundError as exc:
        raise AssertionError(
            "campus_agent.tools.navigation is not implemented yet"
        ) from exc

    required_names = (
        "ALLOWED_NAVIGATION_PLAN_FIELDS",
        "ALLOWED_NAVIGATION_PLAN_STATUSES",
        "FixtureBackedCampusNavigationPlanTool",
    )
    missing = [name for name in required_names if not hasattr(module, name)]
    if missing:
        raise AssertionError(
            f"campus_agent.tools.navigation missing symbols: {missing}"
        )
    return tuple(getattr(module, name) for name in required_names)


def build_tool() -> object:
    _, _, tool_class = import_navigation_symbols()
    return tool_class()


class CampusNavigationPlanToolTest(unittest.TestCase):
    def test_plan_returns_confirmation_safe_preparation_for_resolved_target(self) -> None:
        response = build_tool().plan(
            load_json(REQUESTS_DIR / "walking-student-center-north-campus.json")
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["tool_name"], "campus_navigation_plan")
        self.assertEqual(response["contract_version"], "v1")
        self.assertEqual(response["data"]["status"], "prepared")
        self.assertTrue(response["data"]["requires_confirmation"])
        self.assertEqual(response["data"]["navigation_plan"]["navigation_mode"], "walking")
        self.assertEqual(
            response["data"]["navigation_plan"]["target"]["poi_id"],
            "north-campus-student-center",
        )

    def test_plan_preserves_mode_but_avoids_provider_specific_execution_shape(self) -> None:
        response = build_tool().plan(
            load_json(REQUESTS_DIR / "accessible-library-east-main-campus.json")
        )

        navigation_plan = response["data"]["navigation_plan"]
        self.assertEqual(navigation_plan["navigation_mode"], "accessible")
        self.assertEqual(
            set(navigation_plan.keys()).intersection(FORBIDDEN_NAVIGATION_FIELDS),
            set(),
        )
        self.assertTrue(response["data"]["requires_confirmation"])

    def test_navigation_samples_remain_stable(self) -> None:
        tool = build_tool()

        for case_name in SAMPLE_CASES:
            with self.subTest(case=case_name):
                request_payload = load_json(REQUESTS_DIR / f"{case_name}.json")
                expected_response = load_json(RESPONSES_DIR / f"{case_name}.json")
                actual_response = tool.plan(request_payload)
                self.assertEqual(actual_response, expected_response)

    def test_sample_responses_only_expose_minimal_confirmation_safe_fields(self) -> None:
        allowed_navigation_plan_fields, allowed_statuses, _ = import_navigation_symbols()

        for case_name in SAMPLE_CASES:
            response = load_json(RESPONSES_DIR / f"{case_name}.json")
            self.assertEqual(response["tool_name"], "campus_navigation_plan")
            self.assertEqual(response["contract_version"], "v1")
            self.assertTrue(response["ok"])
            self.assertIn(response["data"]["status"], allowed_statuses)
            self.assertTrue(response["data"]["requires_confirmation"])

            navigation_plan = response["data"]["navigation_plan"]
            self.assertEqual(
                set(navigation_plan.keys()).issubset(allowed_navigation_plan_fields),
                True,
            )
            self.assertEqual(
                set(navigation_plan.keys()).intersection(FORBIDDEN_NAVIGATION_FIELDS),
                set(),
            )
            self.assertIn("summary", navigation_plan)
            self.assertIn("target", navigation_plan)
            self.assertEqual(
                set(navigation_plan["target"].keys()),
                {"campus_id", "poi_id", "label", "coordinate"},
            )
            self.assertEqual(
                set(navigation_plan["target"]["coordinate"].keys()),
                {"lat", "lng"},
            )


if __name__ == "__main__":
    unittest.main()
