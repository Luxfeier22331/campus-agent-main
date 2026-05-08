from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_contracts import (
    AgentRequest,
    AgentResponse,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
    KnowledgeScope,
    RagRequestPayload,
)
from campus_notice_agent.query_service import NoticeGetQuery
from campus_supervisor_agent_worker.agent_delegates import _build_agent_delegates
from campus_supervisor_agent_worker.app import create_bridge_app
from campus_supervisor_agent_worker.settings import ApiSettings


class SupervisorApiSettingsAndHealthTest(unittest.TestCase):
    def test_bridge_readyz_reports_worker_runtime_without_transport_runtime(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                bridge_shared_secret="bridge-secret",
                runtime_provider="mock-runtime",
                supervisor_prompt_model="gpt-supervisor",
                agent_prompt_model="gpt-agent",
            )
        )

        ready = app.handle(
            "GET",
            "/internal/bridge/readyz",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
        )

        self.assertEqual(ready.status_code, 503)
        self.assertEqual(ready.json_body["status"], "degraded")
        self.assertEqual(ready.json_body["runtime_provider"], "mock-runtime")
        self.assertEqual(ready.json_body["prompt_runtime"]["provider"], "mock-runtime")
        self.assertEqual(ready.json_body["prompt_runtime"]["supervisor_model"], "gpt-supervisor")
        self.assertEqual(ready.json_body["prompt_runtime"]["agent_model"], "gpt-agent")
        self.assertEqual(
            ready.json_body["prompt_runtime"]["admission_reason"],
            "api_key_not_configured",
        )
        self.assertIn("prompt_http_pool", ready.json_body)
        agents_sdk = ready.json_body["agents_sdk_runtime"]
        self.assertTrue(agents_sdk["enabled"])
        self.assertFalse(agents_sdk["admitted"])
        self.assertEqual(agents_sdk["admission_reason"], "provider_config_missing")
        self.assertEqual(agents_sdk["runtime_posture"], "domain_agent_adapter_admitted")
        self.assertEqual(agents_sdk["admitted_pairs"], [])
        self.assertNotIn("transport_runtime", ready.json_body)
        self.assertFalse(ready.json_body["prompt_http_pool"]["healthy"])
        self.assertNotIn("audit_runtime", ready.json_body)
        self.assertNotIn("execution_cancel_runtime", ready.json_body)
        self.assertEqual(ready.json_body["worker_runtime"]["role"], "semantic_worker")
        self.assertEqual(
            ready.json_body["worker_runtime"]["cancel_flag_store"],
            "available",
        )
        self.assertEqual(
            ready.json_body["worker_runtime"]["runtime_event_emitter"]["transport"],
            "jsonl",
        )
        app.close()

    def test_bridge_readyz_reports_prompt_runtime_admission_when_provider_binding_is_complete(
        self,
    ) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
                runtime_provider="openai-responses",
                supervisor_prompt_model="gpt-supervisor",
                agent_prompt_model="gpt-agent",
                prompt_runtime_provider="openai-responses",
                prompt_runtime_api_key="test-key",
                prompt_runtime_base_url="https://api.openai.com/v1",
            )
        )

        ready = app.handle(
            "GET",
            "/internal/bridge/readyz",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
        )

        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.json_body["status"], "ready")
        self.assertTrue(ready.json_body["prompt_runtime"]["admitted"])
        self.assertEqual(ready.json_body["prompt_runtime"]["admission_reason"], "")
        self.assertTrue(ready.json_body["prompt_http_pool"]["healthy"])
        self.assertEqual(ready.json_body["prompt_http_pool"]["max_connections"], 32)
        self.assertNotIn("transport_runtime", ready.json_body)
        app.close()

    def test_api_settings_from_env_reads_bridge_worker_defaults(self) -> None:
        env = {
            "CAMPUS_AGENT_APP_NAME": "campus-agent-test",
            "AGENT_RUNTIME_PROVIDER": "agent-os",
            "PROMPT_RUNTIME_MODEL": "gpt-shared",
            "SUPERVISOR_PROMPT_MODEL": "gpt-supervisor",
            "AGENT_PROMPT_MODEL": "gpt-agent",
            "PROMPT_RUNTIME_PROVIDER": "openai-responses",
            "PROMPT_STRICT_STRUCTURED_OUTPUTS": "false",
            "PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS": "1.5",
            "PROMPT_RUNTIME_READ_TIMEOUT_SECONDS": "2.5",
            "PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS": "3.5",
            "PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS": "4.5",
            "PROMPT_RUNTIME_MAX_CONNECTIONS": "17",
            "PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS": "9",
            "PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS": "19",
            "SUPERVISOR_AGENT_WORKER_SHARED_SECRET": "bridge-secret",
            "SUPERVISOR_AGENT_WORKER_THREADS": "7",
            "SUPERVISOR_AGENT_WORKER_REQUEST_BODY_LIMIT_BYTES": "2048",
            "SUPERVISOR_AGENT_WORKER_CANCEL_FLAG_TTL_SECONDS": "123",
            "SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED": "false",
            "SUPERVISOR_AGENTS_SDK_" + "ALLOWED_TARGETS": "stale-target",
            "SUPERVISOR_AGENTS_SDK_" + "ALLOWED_TOOLS": "stale-tool",
        }

        with patch.dict(os.environ, env, clear=True):
            settings = ApiSettings.from_env()

        self.assertEqual(settings.app_name, "campus-agent-test")
        self.assertEqual(settings.runtime_provider, "agent-os")
        self.assertEqual(settings.prompt_runtime_model, "gpt-shared")
        self.assertEqual(settings.supervisor_prompt_model, "gpt-supervisor")
        self.assertEqual(settings.agent_prompt_model, "gpt-agent")
        self.assertEqual(settings.prompt_runtime_provider, "openai-responses")
        self.assertFalse(settings.prompt_strict_structured_outputs)
        self.assertEqual(settings.prompt_runtime_connect_timeout_seconds, 1.5)
        self.assertEqual(settings.prompt_runtime_read_timeout_seconds, 2.5)
        self.assertEqual(settings.prompt_runtime_write_timeout_seconds, 3.5)
        self.assertEqual(settings.prompt_runtime_pool_timeout_seconds, 4.5)
        self.assertEqual(settings.prompt_runtime_max_connections, 17)
        self.assertEqual(settings.prompt_runtime_max_keepalive_connections, 9)
        self.assertEqual(settings.prompt_runtime_keepalive_expiry_seconds, 19)
        self.assertEqual(settings.bridge_shared_secret, "bridge-secret")
        self.assertEqual(settings.bridge_worker_threads, 7)
        self.assertEqual(settings.bridge_request_body_limit_bytes, 2048)
        self.assertEqual(settings.cancel_flag_ttl_seconds, 123)
        self.assertFalse(settings.agents_sdk_runtime_enabled)
        self.assertFalse(hasattr(settings, "agents_sdk_runtime_allowed_targets"))
        self.assertFalse(hasattr(settings, "agents_sdk_runtime_allowed_tools"))
        self.assertFalse(hasattr(settings, "transport" + "_max_concurrent_answers"))

    def test_bridge_readyz_admits_agents_sdk_runtime_from_repo_registry_when_enabled(
        self,
    ) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
                runtime_provider="openai-responses",
                supervisor_prompt_model="gpt-supervisor",
                agent_prompt_model="gpt-agent",
                prompt_runtime_provider="openai-responses",
                prompt_runtime_api_key="test-key",
                prompt_runtime_base_url="https://api.openai.com/v1",
                agents_sdk_runtime_enabled=True,
            )
        )

        ready = app.handle(
            "GET",
            "/internal/bridge/readyz",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
        )

        self.assertEqual(ready.status_code, 200)
        self.assertEqual(
            ready.json_body["agents_sdk_runtime"]["admission_reason"],
            "admitted",
        )
        self.assertEqual(
            ready.json_body["agents_sdk_runtime"]["admitted_pairs"],
            [
                {
                    "target": "campus-services-agent",
                    "tool": "service_status_lookup",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
                {
                    "target": "campus-services-agent",
                    "tool": "service_guide_lookup",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
                {
                    "target": "campus-services-agent",
                    "tool": "transport_schedule_lookup",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
                {
                    "target": "campus-services-agent",
                    "tool": "contact_directory_lookup",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
                {
                    "target": "campus-services-agent",
                    "tool": "academic_calendar_lookup",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
                {
                    "target": "notice-agent",
                    "tool": "campus_notice_discover",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
                {
                    "target": "notice-agent",
                    "tool": "campus_notice_change_set_lookup",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
            ],
        )
        self.assertNotIn("allowed_targets", ready.json_body["agents_sdk_runtime"])
        self.assertNotIn("allowed_tools", ready.json_body["agents_sdk_runtime"])
        app.close()

    def test_api_settings_from_env_enables_agents_sdk_runtime_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = ApiSettings.from_env()

        self.assertTrue(settings.agents_sdk_runtime_enabled)

    def test_api_settings_from_env_reads_retrieval_observation_settings(self) -> None:
        env = {
            "SUPERVISOR_RETRIEVAL_OBSERVATION_JSONL_PATH": "/tmp/retrieval-observations.jsonl",
            "SUPERVISOR_RETRIEVAL_OBSERVATION_INCLUDE_QUERY_TEXT": "true",
        }

        with patch.dict(os.environ, env, clear=True):
            settings = ApiSettings.from_env()

        self.assertEqual(
            settings.retrieval_observation_jsonl_path,
            "/tmp/retrieval-observations.jsonl",
        )
        self.assertTrue(settings.retrieval_observation_include_query_text)

    def test_api_settings_from_env_reads_worker_otel_settings(self) -> None:
        env = {
            "SUPERVISOR_AGENT_WORKER_OTEL_ENABLED": "true",
            "SUPERVISOR_AGENT_WORKER_OTEL_SERVICE_NAME": "campus-supervisor-agent-worker",
            "SUPERVISOR_AGENT_WORKER_OTEL_ALLOWED_ATTRIBUTES_VERSION": "supervisor-agent-worker-otel-attrs-v1",
            "SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_TIMEOUT_SECONDS": "1.5",
            "SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_INTERVAL_SECONDS": "5",
            "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_HEADERS": "authorization=Bearer worker",
            "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": "http://otel-collector:4318/v1/traces",
            "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT": "http://otel-collector:4318/v1/metrics",
            "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT": "http://otel-collector:4318/v1/logs",
        }

        with patch.dict(os.environ, env, clear=True):
            settings = ApiSettings.from_env()

        self.assertTrue(settings.otel_enabled)
        self.assertEqual(settings.otel_service_name, "campus-supervisor-agent-worker")
        self.assertEqual(
            settings.otel_allowed_attributes_version,
            "supervisor-agent-worker-otel-attrs-v1",
        )
        self.assertEqual(settings.otel_export_timeout_seconds, 1.5)
        self.assertEqual(settings.otel_export_interval_seconds, 5.0)
        self.assertEqual(settings.otel_exporter_otlp_headers, "authorization=Bearer worker")
        self.assertEqual(
            settings.otel_exporter_otlp_traces_endpoint,
            "http://otel-collector:4318/v1/traces",
        )
        self.assertEqual(
            settings.otel_exporter_otlp_metrics_endpoint,
            "http://otel-collector:4318/v1/metrics",
        )
        self.assertEqual(
            settings.otel_exporter_otlp_logs_endpoint,
            "http://otel-collector:4318/v1/logs",
        )

    def test_rag_delegate_wires_jsonl_retrieval_observation_sink_when_configured(self) -> None:
        with TemporaryDirectory() as temp_dir:
            observation_path = Path(temp_dir) / "retrieval-observations.jsonl"
            settings = ApiSettings(
                retrieval_observation_jsonl_path=str(observation_path),
            )
            with patch(
                "campus_supervisor_agent_worker.agent_delegates.delegate_to_rag_agent"
            ) as delegate:
                delegate.return_value = AgentResponse(
                    target="rag-agent",
                    status="completed",
                    answer_text="ok",
                    confidence="high",
                )
                delegates = _build_agent_delegates(
                    settings=settings,
                    rag_prompt_executor=None,
                    campus_services_query_service=None,
                    notice_query_service=None,
                )

                response = delegates["rag-agent"](
                    AgentRequest(
                        target="rag-agent",
                        user_goal="校园卡丢了怎么办",
                        request_id="req-rag-jsonl",
                        payload=RagRequestPayload(
                            scope=KnowledgeScope(
                                corpus="regulations",
                                collection="student_rules",
                            )
                        ),
                    )
                )
                observation_sink = delegate.call_args.kwargs["retrieval_observation_sink"]
                observation_sink(
                    {
                        "schema_version": "retrieval-runtime-observation-v1",
                        "request_id": "req-rag-jsonl",
                        "query": "校园卡丢了怎么办",
                        "scope": {
                            "corpus": "regulations",
                            "collection": "student_rules",
                        },
                    }
                )
            rows = [
                json.loads(line)
                for line in observation_path.read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual(response.status, "completed")
        self.assertEqual(rows[0]["request_id"], "req-rag-jsonl")

    def test_notice_get_delegate_uses_internal_query_runtime(self) -> None:
        query_service = _FakeNoticeGetQueryService()

        delegates = _build_agent_delegates(
            settings=ApiSettings(
                agents_sdk_runtime_enabled=True,
                internal_query_base_url="https://supervisor-api.internal",
                internal_query_shared_secret="structured-secret",
            ),
            rag_prompt_executor=None,
            campus_services_query_service=None,
            notice_query_service=query_service,
        )

        response = delegates["notice-agent"](
            AgentRequest(
                target="notice-agent",
                user_goal="读取这条通知",
                request_id="req-provider-tool",
                payload=CampusNoticeGetPayload(notice_id="notice:placeholder"),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(query_service.last_get_query)
        assert query_service.last_get_query is not None
        self.assertEqual(query_service.last_get_query.payload.notice_id, "notice:placeholder")

    def test_api_settings_from_env_rejects_non_positive_cancel_flag_ttl(self) -> None:
        with (
            patch.dict(
                os.environ,
                {"SUPERVISOR_AGENT_WORKER_CANCEL_FLAG_TTL_SECONDS": "0"},
                clear=True,
            ),
            self.assertRaises(ValueError),
        ):
            ApiSettings.from_env()

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
        self.assertEqual(settings.agent_prompt_model, "gpt-shared")

    def test_api_settings_from_env_rejects_invalid_prompt_http_pool_numbers(self) -> None:
        invalid_envs = (
            {"PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS": "0"},
            {"PROMPT_RUNTIME_READ_TIMEOUT_SECONDS": "-1"},
            {"PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS": "0"},
            {"PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS": "-1"},
            {"PROMPT_RUNTIME_MAX_CONNECTIONS": "0"},
            {"PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS": "-1"},
            {
                "PROMPT_RUNTIME_MAX_CONNECTIONS": "2",
                "PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS": "3",
            },
            {"PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS": "0"},
            {"PROMPT_RUNTIME_MAX_OUTPUT_TOKENS": "0"},
        )
        for env in invalid_envs:
            with (
                self.subTest(env=env),
                patch.dict(os.environ, env, clear=True),
                self.assertRaises(ValueError),
            ):
                ApiSettings.from_env()

    def test_api_settings_from_env_rejects_invalid_bridge_and_query_numbers(self) -> None:
        invalid_envs = (
            {"SUPERVISOR_AGENT_WORKER_THREADS": "0"},
            {"SUPERVISOR_AGENT_WORKER_REQUEST_BODY_LIMIT_BYTES": "0"},
            {"SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS": "0"},
        )
        for env in invalid_envs:
            with (
                self.subTest(env=env),
                patch.dict(os.environ, env, clear=True),
                self.assertRaises(ValueError),
            ):
                ApiSettings.from_env()


class _FakeNoticeGetQueryService:
    def __init__(self) -> None:
        self.last_get_query: NoticeGetQuery | None = None

    def get_notice(self, query: NoticeGetQuery) -> CampusNoticeGetResult:
        self.last_get_query = query
        return CampusNoticeGetResult(
            notice_id=query.payload.notice_id,
            outcome="resolved_current",
            title="校历通知",
            source_family="official_web_public_notice",
            source_url="https://campus.example/notices/calendar",
            canonical_url="https://campus.example/notices/calendar",
            normalized_body="校历内容",
        )

    def discover_notice(self, _query):  # pragma: no cover - this test exercises notice get
        raise AssertionError("notice get provider runtime must not call discover")


if __name__ == "__main__":
    unittest.main()
