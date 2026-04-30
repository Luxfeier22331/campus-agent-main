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

    def test_regulation_serving_profiles_remain_closed_until_release(self) -> None:
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

        self.assertEqual(institutional_profile["serving_stage"], "offline_preparation")
        self.assertIs(institutional_profile["retrieval_enabled"], False)
        self.assertIs(institutional_profile["query_enabled_by_default"], False)
        self.assertEqual(institutional_profile["current_only"], False)

        self.assertEqual(scoped_profile["serving_stage"], "offline_preparation")
        self.assertIs(scoped_profile["retrieval_enabled"], False)
        self.assertIs(scoped_profile["query_enabled_by_default"], False)
        self.assertEqual(scoped_profile["current_only"], False)


if __name__ == "__main__":
    unittest.main()
