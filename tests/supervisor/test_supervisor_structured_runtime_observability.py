from __future__ import annotations

import unittest

from campus_contracts import (
    CampusNoticeGetResult,
    ServiceStatusLookupResult,
    SpecialistResponse,
)
from campus_evals.app_api_chat_runtime_decoding import _parse_supervisor_observability
from campus_supervisor_core.response import build_supervisor_observability_from_specialist_response


class SupervisorStructuredRuntimeObservabilityTest(unittest.TestCase):
    def test_service_status_observability_exposes_structured_runtime_summary(self) -> None:
        observability = build_supervisor_observability_from_specialist_response(
            SpecialistResponse(
                target="campus-services-agent",
                status="completed",
                answer_text="海淀校区图书馆当前开放。",
                confidence="high",
                result=ServiceStatusLookupResult(
                    subject_query="图书馆今天开门吗",
                    outcome="resolved_current",
                    resolved_subject="海淀校区图书馆",
                    observed_status="open",
                    queried_time_anchor="2026-04-21T10:30:00+08:00",
                ),
            )
        )

        self.assertIsNotNone(observability)
        assert observability is not None
        self.assertEqual(observability.scope_class, "in_scope")
        self.assertEqual(observability.selected_tool, "service_status_lookup")
        self.assertEqual(observability.tool_business_outcome, "resolved_current")
        self.assertEqual(observability.temporal_posture, "current")

    def test_notice_get_observability_exposes_notice_source_family_summary(self) -> None:
        observability = build_supervisor_observability_from_specialist_response(
            SpecialistResponse(
                target="notice-agent",
                status="completed",
                answer_text="这是通知正文。",
                confidence="high",
                result=CampusNoticeGetResult(
                    notice_id="notice:2026-spring-break",
                    outcome="resolved_current",
                    title="2026年春假安排通知",
                    source_family="internal_notice_restricted",
                    source_url="https://portal.example/notice/2026-spring-break",
                    normalized_body="正文。",
                ),
            )
        )

        self.assertIsNotNone(observability)
        assert observability is not None
        self.assertEqual(observability.scope_class, "in_scope")
        self.assertEqual(observability.selected_tool, "campus_notice_get")
        self.assertEqual(observability.notice_source_family_summary, "internal_notice_restricted")

    def test_eval_decoder_parses_structured_runtime_observability_fields(self) -> None:
        observability = _parse_supervisor_observability(
            {
                "retrievalAttempted": False,
                "scopeClass": "in_scope",
                "selectedTool": "transport_schedule_lookup",
                "toolBusinessOutcome": "clarification_required",
                "toolFailCloseReason": "",
                "toolHistoricalDowngradeReason": "",
                "noticeSourceFamilySummary": "",
                "temporalPosture": "as_of",
                "intentCapability": "knowledge",
                "intentTaskKind": "knowledge_lookup",
                "intentLaunchState": "candidate_only",
                "intentNextAction": "delegate",
                "intentScopeClass": "in_scope",
                "intentScopeReason": "structured_runtime_candidate_signal",
                "intentPolicyReason": "",
                "intentClassifierVersion": "deterministic-intent-v1",
            }
        )

        self.assertIsNotNone(observability)
        assert observability is not None
        self.assertEqual(observability.selected_tool, "transport_schedule_lookup")
        self.assertEqual(observability.tool_business_outcome, "clarification_required")
        self.assertEqual(observability.temporal_posture, "as_of")
        self.assertEqual(observability.intent_capability, "knowledge")
        self.assertEqual(observability.intent_task_kind, "knowledge_lookup")
        self.assertEqual(observability.intent_launch_state, "candidate_only")
        self.assertEqual(observability.intent_next_action, "delegate")
        self.assertEqual(observability.intent_scope_class, "in_scope")
        self.assertEqual(
            observability.intent_scope_reason,
            "structured_runtime_candidate_signal",
        )
        self.assertEqual(observability.intent_classifier_version, "deterministic-intent-v1")


if __name__ == "__main__":
    unittest.main()
