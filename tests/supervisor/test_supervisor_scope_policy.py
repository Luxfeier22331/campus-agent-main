from __future__ import annotations

import unittest

from campus_contracts import KnowledgeScope, SupervisorRequest
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.scope_policy import evaluate_knowledge_scope


class SupervisorScopePolicyTest(unittest.TestCase):
    def test_evaluate_knowledge_scope_keeps_explicit_scope_in_scope(self) -> None:
        decision = evaluate_knowledge_scope(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="奖学金怎么申请？",
                    requested_scope=KnowledgeScope(
                        corpus="regulations",
                        collection="student_handbook",
                    ),
                )
            )
        )

        self.assertEqual(decision.scope_class, "in_scope")
        self.assertEqual(decision.reason, "explicit_requested_scope")

    def test_evaluate_knowledge_scope_marks_external_institution_query_out_of_scope(self) -> None:
        decision = evaluate_knowledge_scope(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="MIT的校长是谁",
                    requested_capability="knowledge",
                )
            )
        )

        self.assertEqual(decision.scope_class, "out_of_scope")
        self.assertEqual(decision.reason, "product_scope_boundary")

    def test_evaluate_knowledge_scope_keeps_curriculum_question_without_scope_in_scope(
        self,
    ) -> None:
        decision = evaluate_knowledge_scope(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="法学民族实验班培养方案里大二下有什么课",
                    requested_capability="knowledge",
                )
            )
        )

        self.assertEqual(decision.scope_class, "in_scope")
        self.assertEqual(decision.reason, "campus_scope_signal")

    def test_evaluate_knowledge_scope_keeps_campus_political_course_question_in_scope(self) -> None:
        decision = evaluate_knowledge_scope(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="习近平新时代中国特色社会主义思想概论有哪些专业要上",
                    requested_capability="knowledge",
                )
            )
        )

        self.assertEqual(decision.scope_class, "in_scope")
        self.assertEqual(decision.reason, "campus_scope_signal")

    def test_evaluate_knowledge_scope_marks_open_domain_political_fact_out_of_scope(self) -> None:
        decision = evaluate_knowledge_scope(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="中国国家主席是谁",
                    requested_capability="knowledge",
                )
            )
        )

        self.assertEqual(decision.scope_class, "out_of_scope")
        self.assertEqual(decision.reason, "product_scope_boundary")


if __name__ == "__main__":
    unittest.main()
