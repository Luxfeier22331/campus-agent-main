from __future__ import annotations

import unittest

from campus_contracts import (
    AgentRequest,
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    RagRequestPayload,
    ServiceGuideLookupPayload,
    WorkflowAgentContext,
)
from campus_supervisor_agent_worker.generated.supervisor_execution_contract import (
    WorkflowPlanWire,
)
from campus_supervisor_agent_worker.openai_agents_workflow_plan import (
    OpenAIAgentsWorkflowPlanError,
    compile_openai_agents_workflow_plan,
    validate_agent_request_against_workflow_plan,
)


class OpenAIAgentsWorkflowPlanTest(unittest.TestCase):
    def test_compiles_go_single_step_plan_for_sdk_agent_execution(self) -> None:
        plan = compile_openai_agents_workflow_plan(
            _single_step_plan(),
            agent_request=_service_guide_request(),
        )

        self.assertEqual(plan.workflow_mode, "single_step")
        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].execution_mode, "sdk_agent_execution")
        self.assertEqual(
            plan.steps[0].step_id, "handoff:campus-services-agent:service_guide_lookup"
        )
        self.assertEqual(plan.steps[0].target, "campus-services-agent")
        self.assertEqual(plan.steps[0].payload_kind, "service_guide_lookup")
        self.assertEqual(plan.steps[0].allowed_tools, ("service_guide_lookup",))
        self.assertEqual(plan.steps[0].expected_output_artifacts, ())
        self.assertFalse(hasattr(plan, "fail_close_on_invalid_plan"))

    def test_compiles_selected_notice_followthrough_without_inventing_route_order(self) -> None:
        plan = compile_openai_agents_workflow_plan(
            _selected_notice_followthrough_plan(),
            agent_request=_notice_get_request(),
        )

        self.assertEqual(plan.workflow_mode, "multi_step")
        self.assertEqual([step.target for step in plan.steps], ["notice-agent", "rag-agent"])
        self.assertEqual(plan.steps[0].execution_mode, "internal_function")
        self.assertEqual(plan.steps[0].expected_output_artifacts, ("notice_context",))
        self.assertEqual(plan.steps[1].execution_mode, "sdk_agent_execution")
        self.assertEqual(plan.steps[1].required_projection_kind, "notice_context")
        self.assertEqual(
            plan.steps[1].depends_on_step_ids, ("handoff:notice-agent:campus_notice_get",)
        )
        self.assertEqual(plan.max_replans, 0)
        self.assertFalse(plan.resume_supported)

    def test_rejects_request_target_not_admitted_by_go_plan(self) -> None:
        with self.assertRaisesRegex(OpenAIAgentsWorkflowPlanError, "plan_not_admitted"):
            compile_openai_agents_workflow_plan(
                _single_step_plan(),
                agent_request=AgentRequest(
                    target="notice-agent",
                    user_goal="找通知",
                    payload=CampusNoticeDiscoverPayload(query_text="找通知"),
                    allowed_tools=("campus_notice_discover",),
                    workflow_context=WorkflowAgentContext(
                        target="notice-agent",
                        workflow_run_ref="workflow:req-sdk-workflow-001",
                        step_id="handoff:notice-agent:campus_notice_discover",
                        agent_id="notice-agent",
                    ),
                ),
            )

    def test_rejects_allowed_tools_drift_against_go_plan_step(self) -> None:
        request = _service_guide_request(allowed_tools=("transport_schedule_lookup",))

        with self.assertRaisesRegex(OpenAIAgentsWorkflowPlanError, "tool_not_admitted"):
            compile_openai_agents_workflow_plan(_single_step_plan(), agent_request=request)

    def test_rejects_missing_go_workflow_context_for_sdk_execution(self) -> None:
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="校园卡丢了怎么办",
            payload=ServiceGuideLookupPayload(
                service_query="校园卡丢了怎么办",
                guide_focus="full_guide",
            ),
            allowed_tools=("service_guide_lookup",),
        )

        with self.assertRaisesRegex(OpenAIAgentsWorkflowPlanError, "plan_not_admitted"):
            validate_agent_request_against_workflow_plan(request)

    def test_rejects_required_projection_mismatch_for_followthrough_step(self) -> None:
        request = AgentRequest(
            target="rag-agent",
            user_goal="这条通知依据学生手册哪条规定？",
            payload=RagRequestPayload(),
            workflow_context=WorkflowAgentContext(
                target="rag-agent",
                workflow_run_ref="workflow:req-sdk-workflow-002",
                step_id="handoff:rag-agent:rag_request",
                agent_id="rag-agent",
                required_projection_kind="schedule_baseline",
                expected_output_artifacts=("evidence_bundle",),
                projection_refs=(
                    {
                        "projection_id": "projection:notice-context-001",
                        "source_step_id": "handoff:notice-agent:campus_notice_get",
                        "projection_kind": "schedule_baseline",
                        "content_hash": "hash-schedule",
                        "safety": {
                            "truncated": False,
                            "redacted": False,
                            "max_chars": 4096,
                            "fields_present": ["notice_id"],
                        },
                    },
                ),
            ),
        )

        with self.assertRaisesRegex(OpenAIAgentsWorkflowPlanError, "projection_kind_not_admitted"):
            compile_openai_agents_workflow_plan(
                _selected_notice_followthrough_plan(),
                agent_request=request,
            )


