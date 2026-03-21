from __future__ import annotations

import importlib
import json
from pathlib import Path
import unittest


FIXTURE_ROOT = Path(__file__).resolve().parents[2] / "fixtures" / "map"
RECORDS_FIXTURE = FIXTURE_ROOT / "map_records.json"
REQUESTS_DIR = FIXTURE_ROOT / "requests"
RESPONSES_DIR = FIXTURE_ROOT / "responses"
SAMPLE_CASES = (
    "resolved-student-center-north-campus-scope",
    "campus-ambiguous-student-center",
    "poi-ambiguous-main-campus-library",
    "no-match-quantum-garden",
)
FORBIDDEN_RESPONSE_FIELDS = {
    "is_ambiguous",
    "ranking_score",
    "source",
    "provider",
    "route",
    "polyline",
    "steps",
    "eta",
    "distance",
    "profile",
    "requires_confirmation",
}
ALLOWED_COORDINATE_FIELDS = frozenset({"lat", "lng"})
ALLOWED_FIXTURE_CAMPUS_FIELDS = frozenset(
    {"campus_id", "campus_name", "label", "coordinate", "match_terms"}
)
ALLOWED_FIXTURE_POI_FIELDS = frozenset(
    {
        "poi_id",
        "poi_name",
        "label",
        "campus_id",
        "building",
        "floor",
        "room",
        "coordinate",
        "match_terms",
    }
)


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def import_map_symbols() -> tuple[object, object, object, object, object]:
    try:
        module = importlib.import_module("campus_agent.tools.map")
    except ModuleNotFoundError as exc:
        raise AssertionError("campus_agent.tools.map is not implemented yet") from exc

    required_names = (
        "ALLOWED_CAMPUS_CANDIDATE_FIELDS",
        "ALLOWED_COORDINATE_FIELDS",
        "ALLOWED_MAP_RESOLVE_STATUSES",
        "ALLOWED_POI_CANDIDATE_FIELDS",
        "FixtureBackedCampusMapResolveTool",
    )
    missing = [name for name in required_names if not hasattr(module, name)]
    if missing:
        raise AssertionError(f"campus_agent.tools.map missing symbols: {missing}")
    return tuple(getattr(module, name) for name in required_names)


def build_tool() -> object:
    _, _, _, _, tool_class = import_map_symbols()
    return tool_class(fixture_path=RECORDS_FIXTURE)


