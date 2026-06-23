from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.online_answer_path_eval import (
    ONLINE_ANSWER_PATH_CASES_PATH,
    OnlineAnswerPathObservation,
    build_online_answer_path_report,
    load_online_answer_path_cases,
)


class OnlineAnswerPathEvalTest(unittest.TestCase):
    def test_loads_online_answer_path_fixture_with_happy_and_fail_close_cases(self) -> None:
        self.assertTrue(ONLINE_ANSWER_PATH_CASES_PATH.exists())

        case_set = load_online_answer_path_cases()

        self.assertEqual(case_set.schema_version, 1)
        self.assertEqual(case_set.case_family, "online_answer_path.v1")
        case_ids = {case.case_id for case in case_set.cases}
        self.assertIn("online-answer-service-guide-happy-path", case_ids)
        self.assertIn("online-answer-policy-unavailable-fail-close", case_ids)
        self.assertIn("online-answer-transport-schedule-routing", case_ids)
        self.assertIn("online-answer-notice-title-url-card", case_ids)

    def test_fixture_covers_user_journey_and_boundary_denominator(self) -> None:
        case_set = load_online_answer_path_cases()
        case_ids = {case.case_id for case in case_set.cases}

        self.assertTrue(
            {
                "online-answer-service-guide-happy-path",
                "online-answer-medical-reimbursement-service-guide",
                "online-answer-transport-schedule-routing",
                "online-answer-academic-calendar-date-week",
                "online-answer-academic-calendar-named-event",
                "online-answer-academic-calendar-spring-break-colloquial",
                "online-answer-academic-calendar-course-suspension",
                "online-answer-academic-calendar-notice-rest-day-override",
                "online-answer-notice-spring-break-original",
                "online-answer-notice-title-url-card",
                "online-answer-notice-detail-summary",
                "online-answer-contextual-follow-up-materials",
                "online-answer-transactional-service-fail-close",
                "online-answer-no-hit-safe-response",
                "online-answer-policy-unavailable-fail-close",
            }.issubset(case_ids)
        )
        terminal_statuses = {case.expected.terminal_status for case in case_set.cases}
        semantic_outcomes = {case.expected.semantic_outcome for case in case_set.cases}
        self.assertTrue(
            {"completed", "needs_clarification", "no_answer", "error"}.issubset(terminal_statuses)
        )
        self.assertTrue(
            {"answered", "clarification", "fail_close", "no_hit"}.issubset(semantic_outcomes)
        )

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

    def test_report_fails_missing_source_url_for_happy_path_contract(self) -> None:
        case_set = load_online_answer_path_cases()
        observations = {
            "online-answer-service-guide-happy-path": OnlineAnswerPathObservation(
                case_id="online-answer-service-guide-happy-path",
                request_id="req_service_guide_001",
                trace_id="trace_service_guide_001",
                selected_capability="campus_services",
                terminal_status="completed",
                semantic_outcome="answered",
                response_contract={
                    "answer_text_present": True,
                    "citations_present": True,
                    "cards_present": True,
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
        self.assertFalse(failing["online-answer-service-guide-happy-path"].passed)
        self.assertIn(
            "response_contract.source_url_present",
            failing["online-answer-service-guide-happy-path"].reason,
        )
        self.assertIn(
            "missing observation", failing["online-answer-policy-unavailable-fail-close"].reason
        )

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
        self.assertEqual(payload["case_family"], "online_answer_path.v1")
        self.assertEqual(payload["summary"]["passed"], len(case_set.cases))


if __name__ == "__main__":
    unittest.main()
