from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    ContextProjection,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    SessionSlot,
    SessionSummary,
    SupervisorRequest,
    TraceContext,
)
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.intent import IntentFrame
from campus_supervisor_core.prompt_packets import (
    build_supervisor_approval_required_prompt_packet,
    build_supervisor_clarify_prompt_packet,
    build_supervisor_out_of_scope_prompt_packet,
    build_supervisor_reject_prompt_packet,
)
from campus_supervisor_core.prompts.registry import (
    get_supervisor_prompt_spec,
    list_supervisor_prompt_specs,
)
from campus_supervisor_core.routing import RoutingDecision


class SupervisorPromptRegistryTest(unittest.TestCase):
    def test_supervisor_prompt_registry_exposes_first_rollout_prompt_assets(self) -> None:
        specs = list_supervisor_prompt_specs()

        self.assertEqual(
            {spec.prompt_id for spec in specs},
            {
                "supervisor_approval_required_v1",
                "supervisor_clarify_v1",
                "supervisor_out_of_scope_v1",
                "supervisor_reject_v1",
            },
        )
        spec = get_supervisor_prompt_spec("supervisor_clarify_v1")
        approval_required = get_supervisor_prompt_spec("supervisor_approval_required_v1")
        out_of_scope = get_supervisor_prompt_spec("supervisor_out_of_scope_v1")
        rejected = get_supervisor_prompt_spec("supervisor_reject_v1")

        self.assertEqual(spec.prompt_id, "supervisor_clarify_v1")
        self.assertEqual(spec.owner_package, "campus_supervisor_core")
        self.assertEqual(spec.supported_modes, ("clarify",))
        self.assertEqual(spec.variables_schema_version, "v1")
        self.assertEqual(spec.output_schema_version, "v1")
        self.assertIn("supervisor", spec.eval_suite)
        self.assertIn("<role>", spec.template_text)
        self.assertIn("<output_contract>", spec.template_text)
        self.assertRegex(spec.template_sha256, r"^[0-9a-f]{64}$")
        self.assertEqual(approval_required.supported_modes, ("approval_required",))
        self.assertEqual(out_of_scope.supported_modes, ("out_of_scope",))
        self.assertEqual(rejected.supported_modes, ("reject",))
        self.assertIn("<role>", approval_required.template_text)
        self.assertIn("<output_contract>", out_of_scope.template_text)
        self.assertIn("<output_contract>", rejected.template_text)


