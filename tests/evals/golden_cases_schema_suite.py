from __future__ import annotations

from tests.evals.golden_cases_test_support import (
    HANDBOOK_SCOPE,
    ActorContext,
    GoldenCase,
    TraceExpectation,
    VersionQuery,
    unittest,
)


class GoldenCaseSchemaTest(unittest.TestCase):
    def test_case_requires_explicit_scope(self) -> None:
        with self.assertRaisesRegex(TypeError, "scope"):
            GoldenCase(
                case_id="case-1",
                split="smoke",
                source_type="expert_authored",
                user_goal="library hours",
                actor=ActorContext(),
                expected_status="completed",
            )

    def test_case_rejects_empty_user_goal(self) -> None:
        with self.assertRaisesRegex(ValueError, "user_goal"):
            GoldenCase(
                case_id="case-2",
                split="smoke",
                source_type="expert_authored",
                user_goal="   ",
                actor=ActorContext(),
                scope=HANDBOOK_SCOPE,
                expected_status="completed",
            )

    def test_trace_expectation_rejects_unknown_capability(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected_capability"):
            TraceExpectation(expected_capability="supervisor-direct")

    def test_trace_expectation_rejects_unknown_capability_family(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected_capability_family"):
            TraceExpectation(expected_capability_family="supervisor")

    def test_trace_expectation_rejects_capability_family_mismatch(self) -> None:
        with self.assertRaisesRegex(ValueError, "same lane"):
            TraceExpectation(
                expected_capability="knowledge",
                expected_capability_family="navigation",
            )

    def test_case_accepts_reference_context_truth_and_metric_overrides(self) -> None:
        case = GoldenCase(
            case_id="case-with-supplemental-truth",
            split="release_gate",
            source_type="expert_authored",
            user_goal="图书馆开放时间是什么？",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            reference_context_ids=("handbook:library",),
            reference_contexts=("图书馆开放时间为 08:00-22:00。",),
            supplemental_metric_overrides={"answer_relevancy": False},
        )

        self.assertEqual(case.reference_context_ids, ("handbook:library",))
        self.assertEqual(case.reference_contexts, ("图书馆开放时间为 08:00-22:00。",))
        self.assertEqual(case.supplemental_metric_overrides, {"answer_relevancy": False})

    def test_case_accepts_semantic_outcome_truth(self) -> None:
        case = GoldenCase(
            case_id="case-semantic-truth",
            split="release_gate",
            source_type="expert_authored",
            user_goal="MIT的校长是谁",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="no_answer",
            expected_semantic_outcome="out_of_scope",
            expected_scope_class="out_of_scope",
            expected_policy_reason="product_scope_boundary",
        )

        self.assertEqual(case.expected_semantic_outcome, "out_of_scope")
        self.assertEqual(case.expected_scope_class, "out_of_scope")
        self.assertEqual(case.expected_policy_reason, "product_scope_boundary")

    def test_case_accepts_version_query_truth(self) -> None:
        case = GoldenCase(
            case_id="case-version-query-truth",
            split="regression_locked",
            source_type="expert_authored",
            user_goal="上一版国家奖学金评审办法怎么规定",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            version_query=VersionQuery(mode="historical"),
            expected_status="completed",
        )

        self.assertEqual(case.version_query, VersionQuery(mode="historical"))
