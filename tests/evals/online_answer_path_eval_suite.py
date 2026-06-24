from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.online_answer_path_eval import (
    ONLINE_ANSWER_PATH_CASES_PATH,
    ONLINE_ANSWER_PATH_RELEASE_SPLITS,
    ONLINE_ANSWER_PRODUCT_PATH_CASES_PATH,
    OnlineAnswerPathObservation,
    build_online_answer_path_report,
    filter_online_answer_path_cases,
    load_online_answer_path_cases,
)


class OnlineAnswerPathEvalTest(unittest.TestCase):
    def test_loads_online_answer_path_fixture_as_main_path_release_dataset(self) -> None:
        self.assertTrue(ONLINE_ANSWER_PATH_CASES_PATH.exists())

        case_set = load_online_answer_path_cases()

        self.assertEqual(case_set.schema_version, 1)
        self.assertEqual(case_set.case_family, "online_answer_main_path.v1")
        self.assertEqual(len(case_set.cases), 52)
        case_ids = {case.case_id for case in case_set.cases}
        self.assertIn("main-institutional-campus-network-password", case_ids)
        self.assertIn("main-student-rules-transfer-policy", case_ids)
        self.assertIn("main-curriculum-required-course", case_ids)
        self.assertIn("main-fail-closed-no-source", case_ids)

    def test_fixture_covers_main_path_domains_and_current_release_splits(self) -> None:
        case_set = load_online_answer_path_cases()
        domains = {
            case.response_contract["domain"]
            for case in case_set.cases
            if isinstance(case.response_contract.get("domain"), str)
        }
        splits = {case.split for case in case_set.cases}

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
        terminal_statuses = {case.expected.terminal_status for case in case_set.cases}
        semantic_outcomes = {case.expected.semantic_outcome for case in case_set.cases}
        self.assertTrue({"release_gate", "clarification", "fail_closed"}.issubset(splits))
        self.assertTrue({"completed", "needs_clarification", "error"}.issubset(terminal_statuses))
        self.assertTrue({"answered", "clarification", "fail_close"}.issubset(semantic_outcomes))

    def test_release_filter_keeps_only_current_default_main_path_cases(self) -> None:
        case_set = load_online_answer_path_cases()

        release_case_set = filter_online_answer_path_cases(case_set)
        release_ids = {case.case_id for case in release_case_set.cases}

        self.assertEqual(ONLINE_ANSWER_PATH_RELEASE_SPLITS, ("release_gate", "regression_locked"))
        self.assertEqual(len(release_case_set.cases), 24)
        self.assertTrue(
            {
                "main-student-rules-transfer-policy",
                "main-curriculum-required-course",
                "main-institutional-campus-network-password",
                "main-official-web-school-profile",
                "main-official-web-teaching-research-units",
                "main-official-web-fee-disclosure",
            }.issubset(release_ids)
        )
        self.assertFalse(
            {
                "main-official-web-deadline-news",
                "main-notice-spring-break-summary",
                "main-campus-card-lost",
                "main-memory-major-context",
                "main-fail-closed-no-source",
            }.intersection(release_ids)
        )

    def test_product_path_fixture_requires_explicit_path(self) -> None:
        case_set = load_online_answer_path_cases(ONLINE_ANSWER_PRODUCT_PATH_CASES_PATH)

        self.assertEqual(case_set.case_family, "online_answer_path.v1")
        case_ids = {case.case_id for case in case_set.cases}
        self.assertIn("online-answer-service-guide-happy-path", case_ids)
        self.assertNotIn("main-institutional-campus-network-password", case_ids)

    def test_report_requires_request_trace_target_terminal_status_and_semantic_outcome(
        self,
    ) -> None:
        case_set = load_online_answer_path_cases()
        observations = {
            case.case_id: OnlineAnswerPathObservation(
                case_id=case.case_id,
                request_id=f"req_{index}",
                trace_id=f"trace_{index}",
                selected_capability=case.expected.selected_capability,
                terminal_status=case.expected.terminal_status,
                semantic_outcome=case.expected.semantic_outcome,
                fail_close_reason=case.expected.fail_close_reason,
                response_contract=dict(case.expected.response_contract),
                operator_backflow=dict(case.expected.operator_backflow),
            )
            for index, case in enumerate(case_set.cases, start=1)
        }

        report = build_online_answer_path_report(case_set.cases, observations)

        self.assertTrue(report.passed)
        self.assertEqual(report.total, len(case_set.cases))
        self.assertEqual(report.passed_count, len(case_set.cases))
        self.assertEqual(report.results[0].request_id, "req_1")
        self.assertEqual(report.results[0].trace_id, "trace_1")

    def test_report_fails_missing_answer_contract_for_main_path_case(self) -> None:
        case_set = load_online_answer_path_cases()
        observations = {
            "main-institutional-campus-network-password": OnlineAnswerPathObservation(
                case_id="main-institutional-campus-network-password",
                request_id="req_service_guide_001",
                trace_id="trace_service_guide_001",
                selected_capability="knowledge",
                terminal_status="completed",
                semantic_outcome="answered",
                response_contract={
                    "answer_text_present": True,
                    "citations_present": True,
                    "cards_present": False,
                    "source_url_present": False,
                },
                operator_backflow={
                    "quality_candidate_supported": True,
                    "trace_backlink_present": True,
                },
            )
        }

        report = build_online_answer_path_report(case_set.cases, observations)

        self.assertFalse(report.passed)
        failing = {result.case_id: result for result in report.results}
        self.assertFalse(failing["main-institutional-campus-network-password"].passed)
        self.assertIn(
            "response_contract.must_not_hallucinate",
            failing["main-institutional-campus-network-password"].reason,
        )
        self.assertIn("missing observation", failing["main-fail-closed-no-source"].reason)

    def test_report_rejects_raw_payload_keys(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            OnlineAnswerPathObservation(
                case_id="online-answer-service-guide-happy-path",
                request_id="req_service_guide_001",
                trace_id="trace_service_guide_001",
                selected_capability="campus_services",
                terminal_status="completed",
                semantic_outcome="answered",
                response_contract={"rawTranscript": "do not persist"},
            )

    def test_report_writes_machine_readable_artifact(self) -> None:
        case_set = load_online_answer_path_cases()
        observations = {
            case.case_id: OnlineAnswerPathObservation(
                case_id=case.case_id,
                request_id=f"req_{index}",
                trace_id=f"trace_{index}",
                selected_capability=case.expected.selected_capability,
                terminal_status=case.expected.terminal_status,
                semantic_outcome=case.expected.semantic_outcome,
                fail_close_reason=case.expected.fail_close_reason,
                response_contract=dict(case.expected.response_contract),
                operator_backflow=dict(case.expected.operator_backflow),
            )
            for index, case in enumerate(case_set.cases, start=1)
        }

        with TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "online-answer-path-e2e.json"
            report = build_online_answer_path_report(
                case_set.cases,
                observations,
                output_path=output_path,
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(payload["schema_version"], 1)
        self.assertEqual(payload["case_family"], "online_answer_main_path.v1")
        self.assertEqual(payload["summary"]["passed"], len(case_set.cases))


if __name__ == "__main__":
    unittest.main()
