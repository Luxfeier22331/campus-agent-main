from __future__ import annotations

import unittest

from campus_contracts import KnowledgeScope
from campus_supervisor_core.errors import DisallowedKnowledgeScopeError
from campus_supervisor_core.query_policy import assert_scope_is_query_enabled


class SupervisorQueryPolicyTest(unittest.TestCase):
    def test_query_policy_allows_student_handbook(self) -> None:
        assert_scope_is_query_enabled(
            KnowledgeScope(corpus="regulations", collection="student_handbook")
        )

    def test_query_policy_rejects_curriculum_plan(self) -> None:
        with self.assertRaisesRegex(
            DisallowedKnowledgeScopeError,
            "knowledge scope curriculum/curriculum_plan is not query-enabled",
        ):
            assert_scope_is_query_enabled(
                KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
            )
