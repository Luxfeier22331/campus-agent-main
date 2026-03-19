from __future__ import annotations

import json
from pathlib import Path
import unittest

from campus_agent.tools.directory import (
    ALLOWED_DIRECTORY_ENTRY_FIELDS,
    ALLOWED_DIRECTORY_ENTRY_TYPES,
    FixtureBackedCampusDirectoryLookupTool,
)


FIXTURE_ROOT = Path(__file__).resolve().parents[2] / "fixtures" / "directory"
RECORDS_FIXTURE = FIXTURE_ROOT / "directory_records.json"
REQUESTS_DIR = FIXTURE_ROOT / "requests"
RESPONSES_DIR = FIXTURE_ROOT / "responses"
FORBIDDEN_ENTRY_FIELDS = {
    "campus_scope",
    "aliases",
    "tags",
    "confidence",
    "source",
}
SAMPLE_CASES = (
    "no-match",
    "single-match-graduate-admissions",
    "multi-entry-registrar-main-campus",
    "scoped-match-library-north-campus",
)


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_tool() -> FixtureBackedCampusDirectoryLookupTool:
    return FixtureBackedCampusDirectoryLookupTool(fixture_path=RECORDS_FIXTURE)


class CampusDirectoryLookupToolTest(unittest.TestCase):
    def test_lookup_returns_empty_entries_for_unknown_query(self) -> None:
        response = build_tool().lookup({"query": "quantum garden office"})

        self.assertTrue(response["ok"])
        self.assertEqual(response["tool_name"], "campus_directory_lookup")
        self.assertEqual(response["contract_version"], "v1")
        self.assertEqual(response["data"]["match_type"], "none")
        self.assertEqual(response["data"]["entries"], [])

    def test_lookup_returns_single_email_entry_for_graduate_admissions(self) -> None:
        response = build_tool().lookup({"query": "graduate admissions email"})

        self.assertTrue(response["ok"])
        self.assertEqual(response["data"]["match_type"], "exact")
        self.assertEqual(len(response["data"]["entries"]), 1)
        self.assertEqual(response["data"]["entries"][0]["entry_type"], "email")
        self.assertEqual(
            response["data"]["entries"][0]["value"],
            "grad-admissions@example.edu",
        )

    def test_lookup_returns_flat_multi_entry_result_for_registrar_office(self) -> None:
        response = build_tool().lookup(
            {"query": "registrar office", "campus_scope": "main-campus"}
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["data"]["match_type"], "exact")
        self.assertEqual(len(response["data"]["entries"]), 5)
        self.assertEqual(
            {entry["entry_type"] for entry in response["data"]["entries"]},
            set(ALLOWED_DIRECTORY_ENTRY_TYPES),
        )

    def test_lookup_applies_campus_scope_only_as_request_side_filter(self) -> None:
        tool = build_tool()

        matched = tool.lookup(
            {"query": "library help desk", "campus_scope": "north-campus"}
        )
        missed = tool.lookup(
            {"query": "library help desk", "campus_scope": "south-campus"}
        )

        self.assertEqual(matched["data"]["match_type"], "exact")
        self.assertGreaterEqual(len(matched["data"]["entries"]), 1)
        self.assertEqual(missed["data"]["match_type"], "none")
        self.assertEqual(missed["data"]["entries"], [])
        for entry in matched["data"]["entries"]:
            self.assertNotIn("campus_scope", entry)

    def test_fixture_records_and_sample_responses_comply_with_frozen_v1_schema(self) -> None:
        records_payload = load_json(RECORDS_FIXTURE)
        self.assertIn("records", records_payload)

        for record in records_payload["records"]:
            self.assertIn("entries", record)
            self.assertIsInstance(record["entries"], list)
            for entry in record["entries"]:
                self._assert_entry_schema(entry)

        for case_name in SAMPLE_CASES:
            response = load_json(RESPONSES_DIR / f"{case_name}.json")
            self._assert_response_schema(response)

    def test_request_response_samples_remain_stable(self) -> None:
        tool = build_tool()

        for case_name in SAMPLE_CASES:
            with self.subTest(case=case_name):
                request_payload = load_json(REQUESTS_DIR / f"{case_name}.json")
                expected_response = load_json(RESPONSES_DIR / f"{case_name}.json")
                actual_response = tool.lookup(request_payload)
                self.assertEqual(actual_response, expected_response)

    def _assert_response_schema(self, response: dict[str, object]) -> None:
        self.assertEqual(response["tool_name"], "campus_directory_lookup")
        self.assertEqual(response["contract_version"], "v1")
        self.assertIn("ok", response)
        self.assertIn("request_id", response)
        self.assertIn("trace_id", response)
        self.assertIn("data", response)
        self.assertIsInstance(response["data"]["entries"], list)
        self.assertIn("match_type", response["data"])

        for entry in response["data"]["entries"]:
            self._assert_entry_schema(entry)

    def _assert_entry_schema(self, entry: dict[str, object]) -> None:
        self.assertIsInstance(entry, dict)
        self.assertEqual(
            {"entry_type", "label", "value"}.issubset(entry.keys()),
            True,
        )
        self.assertIn(entry["entry_type"], ALLOWED_DIRECTORY_ENTRY_TYPES)
        self.assertEqual(
            set(entry.keys()).issubset(ALLOWED_DIRECTORY_ENTRY_FIELDS),
            True,
        )
        self.assertEqual(set(entry.keys()).intersection(FORBIDDEN_ENTRY_FIELDS), set())
        self.assertIsInstance(entry["label"], str)
        self.assertTrue(entry["label"].strip())
        self.assertIsInstance(entry["value"], str)
        self.assertTrue(entry["value"].strip())
        if "address_lines" in entry:
            self.assertIsInstance(entry["address_lines"], list)
            self.assertTrue(entry["address_lines"])
            for line in entry["address_lines"]:
                self.assertIsInstance(line, str)
                self.assertTrue(line.strip())


if __name__ == "__main__":
    unittest.main()

