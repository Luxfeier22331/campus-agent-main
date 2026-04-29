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


if __name__ == "__main__":
    unittest.main()
