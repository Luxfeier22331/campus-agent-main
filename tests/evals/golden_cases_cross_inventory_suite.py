from __future__ import annotations

from tests.evals.golden_cases_test_support import (
    CURRICULUM_SCOPE,
    build_curriculum_program_semester_fact_document_id,
    curriculum_regression_locked_cases,
    curriculum_release_gate_cases,
    curriculum_smoke_cases,
    unittest,
)


class RunCasesCrossInventoryTest(unittest.TestCase):
    def test_curriculum_release_gate_follow_up_cases_keep_resolved_semantic_user_goal(self) -> None:
        cases = {case.case_id: case for case in curriculum_release_gate_cases()}
        law_follow_up_doc_id = build_curriculum_program_semester_fact_document_id(
            "curriculum:法学（民族实验班）本科人才培养方案",
            "第四学期",
        )
        history_follow_up_doc_id = build_curriculum_program_semester_fact_document_id(
            "curriculum:历史学（强基计划）本科人才培养方案",
            "第四学期",
        )

        law_case = cases["curriculum-release-gate-program-follow-up-session-replay"]
        self.assertEqual(law_case.user_goal, "法学民族班培养方案里大二下有什么课")
        self.assertEqual(
            law_case.conversation_turns,
            (
                "法学民族班培养方案里大一上有什么课",
                "那大二下呢",
            ),
        )
        self.assertEqual(
            law_case.expected_sources[0].doc_id,
            law_follow_up_doc_id,
        )
        self.assertEqual(
            law_case.expected_sources[0].canonical_source_id,
            "curriculum:法学（民族实验班）本科人才培养方案",
        )
        self.assertEqual(
            law_case.expected_sources[0].source_unit_kind,
            "semester_course_list",
        )
        self.assertEqual(
            law_case.expected_sources[0].source_unit_key,
            "semester-4",
        )
        self.assertEqual(
            law_case.required_facts,
            ("中国少数民族文字学", "侵权责任法"),
        )

        history_case = cases["curriculum-release-gate-strong-base-follow-up-session-replay"]
        self.assertEqual(history_case.user_goal, "历史学强基计划培养方案里大二下有什么课")
        self.assertEqual(
            history_case.conversation_turns,
            (
                "历史学强基计划培养方案里大一上有什么课",
                "那大二下呢",
            ),
        )
        self.assertEqual(
            history_case.expected_sources[0].doc_id,
            history_follow_up_doc_id,
        )
        self.assertEqual(
            history_case.expected_sources[0].canonical_source_id,
            "curriculum:历史学（强基计划）本科人才培养方案",
        )
        self.assertEqual(
            history_case.expected_sources[0].source_unit_kind,
            "semester_course_list",
        )
        self.assertEqual(
            history_case.expected_sources[0].source_unit_key,
            "semester-4",
        )
        self.assertEqual(
            history_case.required_facts,
            ("大学英语(四)", "中国近代边疆民族史料研读"),
        )

    def test_curriculum_course_fact_cases_use_internal_reference_context_ids(self) -> None:
        release_cases = {case.case_id: case for case in curriculum_release_gate_cases()}
        regression_cases = {case.case_id: case for case in curriculum_regression_locked_cases()}

        self.assertEqual(
            release_cases["curriculum-release-gate-course-family-membership"].reference_context_ids,
            ("course_facts:family-membership",),
        )
        self.assertEqual(
            release_cases[
                "curriculum-release-gate-course-family-audience-short-alias"
            ].reference_context_ids,
            ("course_facts:family-audience",),
        )
        self.assertEqual(
            release_cases["curriculum-release-gate-course-single-schedule"].reference_context_ids,
            ("course_facts:muc.xigai-semester",),
        )
        self.assertEqual(
            release_cases[
                "curriculum-release-gate-course-single-schedule-alias-variant"
            ].reference_context_ids,
            ("course_facts:muc.xigai-semester",),
        )

        self.assertEqual(
            regression_cases[
                "curriculum-regression-course-family-membership"
            ].reference_context_ids,
            ("course_facts:family-membership",),
        )
        self.assertEqual(
            regression_cases[
                "curriculum-regression-course-family-membership-sixiuke"
            ].reference_context_ids,
            ("course_facts:family-membership",),
        )
        self.assertEqual(
            regression_cases[
                "curriculum-regression-course-family-membership-sizhengkecheng"
            ].reference_context_ids,
            ("course_facts:family-membership",),
        )
        self.assertEqual(
            regression_cases["curriculum-regression-course-family-audience"].reference_context_ids,
            ("course_facts:family-audience",),
        )
        self.assertEqual(
            regression_cases[
                "curriculum-regression-course-family-partial-answer"
            ].reference_context_ids,
            ("course_facts:family-audience",),
        )
        self.assertEqual(
            regression_cases["curriculum-regression-course-single-audience"].reference_context_ids,
            ("course_facts:muc.xigai-audience",),
        )
        self.assertEqual(
            regression_cases[
                "curriculum-regression-course-single-schedule-partial-answer"
            ].reference_context_ids,
            ("course_facts:muc.xigai-semester",),
        )

        expected_family_schedule_reference_context_ids = (
            "course_facts:muc.marxist_basic_principles-semester",
            "course_facts:muc.modern_chinese_history_outline-semester",
            "course_facts:muc.mao_zedong_thought_and_theoretical_system-semester",
            "course_facts:muc.xigai-semester",
            "course_facts:muc.ideological_morality_and_rule_of_law-semester",
            "course_facts:muc.situation_and_policy-semester",
            "course_facts:muc.community_for_chinese_nation-semester",
        )
        self.assertEqual(
            regression_cases["curriculum-regression-course-family-schedule"].reference_context_ids,
            expected_family_schedule_reference_context_ids,
        )
        self.assertEqual(
            regression_cases[
                "curriculum-regression-course-family-schedule-short-alias"
            ].reference_context_ids,
            expected_family_schedule_reference_context_ids,
        )
        self.assertEqual(
            regression_cases[
                "curriculum-regression-course-family-schedule-alias-variant"
            ].reference_context_ids,
            expected_family_schedule_reference_context_ids,
        )
        self.assertEqual(
            regression_cases[
                "curriculum-regression-course-family-schedule-sixiuke"
            ].reference_context_ids,
            expected_family_schedule_reference_context_ids,
        )
        self.assertEqual(
            regression_cases[
                "curriculum-regression-course-family-schedule-partial-answer"
            ].reference_context_ids,
            expected_family_schedule_reference_context_ids,
        )

    def test_curriculum_smoke_cases_cover_stable_terminal_statuses(self) -> None:
        cases = curriculum_smoke_cases()

        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "curriculum-smoke-ethnology-title",
                "curriculum-smoke-academic-years",
                "curriculum-smoke-hanyu-international-credits",
                "curriculum-smoke-program-family-membership",
                "curriculum-smoke-program-family-innovation-membership",
                "curriculum-smoke-program-family-strong-base-membership",
                "curriculum-smoke-program-family-ethnic-experimental-membership",
                "curriculum-smoke-program-family-second-degree-membership-full-alias",
                "curriculum-smoke-no-answer",
                "curriculum-smoke-needs-clarification",
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
                "completed",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.source_type == "expert_authored" for case in cases))
        self.assertTrue(all(case.split == "smoke" for case in cases))
        self.assertTrue(all(case.scope == CURRICULUM_SCOPE for case in cases))

    def test_curriculum_regression_locked_cases_cover_high_risk_lanes(self) -> None:
        cases = curriculum_regression_locked_cases()

        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "curriculum-regression-history-strong-base",
                "curriculum-regression-history-strong-base-deictic-major",
                "curriculum-regression-course-map-unsupported",
                "curriculum-regression-general-english-credits",
                "curriculum-regression-minority-language-strong-base",
                "curriculum-regression-education-second-degree-years",
                "curriculum-regression-fiscal-core-credits",
                "curriculum-regression-course-family-membership",
                "curriculum-regression-course-family-membership-sixiuke",
                "curriculum-regression-course-family-membership-sizhengkecheng",
                "curriculum-regression-course-family-audience",
                "curriculum-regression-course-family-schedule",
                "curriculum-regression-course-family-schedule-short-alias",
                "curriculum-regression-course-family-schedule-alias-variant",
                "curriculum-regression-course-family-schedule-sixiuke",
                "curriculum-regression-course-family-partial-answer",
                "curriculum-regression-course-family-schedule-partial-answer",
                "curriculum-regression-course-single-schedule-partial-answer",
                "curriculum-regression-course-single-audience",
                "curriculum-regression-program-family-base-class-membership",
                "curriculum-regression-program-family-second-degree-membership",
                "curriculum-regression-program-family-second-degree-membership-alias-variant",
                "curriculum-regression-program-family-second-degree-membership-full-alias",
                "curriculum-regression-program-family-generic-experimental-membership",
                "curriculum-regression-program-family-generic-innovation-membership",
                "curriculum-regression-program-family-innovation-experimental-membership",
                "curriculum-regression-program-family-ethnic-experimental-membership",
                "curriculum-regression-program-family-strong-base-membership-full-alias",
                "curriculum-regression-program-family-name-pattern-experimental-membership",
                "curriculum-regression-program-family-name-pattern-innovation-membership",
                "curriculum-regression-no-answer-program",
                "curriculum-regression-needs-clarification-degree",
                "curriculum-regression-needs-clarification-deictic-experimental-class-with-verified-major",
                "curriculum-regression-needs-clarification-base-class-with-verified-major",
                "curriculum-regression-needs-clarification-ethnic-experimental-class",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
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
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
                "needs_clarification",
                "needs_clarification",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.source_type == "expert_authored" for case in cases))
        self.assertTrue(all(case.split == "regression_locked" for case in cases))
        self.assertTrue(all(case.scope == CURRICULUM_SCOPE for case in cases))
