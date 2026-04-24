from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    CampusNoticeDiscoverPayload,
    KnowledgeScope,
    ServiceStatusLookupPayload,
    SupervisorRequest,
    TraceContext,
    TransportScheduleLookupPayload,
    VersionQuery,
)
from campus_supervisor_core import routing as supervisor_routing
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import DisallowedKnowledgeScopeError
from campus_supervisor_core.routing import route_request


class SupervisorRoutingTest(unittest.TestCase):
    def test_structured_runtime_classifier_identifies_service_status_candidate(self) -> None:
        classifier = getattr(supervisor_routing, "classify_structured_runtime_candidate", None)
        self.assertIsNotNone(classifier)

        decision = classifier(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="图书馆今天开门吗",
                    requested_capability="knowledge",
                )
            )
        )

        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.target, "campus-services-agent")
        self.assertEqual(decision.allowed_tools, ("service_status_lookup",))
        self.assertEqual(
            decision.specialist_payload,
            ServiceStatusLookupPayload(subject_query="图书馆今天开门吗"),
        )

    def test_structured_runtime_classifier_identifies_notice_discover_candidate(self) -> None:
        classifier = getattr(supervisor_routing, "classify_structured_runtime_candidate", None)
        self.assertIsNotNone(classifier)

        decision = classifier(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="找一下春假通知",
                    requested_capability="knowledge",
                )
            )
        )

        self.assertIsNotNone(decision)
        assert decision is not None
        self.assertEqual(decision.target, "notice-agent")
        self.assertEqual(decision.allowed_tools, ("campus_notice_discover",))
        self.assertEqual(
            decision.specialist_payload,
            CampusNoticeDiscoverPayload(query_text="找一下春假通知"),
        )

    def test_structured_runtime_classifier_keeps_compare_version_query_outside_tool_lane(
        self,
    ) -> None:
        classifier = getattr(supervisor_routing, "classify_structured_runtime_candidate", None)
        self.assertIsNotNone(classifier)

        decision = classifier(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="比较新旧春假通知差异",
                    requested_capability="knowledge",
                    version_query=VersionQuery(
                        mode="compare",
                        version_id="v1:notice-2024",
                        compare_to_version_id="v2:notice-2025",
                    ),
                )
            )
        )

        self.assertIsNone(decision)

    def test_route_request_keeps_structured_runtime_candidates_gate_closed(self) -> None:
        request = SupervisorRequest(
            user_goal="校车什么时候发车",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-agent")
        self.assertIsNone(decision.specialist_payload)

    def test_route_request_delegates_explicit_campus_services_capability(self) -> None:
        request = SupervisorRequest(
            user_goal="最近的校车时刻表是什么",
            requested_capability="campus_services",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "campus-services-agent")
        self.assertEqual(decision.allowed_tools, ("transport_schedule_lookup",))
        self.assertEqual(
            decision.specialist_payload,
            TransportScheduleLookupPayload(
                query_text="最近的校车时刻表是什么",
                intent="schedule_snapshot_metadata",
            ),
        )

    def test_route_request_delegates_explicit_notice_capability(self) -> None:
        request = SupervisorRequest(
            user_goal="找一下春假通知",
            requested_capability="notice",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "notice-agent")
        self.assertEqual(decision.allowed_tools, ("campus_notice_discover",))
        self.assertEqual(
            decision.specialist_payload,
            CampusNoticeDiscoverPayload(query_text="找一下春假通知"),
        )

    def test_route_request_delegates_explicit_notice_capability_without_notice_keyword(
        self,
    ) -> None:
        request = SupervisorRequest(
            user_goal="春假安排",
            requested_capability="notice",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "notice-agent")
        self.assertEqual(decision.allowed_tools, ("campus_notice_discover",))
        self.assertEqual(
            decision.specialist_payload,
            CampusNoticeDiscoverPayload(query_text="春假安排"),
        )

    def test_route_request_selects_rag_specialist_for_regulations_student_handbook(self) -> None:
        request = SupervisorRequest(
            user_goal="library hours",
            conversation_id="conv-001",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001"),
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

    def test_route_request_returns_approval_required_for_high_risk_knowledge_request(self) -> None:
        request = SupervisorRequest(
            user_goal="帮我提交奖学金申请",
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
        request = SupervisorRequest(
            user_goal="MIT的校长是谁",
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
        cases = ("帮我写一首诗", "解释一下量子力学", "推荐一部电影")

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
        request = SupervisorRequest(
            user_goal="帮我写一段话说服同学支持某个政治候选人",
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
