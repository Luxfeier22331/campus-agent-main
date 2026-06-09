from __future__ import annotations

from tests.evals.golden_cases_test_support import (
    CURRICULUM_SCOPE,
    HANDBOOK_SCOPE,
    TraceExpectation,
    VersionQuery,
    _is_lookup_style_goal,
    curriculum_regression_locked_cases,
    curriculum_release_gate_cases,
    handbook_error_gate_cases,
    handbook_regression_locked_cases,
    handbook_release_gate_cases,
    handbook_smoke_cases,
    official_web_release_gate_cases,
    policy_risk_and_grounding_release_gate_cases,
    unittest,
    versioned_history_regression_locked_cases,
)


class RunCasesHandbookInventoryTest(unittest.TestCase):
    def test_handbook_smoke_cases_cover_stable_terminal_statuses(self) -> None:
        cases = handbook_smoke_cases()

        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "handbook-smoke-scholarship-title",
                "handbook-smoke-student-card",
                "handbook-smoke-no-answer",
                "handbook-smoke-needs-clarification",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.source_type == "expert_authored" for case in cases))
        self.assertTrue(all(case.split == "smoke" for case in cases))
        self.assertTrue(all(case.scope == HANDBOOK_SCOPE for case in cases))

    def test_handbook_regression_locked_cases_cover_high_risk_lanes(self) -> None:
        cases = handbook_regression_locked_cases()

        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "handbook-regression-student-status-article",
                "handbook-regression-dormitory-lighting",
                "handbook-regression-student-card-reissue",
                "handbook-regression-no-answer-visa",
                "handbook-regression-needs-clarification-scholarship",
                "handbook-regression-needs-clarification-policy-object",
                "handbook-regression-national-scholarship-no-answer-author-affiliation",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
                "needs_clarification",
                "no_answer",
            ),
        )
        self.assertTrue(all(case.source_type == "expert_authored" for case in cases))
        self.assertTrue(all(case.split == "regression_locked" for case in cases))
        self.assertTrue(all(case.scope == HANDBOOK_SCOPE for case in cases))

    def test_versioned_history_regression_locked_cases_cover_modes_and_fail_close_truth(
        self,
    ) -> None:
        cases = versioned_history_regression_locked_cases()
        cases_by_id = {case.case_id: case for case in cases}

        self.assertEqual(len(cases), 6)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "versioned-history-current-control",
                "versioned-history-historical-answer",
                "versioned-history-as-of-answer",
                "versioned-history-compare-answer",
                "versioned-history-unresolved-fail-close",
                "versioned-history-compare-support-incomplete",
            ),
        )
        self.assertEqual(
            tuple(case.version_query.mode for case in cases),
            ("current", "historical", "as_of", "compare", "historical", "compare"),
        )
        self.assertEqual(
            cases_by_id["versioned-history-as-of-answer"].version_query,
            VersionQuery(mode="as_of", as_of="2024-06-01"),
        )
        self.assertEqual(
            cases_by_id["versioned-history-compare-answer"].version_query,
            VersionQuery(
                mode="compare", version_id="v1:scholarship", compare_to_version_id="v2:scholarship"
            ),
        )
        self.assertEqual(
            cases_by_id["versioned-history-historical-answer"].expected_semantic_outcome,
            "historical_grounded_answer",
        )
        self.assertEqual(
            cases_by_id["versioned-history-as-of-answer"].expected_semantic_outcome,
            "as_of_grounded_answer",
        )
        self.assertEqual(
            cases_by_id["versioned-history-compare-answer"].expected_semantic_outcome,
            "compare_grounded_answer",
        )
        self.assertEqual(
            cases_by_id[
                "versioned-history-unresolved-fail-close"
            ].expected_retrieval_adequacy_reason,
            "version_filter_unresolved",
        )
        self.assertFalse(
            cases_by_id[
                "versioned-history-unresolved-fail-close"
            ].trace_expectation.retrieval_called
        )
        self.assertEqual(
            cases_by_id[
                "versioned-history-compare-support-incomplete"
            ].expected_retrieval_adequacy_reason,
            "compare_support_incomplete",
        )
        self.assertTrue(
            cases_by_id[
                "versioned-history-compare-support-incomplete"
            ].trace_expectation.retrieval_called
        )
        self.assertTrue(all("versioned_history" in case.tags for case in cases))

    def test_handbook_release_gate_cases_cover_terminal_statuses(self) -> None:
        cases = handbook_release_gate_cases()
        cases_by_id = {case.case_id: case for case in cases}

        self.assertEqual(len(cases), 11)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "release-gate-scholarship-title",
                "release-gate-student-card",
                "release-gate-student-card-materials",
                "release-gate-student-card-time",
                "release-gate-dormitory-lighting",
                "release-gate-medical-title",
                "release-gate-national-scholarship-alias",
                "release-gate-national-scholarship-no-answer-author-affiliation",
                "release-gate-needs-clarification-policy-object",
                "release-gate-no-answer",
                "release-gate-needs-clarification",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.split == "release_gate" for case in cases))
        self.assertTrue(all(case.scope == HANDBOOK_SCOPE for case in cases))
        self.assertTrue(
            any(
                "24:00" in fact
                for fact in cases_by_id["release-gate-dormitory-lighting"].reference_facts
            )
        )
        self.assertTrue(
            any(
                "每周四下午" in fact
                for fact in cases_by_id["release-gate-student-card"].reference_facts
            )
        )
        self.assertTrue(
            any(
                "书面申请" in fact
                for fact in cases_by_id["release-gate-student-card-materials"].reference_facts
            )
        )
        self.assertTrue(
            any(
                "每周四下午" in fact
                for fact in cases_by_id["release-gate-student-card-time"].reference_facts
            )
        )
        self.assertEqual(
            cases_by_id["release-gate-scholarship-title"].supplemental_metric_overrides.get(
                "answer_relevancy"
            ),
            False,
        )
        self.assertEqual(
            cases_by_id["release-gate-national-scholarship-alias"].forbidden_sources[0].doc_id,
            "handbook:651a8dbf99f52b997bc74ae8fd6cd287887f74a7",
        )
        self.assertEqual(
            cases_by_id["release-gate-dormitory-lighting"].reference_context_ids,
            ("handbook:2ec80263a9e7b11379281349196ceb96afa44c3b",),
        )
        self.assertEqual(
            cases_by_id[
                "release-gate-national-scholarship-no-answer-author-affiliation"
            ].expected_semantic_outcome,
            "unsupported_by_evidence",
        )
        self.assertEqual(
            cases_by_id["release-gate-no-answer"].expected_scope_class,
            "in_scope",
        )

    def test_completed_release_and_regression_cases_define_context_truth_or_explicit_metric_skip(
        self,
    ) -> None:
        cases = (
            *handbook_release_gate_cases(),
            *handbook_regression_locked_cases(),
            *curriculum_release_gate_cases(),
            *curriculum_regression_locked_cases(),
        )

        for case in cases:
            if case.expected_status != "completed":
                continue
            with self.subTest(case_id=case.case_id):
                self.assertTrue(
                    case.reference_context_ids or case.reference_contexts,
                    "completed case must define supplemental context truth",
                )
                self.assertEqual(
                    case.supplemental_metric_overrides.get("answer_relevancy") is False,
                    _is_lookup_style_goal(case.user_goal),
                )

    def test_handbook_error_gate_cases_cover_deterministic_error_paths(self) -> None:
        cases = handbook_error_gate_cases()

        self.assertEqual(len(cases), 3)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "error-gate-retrieval-backend-failure",
                "error-gate-evidence-shaping-failure",
                "error-gate-invalid-backend-contract",
            ),
        )
        self.assertTrue(all(case.expected_status == "error" for case in cases))
        self.assertTrue(all(case.split == "release_gate" for case in cases))
        self.assertTrue(all("error_gate" in case.tags for case in cases))
        self.assertTrue(all(case.scope == HANDBOOK_SCOPE for case in cases))

    def test_curriculum_release_gate_cases_cover_terminal_statuses(self) -> None:
        cases = curriculum_release_gate_cases()

        self.assertEqual(len(cases), 16)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "curriculum-release-gate-ethnology-title",
                "curriculum-release-gate-academic-years",
                "curriculum-release-gate-total-credits",
                "curriculum-release-gate-course-map-unsupported",
                "curriculum-release-gate-course-family-membership",
                "curriculum-release-gate-course-family-audience-short-alias",
                "curriculum-release-gate-course-single-schedule",
                "curriculum-release-gate-course-single-schedule-alias-variant",
                "curriculum-release-gate-program-family-membership",
                "curriculum-release-gate-program-family-experimental-membership",
                "curriculum-release-gate-program-family-strong-base-membership-full-alias",
                "curriculum-release-gate-program-family-name-pattern-experimental-membership",
                "curriculum-release-gate-program-follow-up-session-replay",
                "curriculum-release-gate-strong-base-follow-up-session-replay",
                "curriculum-release-gate-no-answer",
                "curriculum-release-gate-needs-clarification",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "completed",
                "completed",
                "no_answer",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.split == "release_gate" for case in cases))
        self.assertTrue(all(case.scope == CURRICULUM_SCOPE for case in cases))
        self.assertTrue(all("curriculum" in case.tags for case in cases))
        self.assertEqual(
            next(
                case.expected_semantic_outcome
                for case in cases
                if case.case_id == "curriculum-release-gate-no-answer"
            ),
            "unsupported_by_evidence",
        )

    def test_official_web_release_gate_cases_project_fail_close_semantic_truth(self) -> None:
        cases = {case.case_id: case for case in official_web_release_gate_cases()}

        self.assertEqual(
            cases[
                "official-web-release-gate-freshness-sensitive-no-answer"
            ].expected_semantic_outcome,
            "freshness_fail_close",
        )
        self.assertEqual(
            cases["official-web-release-gate-freshness-sensitive-no-answer"].expected_scope_class,
            "in_scope",
        )
        self.assertEqual(
            cases[
                "official-web-release-gate-unanchored-life-service-no-answer"
            ].expected_semantic_outcome,
            "unsupported_by_evidence",
        )
        self.assertEqual(
            cases[
                "official-web-release-gate-unanchored-life-service-no-answer"
            ].expected_scope_class,
            "in_scope",
        )

    def test_policy_risk_and_grounding_release_gate_cases_cover_cross_cutting_semantics(
        self,
    ) -> None:
        cases = policy_risk_and_grounding_release_gate_cases()
        cases_by_id = {case.case_id: case for case in cases}

        self.assertEqual(len(cases), 4)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "policy-risk-release-gate-campus-political-course-audience",
                "policy-risk-release-gate-open-domain-political-fact",
                "policy-risk-release-gate-political-persuasion-refusal",
                "policy-risk-release-gate-unsupported-campus-policy-claim",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "no_answer",
                "rejected",
                "no_answer",
            ),
        )
        self.assertEqual(
            tuple(case.expected_semantic_outcome for case in cases),
            (
                "grounded_answer",
                "out_of_scope",
                "policy_refusal",
                "unsupported_by_evidence",
            ),
        )
        self.assertEqual(
            cases_by_id[
                "policy-risk-release-gate-campus-political-course-audience"
            ].trace_expectation,
            TraceExpectation(
                selected_scope=CURRICULUM_SCOPE,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
                expected_capability="knowledge",
                expected_capability_family="knowledge",
            ),
        )
        self.assertEqual(
            cases_by_id[
                "policy-risk-release-gate-open-domain-political-fact"
            ].expected_policy_reason,
            "product_scope_boundary",
        )
        self.assertEqual(
            cases_by_id[
                "policy-risk-release-gate-political-persuasion-refusal"
            ].expected_policy_reason,
            "political_persuasion",
        )
        self.assertEqual(
            cases_by_id[
                "policy-risk-release-gate-unsupported-campus-policy-claim"
            ].trace_expectation,
            TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
                fail_closed_expected=True,
                expected_capability="knowledge",
                expected_capability_family="knowledge",
            ),
        )
        self.assertIn(
            "citation_required_answer",
            cases_by_id["policy-risk-release-gate-campus-political-course-audience"].tags,
        )
        self.assertEqual(
            cases_by_id[
                "policy-risk-release-gate-campus-political-course-audience"
            ].expected_retrieval_adequacy_verdict,
            "sufficient",
        )
        self.assertEqual(
            cases_by_id[
                "policy-risk-release-gate-campus-political-course-audience"
            ].expected_grounding_verdict,
            "grounded",
        )

        handbook_release_cases = {case.case_id: case for case in handbook_release_gate_cases()}
        clarification_case = handbook_release_cases["release-gate-needs-clarification"]
        self.assertIn("clarification_instead_of_guess", clarification_case.tags)
        self.assertEqual(clarification_case.expected_retrieval_adequacy_verdict, "ambiguous")
        self.assertEqual(
            clarification_case.expected_retrieval_adequacy_reason, "policy_object_missing"
        )
