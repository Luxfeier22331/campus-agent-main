from __future__ import annotations

import unittest

from campus_supervisor_agent_worker.agents_sdk_runtime_policy import (
    agents_sdk_runtime_status,
)


class AgentsSdkRuntimePolicyTest(unittest.TestCase):
    def test_status_is_default_off_without_requiring_sdk_dependency(self) -> None:
        status = agents_sdk_runtime_status(
            enabled=False,
            allowed_targets=(),
            allowed_tools=(),
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
                "allowed_targets": [],
                "allowed_tools": [],
                "runtime_enabled": False,
                "runtime_admitted": False,
                "runtime_posture": "domain_agent_adapter_pilot",
            },
        )

    def test_status_reports_stable_fail_close_reasons_when_enabled(self) -> None:
        cases = (
            (
                {
                    "sdk_available": False,
                    "prompt_runtime_provider": "openai-responses",
                    "agent_model": "gpt-agent",
                    "allowed_targets": ("notice-agent",),
                    "allowed_tools": ("campus_notice_discover",),
                },
                "dependency_missing",
            ),
            (
                {
                    "sdk_available": True,
                    "prompt_runtime_provider": "",
                    "agent_model": "gpt-agent",
                    "allowed_targets": ("notice-agent",),
                    "allowed_tools": ("campus_notice_discover",),
                },
                "provider_config_missing",
            ),
            (
                {
                    "sdk_available": True,
                    "prompt_runtime_provider": "openai-responses",
                    "agent_model": "",
                    "allowed_targets": ("notice-agent",),
                    "allowed_tools": ("campus_notice_discover",),
                },
                "model_missing",
            ),
            (
                {
                    "sdk_available": True,
                    "prompt_runtime_provider": "openai-responses",
                    "agent_model": "gpt-agent",
                    "allowed_targets": (),
                    "allowed_tools": ("campus_notice_discover",),
                },
                "allowed_target_missing",
            ),
            (
                {
                    "sdk_available": True,
                    "prompt_runtime_provider": "openai-responses",
                    "agent_model": "gpt-agent",
                    "allowed_targets": ("notice-agent",),
                    "allowed_tools": (),
                },
                "allowed_tool_missing",
            ),
        )
        for kwargs, reason in cases:
            with self.subTest(reason=reason):
                status = agents_sdk_runtime_status(enabled=True, **kwargs)

            self.assertEqual(status["admission_reason"], reason)
            self.assertFalse(status["admitted"])

    def test_status_admits_only_when_enabled_and_configured_for_agent_facing_tool(self) -> None:
        status = agents_sdk_runtime_status(
            enabled=True,
            allowed_targets=("notice-agent",),
            allowed_tools=("campus_notice_discover",),
            prompt_runtime_provider="openai-responses",
            agent_model="gpt-agent",
            sdk_available=True,
        )

        self.assertTrue(status["admitted"])
        self.assertEqual(status["admission_reason"], "admitted")
        self.assertEqual(status["allowed_targets"], ["notice-agent"])
        self.assertEqual(status["allowed_tools"], ["campus_notice_discover"])

    def test_status_rejects_stale_notice_get_sdk_tool(self) -> None:
        status = agents_sdk_runtime_status(
            enabled=True,
            allowed_targets=("notice-agent",),
            allowed_tools=("campus_notice_get",),
            prompt_runtime_provider="openai-responses",
            agent_model="gpt-agent",
            sdk_available=True,
        )

        self.assertFalse(status["admitted"])
        self.assertEqual(status["admission_reason"], "unsupported_allowed_tool")
        self.assertEqual(status["allowed_tools"], ["campus_notice_get"])


if __name__ == "__main__":
    unittest.main()
