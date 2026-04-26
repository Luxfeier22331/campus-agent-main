from __future__ import annotations

import os
import unittest
from unittest.mock import patch

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
        self.assertNotIn("transport_runtime", ready.json_body)
        self.assertFalse(ready.json_body["prompt_http_pool"]["healthy"])
        self.assertNotIn("audit_runtime", ready.json_body)
        self.assertNotIn("execution_cancel_runtime", ready.json_body)
        self.assertEqual(
            ready.json_body["worker_runtime"],
            {"role": "semantic_worker", "cancel_flag_store": "available"},
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
            "SUPERVISOR_AGENT_WORKER_CANCEL_FLAG_TTL_SECONDS": "123",
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
        self.assertEqual(settings.cancel_flag_ttl_seconds, 123)
        self.assertFalse(hasattr(settings, "transport" + "_max_concurrent_answers"))

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


if __name__ == "__main__":
    unittest.main()
