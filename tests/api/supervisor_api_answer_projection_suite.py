from __future__ import annotations

import unittest
from dataclasses import asdict

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    ErrorInfo,
    EvidenceBundle,
    KnowledgeScope,
    RagResultPayload,
    SupervisorRequest,
    SupervisorResponse,
    TraceContext,
    VersionQuery,
)
from campus_supervisor_api.api import HttpResponse
from campus_supervisor_api.app import create_app
from campus_supervisor_api.settings import ApiSettings


class SupervisorApiAnswerProjectionTest(unittest.TestCase):
    def test_answer_route_maps_auth_trace_and_response_shape(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="The library is open from 08:00 to 22:00.",
                confidence="medium",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text=request.user_goal,
                        corpus="regulations",
                        collection="student_rules",
                    )
                ),
            )

        app = create_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="api-bearer-user",
                default_actor_roles=("student",),
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={
                "Authorization": "Bearer secret-token",
                "X-Trace-Id": "trace-001",
                "X-Actor-Id": "student-001",
            },
            json_body={
                "user_goal": "library hours",
                "conversation_id": "conv-001",
                "request_id": "req-001",
                "safety_identifier": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
            },
        )

        self.assertIsInstance(response, HttpResponse)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["trace_id"], "trace-001")
        self.assertEqual(response.json_body["selected_target"], "rag-agent")
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(
            response.json_body["answer_text"],
            "The library is open from 08:00 to 22:00.",
        )
        self.assertEqual(captured_requests[0].user_goal, "library hours")
        self.assertEqual(captured_requests[0].conversation_id, "conv-001")
        self.assertEqual(captured_requests[0].request_id, "req-001")
        self.assertEqual(
            captured_requests[0].safety_identifier,
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )
        self.assertEqual(captured_requests[0].trace, TraceContext(trace_id="trace-001"))
        self.assertEqual(captured_requests[0].actor.user_id, "api-bearer-user")
        self.assertEqual(captured_requests[0].actor.roles, ("student",))
        self.assertEqual(
            captured_requests[0].actor,
            ActorContext(
                user_id="api-bearer-user",
                roles=("student",),
            ),
        )
        self.assertEqual(
            captured_requests[0].context.authorization,
            AuthorizationProjection(
                principal_id="api-bearer-user",
                entitlement_snapshot_id="",
                entitlement_groups=(),
                visibility_scope=None,
                applicability_scope=None,
                ownership_scopes=(),
                approval_state="",
                retrieval_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=(),
                    visibility_level="public",
                    visibility_scope=None,
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            ),
        )
        self.assertEqual(
            captured_requests[0].requested_scope,
            KnowledgeScope(
                corpus="regulations",
                collection="student_rules",
            ),
        )
        self.assertIsNone(captured_requests[0].requested_capability)
        self.assertEqual(captured_requests[0].version_query, VersionQuery(mode="current"))

    def test_answer_route_projects_explicit_version_query_to_supervisor_request(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="正在比较历史版本。",
                confidence="medium",
            )

        app = create_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="api-bearer-user",
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token"},
            json_body={
                "user_goal": "比较新旧学生手册关于请假制度的差异",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "version_query": {
                    "mode": "compare",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(
            captured_requests[0].version_query,
            VersionQuery(mode="compare"),
        )

    def test_answer_route_projects_compare_version_selectors_to_supervisor_request(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="正在比较指定版本。",
                confidence="medium",
            )

        app = create_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="api-bearer-user",
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token"},
            json_body={
                "user_goal": "比较指定两个学生手册版本的差异",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "version_query": {
                    "mode": "compare",
                    "version_id": "v1:student-handbook",
                    "compare_to_version_id": "v2:student-handbook",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(
            captured_requests[0].version_query,
            VersionQuery(
                mode="compare",
                version_id="v1:student-handbook",
                compare_to_version_id="v2:student-handbook",
            ),
        )

    def test_answer_route_rejects_non_current_version_query_for_place_lookup(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="runtime-bearer-user",
            ),
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token"},
            json_body={
                "user_goal": "图书馆在哪里",
                "version_query": {
                    "mode": "historical",
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_supervisor_request")
        self.assertIn(
            "version_query is not allowed for place_lookup requests",
            response.json_body["error"]["message"],
        )

    def test_answer_route_rejects_removed_availability_request_shape(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="runtime-bearer-user",
            ),
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token"},
            json_body={
                "user_goal": "Is the website up?",
                "requested_capability": "availability",
                "availability_target_id": "official-homepage",
                "follow_redirects": False,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn(
            "unsupported requested_capability: availability",
            response.json_body["error"]["message"],
        )

    def test_answer_route_projects_supervisor_response_without_orchestration_logic(self) -> None:
        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            return SupervisorResponse(
                selected_target="rag-agent",
                status="error",
                confidence="low",
                error=ErrorInfo(
                    code="retrieval_failed",
                    message="retrieval backend unavailable",
                    retryable=False,
                ),
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="runtime-bearer-user",
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token", "x-trace-id": "trace-001"},
            json_body={
                "user_goal": "library hours",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
            },
        )

        expected_payload = asdict(
            SupervisorResponse(
                selected_target="rag-agent",
                status="error",
                confidence="low",
                error=ErrorInfo(
                    code="retrieval_failed",
                    message="retrieval backend unavailable",
                    retryable=False,
                ),
            )
        )
        expected_payload["trace_id"] = "trace-001"

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body, expected_payload)
