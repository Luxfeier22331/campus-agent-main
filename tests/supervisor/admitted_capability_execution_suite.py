from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    CapabilityRequest,
    ContextProjection,
    ServiceGuideLookupPayload,
    WorkflowCapabilityContext,
)
from campus_supervisor_agent_worker.admitted_capability_execution import (
    AdmittedCapabilityExecutor,
)
from campus_supervisor_agent_worker.settings import ApiSettings
from campus_supervisor_agent_worker.tool_execution import (
    build_default_tool_execution_session,
)
from campus_supervisor_agent_worker.tool_spec_registry import default_tool_spec_registry

from tests.agent.campus_services_capability_fakes import FakeCampusServicesQueryService
from tests.agent.test_notice_capability import _FakeNoticeQueryService


class AdmittedCapabilityExecutionSuite(unittest.TestCase):
    def test_plan_marks_structured_handoff_request_as_sdk_agent_execution(self) -> None:
        executor = _executor()

        plan = executor.plan(
            CapabilityRequest(
                capability="campus_services",
                user_goal="校园卡丢了怎么办",
                payload=ServiceGuideLookupPayload(
                    service_query="校园卡丢了怎么办",
                    guide_focus="full_guide",
                ),
                allowed_tools=("service_guide_lookup",),
            )
        )

        self.assertEqual(plan.mode, "sdk_agent_execution")
        self.assertEqual(plan.runtime_posture, "typed_activity_admitted")
        self.assertIsNone(plan.internal_function_tool)

    def test_plan_marks_notice_get_as_internal_function(self) -> None:
        executor = _executor()

        plan = executor.plan(
            CapabilityRequest(
                capability="notice",
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
            CapabilityRequest(
                capability="notice",
                user_goal="找春假通知",
                payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
                allowed_tools=("service_status_lookup",),
            )
        )

        self.assertEqual(plan.mode, "not_admitted")
        self.assertEqual(plan.failure_class, "request_not_admitted")
        self.assertIn("allowed_tools", plan.message)

    def test_execute_preplanned_structured_handoff_does_not_require_sdk_runtime(
        self,
    ) -> None:
        query_service = FakeCampusServicesQueryService()
        registry = default_tool_spec_registry()
        executor = AdmittedCapabilityExecutor(
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
            CapabilityRequest(
                capability="campus_services",
                user_goal="校园卡丢了怎么办",
                payload=ServiceGuideLookupPayload(
                    service_query="校园卡丢了怎么办",
                    guide_focus="full_guide",
                ),
                allowed_tools=("service_guide_lookup",),
                actor=ActorContext(user_id="student-001"),
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001"),
                    authorization=AuthorizationProjection(
                        principal_id="principal-001",
                        entitlement_groups=("students",),
                    ),
                ),
                workflow_context=WorkflowCapabilityContext(
                    capability="campus_services",
                    workflow_run_ref="workflow:req-missing-runtime",
                    step_id="handoff:campus_services:service_guide_lookup",
                    capability_id="campus_services",
                ),
            )
        )

        self.assertEqual(response.capability, "campus_services")
        self.assertEqual(response.status, "completed")
        self.assertIsNone(response.error)
        self.assertIsNotNone(response.capability_observability)
        assert response.capability_observability is not None
        self.assertEqual(
            response.capability_observability.selected_tool,
            "service_guide_lookup",
        )
        self.assertIsNotNone(query_service.last_service_guide_query)

    def test_execute_uses_provided_admission_without_revalidating_request(self) -> None:
        query_service = FakeCampusServicesQueryService()
        base_registry = default_tool_spec_registry()

        class _ObservedRegistry:
            def __init__(self, wrapped) -> None:
                self._wrapped = wrapped
                self.validate_calls = 0

            def validate_allowed_tools_for_request(self, request):
                self.validate_calls += 1
                return self._wrapped.validate_allowed_tools_for_request(request)

            def tool_by_name(self, name):
                return self._wrapped.tool_by_name(name)

            def payload_kind_for_request(self, target, payload):
                return self._wrapped.payload_kind_for_request(target, payload)

        registry = _ObservedRegistry(base_registry)
        executor = AdmittedCapabilityExecutor(
            settings=ApiSettings(agents_sdk_runtime_enabled=True),
            runtime=None,
            tool_execution_session=build_default_tool_execution_session(
                campus_services_query_service=query_service,
                notice_query_service=_FakeNoticeQueryService(),
                tool_registry=base_registry,
            ),
            tool_registry=registry,
        )
        request = CapabilityRequest(
            capability="campus_services",
            user_goal="校园卡丢了怎么办",
            payload=ServiceGuideLookupPayload(
                service_query="校园卡丢了怎么办",
                guide_focus="full_guide",
            ),
            allowed_tools=("service_guide_lookup",),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001"),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    entitlement_groups=("students",),
                ),
            ),
            workflow_context=WorkflowCapabilityContext(
                capability="campus_services",
                workflow_run_ref="workflow:req-provided-admission",
                step_id="handoff:campus_services:service_guide_lookup",
                capability_id="campus_services",
            ),
        )
        admission = base_registry.validate_allowed_tools_for_request(request)
        response = executor.execute(request, admission=admission)

        self.assertEqual(response.status, "completed")
        self.assertIsNone(response.error)
        self.assertEqual(registry.validate_calls, 0)

    def test_execute_marks_preplanned_query_service_exception_non_retryable(self) -> None:
        class _FailingRuntime:
            def lookup_service_guide(self, query):
                del query
                raise RuntimeError("query backend contract drift")

        registry = default_tool_spec_registry()
        executor = AdmittedCapabilityExecutor(
            settings=ApiSettings(agents_sdk_runtime_enabled=True),
            runtime=None,
            tool_execution_session=build_default_tool_execution_session(
                campus_services_query_service=_FailingRuntime(),
                notice_query_service=_FakeNoticeQueryService(),
                tool_registry=registry,
            ),
            tool_registry=registry,
        )

        response = executor.execute(
            CapabilityRequest(
                capability="campus_services",
                user_goal="校园卡丢了怎么办",
                payload=ServiceGuideLookupPayload(
                    service_query="校园卡丢了怎么办",
                    guide_focus="full_guide",
                ),
                allowed_tools=("service_guide_lookup",),
                actor=ActorContext(user_id="student-001"),
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001"),
                    authorization=AuthorizationProjection(
                        principal_id="principal-001",
                        entitlement_groups=("students",),
                    ),
                ),
                workflow_context=WorkflowCapabilityContext(
                    capability="campus_services",
                    workflow_run_ref="workflow:req-sdk-runtime-failed",
                    step_id="handoff:campus_services:service_guide_lookup",
                    capability_id="campus_services",
                ),
            )
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.error)
        assert response.error is not None
        self.assertFalse(response.error.retryable)
        self.assertIsNotNone(response.capability_observability)
        assert response.capability_observability is not None
        self.assertEqual(
            response.capability_observability.failure_class, "internal_query_service_failed"
        )


def _executor() -> AdmittedCapabilityExecutor:
    registry = default_tool_spec_registry()
    return AdmittedCapabilityExecutor(
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
