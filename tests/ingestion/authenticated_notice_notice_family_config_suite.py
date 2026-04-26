from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_notice_family import (
    read_authenticated_notice_notice_family_config_path,
)

from tests.ingestion.authenticated_notice_notice_family_test_support import (
    NOTICE_FAMILY_CONFIG_PATH,
    load_notice_family_config,
)


class AuthenticatedNoticeNoticeFamilyConfigTest(unittest.TestCase):
    def test_read_config_path_uses_repo_tracked_internal_notice_config(self) -> None:
        path = read_authenticated_notice_notice_family_config_path({})

        self.assertEqual(path, NOTICE_FAMILY_CONFIG_PATH.resolve())
        self.assertTrue(path.exists())

    def test_load_repo_tracked_config(self) -> None:
        config = load_notice_family_config()

        self.assertEqual(config.corpus, "campus_notices")
        self.assertEqual(config.collection, "internal_notice")
        self.assertEqual(config.default_family, "other")
        self.assertGreaterEqual(len(config.rules), 5)

    def test_config_rules_are_loaded_by_priority_descending(self) -> None:
        config = load_notice_family_config()
        priorities = tuple(rule.priority for rule in config.rules)

        self.assertEqual(priorities, tuple(sorted(priorities, reverse=True)))


if __name__ == "__main__":
    unittest.main()
