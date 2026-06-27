import unittest

from campus_evals.online_answer_main_path_cases import (
    ONLINE_ANSWER_MAIN_PATH_CASES_PATH,
    load_online_answer_main_path_cases,
)


class OnlineAnswerMainPathCasesTest(unittest.TestCase):
    def test_main_path_cases_are_a_release_sized_product_dataset(self) -> None:
        case_set = load_online_answer_main_path_cases()

        self.assertTrue(ONLINE_ANSWER_MAIN_PATH_CASES_PATH.exists())
        self.assertEqual("online_answer_main_path.v1", case_set.case_family)
        self.assertEqual(52, len(case_set.cases))
        self.assertEqual(
            len(case_set.cases),
            len({case.case_id for case in case_set.cases}),
        )

    def test_main_path_cases_cover_required_domains_and_outcomes(self) -> None:
        case_set = load_online_answer_main_path_cases()

        domains = {case.domain for case in case_set.cases}
        outcomes = {case.expected.terminal_outcome for case in case_set.cases}
        self.assertTrue(
            {
                "student_rules",
                "curriculum_plan",
                "institutional_rules",
                "official_web",
                "notice",
                "campus_services",
                "memory_personalization",
                "ambiguity",
            }.issubset(domains)
        )
        self.assertTrue({"completed", "clarification", "fail_closed"}.issubset(outcomes))

    def test_main_path_cases_pin_runtime_trace_contract(self) -> None:
        case_set = load_online_answer_main_path_cases()

        for case in case_set.cases:
            with self.subTest(case_id=case.case_id):
                self.assertTrue(case.user_utterance.strip())
                self.assertTrue(case.expected.selected_tool.strip())
                self.assertTrue(case.expected.answer_contract)
                self.assertTrue(case.expected.trace_contract.required_stages)
                self.assertTrue(case.expected.source_truth.expected_collections)


if __name__ == "__main__":
    unittest.main()
