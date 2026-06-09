from __future__ import annotations

import unittest
from pathlib import Path

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    CapabilityRequest,
    ContextProjection,
    RagRequestPayload,
    ServiceGuideLookupPayload,
    ServiceStatusLookupPayload,
)
from campus_knowledge_capability.rag_sdk_models import (
    RagQueryIntent,
    RagSdkEvidenceProjection,
    RagTaskKind,
)
from campus_supervisor_agent_worker.openai_agents_runtime import OpenAIAgentsToolInvocation
from campus_supervisor_agent_worker.tool_execution import (
    ToolExecutionContext,
    ToolExecutionError,
    ToolExecutionSession,
    build_default_tool_execution_registry,
)
from campus_supervisor_agent_worker.tool_spec_registry import default_tool_spec_registry

from tests.agent.campus_services_capability_fakes import FakeCampusServicesQueryService
from tests.agent.knowledge_capability_test_support import _make_handbook_source
from tests.agent.test_notice_capability import _FakeNoticeQueryService


class ToolExecutionRegistrySuite(unittest.TestCase):
    def test_notice_get_is_internal_function_not_closed(self) -> None:
        registry = default_tool_spec_registry()
        notice_get = registry.tool_by_name("campus_notice_get")

        self.assertIsNotNone(notice_get)
        assert notice_get is not None
        self.assertEqual(notice_get.surface, "capability_internal")
        self.assertEqual(notice_get.runtime_posture, "internal_function")
        self.assertFalse(notice_get.function_schema.available)

    def test_registry_executes_campus_services_structured_tool(self) -> None:
        registry = build_default_tool_execution_registry(
            campus_services_query_service=FakeCampusServicesQueryService(),
            notice_query_service=_FakeNoticeQueryService(),
        )

        result = registry.execute(
            OpenAIAgentsToolInvocation(
                name="service_guide_lookup",
                arguments={
                    "service_query": "校园卡丢了怎么办",
                    "guide_focus": "full_guide",
                },
                call_id="call-service-guide-001",
            ),
            context=ToolExecutionContext(
                agent_request=CapabilityRequest(
                    capability="campus_services",
                    user_goal="校园卡丢了怎么办",
                    payload=ServiceGuideLookupPayload(
                        service_query="校园卡丢了怎么办",
                        guide_focus="full_guide",
                    ),
                    allowed_tools=("service_guide_lookup",),
                )
            ),
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["service_query"], "校园卡丢了怎么办")

    def test_registry_executes_notice_internal_function(self) -> None:
        registry = build_default_tool_execution_registry(
            campus_services_query_service=FakeCampusServicesQueryService(),
            notice_query_service=_FakeNoticeQueryService(),
        )

        result = registry.execute_internal_function(
            "campus_notice_get",
            context=ToolExecutionContext(
                agent_request=CapabilityRequest(
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
            ),
        )

        self.assertEqual(result.status, "completed")
        self.assertEqual(result.capability, "notice")
        self.assertIn("原文链接", result.answer_text)

    def test_registry_executes_rag_sdk_internal_function(self) -> None:
        registry = build_default_tool_execution_registry(
            campus_services_query_service=FakeCampusServicesQueryService(),
            notice_query_service=_FakeNoticeQueryService(),
        )

        result = registry.execute(
            OpenAIAgentsToolInvocation(
                name="retrieve_evidence",
                arguments={
                    "query_slot_id": "indexed-lookup",
                    "retrieval_intent": "policy_lookup",
                },
                call_id="call-rag-sdk-001",
            ),
            context=ToolExecutionContext(
                rag_sdk_request=_rag_sdk_request(),
            ),
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["query_slot_id"], "indexed-lookup")
        self.assertEqual(result["source_count"], 1)

    def test_registry_rejects_closed_tool_execution(self) -> None:
        registry = build_default_tool_execution_registry(
            campus_services_query_service=FakeCampusServicesQueryService(),
            notice_query_service=_FakeNoticeQueryService(),
        )

        with self.assertRaisesRegex(ToolExecutionError, "closed"):
            registry.execute(
                OpenAIAgentsToolInvocation(
                    name="retrieval.query",
                    arguments={},
                    call_id="call-rag-closed-001",
                ),
                context=ToolExecutionContext(
                    agent_request=CapabilityRequest(
                        capability="knowledge",
                        user_goal="奖学金",
                        payload=RagRequestPayload(),
                    )
                ),
            )

    def test_session_dispatches_model_facing_and_internal_paths_through_same_registry(self) -> None:
        tool_registry = default_tool_spec_registry()
        execution_registry = build_default_tool_execution_registry(
            campus_services_query_service=FakeCampusServicesQueryService(),
            notice_query_service=_FakeNoticeQueryService(),
        )
        session = ToolExecutionSession(
            tool_registry=tool_registry,
            execution_registry=execution_registry,
        )

        structured_result = session.execute_sdk_tool(
            OpenAIAgentsToolInvocation(
                name="campus_notice_discover",
                arguments={"query_text": "春假通知"},
                call_id="call-notice-discover-001",
            ),
            context=ToolExecutionContext(
                agent_request=CapabilityRequest(
                    capability="notice",
                    user_goal="找春假通知",
                    payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
                    allowed_tools=("campus_notice_discover",),
                )
            ),
        )
        internal_result = session.execute_internal_function(
            "campus_notice_get",
            context=ToolExecutionContext(
                agent_request=CapabilityRequest(
                    capability="notice",
                    user_goal="读取通知",
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
            ),
        )

        self.assertEqual(structured_result["status"], "completed")
        self.assertEqual(internal_result.status, "completed")

    def test_session_rejects_sdk_tool_not_admitted_by_current_agent_request(self) -> None:
        session = ToolExecutionSession(
            tool_registry=default_tool_spec_registry(),
            execution_registry=build_default_tool_execution_registry(
                campus_services_query_service=FakeCampusServicesQueryService(),
                notice_query_service=_FakeNoticeQueryService(),
            ),
        )

        with self.assertRaisesRegex(ToolExecutionError, "not admitted"):
            session.execute_sdk_tool(
                OpenAIAgentsToolInvocation(
                    name="service_status_lookup",
                    arguments={"subject_query": "图书馆今天开门吗"},
                    call_id="call-wrong-tool-001",
                ),
                context=ToolExecutionContext(
                    agent_request=CapabilityRequest(
                        capability="campus_services",
                        user_goal="校园卡丢了怎么办",
                        payload=ServiceGuideLookupPayload(
                            service_query="校园卡丢了怎么办",
                            guide_focus="full_guide",
                        ),
                        allowed_tools=("service_guide_lookup",),
                    )
                ),
            )

    def test_session_accepts_sdk_tool_admitted_by_current_agent_request(self) -> None:
        session = ToolExecutionSession(
            tool_registry=default_tool_spec_registry(),
            execution_registry=build_default_tool_execution_registry(
                campus_services_query_service=FakeCampusServicesQueryService(),
                notice_query_service=_FakeNoticeQueryService(),
            ),
        )

        result = session.execute_sdk_tool(
            OpenAIAgentsToolInvocation(
                name="service_status_lookup",
                arguments={"subject_query": "图书馆今天开门吗"},
                call_id="call-admitted-tool-001",
            ),
            context=ToolExecutionContext(
                agent_request=CapabilityRequest(
                    capability="campus_services",
                    user_goal="图书馆今天开门吗",
                    payload=ServiceStatusLookupPayload(subject_query="图书馆今天开门吗"),
                    allowed_tools=("service_status_lookup",),
                )
            ),
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["outcome"], "resolved_current")

    def test_registry_refuses_internal_function_posture_in_sdk_descriptor_surface(self) -> None:
        tool_registry = default_tool_spec_registry()
        internal_function = tool_registry.tool_by_name("campus_notice_get")
        assert internal_function is not None
        self.assertEqual(internal_function.runtime_posture, "internal_function")
        self.assertFalse(internal_function.function_schema.available)

    def test_agent_delegate_source_does_not_call_domain_sdk_helpers_directly(self) -> None:
        source = Path(
            "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/capability_delegates.py"
        )
        text = source.read_text(encoding="utf-8")

        for fragment in (
            "execute_notice_sdk_tool(",
            "execute_campus_services_sdk_tool(",
            "run_notice_get_internal_request(",
        ):
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, text)


def _rag_sdk_request():
    projection = RagSdkEvidenceProjection.from_evidence_bundle(_evidence_bundle())
    return _make_rag_sdk_request(projection)


def _make_rag_sdk_request(projection: RagSdkEvidenceProjection):
    from campus_knowledge_capability.rag_sdk_models import RagSdkRunRequest

    return RagSdkRunRequest(
        user_goal="有哪些本科生可以申请的奖学金",
        query_intent=RagQueryIntent(
            task_kind=RagTaskKind.SPECIFIC_POLICY_LOOKUP,
            normalized_query="有哪些本科生可以申请的奖学金",
            admitted_query_slot_ids=("indexed-lookup",),
        ),
        evidence=projection,
        request_id="req-rag-sdk-001",
    )


def _evidence_bundle():
    from campus_contracts import EvidenceBundle

    return EvidenceBundle(
        query_text="有哪些本科生可以申请的奖学金",
        corpus="regulations",
        collection="student_rules",
        sources=(
            _make_handbook_source(
                doc_id="handbook:scholarship",
                title="奖学金评审办法",
                snippet="本科生可申请国家奖学金。",
                score=0.96,
                chunk_id_suffix="scholarship-1",
                content_role="policy_basis",
                is_answer_bearing=True,
            ),
        ),
    )


if __name__ == "__main__":
    unittest.main()
