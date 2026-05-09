from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AgentRequest,
    AuthorizationProjection,
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    ContextProjection,
    ServiceGuideLookupPayload,
    TransportScheduleLookupPayload,
    TransportServiceTimeQuery,
)
from campus_supervisor_agent_worker.admitted_agent_execution import (
    AdmittedAgentExecutor,
)
from campus_supervisor_agent_worker.settings import ApiSettings
from campus_supervisor_agent_worker.tool_execution import (
    build_default_tool_execution_session,
)
from campus_supervisor_agent_worker.tool_spec_registry import default_tool_spec_registry

from tests.agent.campus_services_agent_fakes import FakeCampusServicesQueryService
from tests.agent.test_notice_agent import _FakeNoticeQueryService


class AdmittedAgentExecutionSuite(unittest.TestCase):
    def test_plan_marks_structured_handoff_request_as_sdk_agent_execution(self) -> None:
        executor = _executor()

        plan = executor.plan(
            AgentRequest(
                target="campus-services-agent",
                user_goal="校园卡丢了怎么办",
                payload=ServiceGuideLookupPayload(
                    service_query="校园卡丢了怎么办",
                    guide_focus="full_guide",
                ),
                allowed_tools=("service_guide_lookup",),
            )
        )

        self.assertEqual(plan.mode, "sdk_agent_execution")
        self.assertEqual(plan.runtime_posture, "sdk_adapter_admitted")
        self.assertIsNone(plan.internal_function_tool)

    def test_plan_marks_notice_get_as_internal_function(self) -> None:
        executor = _executor()

        plan = executor.plan(
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
            )
        )

        self.assertEqual(plan.mode, "internal_function")
        self.assertEqual(plan.runtime_posture, "internal_function")
        assert plan.internal_function_tool is not None
        self.assertEqual(plan.internal_function_tool.name, "campus_notice_get")

    def test_plan_rejects_allowed_tool_drift(self) -> None:
        executor = _executor()

        plan = executor.plan(
            AgentRequest(
                target="notice-agent",
                user_goal="找春假通知",
                payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
                allowed_tools=("service_status_lookup",),
            )
        )

        self.assertEqual(plan.mode, "not_admitted")
        self.assertEqual(plan.failure_class, "request_not_admitted")
        self.assertIn("allowed_tools", plan.message)

    def test_execute_uses_deterministic_campus_services_fallback_when_runtime_missing(
        self,
    ) -> None:
        query_service = FakeCampusServicesQueryService()
        registry = default_tool_spec_registry()
        executor = AdmittedAgentExecutor(
            settings=ApiSettings(agents_sdk_runtime_enabled=True),
            runtime=None,
            tool_execution_session=build_default_tool_execution_session(
                campus_services_query_service=query_service,
                notice_query_service=_FakeNoticeQueryService(),
                tool_registry=registry,
            ),
            tool_registry=registry,
        )

        response = executor.execute(
            AgentRequest(
                target="campus-services-agent",
                user_goal="明天最早的班车几点",
                payload=TransportScheduleLookupPayload(
                    query_text="明天最早的班车几点",
                    intent="first_departure",
                    service_time_query=TransportServiceTimeQuery(
                        date_mode="tomorrow",
                        daypart="morning",
                    ),
                ),
                allowed_tools=("transport_schedule_lookup",),
                actor=ActorContext(user_id="student-001"),
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001"),
                    authorization=AuthorizationProjection(
                        principal_id="principal-001",
                        entitlement_groups=("students",),
                    ),
                ),
            )
        )

        self.assertEqual(response.target, "campus-services-agent")
        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(
            response.agent_observability.selected_tool,
            "transport_schedule_lookup",
        )
        self.assertIsNotNone(query_service.last_transport_schedule_query)
        assert query_service.last_transport_schedule_query is not None
        self.assertEqual(
            query_service.last_transport_schedule_query.payload.intent,
            "first_departure",
        )
        self.assertEqual(
            query_service.last_transport_schedule_query.access_context.actor.user_id,
            "student-001",
        )


def _executor() -> AdmittedAgentExecutor:
    registry = default_tool_spec_registry()
    return AdmittedAgentExecutor(
        settings=ApiSettings(agents_sdk_runtime_enabled=True),
        runtime=None,
        tool_execution_session=build_default_tool_execution_session(
            campus_services_query_service=FakeCampusServicesQueryService(),
            notice_query_service=_FakeNoticeQueryService(),
            tool_registry=registry,
        ),
        tool_registry=registry,
    )


if __name__ == "__main__":
    unittest.main()
