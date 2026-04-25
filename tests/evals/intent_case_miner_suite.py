from __future__ import annotations

import unittest

from campus_evals.intent_case_miner import mine_intent_case_candidates


class IntentCaseMinerTest(unittest.TestCase):
    def test_mine_intent_case_candidates_extracts_low_confidence_records(self) -> None:
        candidates = mine_intent_case_candidates(
            (
                {
                    "request_id": "req-candidate-001",
                    "user_goal": "找一下春假通知",
                    "intent_capability": "knowledge",
                    "intent_task_kind": "knowledge_lookup",
                    "intent_launch_state": "candidate_only",
                    "intent_next_action": "delegate",
                    "intent_scope_class": "in_scope",
                    "intent_scope_reason": "structured_runtime_candidate_signal",
                    "intent_policy_reason": "",
                    "selected_target": "rag-agent",
                },
                {
                    "request_id": "req-stable-001",
                    "user_goal": "奖学金怎么申请？",
                    "intent_capability": "knowledge",
                    "intent_task_kind": "knowledge_lookup",
                    "intent_launch_state": "open",
                    "intent_next_action": "delegate",
                    "intent_scope_class": "in_scope",
                    "intent_scope_reason": "campus_scope_signal",
                    "selected_target": "rag-agent",
                },
            )
        )

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].case_id, "mined-req-candidate-001")
        self.assertEqual(candidates[0].user_goal, "找一下春假通知")
        self.assertEqual(candidates[0].expected_launch_state, "candidate_only")
        self.assertEqual(candidates[0].tags, ("mined", "needs_review", "candidate_only"))

    def test_mine_intent_case_candidates_deduplicates_user_goals(self) -> None:
        candidates = mine_intent_case_candidates(
            (
                {
                    "request_id": "req-001",
                    "user_goal": "图书馆在哪里",
                    "intent_launch_state": "closed",
                    "intent_next_action": "out_of_scope",
                    "intent_capability": "place_lookup",
                    "intent_task_kind": "place_lookup",
                    "intent_scope_class": "out_of_scope",
                    "intent_policy_reason": "navigation_temporarily_unsupported",
                },
                {
                    "request_id": "req-002",
                    "user_goal": " 图书馆 在 哪里 ",
                    "intent_launch_state": "closed",
                    "intent_next_action": "out_of_scope",
                    "intent_capability": "place_lookup",
                    "intent_task_kind": "place_lookup",
                    "intent_scope_class": "out_of_scope",
                    "intent_policy_reason": "navigation_temporarily_unsupported",
                },
            )
        )

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].case_id, "mined-req-001")

    def test_mine_intent_case_candidates_samples_follow_up_and_reviewed_failures(self) -> None:
        candidates = mine_intent_case_candidates(
            (
                {
                    "request_id": "req-follow-up-001",
                    "user_goal": "那大二下呢",
                    "intent_capability": "knowledge",
                    "intent_task_kind": "knowledge_lookup",
                    "intent_launch_state": "open",
                    "intent_next_action": "delegate",
                    "intent_scope_class": "in_scope",
                    "intent_scope_reason": "campus_scope_signal",
                    "intent_context_resolution_state": "resolved",
                    "intent_context_reference_type": "curriculum_slot",
                    "selected_target": "rag-agent",
                },
                {
                    "request_id": "req-reviewed-001",
                    "user_goal": "这条通知详情",
                    "intent_capability": "knowledge",
                    "intent_task_kind": "knowledge_lookup",
                    "intent_launch_state": "candidate_only",
                    "intent_next_action": "clarify",
                    "intent_scope_class": "in_scope",
                    "intent_scope_reason": "structured_runtime_candidate_signal",
                    "intent_review_verdict": "incorrect",
                    "selected_target": "none",
                },
            )
        )

        self.assertEqual(
            [case.case_id for case in candidates],
            [
                "mined-req-follow-up-001",
                "mined-req-reviewed-001",
            ],
        )
        self.assertIn("follow_up", candidates[0].tags)
        self.assertIn("reviewed_incorrect", candidates[1].tags)


if __name__ == "__main__":
    unittest.main()
