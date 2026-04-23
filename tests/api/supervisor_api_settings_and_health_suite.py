from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from campus_supervisor_api.app import create_app
from campus_supervisor_api.settings import ApiSettings
from campus_supervisor_core import (
    DisallowedKnowledgeScopeError,
    InvalidSupervisorRequestError,
)


class SupervisorApiSettingsAndHealthTest(unittest.TestCase):
    def test_answer_route_returns_400_for_conflicting_supervisor_inputs(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="runtime-bearer-user",
            ),
            supervisor_handler=lambda request: (_ for _ in ()).throw(
                InvalidSupervisorRequestError(
                    "requested_scope is not allowed for place_lookup requests"
                )
            ),
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token"},
            json_body={
                "user_goal": "test",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_supervisor_request")

    def test_answer_route_returns_403_for_query_disabled_scope(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="runtime-bearer-user",
            ),
            supervisor_handler=lambda request: (_ for _ in ()).throw(
                DisallowedKnowledgeScopeError(
                    "knowledge scope curriculum/curriculum_plan is not query-enabled"
                )
            ),
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token"},
            json_body={
                "user_goal": "test",
                "requested_scope": {
                    "corpus": "curriculum",
                    "collection": "curriculum_plan",
                },
            },
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json_body["error"]["code"], "disallowed_knowledge_scope")

    def test_answer_route_clarifies_generic_knowledge_request_without_explicit_scope(self) -> None:
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
            json_body={"user_goal": "test"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["status"], "needs_clarification")
        self.assertEqual(
            response.json_body["follow_up_question"],
            "请先说明你想查询的校内知识范围或资料集合。",
        )

    def test_health_and_ready_routes_exist(self) -> None:
        app = create_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                runtime_provider="mock-runtime",
                supervisor_prompt_model="gpt-supervisor",
                specialist_prompt_model="gpt-specialist",
            )
        )

        health = app.handle("GET", "/healthz")
        ready = app.handle("GET", "/readyz")

        self.assertEqual(health.json_body["status"], "ok")
        self.assertEqual(ready.status_code, 503)
        self.assertEqual(ready.json_body["status"], "degraded")
        self.assertEqual(app.name, "campus-agent-v2")
        self.assertEqual(app.runtime.provider, "mock-runtime")
        self.assertEqual(ready.json_body["runtime_provider"], "mock-runtime")
        self.assertEqual(ready.json_body["prompt_runtime"]["provider"], "mock-runtime")
        self.assertEqual(
            ready.json_body["prompt_runtime"]["developer_invariants_id"],
            "repo_global_developer_invariants_v1",
        )
        self.assertEqual(
            ready.json_body["prompt_runtime"]["developer_invariants_version"],
            "v1",
        )
        self.assertTrue(ready.json_body["prompt_runtime"]["strict_structured_outputs"])
        self.assertEqual(ready.json_body["prompt_runtime"]["transport"], "responses")
        self.assertEqual(ready.json_body["prompt_runtime"]["supervisor_model"], "gpt-supervisor")
        self.assertEqual(ready.json_body["prompt_runtime"]["specialist_model"], "gpt-specialist")
        self.assertFalse(ready.json_body["prompt_runtime"]["admitted"])
        self.assertEqual(
            ready.json_body["prompt_runtime"]["admission_reason"],
            "api_key_not_configured",
        )
        self.assertIn("prompt_http_pool", ready.json_body)
        self.assertIn("audit_runtime", ready.json_body)
        self.assertIn("transport_runtime", ready.json_body)
        self.assertFalse(ready.json_body["prompt_http_pool"]["healthy"])
        self.assertTrue(ready.json_body["audit_runtime"]["healthy"])
        self.assertTrue(ready.json_body["transport_runtime"]["healthy"])

    def test_ready_route_reports_prompt_runtime_admission_when_provider_binding_is_complete(
        self,
    ) -> None:
        app = create_app(
            settings=ApiSettings(
                runtime_provider="openai-responses",
                supervisor_prompt_model="gpt-supervisor",
                specialist_prompt_model="gpt-specialist",
                prompt_runtime_provider="openai-responses",
                prompt_runtime_api_key="test-key",
                prompt_runtime_base_url="https://api.openai.com/v1",
            )
        )

        ready = app.handle("GET", "/readyz")

        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.json_body["status"], "ready")
        self.assertTrue(ready.json_body["prompt_runtime"]["admitted"])
        self.assertEqual(ready.json_body["prompt_runtime"]["admission_reason"], "")
        self.assertTrue(ready.json_body["prompt_http_pool"]["healthy"])
        self.assertEqual(ready.json_body["prompt_http_pool"]["max_connections"], 32)
        app.close()

    def test_api_settings_from_env_reads_api_boundary_defaults(self) -> None:
        env = {
            "CAMPUS_AGENT_APP_NAME": "campus-agent-test",
            "API_AUTH_MODE": "trusted-worker",
            "API_BEARER_TOKEN": "secret-token",
            "API_WORKER_SHARED_SECRET": "worker-secret",
            "API_DEFAULT_ACTOR_ID": "runtime-bearer-user",
            "AGENT_RUNTIME_PROVIDER": "agent-os",
            "API_DEFAULT_ACTOR_ROLES": "student",
            "PROMPT_RUNTIME_MODEL": "gpt-shared",
            "SUPERVISOR_PROMPT_MODEL": "gpt-supervisor",
            "SPECIALIST_PROMPT_MODEL": "gpt-specialist",
            "PROMPT_RUNTIME_PROVIDER": "openai-responses",
            "PROMPT_STRICT_STRUCTURED_OUTPUTS": "false",
            "PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS": "1.5",
            "PROMPT_RUNTIME_READ_TIMEOUT_SECONDS": "2.5",
            "PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS": "3.5",
            "PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS": "4.5",
            "PROMPT_RUNTIME_MAX_CONNECTIONS": "17",
            "PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS": "9",
            "PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS": "19",
            "AUDIT_LOG_PATH": "./var/log/custom-audit.log",
            "AUDIT_QUEUE_CAPACITY": "64",
            "SUPERVISOR_API_MAX_CONCURRENT_ANSWERS": "5",
            "SUPERVISOR_API_TRANSPORT_WORKER_THREADS": "7",
        }

        with patch.dict(os.environ, env, clear=True):
            settings = ApiSettings.from_env()

        self.assertEqual(settings.app_name, "campus-agent-test")
        self.assertEqual(settings.auth_mode, "trusted-worker")
        self.assertEqual(settings.bearer_token, "secret-token")
        self.assertEqual(settings.worker_shared_secret, "worker-secret")
        self.assertEqual(settings.default_actor_id, "runtime-bearer-user")
        self.assertEqual(settings.runtime_provider, "agent-os")
        self.assertEqual(settings.default_actor_roles, ("student",))
        self.assertEqual(settings.prompt_runtime_model, "gpt-shared")
        self.assertEqual(settings.supervisor_prompt_model, "gpt-supervisor")
        self.assertEqual(settings.specialist_prompt_model, "gpt-specialist")
        self.assertEqual(settings.prompt_runtime_provider, "openai-responses")
        self.assertFalse(settings.prompt_strict_structured_outputs)
        self.assertEqual(settings.prompt_runtime_connect_timeout_seconds, 1.5)
        self.assertEqual(settings.prompt_runtime_read_timeout_seconds, 2.5)
        self.assertEqual(settings.prompt_runtime_write_timeout_seconds, 3.5)
        self.assertEqual(settings.prompt_runtime_pool_timeout_seconds, 4.5)
        self.assertEqual(settings.prompt_runtime_max_connections, 17)
        self.assertEqual(settings.prompt_runtime_max_keepalive_connections, 9)
        self.assertEqual(settings.prompt_runtime_keepalive_expiry_seconds, 19)
        self.assertEqual(str(settings.audit_log_path), "var/log/custom-audit.log")
        self.assertEqual(settings.audit_queue_capacity, 64)
        self.assertEqual(settings.transport_max_concurrent_answers, 5)
        self.assertEqual(settings.transport_worker_threads, 7)

    def test_api_settings_from_env_uses_shared_prompt_runtime_model_when_role_overrides_are_absent(
        self,
    ) -> None:
        env = {
            "PROMPT_RUNTIME_MODEL": "gpt-shared",
        }

        with patch.dict(os.environ, env, clear=True):
            settings = ApiSettings.from_env()

        self.assertEqual(settings.prompt_runtime_model, "gpt-shared")
        self.assertEqual(settings.supervisor_prompt_model, "gpt-shared")
        self.assertEqual(settings.specialist_prompt_model, "gpt-shared")

    def test_answer_route_rejects_missing_bearer_actor_identity_configuration(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
            )
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token"},
            json_body={
                "user_goal": "library hours",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
            },
        )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json_body["error"]["code"], "auth_not_configured")

    def test_answer_route_rejects_missing_trusted_worker_context(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
            )
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