class CampusMapResolveToolTest(unittest.TestCase):
    def test_resolve_returns_resolved_result_when_scope_restricts_to_one_campus(self) -> None:
        response = build_tool().resolve(
            {"query": "student center", "campus_scope": "north-campus"}
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["tool_name"], "campus_map_resolve")
        self.assertEqual(response["contract_version"], "v1")
        self.assertEqual(response["data"]["status"], "resolved")
        self.assertEqual(response["data"]["selected_campus"]["campus_id"], "north-campus")
        self.assertEqual(
            response["data"]["selected_poi"]["poi_id"],
            "north-campus-student-center",
        )
        self.assertEqual(
            response["data"]["target_coordinate"],
            {"lat": 39.9125, "lng": 116.4215},
        )

    def test_resolve_returns_campus_ambiguity_when_query_matches_pois_on_multiple_campuses(
        self,
    ) -> None:
        response = build_tool().resolve({"query": "student center"})

        self.assertEqual(response["data"]["status"], "campus_ambiguous")
        self.assertEqual(len(response["data"]["campus_candidates"]), 2)
        self.assertEqual(
            [candidate["campus_id"] for candidate in response["data"]["campus_candidates"]],
            ["north-campus", "west-campus"],
        )
        self.assertEqual(response["data"]["poi_candidates"], [])
        self.assertNotIn("selected_campus", response["data"])

    def test_resolve_returns_poi_ambiguity_when_single_campus_has_multiple_poi_matches(
        self,
    ) -> None:
        response = build_tool().resolve({"query": "main campus library"})

        self.assertEqual(response["data"]["status"], "poi_ambiguous")
        self.assertEqual(response["data"]["selected_campus"]["campus_id"], "main-campus")
        self.assertEqual(len(response["data"]["poi_candidates"]), 2)
        self.assertEqual(
            {candidate["poi_id"] for candidate in response["data"]["poi_candidates"]},
            {
                "main-campus-library-east-entrance",
                "main-campus-library-west-entrance",
            },
        )
        self.assertNotIn("selected_poi", response["data"])
        self.assertNotIn("target_coordinate", response["data"])

    def test_resolve_returns_no_match_with_empty_candidate_arrays(self) -> None:
        response = build_tool().resolve({"query": "quantum garden"})

        self.assertEqual(response["data"]["status"], "no_match")
        self.assertEqual(response["data"]["campus_candidates"], [])
        self.assertEqual(response["data"]["poi_candidates"], [])
        self.assertNotIn("selected_campus", response["data"])
        self.assertNotIn("selected_poi", response["data"])
        self.assertNotIn("target_coordinate", response["data"])

    def test_fixture_records_and_sample_responses_comply_with_frozen_v1_schema(self) -> None:
        (
            allowed_campus_fields,
            allowed_coordinate_fields,
            allowed_statuses,
            allowed_poi_fields,
            _,
        ) = import_map_symbols()

        records_payload = load_json(RECORDS_FIXTURE)
        self.assertIn("campuses", records_payload)
        self.assertIn("pois", records_payload)

        for campus in records_payload["campuses"]:
            self.assertEqual(set(campus.keys()).issubset(ALLOWED_FIXTURE_CAMPUS_FIELDS), True)
            self._assert_coordinate_schema(campus["coordinate"], allowed_coordinate_fields)

        for poi in records_payload["pois"]:
            self.assertEqual(set(poi.keys()).issubset(ALLOWED_FIXTURE_POI_FIELDS), True)
            self._assert_coordinate_schema(poi["coordinate"], allowed_coordinate_fields)

        for case_name in SAMPLE_CASES:
            response = load_json(RESPONSES_DIR / f"{case_name}.json")
            self._assert_response_schema(
                response=response,
                allowed_statuses=allowed_statuses,
                allowed_campus_fields=allowed_campus_fields,
                allowed_poi_fields=allowed_poi_fields,
                allowed_coordinate_fields=allowed_coordinate_fields,
            )

    def test_request_response_samples_remain_stable(self) -> None:
        tool = build_tool()

        for case_name in SAMPLE_CASES:
            with self.subTest(case=case_name):
                request_payload = load_json(REQUESTS_DIR / f"{case_name}.json")
                expected_response = load_json(RESPONSES_DIR / f"{case_name}.json")
                actual_response = tool.resolve(request_payload)
                self.assertEqual(actual_response, expected_response)

    def _assert_response_schema(
        self,
        *,
        response: dict[str, object],
        allowed_statuses: tuple[str, ...],
        allowed_campus_fields: frozenset[str],
        allowed_poi_fields: frozenset[str],
        allowed_coordinate_fields: frozenset[str],
    ) -> None:
        self.assertTrue(response["ok"])
        self.assertEqual(response["tool_name"], "campus_map_resolve")
        self.assertEqual(response["contract_version"], "v1")
        self.assertIn("request_id", response)
        self.assertIn("trace_id", response)
        self.assertIn("data", response)

        data = response["data"]
        self.assertIn("status", data)
        self.assertIn(data["status"], allowed_statuses)
        self.assertIsInstance(data["campus_candidates"], list)
        self.assertIsInstance(data["poi_candidates"], list)
        self.assertEqual(set(data.keys()).intersection(FORBIDDEN_RESPONSE_FIELDS), set())

        for campus in data["campus_candidates"]:
            self._assert_campus_schema(campus, allowed_campus_fields, allowed_coordinate_fields)
        for poi in data["poi_candidates"]:
            self._assert_poi_schema(poi, allowed_poi_fields, allowed_coordinate_fields)

        status = data["status"]
        if status == "resolved":
            self.assertIn("selected_campus", data)
            self.assertIn("selected_poi", data)
            self.assertIn("target_coordinate", data)
            self._assert_campus_schema(
                data["selected_campus"], allowed_campus_fields, allowed_coordinate_fields
            )
            self._assert_poi_schema(
                data["selected_poi"], allowed_poi_fields, allowed_coordinate_fields
            )
            self._assert_coordinate_schema(
                data["target_coordinate"], allowed_coordinate_fields
            )
        if status == "campus_ambiguous":
            self.assertTrue(data["campus_candidates"])
            self.assertNotIn("selected_campus", data)
            self.assertNotIn("selected_poi", data)
            self.assertNotIn("target_coordinate", data)
        if status == "poi_ambiguous":
            self.assertIn("selected_campus", data)
            self.assertTrue(data["poi_candidates"])
            self.assertNotIn("selected_poi", data)
            self.assertNotIn("target_coordinate", data)
        if status == "no_match":
            self.assertNotIn("selected_campus", data)
            self.assertNotIn("selected_poi", data)
            self.assertNotIn("target_coordinate", data)

    def _assert_campus_schema(
        self,
        campus: dict[str, object],
        allowed_fields: frozenset[str],
        allowed_coordinate_fields: frozenset[str],
    ) -> None:
        self.assertEqual(
            {"campus_id", "campus_name", "label"}.issubset(campus.keys()),
            True,
        )
        self.assertEqual(set(campus.keys()).issubset(allowed_fields), True)
        if "coordinate" in campus:
            self._assert_coordinate_schema(campus["coordinate"], allowed_coordinate_fields)

    def _assert_poi_schema(
        self,
        poi: dict[str, object],
        allowed_fields: frozenset[str],
        allowed_coordinate_fields: frozenset[str],
    ) -> None:
        self.assertEqual(
            {"poi_id", "poi_name", "label", "campus_id"}.issubset(poi.keys()),
            True,
        )
        self.assertEqual(set(poi.keys()).issubset(allowed_fields), True)
        if "coordinate" in poi:
            self._assert_coordinate_schema(poi["coordinate"], allowed_coordinate_fields)

    def _assert_coordinate_schema(
        self,
        coordinate: dict[str, object],
        allowed_coordinate_fields: frozenset[str],
    ) -> None:
        self.assertEqual(set(coordinate.keys()), allowed_coordinate_fields)
        self.assertIsInstance(coordinate["lat"], float)
        self.assertIsInstance(coordinate["lng"], float)


if __name__ == "__main__":
    unittest.main()

