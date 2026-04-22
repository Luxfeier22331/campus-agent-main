from __future__ import annotations

import base64
import json
import unittest

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    ContextProjection,
    ProfileMemoryItem,
    ProfileMemorySummary,
    SessionSlot,
    SessionSummary,
    SupervisorRequest,
    SupervisorResponse,
)
from campus_supervisor_api.app import create_app
from campus_supervisor_api.settings import ApiSettings


class SupervisorApiTrustedWorkerTest(unittest.TestCase):
    def test_answer_route_rejects_trusted_worker_requests_without_projected_context(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="Worker path reached supervisor.",
                confidence="high",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
                default_actor_roles=("runtime",),
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={
                "x-worker-origin-auth": "worker-secret",
            },
            json_body={
                "user_goal": "library hours",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("context", response.json_body["error"]["message"])
        self.assertEqual(captured_requests, [])

    def test_answer_route_accepts_projected_context_in_trusted_worker_mode_without_legacy_retrieval_carrier(
        self,
    ) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="Projected context reached supervisor.",
                confidence="high",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
                default_actor_roles=("runtime",),
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={
                "x-worker-origin-auth": "worker-secret",
                "cf-access-jwt-assertion": _make_jwt(
                    {
                        "email": "other-student@example.edu",
                    }
                ),
            },
            json_body={
                "user_goal": "保研政策怎么准备？",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": {
                    "actor": {
                        "user_id": "student@example.edu",
                        "principal_id": "principal-001",
                        "principal_type": "student",
                        "roles": ["student"],
                        "cohort": "2023",
                        "major": "philosophy",
                        "program": "undergraduate",
                    },
                    "authorization": {
                        "principal_id": "principal-001",
                        "projection_source": "campus_identity",
                        "entitlement_snapshot_id": "entitlements-2026-03-29",
                        "entitlement_groups": ["students", "library"],
                        "visibility_scope": "north",
                        "applicability_scope": "undergraduate",
                        "ownership_scopes": ["conversation:student@example.edu"],
                        "approval_state": "not_required",
                        "retrieval_filter": {
                            "entitlement_groups": ["students", "library"],
                            "visibility_level": "public",
                            "visibility_scope": "north",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                        },
                    },
                    "profile_memory": {
                        "items": [
                            {
                                "item_id": "memory-001",
                                "key": "recent_goal",
                                "value": "咨询保研",
                                "source_type": "user_declared",
                                "confidence": "high",
                                "visibility": "user_visible",
                                "last_verified_at": "2026-03-28",
                            }
                        ]
                    },
                    "session": {
                        "confirmed_slots": [
                            {"name": "policy_topic", "value": "推免资格", "confirmed": True}
                        ],
                        "turn_count": 2,
                    },
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            captured_requests[0].context,
            ContextProjection(
                actor=ActorContext(
                    user_id="student@example.edu",
                    principal_id="principal-001",
                    principal_type="student",
                    roles=("student",),
                    departments=(),
                    cohort="2023",
                    major="philosophy",
                    program="undergraduate",
                ),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    projection_source="campus_identity",
                    entitlement_snapshot_id="entitlements-2026-03-29",
                    entitlement_groups=("students", "library"),
                    visibility_scope="north",
                    applicability_scope="undergraduate",
                    ownership_scopes=("conversation:student@example.edu",),
                    approval_state="not_required",
                    retrieval_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=("students", "library"),
                        visibility_level="public",
                        visibility_scope="north",
                        policy_projection_version="phase1-authorization-projection-v1",
                    ),
                ),
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="咨询保研",
                            source_type="user_declared",
                            confidence="high",
                            visibility="user_visible",
                            last_verified_at="2026-03-28",
                        ),
                    ),
                ),
                session=SessionSummary(
                    confirmed_slots=(
                        SessionSlot(name="policy_topic", value="推免资格", confirmed=True),
                    ),
                    turn_count=2,
                ),
            ),
        )
        self.assertEqual(captured_requests[0].actor, captured_requests[0].context.actor)

    def test_answer_route_rejects_unsupported_actor_context_fields_in_trusted_worker_context(
        self,
    ) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
                default_actor_roles=("runtime",),
            )
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={
                "x-worker-origin-auth": "worker-secret",
            },
            json_body={
                "user_goal": "保研政策怎么准备？",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": {
                    "actor": {
                        "user_id": "student@example.edu",
                        "principal_id": "principal-001",
                        "principal_type": "student",
                        "roles": ["student"],
                        "groups": ["students", "library"],
                        "campus_scope": "north",
                    },
                    "authorization": {
                        "principal_id": "principal-001",
                        "entitlement_groups": ["students", "library"],
                        "visibility_scope": "north",
                        "retrieval_filter": {
                            "entitlement_groups": ["students", "library"],
                            "visibility_level": "public",
                            "visibility_scope": "north",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                        },
                    },
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("unsupported actor context fields", response.json_body["error"]["message"])

    def test_answer_route_rejects_unsupported_retrieval_filter_fields_in_trusted_worker_context(
        self,
    ) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
                default_actor_roles=("runtime",),
            )
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={
                "x-worker-origin-auth": "worker-secret",
            },
            json_body={
                "user_goal": "保研政策怎么准备？",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": {
                    "actor": {
                        "user_id": "student@example.edu",
                        "principal_id": "principal-001",
                        "principal_type": "student",
                        "roles": ["student"],
                    },
                    "authorization": {
                        "principal_id": "principal-001",
                        "entitlement_groups": ["students", "library"],
                        "visibility_scope": "north",
                        "retrieval_filter": {
                            "entitlement_groups": ["students", "library"],
                            "visibility_level": "public",
                            "acl_groups": ["students", "library"],
                            "visibility_scope": "north",
                            "campus_scope": "north",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                        },
                    },
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("unsupported retrieval filter fields", response.json_body["error"]["message"])

    def test_answer_route_rejects_trusted_worker_actor_projection_that_conflicts_with_context_actor(
        self,
    ) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
            ),
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={
                "x-worker-origin-auth": "worker-secret",
            },
            json_body={
                "user_goal": "保研政策怎么准备？",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": {
                    "actor": {
                        "user_id": "student@example.edu",
                    },
                    "authorization": {
                        "retrieval_filter": {
                            "entitlement_groups": [],
                            "visibility_level": "public",
                            "visibility_scope": "north",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                        }
                    },
                },
                "actor": {
                    "user_id": "other-student@example.edu",
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("actor and context.actor must match", response.json_body["error"]["message"])

    def test_answer_route_rejects_missing_trusted_worker_secret(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
            )
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={},
            json_body={"user_goal": "library hours"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")

    def test_answer_route_rejects_invalid_trusted_worker_secret(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
            )
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"x-worker-origin-auth": "wrong-secret"},
            json_body={"user_goal": "library hours"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")


def _make_jwt(payload: dict[str, object]) -> str:
    header = _urlsafe_json({"alg": "none", "typ": "JWT"})
    body = _urlsafe_json(payload)
    return f"{header}.{body}.signature"


def _urlsafe_json(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
