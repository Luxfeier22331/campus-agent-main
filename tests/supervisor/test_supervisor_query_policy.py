from __future__ import annotations

import unittest

from campus_contracts import KnowledgeScope
from campus_supervisor_core.errors import DisallowedKnowledgeScopeError
from campus_supervisor_core.query_policy import assert_scope_is_query_enabled


class SupervisorQueryPolicyTest(unittest.TestCase):
    def test_query_policy_allows_student_handbook(self) -> None:
        assert_scope_is_query_enabled(
            KnowledgeScope(corpus="regulations", collection="student_rules")
        )

    def test_query_policy_allows_curriculum_plan(self) -> None:
        assert_scope_is_query_enabled(
            KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
        )

    def test_query_policy_allows_official_web_stable_reference(self) -> None:
        assert_scope_is_query_enabled(
            KnowledgeScope(corpus="official_web", collection="stable_reference")
        )

    def test_query_policy_rejects_official_web_fresh_news(self) -> None:
        with self.assertRaisesRegex(
            DisallowedKnowledgeScopeError,
            "knowledge scope official_web/fresh_news is not query-enabled",
        ):
            assert_scope_is_query_enabled(
                KnowledgeScope(corpus="official_web", collection="fresh_news")
            )

    def test_query_policy_rejects_official_web_news_archive(self) -> None:
        with self.assertRaisesRegex(
            DisallowedKnowledgeScopeError,
            "knowledge scope official_web/news_archive is not query-enabled",
        ):
            assert_scope_is_query_enabled(
                KnowledgeScope(corpus="official_web", collection="news_archive")
            )

    def test_query_policy_rejects_service_catalog(self) -> None:
        with self.assertRaisesRegex(
            DisallowedKnowledgeScopeError,
            "knowledge scope campus_services/service_catalog is not query-enabled",
        ):
            assert_scope_is_query_enabled(
                KnowledgeScope(corpus="campus_services", collection="service_catalog")
            )


if __name__ == "__main__":
    unittest.main()
