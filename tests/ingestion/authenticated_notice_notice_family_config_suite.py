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

    def test_first_phase_downstream_denominator_is_explicit(self) -> None:
        config = load_notice_family_config()
        first_phase_downstream_routes = {
            "regulation_candidate",
            "service_status_candidate",
        }
        deferred_special_routes = {
            "procurement_notice_history",
            "special_service_candidate",
            "stable_contact_candidate",
        }
        observed_routes = {
            policy.consumption_route for policy in config.routing_policy.family_policies.values()
        }

        self.assertTrue(first_phase_downstream_routes.issubset(observed_routes))
        self.assertFalse(observed_routes & deferred_special_routes)

    def test_generic_card_only_families_route_to_notice_query_without_machine_processing(
        self,
    ) -> None:
        config = load_notice_family_config()
        generic_card_only_families = {
            "campus_news_publicity",
            "culture_publicity_activity",
            "event_activity",
            "general_publicity_culture",
            "lecture_publicity",
            "procurement_notice",
            "research_publicity_call",
        }

        for family in sorted(generic_card_only_families):
            with self.subTest(family=family):
                policy = config.routing_policy.family_policies[family]
                self.assertEqual(policy.consumption_route, "notice_level_query")
                self.assertEqual(policy.machine_processing_policy, "skip")

    def test_default_publicity_signal_routes_to_generic_card_not_defer(self) -> None:
        config = load_notice_family_config()
        overrides = {
            override.name: override
            for override in config.routing_policy.default_family_route_overrides
        }

        publicity_signal = overrides["defer_publicity_signal"]
        self.assertEqual(publicity_signal.consumption_route, "notice_level_query")
        self.assertEqual(publicity_signal.machine_processing_policy, "skip")


if __name__ == "__main__":
    unittest.main()