def _service_guide_request(
    *, allowed_tools: tuple[str, ...] = ("service_guide_lookup",)
) -> AgentRequest:
    return AgentRequest(
        target="campus-services-agent",
        user_goal="校园卡丢了怎么办",
        request_id="req-sdk-workflow-001",
        payload=ServiceGuideLookupPayload(
            service_query="校园卡丢了怎么办",
            guide_focus="full_guide",
        ),
        allowed_tools=allowed_tools,
        workflow_context=WorkflowAgentContext(
            target="campus-services-agent",
            workflow_run_ref="workflow:req-sdk-workflow-001",
            step_id="handoff:campus-services-agent:service_guide_lookup",
            agent_id="campus-services-agent",
        ),
    )


def _notice_get_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="这条通知依据学生手册哪条规定？",
        request_id="req-sdk-workflow-002",
        payload=CampusNoticeGetPayload(
            notice_id="notice:smoke:001",
            source_family="wechat_public_notice",
        ),
        allowed_tools=(),
        workflow_context=WorkflowAgentContext(
            target="notice-agent",
            workflow_run_ref="workflow:req-sdk-workflow-002",
            step_id="handoff:notice-agent:campus_notice_get",
            agent_id="notice-agent",
            expected_output_artifacts=("notice_context",),
        ),
    )


def _single_step_plan() -> WorkflowPlanWire:
    return WorkflowPlanWire.model_validate(
        {
            "schema_version": "workflow-plan-v1",
            "plan_id": "plan:single_step:campus-services-agent:service_guide_lookup",
            "workflow_mode": "single_step",
            "allowed_agents": ["campus-services-agent"],
            "steps": [
                {
                    "step_id": "handoff:campus-services-agent:service_guide_lookup",
                    "step_kind": "handoff",
                    "target": "campus-services-agent",
                    "payload_kind": "service_guide_lookup",
                    "allowed_tools": ["service_guide_lookup"],
                    "selected_tool": "service_guide_lookup",
                }
            ],
            "edges": [],
            "terminal_policy": {"fail_close_on_invalid_plan": True},
            "resume_policy": {"resume_supported": False},
            "semantic_retry_policy": {"max_replans": 0},
        }
    )


def _selected_notice_followthrough_plan() -> WorkflowPlanWire:
    return WorkflowPlanWire.model_validate(
        {
            "schema_version": "workflow-plan-v1",
            "plan_id": "plan:selected_notice:knowledge_followthrough",
            "workflow_mode": "multi_step",
            "allowed_agents": ["notice-agent", "rag-agent"],
            "steps": [
                {
                    "step_id": "handoff:notice-agent:campus_notice_get",
                    "step_kind": "handoff",
                    "target": "notice-agent",
                    "payload_kind": "campus_notice_get",
                    "allowed_tools": [],
                    "selected_tool": "",
                },
                {
                    "step_id": "handoff:rag-agent:rag_request",
                    "step_kind": "handoff",
                    "target": "rag-agent",
                    "payload_kind": "rag_request",
                    "allowed_tools": [],
                    "selected_tool": "",
                },
            ],
            "edges": [
                {
                    "from_step_id": "handoff:notice-agent:campus_notice_get",
                    "to_step_id": "handoff:rag-agent:rag_request",
                    "condition": "completed",
                    "required_projection_kind": "notice_context",
                }
            ],
            "terminal_policy": {"fail_close_on_invalid_plan": True},
            "resume_policy": {"resume_supported": False},
            "semantic_retry_policy": {"max_replans": 0},
        }
    )


if __name__ == "__main__":
    unittest.main()
