from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.public_chat_product_path_eval import (
    PUBLIC_CHAT_PRODUCT_PATH_CASES_PATH,
    PublicChatProductPathObservation,
    build_public_chat_product_path_report,
    load_public_chat_product_path_cases,
)


class PublicChatProductPathEvalTest(unittest.TestCase):
    def test_loads_public_chat_product_path_fixture_with_happy_and_fail_close_cases(self) -> None:
        self.assertTrue(PUBLIC_CHAT_PRODUCT_PATH_CASES_PATH.exists())

        case_set = load_public_chat_product_path_cases()

        self.assertEqual(case_set.schema_version, 1)
        self.assertEqual(case_set.case_family, "public_chat_product_path.v1")
        case_ids = {case.case_id for case in case_set.cases}
        self.assertIn("public-chat-service-guide-happy-path", case_ids)
        self.assertIn("public-chat-policy-unavailable-fail-close", case_ids)
        self.assertIn("public-chat-transport-schedule-routing", case_ids)
        self.assertIn("public-chat-notice-title-url-card", case_ids)

    def test_fixture_covers_user_journey_and_boundary_denominator(self) -> None:
        case_set = load_public_chat_product_path_cases()
        case_ids = {case.case_id for case in case_set.cases}

        self.assertTrue(
            {
                "public-chat-service-guide-happy-path",
                "public-chat-medical-reimbursement-service-guide",
                "public-chat-transport-schedule-routing",
                "public-chat-academic-calendar-date-week",
                "public-chat-academic-calendar-named-event",
                "public-chat-academic-calendar-spring-break-colloquial",
                "public-chat-academic-calendar-course-suspension",
                "public-chat-academic-calendar-notice-rest-day-override",
                "public-chat-notice-spring-break-original",
                "public-chat-notice-title-url-card",
                "public-chat-notice-detail-summary",
                "public-chat-contextual-follow-up-materials",
                "public-chat-transactional-service-fail-close",
                "public-chat-no-hit-safe-response",
                "public-chat-policy-unavailable-fail-close",
            }.issubset(case_ids)
        )
        outcomes = {case.expected.terminal_outcome for case in case_set.cases}
        self.assertTrue({"completed", "clarification", "fail_close", "no_hit"}.issubset(outcomes))

    def test_report_requires_request_trace_target_and_terminal_outcome(self) -> None:
        case_set = load_public_chat_product_path_cases()
        observations = {
            case.case_id: PublicChatProductPathObservation(
                case_id=case.case_id,
                request_id=f"req_{index}",
                trace_id=f"trace_{index}",
                selected_capability=case.expected.selected_capability,
                terminal_outcome=case.expected.terminal_outcome,
                fail_close_reason=case.expected.fail_close_reason,
                response_contract=dict(case.expected.response_contract),
                operator_backflow=dict(case.expected.operator_backflow),
            )
            for index, case in enumerate(case_set.cases, start=1)
        }

        report = build_public_chat_product_path_report(case_set.cases, observations)

        self.assertTrue(report.passed)
        self.assertEqual(report.total, len(case_set.cases))
        self.assertEqual(report.passed_count, len(case_set.cases))
        self.assertEqual(report.results[0].request_id, "req_1")
        self.assertEqual(report.results[0].trace_id, "trace_1")

    def test_report_fails_missing_source_url_for_happy_path_contract(self) -> None:
        case_set = load_public_chat_product_path_cases()
        observations = {
            "public-chat-service-guide-happy-path": PublicChatProductPathObservation(
                case_id="public-chat-service-guide-happy-path",
                request_id="req_service_guide_001",
                trace_id="trace_service_guide_001",
                selected_capability="campus_services",
                terminal_outcome="completed",
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

        report = build_public_chat_product_path_report(case_set.cases, observations)

        self.assertFalse(report.passed)
        failing = {result.case_id: result for result in report.results}
        self.assertFalse(failing["public-chat-service-guide-happy-path"].passed)
        self.assertIn(
            "response_contract.source_url_present",
            failing["public-chat-service-guide-happy-path"].reason,
        )
        self.assertIn(
            "missing observation", failing["public-chat-policy-unavailable-fail-close"].reason
        )

    def test_report_rejects_raw_payload_keys(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            PublicChatProductPathObservation(
                case_id="public-chat-service-guide-happy-path",
                request_id="req_service_guide_001",
                trace_id="trace_service_guide_001",
                selected_capability="campus_services",
                terminal_outcome="completed",
                response_contract={"rawTranscript": "do not persist"},
            )

    def test_report_writes_machine_readable_artifact(self) -> None:
        case_set = load_public_chat_product_path_cases()
        observations = {
            case.case_id: PublicChatProductPathObservation(
                case_id=case.case_id,
                request_id=f"req_{index}",
                trace_id=f"trace_{index}",
                selected_capability=case.expected.selected_capability,
                terminal_outcome=case.expected.terminal_outcome,
                fail_close_reason=case.expected.fail_close_reason,
                response_contract=dict(case.expected.response_contract),
                operator_backflow=dict(case.expected.operator_backflow),
            )
            for index, case in enumerate(case_set.cases, start=1)
        }

        with TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "public-chat-product-path-e2e.json"
            report = build_public_chat_product_path_report(
                case_set.cases,
                observations,
                output_path=output_path,
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(payload["schema_version"], 1)
        self.assertEqual(payload["case_family"], "public_chat_product_path.v1")
        self.assertEqual(payload["summary"]["passed"], len(case_set.cases))


if __name__ == "__main__":
    unittest.main()
