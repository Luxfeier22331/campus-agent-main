# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.contracts.contract_models_services_and_notice_suite_support import *


class ContractModelsServicesAndNoticeSuitePart02(unittest.TestCase):
    def test_notice_get_result_allows_reference_only_resolved_notice_without_body(self) -> None:
        result = CampusNoticeGetResult(
            notice_id="wechat:notice:muc:001",
            outcome="resolved_current",
            title="关于讲座安排的通知",
            source_family="wechat_public_notice",
            source_url="https://mp.weixin.qq.com/s/example",
            reference_only=True,
        )

        self.assertTrue(result.reference_only)
        self.assertEqual(result.normalized_body, "")

    def test_notice_context_projection_rejects_raw_body_fields(self) -> None:
        projection = NoticeContextProjection(
            projection_id="projection:notice_context:abc123",
            notice_ref=SelectedNoticeRef(
                notice_id="notice:muc-spring-break-2026",
                source_family="official_web_public_notice",
                title="2026年春假安排通知",
            ),
            content_hash="sha256:abc123",
            source_url="https://www.muc.edu.cn/info/2026-spring-break.htm",
            body_excerpt="春假安排短摘要。",
            bounded_summary="该通知说明春假安排，以官方链接为准。",
            extracted_facts=("春假安排以官方链接为准",),
        )

        payload = asdict(projection)

        self.assertNotIn("normalized_body", payload)
        self.assertEqual(payload["display_policy"]["public_surface"], "bounded_summary")
        self.assertTrue(payload["display_policy"]["full_body_forbidden"])

    def test_notice_display_policy_forbids_public_full_body_policy(self) -> None:
        with self.assertRaisesRegex(ValueError, "full_body_forbidden must be true"):
            NoticeDisplayPolicy(full_body_forbidden=False)

    def test_agent_request_rejects_notice_get_as_tool_facing_allowed_tool(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported allowed_tool: campus_notice_get"):
            ToolRequest(
                tool="campus_notice_get",
                user_goal="打开这条通知",
                payload=CampusNoticeGetPayload(notice_id="notice:muc-spring-break-2026"),
                allowed_tools=("campus_notice_get",),  # type: ignore[arg-type]
            )

    def test_agent_request_accepts_transport_schedule_payload(self) -> None:
        request = ToolRequest(
            tool="transport_schedule_lookup",
            user_goal="校车下一班几点",
            payload=TransportScheduleLookupPayload(
                query_text="校车下一班几点",
                intent="next_departure",
            ),
        )

        self.assertEqual(
            asdict(request)["payload"],
            {
                "query_text": "校车下一班几点",
                "intent": "next_departure",
                "route_selector": None,
                "snapshot_query": {
                    "mode": "current",
                    "as_of": "",
                    "year_hint": "",
                },
                "service_time_query": None,
                "result_limit": None,
            },
        )

    def test_tool_response_serializes_notice_get_result_shape(self) -> None:
        response = ToolResponse(
            tool="knowledge_query",
            status="completed",
            answer_text="这是当前可确认的春假通知正文。",
            confidence="high",
            result=CampusNoticeGetResult(
                notice_id="notice:muc-spring-break-2026",
                title="2026年春假安排通知",
                outcome="resolved_current",
                source_family="official_web_public_notice",
                source_url="https://www.muc.edu.cn/info/2026-spring-break.htm",
                canonical_url="https://www.muc.edu.cn/info/2026-spring-break.htm",
                body_excerpt="春假安排以官方链接为准。",
                published_at="2026-04-18",
                effective_at="2026-04-30",
                attachment_refs=("asset:notice-attachment-001",),
                provenance_refs=("projection:official_web_notice_projection_v1",),
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["result"]["notice_id"], "notice:muc-spring-break-2026")
        self.assertEqual(payload["result"]["source_family"], "official_web_public_notice")
        self.assertEqual(payload["result"]["display_policy"]["public_surface"], "card_only")
        self.assertEqual(payload["result"]["normalized_body"], "")
        self.assertEqual(
            tuple(payload["result"]["attachment_refs"]),
            ("asset:notice-attachment-001",),
        )
        self.assertEqual(
            tuple(payload["result"]["provenance_refs"]),
            ("projection:official_web_notice_projection_v1",),
        )

    def test_agent_request_rejects_missing_payload(self) -> None:
        with self.assertRaises(TypeError):
            ToolRequest(  # type: ignore[call-arg]
                tool="knowledge_query",
                user_goal="library hours",
            )

    def test_document_ref_and_error_defaults_are_stable(self) -> None:
        document_ref = DocumentRef(
            document_id="handbook:test-001",
            revision_track="source-faithful",
            version_id="v1:test-001",
            corpus="regulations",
            collection="student_rules",
            source_uri="https://campus.example/docs/test-001",
            content_hash="sha256:test-001",
        )
        error = ErrorInfo(code="retrieval_failed", message="Qdrant timeout")

        self.assertEqual(document_ref.corpus, "regulations")
        self.assertEqual(document_ref.collection, "student_rules")
        self.assertFalse(error.retryable)
        self.assertEqual(asdict(error)["message"], "Qdrant timeout")

    def test_document_ref_accepts_campus_services_transport_collection(self) -> None:
        transport_ref = DocumentRef(
            document_id="transport:schedule-001",
            revision_track="source-faithful",
            version_id="v1:schedule-001",
            corpus="campus_services",
            collection="transport_schedule",
            source_uri="https://www.muc.edu.cn/bus/schedule.htm",
            content_hash="sha256:schedule-001",
        )

        self.assertEqual(transport_ref.corpus, "campus_services")
        self.assertEqual(transport_ref.collection, "transport_schedule")


if __name__ == "__main__":
    unittest.main()
