from __future__ import annotations

import unittest

from campus_contracts import (
    ContextProjection,
    KnowledgeScope,
    SessionSlot,
    SessionSummary,
    SupervisorRequest,
)
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
                        collection="student_rules",
                    ),
                )
            )
        )

        self.assertEqual(decision.scope_class, "in_scope")
        self.assertEqual(decision.reason, "explicit_requested_scope")

    def test_evaluate_knowledge_scope_marks_external_institution_query_out_of_scope(self) -> None:
        for user_goal in ("MIT的校长是谁", "北京大学有哪些专业"):
            with self.subTest(user_goal=user_goal):
                decision = evaluate_knowledge_scope(
                    SupervisorRequestContext.from_request(
                        SupervisorRequest(
                            user_goal=user_goal,
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

    def test_evaluate_knowledge_scope_marks_open_domain_default_queries_out_of_scope(
        self,
    ) -> None:
        cases = ("解释一下AI", "帮我算高数题", "帮我写一封邮件给老师", "这个流程能帮我提交吗")

        for user_goal in cases:
            with self.subTest(user_goal=user_goal):
                decision = evaluate_knowledge_scope(
                    SupervisorRequestContext.from_request(
                        SupervisorRequest(
                            user_goal=user_goal,
                            requested_capability="knowledge",
                        )
                    )
                )

                self.assertEqual(decision.scope_class, "out_of_scope")
                self.assertEqual(decision.reason, "product_scope_boundary")

    def test_evaluate_knowledge_scope_marks_service_queries_as_structured_candidates(
        self,
    ) -> None:
        for user_goal in ("校车什么时候发车", "食堂营业到几点"):
            with self.subTest(user_goal=user_goal):
                decision = evaluate_knowledge_scope(
                    SupervisorRequestContext.from_request(
                        SupervisorRequest(
                            user_goal=user_goal,
                            requested_capability="knowledge",
                        )
                    )
                )

                self.assertEqual(decision.scope_class, "in_scope")
                self.assertEqual(decision.reason, "structured_runtime_candidate_signal")

    def test_evaluate_knowledge_scope_marks_notice_queries_as_structured_candidates(
        self,
    ) -> None:
        decision = evaluate_knowledge_scope(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="找一下春假通知",
                    requested_capability="knowledge",
                )
            )
        )

        self.assertEqual(decision.scope_class, "in_scope")
        self.assertEqual(decision.reason, "structured_runtime_candidate_signal")

    def test_evaluate_knowledge_scope_rejects_contextual_follow_up_without_context(
        self,
    ) -> None:
        decision = evaluate_knowledge_scope(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="这个流程怎么办",
                    requested_capability="knowledge",
                )
            )
        )

        self.assertEqual(decision.scope_class, "out_of_scope")
        self.assertEqual(decision.reason, "product_scope_boundary")

    def test_evaluate_knowledge_scope_keeps_contextual_follow_up_with_campus_context(
        self,
    ) -> None:
        decision = evaluate_knowledge_scope(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="这个流程怎么办",
                    requested_capability="knowledge",
                    context=ContextProjection(
                        session=SessionSummary(
                            confirmed_slots=(SessionSlot(name="policy_topic", value="奖学金"),),
                        ),
                    ),
                )
            )
        )

        self.assertEqual(decision.scope_class, "in_scope")
        self.assertEqual(decision.reason, "campus_context_signal")


if __name__ == "__main__":
    unittest.main()
