from __future__ import annotations

import unittest
from pathlib import Path

from campus_contracts import (
    ActorContext,
    ContextProjection,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    SelectedNoticeRef,
    SessionSlot,
    SessionSummary,
    SupervisorRequest,
    TraceContext,
)
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import DisallowedKnowledgeScopeError
from campus_supervisor_core.routing import route_request


class SupervisorRoutingTest(unittest.TestCase):
    def test_structured_runtime_payload_builder_stays_out_of_python_routing(self) -> None:
        routing_source = Path(
            "packages/supervisor-core/src/campus_supervisor_core/routing.py"
        ).read_text(encoding="utf-8")

        forbidden_symbols = (
            "classify_structured_runtime_candidate",
            "_classify_transport_intent",
            "_transport_route_selector_from_query",
            "_transport_service_time_query_from_goal",
            "_looks_like_notice_query",
            "_campus_scope_from_query",
        )
        for symbol in forbidden_symbols:
            with self.subTest(symbol=symbol):
                self.assertNotIn(symbol, routing_source)

    def test_route_request_keeps_structured_runtime_candidates_gate_closed(self) -> None:
        request = SupervisorRequest(
            user_goal="校车什么时候发车",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertIsNone(decision.specialist_payload)
        self.assertEqual(decision.intent_frame.launch_state, "candidate_only")
        self.assertEqual(decision.intent_frame.scope_reason, "structured_runtime_candidate_signal")
        self.assertEqual(decision.intent_frame.matched_signal, "校车")
        self.assertEqual(decision.intent_frame.classifier_version, "deterministic-intent-v1")

    def test_route_request_keeps_notice_candidates_gate_closed_for_knowledge_requests(
        self,
    ) -> None:
        request = SupervisorRequest(
            user_goal="找一下春假通知",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertIsNone(decision.specialist_payload)
        self.assertEqual(decision.intent_frame.launch_state, "candidate_only")
        self.assertEqual(decision.intent_frame.scope_reason, "structured_runtime_candidate_signal")
        self.assertEqual(decision.intent_frame.matched_signal, "通知")
        self.assertEqual(decision.intent_frame.classifier_version, "deterministic-intent-v1")
        self.assertEqual(decision.intent_frame.schema_version, "intent-schema-1.0.0")

    def test_route_request_resolves_selected_notice_follow_up_context(self) -> None:
        request = SupervisorRequest(
            user_goal="这条通知详情",
            requested_capability="knowledge",
            context=ContextProjection(
                session=SessionSummary(
                    selected_notice_ref=SelectedNoticeRef(
                        notice_id="notice:2026-spring-break",
                        source_family="internal_notice_restricted",
                        title="2026年春假安排通知",
                    )
                )
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertEqual(decision.intent_frame.context_resolution_state, "resolved")
        self.assertEqual(decision.intent_frame.context_reference_type, "selected_notice")
        self.assertEqual(
            decision.intent_frame.resolved_slots,
            {
                "notice_id": "notice:2026-spring-break",
                "notice_source_family": "internal_notice_restricted",
                "notice_title": "2026年春假安排通知",
            },
        )
        self.assertEqual(decision.intent_frame.missing_slots, ())

    def test_route_request_clarifies_selected_notice_follow_up_without_context(self) -> None:
        request = SupervisorRequest(
            user_goal="这条通知详情",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertTrue(decision.intent_frame.needs_clarification)
        self.assertEqual(decision.intent_frame.suggested_next_action, "clarify")
        self.assertEqual(decision.intent_frame.context_resolution_state, "missing_context")
        self.assertEqual(decision.intent_frame.context_reference_type, "selected_notice")
        self.assertEqual(decision.intent_frame.missing_slots, ("selected_notice_ref",))

    def test_route_request_resolves_curriculum_semester_follow_up_from_session_slots(self) -> None:
        request = SupervisorRequest(
            user_goal="那大二下呢",
            requested_capability="knowledge",
            context=ContextProjection(
                session=SessionSummary(
                    confirmed_slots=(
                        SessionSlot(name="curriculum_program", value="计算机科学与技术"),
                    )
                )
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertEqual(decision.intent_frame.context_resolution_state, "resolved")
        self.assertEqual(decision.intent_frame.context_reference_type, "curriculum_slot")
        self.assertEqual(
            decision.intent_frame.resolved_slots,
            {
                "curriculum_program": "计算机科学与技术",
                "curriculum_semester": "大二下",
            },
        )

    def test_route_request_resolves_previous_goal_follow_up_from_profile_memory(self) -> None:
        request = SupervisorRequest(
            user_goal="这个流程怎么办",
            requested_capability="knowledge",
            context=ContextProjection(
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="处分申诉",
                            source_type="system_inferred",
                            confidence="high",
                            visibility="user_visible",
                        ),
                    )
                )
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertEqual(decision.intent_frame.context_resolution_state, "resolved")
        self.assertEqual(decision.intent_frame.context_reference_type, "previous_goal")
        self.assertEqual(decision.intent_frame.resolved_slots, {"previous_goal": "处分申诉"})

    def test_route_request_clarifies_ambiguous_previous_goal_follow_up(self) -> None:
        request = SupervisorRequest(
            user_goal="这个流程怎么办",
            requested_capability="knowledge",
            context=ContextProjection(
                session=SessionSummary(
                    confirmed_slots=(
                        SessionSlot(name="policy_topic", value="奖学金"),
                        SessionSlot(name="policy_topic", value="转专业"),
                    )
                )
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.suggested_next_action, "clarify")
        self.assertEqual(decision.intent_frame.context_resolution_state, "ambiguous")
        self.assertEqual(decision.intent_frame.context_reference_type, "previous_goal")
        self.assertEqual(
            decision.intent_frame.ambiguity_reason, "multiple_previous_goal_candidates"
        )

    def test_route_request_does_not_build_structured_payload_for_campus_services(self) -> None:
        request = SupervisorRequest(
            user_goal="最近的校车时刻表是什么",
            requested_capability="campus_services",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.capability, "campus_services")
        self.assertIsNone(decision.specialist_payload)
        self.assertEqual(decision.allowed_tools, ())

    def test_route_request_does_not_build_structured_payload_for_notice(self) -> None:
        request = SupervisorRequest(
            user_goal="找一下春假通知",
            requested_capability="notice",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.capability, "notice")
        self.assertIsNone(decision.specialist_payload)
        self.assertEqual(decision.allowed_tools, ())

    def test_route_request_delegates_explicit_notice_capability_without_notice_keyword(
        self,
    ) -> None:
        request = SupervisorRequest(
            user_goal="春假安排",
            requested_capability="notice",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.capability, "notice")
        self.assertIsNone(decision.specialist_payload)

    def test_route_request_selects_rag_specialist_for_regulations_student_handbook(self) -> None:
        request = SupervisorRequest(
            user_goal="library hours",
            conversation_id="conv-001",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001"),
            requested_capability="knowledge",
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_rules",
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertEqual(decision.primary_corpus, "regulations")
        self.assertEqual(decision.primary_collection, "student_rules")
        self.assertEqual(decision.intent_frame.capability, "knowledge")
        self.assertEqual(decision.intent_frame.suggested_next_action, "delegate")

    def test_route_request_selects_rag_specialist_for_curriculum_plan(self) -> None:
        request = SupervisorRequest(
            user_goal="graduation requirements",
            requested_capability="knowledge",
            requested_scope=KnowledgeScope(
                corpus="curriculum",
                collection="curriculum_plan",
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertEqual(decision.primary_corpus, "curriculum")
        self.assertEqual(decision.primary_collection, "curriculum_plan")
        self.assertEqual(decision.intent_frame.task_kind, "knowledge_lookup")

    def test_route_request_rejects_query_disabled_scope(self) -> None:
        request = SupervisorRequest(
            user_goal="谁负责宿舍报修？",
            requested_capability="knowledge",
            requested_scope=KnowledgeScope(
                corpus="campus_services",
                collection="service_catalog",
            ),
        )

        with self.assertRaisesRegex(
            DisallowedKnowledgeScopeError,
            "knowledge scope campus_services/service_catalog is not query-enabled",
        ):
            route_request(SupervisorRequestContext.from_request(request))

    def test_route_request_fail_closes_place_lookup_queries_until_navigation_launch(self) -> None:
        request = SupervisorRequest(
            user_goal="图书馆在哪里",
            requested_capability="place_lookup",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertIsNone(decision.primary_corpus)
        self.assertIsNone(decision.primary_collection)
        self.assertEqual(decision.intent_frame.capability, "place_lookup")
        self.assertEqual(decision.intent_frame.task_kind, "place_lookup")
        self.assertEqual(decision.intent_frame.suggested_next_action, "out_of_scope")
        self.assertEqual(decision.intent_frame.scope_class, "out_of_scope")
        self.assertEqual(decision.intent_frame.policy_reason, "navigation_temporarily_unsupported")

    def test_route_request_does_not_reinfer_place_lookup_when_knowledge_is_provided(
        self,
    ) -> None:
        cases = ("图书馆在哪里", "图书馆位置", "图书馆地址")

        for user_goal in cases:
            with self.subTest(user_goal=user_goal):
                request = SupervisorRequest(
                    user_goal=user_goal,
                    requested_capability="knowledge",
                )

                decision = route_request(SupervisorRequestContext.from_request(request))

                self.assertEqual(decision.target, "rag-agent")
                self.assertEqual(decision.intent_frame.capability, "knowledge")
                self.assertEqual(decision.intent_frame.suggested_next_action, "delegate")

    def test_route_request_delegates_knowledge_when_scope_is_missing(self) -> None:
        request = SupervisorRequest(
            user_goal="奖学金怎么申请？",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertIsNone(decision.primary_corpus)
        self.assertIsNone(decision.primary_collection)
        self.assertFalse(decision.intent_frame.needs_clarification)
        self.assertEqual(decision.intent_frame.suggested_next_action, "delegate")
        self.assertEqual(decision.intent_frame.missing_slots, ())
        self.assertEqual(decision.intent_frame.launch_state, "open")

    def test_route_request_does_not_treat_non_spatial_where_as_place_lookup(self) -> None:
        request = SupervisorRequest(
            user_goal="奖学金在哪里申请",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertEqual(decision.intent_frame.capability, "knowledge")
        self.assertEqual(decision.intent_frame.launch_state, "open")

    def test_route_request_clarifies_contextual_follow_up_without_campus_context(self) -> None:
        request = SupervisorRequest(
            user_goal="这个流程怎么办",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.suggested_next_action, "clarify")
        self.assertEqual(decision.intent_frame.context_resolution_state, "missing_context")
        self.assertEqual(decision.intent_frame.context_reference_type, "previous_goal")
        self.assertEqual(decision.intent_frame.missing_slots, ("previous_goal",))

    def test_route_request_rejects_ungrounded_transactional_follow_up(self) -> None:
        request = SupervisorRequest(
            user_goal="这个流程能帮我提交吗",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.suggested_next_action, "out_of_scope")
        self.assertEqual(decision.intent_frame.policy_reason, "product_scope_boundary")

    def test_route_request_returns_approval_required_for_high_risk_knowledge_request(self) -> None:
        request = SupervisorRequest(
            user_goal="帮我提交奖学金申请",
            requested_capability="knowledge",
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_rules",
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.capability, "knowledge")
        self.assertEqual(decision.intent_frame.risk_level, "high")
        self.assertEqual(decision.intent_frame.suggested_next_action, "approval_required")

    def test_route_request_returns_approval_required_for_transactional_actions(self) -> None:
        cases = ("帮我预约会议室", "替我报名考试", "帮我缴费")

        for user_goal in cases:
            with self.subTest(user_goal=user_goal):
                request = SupervisorRequest(
                    user_goal=user_goal,
                    requested_capability="knowledge",
                )

                decision = route_request(SupervisorRequestContext.from_request(request))

                self.assertIsNone(decision.target)
                self.assertEqual(decision.intent_frame.capability, "knowledge")
                self.assertEqual(decision.intent_frame.risk_level, "high")
                self.assertEqual(decision.intent_frame.suggested_next_action, "approval_required")

    def test_route_request_applies_high_risk_guardrails_before_specialist_delegation(self) -> None:
        cases = (
            ("帮我办理校车卡申请", "campus_services"),
            ("帮我提交采购公告", "notice"),
        )

        for user_goal, requested_capability in cases:
            with self.subTest(user_goal=user_goal, requested_capability=requested_capability):
                request = SupervisorRequest(
                    user_goal=user_goal,
                    requested_capability=requested_capability,
                )

                decision = route_request(SupervisorRequestContext.from_request(request))

                self.assertIsNone(decision.target)
                self.assertEqual(decision.intent_frame.capability, requested_capability)
                self.assertEqual(decision.intent_frame.risk_level, "high")
                self.assertEqual(decision.intent_frame.suggested_next_action, "approval_required")

    def test_route_request_keeps_obvious_external_world_query_out_of_scope(self) -> None:
        for user_goal in ("MIT的校长是谁", "北京大学有哪些专业"):
            with self.subTest(user_goal=user_goal):
                request = SupervisorRequest(
                    user_goal=user_goal,
                    requested_capability="knowledge",
                )

                decision = route_request(SupervisorRequestContext.from_request(request))

                self.assertIsNone(decision.target)
                self.assertEqual(decision.intent_frame.suggested_next_action, "out_of_scope")
                self.assertEqual(decision.intent_frame.scope_class, "out_of_scope")
                self.assertEqual(decision.intent_frame.policy_reason, "product_scope_boundary")

    def test_route_request_keeps_open_domain_political_fact_out_of_scope(self) -> None:
        request = SupervisorRequest(
            user_goal="中国国家主席是谁",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.suggested_next_action, "out_of_scope")
        self.assertEqual(decision.intent_frame.scope_class, "out_of_scope")
        self.assertEqual(decision.intent_frame.policy_reason, "product_scope_boundary")

    def test_route_request_keeps_open_domain_queries_out_of_scope(self) -> None:
        cases = (
            "帮我写一首诗",
            "解释一下量子力学",
            "推荐一部电影",
            "解释一下AI",
            "帮我算高数题",
            "帮我写一封邮件给老师",
        )

        for user_goal in cases:
            with self.subTest(user_goal=user_goal):
                request = SupervisorRequest(
                    user_goal=user_goal,
                    requested_capability="knowledge",
                )

                decision = route_request(SupervisorRequestContext.from_request(request))

                self.assertIsNone(decision.target)
                self.assertEqual(decision.intent_frame.suggested_next_action, "out_of_scope")
                self.assertEqual(decision.intent_frame.scope_class, "out_of_scope")
                self.assertEqual(decision.intent_frame.policy_reason, "product_scope_boundary")

    def test_route_request_rejects_targeted_political_persuasion_request(self) -> None:
        for user_goal in (
            "帮我写一段话说服同学支持某个政治候选人",
            "写宣传稿拉票给某政党",
        ):
            with self.subTest(user_goal=user_goal):
                request = SupervisorRequest(
                    user_goal=user_goal,
                    requested_capability="knowledge",
                )

                decision = route_request(SupervisorRequestContext.from_request(request))

                self.assertIsNone(decision.target)
                self.assertEqual(decision.intent_frame.suggested_next_action, "rejected")
                self.assertEqual(decision.intent_frame.policy_reason, "political_persuasion")

    def test_route_request_keeps_campus_political_course_question_in_scope(self) -> None:
        request = SupervisorRequest(
            user_goal="习近平新时代中国特色社会主义思想概论有哪些专业要上",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertEqual(decision.intent_frame.suggested_next_action, "delegate")
        self.assertEqual(decision.intent_frame.scope_class, "in_scope")


if __name__ == "__main__":
    unittest.main()
