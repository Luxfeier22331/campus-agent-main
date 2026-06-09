from __future__ import annotations

import json
import unittest
from pathlib import Path


class QueryServingScopePolicyDriftTest(unittest.TestCase):
    def test_go_query_serving_scope_policy_matches_runtime_profiles(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        policy_path = repo_root / "configs/runtime/query-serving-scopes.v1.json"
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
        policy_scopes = {(scope["corpus"], scope["collection"]) for scope in policy["scopes"]}

        profile_scopes: set[tuple[str, str]] = set()
        for profile_path in (repo_root / "configs/ingestion").glob("*/*/runtime-profile.json"):
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            if profile.get("query_enabled_by_default") is True:
                profile_scopes.add((profile["corpus"], profile["collection"]))

        self.assertEqual(policy_scopes, profile_scopes)

    def test_active_structured_tools_match_structured_query_runtime_profiles(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        tool_spec_path = repo_root / "configs/runtime/tools.v3.json"
        tool_spec = json.loads(tool_spec_path.read_text(encoding="utf-8"))
        active_structured_tools = {
            tool["name"]
            for tool in tool_spec["tools"]
            if tool.get("active") is True
            and tool.get("surface") == "structured_handoff"
            and tool.get("backend") == "internal_structured_query_service"
        }

        profile_tools: set[str] = set()
        for profile_path in (repo_root / "configs/ingestion").glob("*/*/runtime-profile.json"):
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            if profile.get("structured_query_enabled") is True:
                profile_tools.update(profile.get("structured_query_tools") or [])

        self.assertEqual(
            active_structured_tools - {"campus_notice_discover", "campus_notice_change_set_lookup"},
            profile_tools,
        )

    def test_active_structured_runtime_profiles_do_not_enter_default_query_serving(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]

        structured_profiles: dict[str, dict[str, object]] = {}
        for profile_path in (repo_root / "configs/ingestion").glob("*/*/runtime-profile.json"):
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            if profile.get("structured_query_enabled") is True:
                for tool_name in profile.get("structured_query_tools") or []:
                    structured_profiles[str(tool_name)] = profile

        expected_tools = {
            "academic_calendar_lookup",
            "contact_directory_lookup",
            "service_guide_lookup",
            "service_status_lookup",
            "transport_schedule_lookup",
        }
        self.assertEqual(set(structured_profiles), expected_tools)
        for tool_name in expected_tools:
            profile = structured_profiles[tool_name]
            self.assertEqual(
                profile["serving_stage"],
                "structured_query_serving",
                tool_name,
            )
            self.assertIs(profile["retrieval_enabled"], False, tool_name)
            self.assertIs(profile["query_enabled_by_default"], False, tool_name)

    def test_regulation_serving_admission_profiles_are_explicit(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        institutional_profile = json.loads(
            (
                repo_root / "configs/ingestion/regulations/institutional_rules/runtime-profile.json"
            ).read_text(encoding="utf-8")
        )
        scoped_profile = json.loads(
            (
                repo_root / "configs/ingestion/regulations/scoped_rules/runtime-profile.json"
            ).read_text(encoding="utf-8")
        )

        self.assertEqual(institutional_profile["serving_stage"], "query_serving")
        self.assertIs(institutional_profile["retrieval_enabled"], True)
        self.assertIs(institutional_profile["query_enabled_by_default"], True)
        self.assertEqual(institutional_profile["current_only"], True)
        self.assertEqual(
            institutional_profile["serving_revision_tracks"],
            ["current-effective"],
        )

        self.assertEqual(scoped_profile["serving_stage"], "query_serving")
        self.assertIs(scoped_profile["retrieval_enabled"], True)
        self.assertIs(scoped_profile["query_enabled_by_default"], False)
        self.assertEqual(scoped_profile["current_only"], True)
        self.assertEqual(scoped_profile["serving_revision_tracks"], ["current-effective"])


if __name__ == "__main__":
    unittest.main()
