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
                "admitted_pairs": [],
                "blocked_pairs": [],
            },
        )

    def test_status_reports_stable_fail_close_reasons_when_enabled(self) -> None:
        cases = (
            (
                {
                    "sdk_available": False,
                    "prompt_runtime_provider": "openai-responses",
                    "agent_model": "gpt-agent",
                },
                "dependency_missing",
            ),
            (
                {
                    "sdk_available": True,
                    "prompt_runtime_provider": "",
                    "agent_model": "gpt-agent",
                },
                "provider_config_missing",
            ),
            (
                {
                    "sdk_available": True,
                    "prompt_runtime_provider": "openai-responses",
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

    def test_status_admits_only_when_enabled_and_configured_for_agent_facing_tool(self) -> None:
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

    def test_status_reports_target_tool_matrix_for_admitted_domain_adapters(self) -> None:
        status = agents_sdk_runtime_status(
            enabled=True,
            prompt_runtime_provider="openai-responses",
            agent_model="gpt-agent",
            sdk_available=True,
        )

        self.assertTrue(status["admitted"])
        self.assertEqual(status["runtime_posture"], "domain_agent_adapter_admitted")
        self.assertEqual(
            status["admitted_pairs"],
            [
                {
                    "target": "campus-services-agent",
                    "tool": "service_guide_lookup",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
                {
                    "target": "campus-services-agent",
                    "tool": "contact_directory_lookup",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
                {
                    "target": "calendar-agent",
                    "tool": "academic_calendar_lookup",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
                {
                    "target": "notice-agent",
                    "tool": "campus_notice_discover",
                    "tool_runtime_posture": "sdk_adapter_admitted",
                },
            ],
        )
        self.assertEqual(status["blocked_pairs"], [])

    def test_status_ignores_non_sdk_structured_tools_when_deriving_admission(self) -> None:
        status = agents_sdk_runtime_status(
            enabled=True,
            prompt_runtime_provider="openai-responses",
            agent_model="gpt-agent",
            sdk_available=True,
        )

        self.assertTrue(status["admitted"])
        self.assertEqual(
            [pair["tool"] for pair in status["admitted_pairs"]],
            [
                "service_guide_lookup",
                "contact_directory_lookup",
                "academic_calendar_lookup",
                "campus_notice_discover",
            ],
        )
        self.assertNotIn(
            "service_status_lookup",
            [pair["tool"] for pair in status["admitted_pairs"]],
        )
        self.assertNotIn(
            "transport_schedule_lookup",
            [pair["tool"] for pair in status["admitted_pairs"]],
        )

    def test_status_fails_closed_when_registry_has_no_sdk_admitted_tool(self) -> None:
        from dataclasses import replace

        from campus_supervisor_agent_worker.tool_spec_registry import default_tool_spec_registry

        registry = default_tool_spec_registry()
        without_sdk_tool = replace(
            registry,
            tools=tuple(
                replace(tool, runtime_posture="typed_handoff_only")
                if tool.runtime_posture == "sdk_adapter_admitted"
                else tool
                for tool in registry.tools
            ),
        )

        status = agents_sdk_runtime_status(
            enabled=True,
            prompt_runtime_provider="openai-responses",
            agent_model="gpt-agent",
            sdk_available=True,
            tool_registry=without_sdk_tool,
        )

        self.assertFalse(status["admitted"])
        self.assertEqual(status["admission_reason"], "sdk_tool_missing")
        self.assertEqual(status["admitted_pairs"], [])
        self.assertIn(
            {
                "target": "notice-agent",
                "tool": "campus_notice_discover",
                "reason": "tool_not_sdk_admitted",
                "tool_runtime_posture": "typed_handoff_only",
            },
            status["blocked_pairs"],
        )

    def test_status_keeps_notice_get_out_of_derived_sdk_pairs(self) -> None:
        status = agents_sdk_runtime_status(
            enabled=True,
            prompt_runtime_provider="openai-responses",
            agent_model="gpt-agent",
            sdk_available=True,
        )

        tools = [pair["tool"] for pair in status["admitted_pairs"]]
        blocked_tools = [pair["tool"] for pair in status["blocked_pairs"]]
        self.assertNotIn("campus_notice_get", tools)
        self.assertNotIn("campus_notice_get", blocked_tools)


if __name__ == "__main__":
    unittest.main()