class SupervisorPromptPacketTest(unittest.TestCase):
    def _make_context(
        self,
        *,
        requested_scope: KnowledgeScope | None = None,
    ) -> SupervisorRequestContext:
        actor = ActorContext(
            user_id="student-001",
            cohort="2023",
            major="法学",
        )
        request = SupervisorRequest(
            user_goal="法学民族实验班培养方案里大二下有什么课",
            request_id="req-clarify-001",
            trace=TraceContext(trace_id="trace-clarify-001"),
            actor=actor,
            requested_capability="knowledge",
            requested_scope=requested_scope,
            context=ContextProjection(
                actor=actor,
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="法学民族实验班培养方案",
                            source_type="user_declared",
                            confidence="high",
                            visibility="user_visible",
                        ),
                    ),
                ),
                session=SessionSummary(
                    confirmed_slots=(
                        SessionSlot(name="curriculum_program_family", value="民族实验班"),
                    ),
                    turn_count=2,
                ),
            ),
        )
        return SupervisorRequestContext.from_request(request)

    def test_build_supervisor_clarify_prompt_packet_keeps_task_and_user_input_separate(
        self,
    ) -> None:
        context = self._make_context()
        decision = RoutingDecision(
            target=None,
            primary_corpus=None,
            primary_collection=None,
            intent_frame=IntentFrame(
                capability="knowledge",
                task_kind="knowledge_lookup",
                domain_candidates=("knowledge",),
                missing_slots=("requested_scope",),
                risk_level="low",
                needs_clarification=True,
                suggested_next_action="clarify",
                personalization_mode="user_grounded",
                clarification_subject="民族实验班",
            ),
        )

        packet = build_supervisor_clarify_prompt_packet(context, decision)

        self.assertEqual(packet.prompt_id, "supervisor_clarify_v1")
        self.assertEqual(packet.task.request_id, "req-clarify-001")
        self.assertEqual(packet.task.mode, "clarify")
        self.assertEqual(packet.task.language, "zh-CN")
        self.assertEqual(packet.task.task_kind, "knowledge_lookup")
        self.assertEqual(packet.task.requested_capability, "knowledge")
        self.assertEqual(packet.task.personalization_mode, "user_grounded")
        self.assertEqual(packet.task.missing_slots, ("requested_scope",))
        self.assertEqual(packet.task.clarification_subject, "民族实验班")
        self.assertIn("ask_for_missing_information", packet.task.allowed_actions)
        self.assertIn("override_authz", packet.task.forbidden_actions)
        self.assertEqual(packet.user_input_text, "法学民族实验班培养方案里大二下有什么课")
        self.assertFalse(hasattr(packet.task, "user_input_text"))

    def test_build_supervisor_approval_required_prompt_packet_keeps_policy_task_typed(self) -> None:
        context = self._make_context(
            requested_scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        )
        decision = RoutingDecision(
            target=None,
            primary_corpus="regulations",
            primary_collection="student_rules",
            intent_frame=IntentFrame(
                capability="knowledge",
                task_kind="action_request",
                domain_candidates=("knowledge",),
                missing_slots=(),
                risk_level="high",
                needs_clarification=False,
                suggested_next_action="approval_required",
                personalization_mode="generic",
            ),
        )

        packet = build_supervisor_approval_required_prompt_packet(context, decision)

        self.assertEqual(packet.prompt_id, "supervisor_approval_required_v1")
        self.assertEqual(packet.task.mode, "approval_required")
        self.assertEqual(packet.task.task_kind, "action_request")
        self.assertEqual(packet.task.resolved_scope_corpus, "regulations")
        self.assertEqual(packet.task.resolved_scope_collection, "student_rules")
        self.assertIn("provide_operator_guidance", packet.task.allowed_actions)
        self.assertIn("override_authz", packet.task.forbidden_actions)
        self.assertEqual(packet.user_input_text, "法学民族实验班培养方案里大二下有什么课")

    def test_build_supervisor_reject_prompt_packet_keeps_policy_task_typed(self) -> None:
        context = self._make_context(
            requested_scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        )
        decision = RoutingDecision(
            target=None,
            primary_corpus="regulations",
            primary_collection="student_rules",
            intent_frame=IntentFrame(
                capability="knowledge",
                task_kind="policy_violation",
                domain_candidates=("knowledge",),
                missing_slots=(),
                risk_level="high",
                needs_clarification=False,
                suggested_next_action="rejected",
                personalization_mode="generic",
            ),
        )

        packet = build_supervisor_reject_prompt_packet(context, decision)

        self.assertEqual(packet.prompt_id, "supervisor_reject_v1")
        self.assertEqual(packet.task.mode, "reject")
        self.assertEqual(packet.task.task_kind, "policy_violation")
        self.assertIn("explain_boundary_briefly", packet.task.allowed_actions)
        self.assertIn("invent_policy_reason", packet.task.forbidden_actions)
        self.assertEqual(packet.user_input_text, "法学民族实验班培养方案里大二下有什么课")

    def test_build_supervisor_out_of_scope_prompt_packet_keeps_scope_boundary_typed(self) -> None:
        context = self._make_context()
        decision = RoutingDecision(
            target=None,
            primary_corpus=None,
            primary_collection=None,
            intent_frame=IntentFrame(
                capability="knowledge",
                task_kind="knowledge_lookup",
                domain_candidates=("out_of_scope",),
                missing_slots=(),
                risk_level="low",
                needs_clarification=False,
                suggested_next_action="out_of_scope",
                personalization_mode="generic",
                scope_class="out_of_scope",
                policy_reason="product_scope_boundary",
            ),
        )

        packet = build_supervisor_out_of_scope_prompt_packet(context, decision)

        self.assertEqual(packet.prompt_id, "supervisor_out_of_scope_v1")
        self.assertEqual(packet.task.mode, "out_of_scope")
        self.assertEqual(packet.task.policy_decision, "product_scope_boundary")
        self.assertIn("explain_product_boundary_briefly", packet.task.allowed_actions)
        self.assertIn("expand_scope", packet.task.forbidden_actions)
        self.assertEqual(packet.user_input_text, "法学民族实验班培养方案里大二下有什么课")


if __name__ == "__main__":
    unittest.main()
