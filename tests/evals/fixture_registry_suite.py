import json
import unittest

from campus_evals.fixture_registry import fixture_path, fixture_registry_path


class FixtureRegistryTest(unittest.TestCase):
    def test_registered_fixture_paths_exist(self) -> None:
        payload = json.loads(fixture_registry_path().read_text(encoding="utf-8"))

        missing = []
        for fixture_id in payload["fixtures"]:
            try:
                fixture_path(fixture_id)
            except FileNotFoundError as exc:
                missing.append(str(exc))

        self.assertEqual([], missing)

    def test_legacy_aliases_resolve_to_same_paths(self) -> None:
        payload = json.loads(fixture_registry_path().read_text(encoding="utf-8"))

        mismatches = []
        for alias, fixture_id in payload["legacy_aliases"].items():
            alias_path = fixture_path(alias)
            fixture_id_path = fixture_path(fixture_id)
            if alias_path != fixture_id_path:
                mismatches.append((alias, fixture_id))

        self.assertEqual([], mismatches)


if __name__ == "__main__":
    unittest.main()
