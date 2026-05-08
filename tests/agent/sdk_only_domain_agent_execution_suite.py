from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AgentRequest,
    AuthorizationProjection,
    CampusNoticeGetPayload,
    ContextProjection,
    ServiceGuideLookupPayload,
)
from campus_supervisor_agent_worker.agents_sdk_runner import AgentsSdkToolExecutionRequest

from tests.agent.campus_services_agent_fakes import FakeCampusServicesQueryService
from tests.agent.test_notice_agent import _FakeNoticeQueryService


class SdkOnlyDomainAgentExecutionTest(unittest.TestCase):
    def test_campus_services_sdk_tool_executor_projects_bounded_result(self) -> None:
        from campus_services_agent.sdk_tool_executor import execute_campus_services_sdk_tool

        request = AgentRequest(
            target="campus-services-agent",
            user_goal="校园卡丢了怎么办",
            payload=ServiceGuideLookupPayload(
                service_query="校园卡丢了怎么办",
                guide_focus="full_guide",
            ),
            allowed_tools=("service_guide_lookup",),
        )

        result = execute_campus_services_sdk_tool(
            AgentsSdkToolExecutionRequest(
                name="service_guide_lookup",
                arguments={
                    "service_query": "校园卡丢了怎么办",
                    "guide_focus": "full_guide",
                },
                call_id="call-service-guide-001",
            ),
            agent_request=request,
            query_service=FakeCampusServicesQueryService(),
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["outcome"], "resolved_current")
        self.assertEqual(result["service_query"], "校园卡丢了怎么办")
        self.assertIn("source_ref_count", result)
        self.assertNotIn("normalized_body", result)

    def test_notice_get_internal_runtime_preserves_internal_resolve_seam(self) -> None:
        from campus_notice_agent.notice_get_runtime import run_notice_get_internal_request

        response = run_notice_get_internal_request(
            AgentRequest(
                target="notice-agent",
                user_goal="读取这条通知",
                payload=CampusNoticeGetPayload(
                    notice_id="notice:2026-spring-holiday",
                    source_family="official_web_public_notice",
                ),
                allowed_tools=(),
                actor=ActorContext(user_id="student-001"),
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001"),
                    authorization=AuthorizationProjection(
                        principal_id="principal-001",
                        entitlement_groups=("students",),
                    ),
                ),
            ),
            query_service=_FakeNoticeQueryService(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.target, "notice-agent")
        self.assertIn("原文链接", response.answer_text)
        self.assertNotIn("春假时间为 5 月 1 日至 5 月 5 日", response.answer_text)


if __name__ == "__main__":
    unittest.main()
