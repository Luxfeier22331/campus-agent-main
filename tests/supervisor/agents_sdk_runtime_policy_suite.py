from __future__ import annotations

import unittest

from campus_supervisor_agent_worker.agents_sdk_runtime_policy import (
    agents_sdk_runtime_status,
)


class AgentsSdkRuntimePolicyTest(unittest.TestCase):
    def test_status_is_default_off_without_requiring_sdk_dependency(self) -> None:
        status = agents_sdk_runtime_status(
            enabled=False,
            prompt_runtime_provider="",
            agent_model="",
            sdk_available=False,
        )

        self.assertEqual(
            status,
            {
                "enabled": False,
                "admitted": False,
                "admission_reason": "disabled",
                "runtime_enabled": False,
                "runtime_admitted": False,
                "runtime_posture": "domain_agent_adapter_admitted",
            },
        )

    def test_status_reports_stable_fail_close_reasons_when_enabled(self) -> None:
        cases = (
            (
                {
                    "sdk_available": False,
                    "prompt_runtime_provider": "openai-responses",
                    "prompt_runtime_api_key_configured": True,
                    "agent_model": "gpt-agent",
                },
                "dependency_missing",
            ),
            (
                {
                    "sdk_available": True,
                    "prompt_runtime_provider": "",
                    "prompt_runtime_api_key_configured": True,
                    "agent_model": "gpt-agent",
                },
                "provider_config_missing",
            ),
            (
                {
                    "sdk_available": True,
                    "prompt_runtime_provider": "openai-responses",
                    "prompt_runtime_api_key_configured": False,
                    "agent_model": "gpt-agent",
                },
                "provider_key_missing",
            ),
            (
                {
                    "sdk_available": True,
                    "prompt_runtime_provider": "openai-responses",
                    "prompt_runtime_api_key_configured": True,
                    "agent_model": "",
                },
                "model_missing",
            ),
        )
        for kwargs, reason in cases:
            with self.subTest(reason=reason):
                status = agents_sdk_runtime_status(enabled=True, **kwargs)

            self.assertEqual(status["admission_reason"], reason)
            self.assertFalse(status["admitted"])

    def test_status_admits_only_when_enabled_and_configured(self) -> None:
        status = agents_sdk_runtime_status(
            enabled=True,
            prompt_runtime_provider="openai-responses",
            agent_model="gpt-agent",
            sdk_available=True,
        )

        self.assertTrue(status["admitted"])
        self.assertEqual(status["admission_reason"], "admitted")
        self.assertNotIn("allowed_targets", status)
        self.assertNotIn("allowed_tools", status)
        self.assertNotIn("admitted_pairs", status)
        self.assertNotIn("blocked_pairs", status)


if __name__ == "__main__":
    unittest.main()
