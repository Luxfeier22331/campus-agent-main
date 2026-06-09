from __future__ import annotations

import unittest

from campus_contracts import (
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    CapabilityRequest,
    RagRequestPayload,
    ServiceGuideLookupPayload,
    WorkflowCapabilityContext,
)
from campus_supervisor_agent_worker.generated.supervisor_execution_contract import (
    WorkflowPlanWire,
)
from campus_supervisor_agent_worker.openai_agents_workflow_plan import (
    OpenAIAgentsWorkflowPlanError,
    compile_openai_agents_workflow_plan,
    validate_capability_request_against_workflow_plan,
)


class OpenAIAgentsWorkflowPlanTest(unittest.TestCase):
    def test_compiles_go_single_step_plan_for_typed_activity_execution(self) -> None:
        plan = compile_openai_agents_workflow_plan(
            _single_step_plan(),
            capability_request=_service_guide_request(),
        )

        self.assertEqual(plan.workflow_mode, "single_step")
        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].execution_mode, "typed_activity_execution")
        self.assertEqual(
            plan.steps[0].step_id, "capability:campus_services:service_guide_lookup"
        )
        self.assertEqual(plan.steps[0].capability, "campus_services")
        self.assertEqual(plan.steps[0].payload_kind, "service_guide_lookup")
        self.assertEqual(plan.steps[0].allowed_tools, ("service_guide_lookup",))
        self.assertEqual(plan.steps[0].expected_output_artifacts, ())
        self.assertFalse(hasattr(plan, "fail_close_on_invalid_plan"))

    def test_compiles_selected_notice_followthrough_without_inventing_route_order(self) -> None:
        plan = compile_openai_agents_workflow_plan(
            _selected_notice_followthrough_plan(),
            capability_request=_notice_get_request(),
        )

        self.assertEqual(plan.workflow_mode, "multi_step")
        self.assertEqual([step.capability for step in plan.steps], ["notice", "knowledge"])
        self.assertEqual(plan.steps[0].execution_mode, "internal_function")
        self.assertEqual(plan.steps[0].expected_output_artifacts, ("notice_context",))
        self.assertEqual(plan.steps[1].execution_mode, "typed_activity_execution")
        self.assertEqual(plan.steps[1].required_projection_kind, "notice_context")
        self.assertEqual(
            plan.steps[1].depends_on_step_ids, ("capability:notice:campus_notice_get",)
        )
        self.assertEqual(plan.max_replans, 0)
        self.assertFalse(plan.resume_supported)

    def test_rejects_request_capability_not_admitted_by_go_plan(self) -> None:
        with self.assertRaisesRegex(OpenAIAgentsWorkflowPlanError, "plan_not_admitted"):
            compile_openai_agents_workflow_plan(
                _single_step_plan(),
                capability_request=CapabilityRequest(
                    capability="notice",
                    user_goal="找通知",
                    payload=CampusNoticeDiscoverPayload(query_text="找通知"),
                    allowed_tools=("campus_notice_discover",),
                    workflow_context=WorkflowCapabilityContext(
                        capability="notice",
                        workflow_run_ref="workflow:req-sdk-workflow-001",
                        step_id="capability:notice:campus_notice_discover",
                        capability_id="notice",
                    ),
                ),
            )

    def test_rejects_allowed_tools_drift_against_go_plan_step(self) -> None:
        request = _service_guide_request(allowed_tools=("transport_schedule_lookup",))

        with self.assertRaisesRegex(OpenAIAgentsWorkflowPlanError, "tool_not_admitted"):
            compile_openai_agents_workflow_plan(_single_step_plan(), capability_request=request)

    def test_rejects_missing_go_workflow_context_for_sdk_execution(self) -> None:
        request = CapabilityRequest(
            capability="campus_services",
            user_goal="校园卡丢了怎么办",
            payload=ServiceGuideLookupPayload(
                service_query="校园卡丢了怎么办",
                guide_focus="full_guide",
            ),
            allowed_tools=("service_guide_lookup",),
        )

        with self.assertRaisesRegex(OpenAIAgentsWorkflowPlanError, "plan_not_admitted"):
            validate_capability_request_against_workflow_plan(request)

    def test_rejects_required_projection_mismatch_for_followthrough_step(self) -> None:
        request = CapabilityRequest(
            capability="knowledge",
            user_goal="这条通知依据学生手册哪条规定？",
            payload=RagRequestPayload(),
            workflow_context=WorkflowCapabilityContext(
                capability="knowledge",
                workflow_run_ref="workflow:req-sdk-workflow-002",
                step_id="capability:knowledge:rag_request",
                capability_id="knowledge",
                required_projection_kind="schedule_baseline",
                expected_output_artifacts=("evidence_bundle",),
                projection_refs=(
                    {
                        "projection_id": "projection:notice-context-001",
                        "source_step_id": "capability:notice:campus_notice_get",
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
                capability_request=request,
            )


def _service_guide_request(
    *, allowed_tools: tuple[str, ...] = ("service_guide_lookup",)
) -> CapabilityRequest:
    return CapabilityRequest(
        capability="campus_services",
        user_goal="校园卡丢了怎么办",
        request_id="req-sdk-workflow-001",
        payload=ServiceGuideLookupPayload(
            service_query="校园卡丢了怎么办",
            guide_focus="full_guide",
        ),
        allowed_tools=allowed_tools,
        workflow_context=WorkflowCapabilityContext(
            capability="campus_services",
            workflow_run_ref="workflow:req-sdk-workflow-001",
            step_id="capability:campus_services:service_guide_lookup",
            capability_id="campus_services",
        ),
    )


def _notice_get_request() -> CapabilityRequest:
    return CapabilityRequest(
        capability="notice",
        user_goal="这条通知依据学生手册哪条规定？",
        request_id="req-sdk-workflow-002",
        payload=CampusNoticeGetPayload(
            notice_id="notice:smoke:001",
            source_family="wechat_public_notice",
        ),
        allowed_tools=(),
        workflow_context=WorkflowCapabilityContext(
            capability="notice",
            workflow_run_ref="workflow:req-sdk-workflow-002",
            step_id="capability:notice:campus_notice_get",
            capability_id="notice",
            expected_output_artifacts=("notice_context",),
        ),
    )


def _single_step_plan() -> WorkflowPlanWire:
    return WorkflowPlanWire.model_validate(
        {
            "schema_version": "workflow-plan-v1",
            "plan_id": "plan:single_step:campus_services:service_guide_lookup",
            "workflow_mode": "single_step",
            "allowed_capabilities": ["campus_services"],
            "steps": [
                {
                    "step_id": "capability:campus_services:service_guide_lookup",
                    "step_kind": "handoff",
                    "capability": "campus_services",
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
            "allowed_capabilities": ["notice", "knowledge"],
            "steps": [
                {
                    "step_id": "capability:notice:campus_notice_get",
                    "step_kind": "handoff",
                    "capability": "notice",
                    "payload_kind": "campus_notice_get",
                    "allowed_tools": [],
                    "selected_tool": "",
                },
                {
                    "step_id": "capability:knowledge:rag_request",
                    "step_kind": "handoff",
                    "capability": "knowledge",
                    "payload_kind": "rag_request",
                    "allowed_tools": [],
                    "selected_tool": "",
                },
            ],
            "edges": [
                {
                    "from_step_id": "capability:notice:campus_notice_get",
                    "to_step_id": "capability:knowledge:rag_request",
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
