from __future__ import annotations

import unittest
from dataclasses import replace
from pathlib import Path

from campus_supervisor_agent_worker.agents_sdk_tool_bridge import (
    AgentsSdkToolBridgeError,
    build_agents_sdk_tool_descriptors,
)
from campus_supervisor_agent_worker.tool_spec_registry import default_tool_spec_registry


class AgentsSdkToolBridgeTest(unittest.TestCase):
    def test_rejects_internal_notice_get_tool_surface(self) -> None:
        with self.assertRaisesRegex(
            AgentsSdkToolBridgeError,
            "unsupported_tool_surface",
        ) as caught:
            build_agents_sdk_tool_descriptors(("campus_notice_get",))

        self.assertEqual(caught.exception.reason, "unsupported_tool_surface")

    def test_rejects_empty_allowed_tools(self) -> None:
        with self.assertRaisesRegex(AgentsSdkToolBridgeError, "allowed_tools_missing") as caught:
            build_agents_sdk_tool_descriptors(())

        self.assertEqual(caught.exception.reason, "allowed_tools_missing")

    def test_rejects_unknown_allowed_tool(self) -> None:
        with self.assertRaisesRegex(AgentsSdkToolBridgeError, "unknown_tool") as caught:
            build_agents_sdk_tool_descriptors(("hallucinated_tool",))

        self.assertEqual(caught.exception.reason, "unknown_tool")

    def test_rejects_typed_handoff_only_tool_before_sdk_surface(self) -> None:
        with self.assertRaisesRegex(
            AgentsSdkToolBridgeError,
            "runtime_posture_not_admitted",
        ) as caught:
            build_agents_sdk_tool_descriptors(("service_status_lookup",))

        self.assertEqual(caught.exception.reason, "runtime_posture_not_admitted")

    def test_rejects_agent_internal_tool_surface(self) -> None:
        with self.assertRaisesRegex(
            AgentsSdkToolBridgeError,
            "unsupported_tool_surface",
        ) as caught:
            build_agents_sdk_tool_descriptors(("retrieval.query",))

        self.assertEqual(caught.exception.reason, "unsupported_tool_surface")

    def test_admits_sdk_adapter_candidate_notice_discover_tool(self) -> None:
        descriptors = build_agents_sdk_tool_descriptors(
            ("campus_notice_discover",),
            registry=_sdk_candidate_tool_registry("campus_notice_discover"),
        )

        self.assertEqual(len(descriptors), 1)
        descriptor = descriptors[0]
        self.assertEqual(descriptor.name, "campus_notice_discover")
        self.assertEqual(descriptor.owner_agent, "notice-agent")
        self.assertEqual(descriptor.runtime_posture, "sdk_adapter_candidate")
        self.assertTrue(descriptor.read_only)
        self.assertTrue(descriptor.function_schema_strict)

    def test_admits_sdk_adapter_admitted_notice_discover_tool(self) -> None:
        descriptors = build_agents_sdk_tool_descriptors(
            ("campus_notice_discover",),
            registry=_sdk_candidate_tool_registry(
                "campus_notice_discover",
                runtime_posture="sdk_adapter_admitted",
            ),
        )

        self.assertEqual(descriptors[0].runtime_posture, "sdk_adapter_admitted")

    def test_bridge_module_does_not_import_or_execute_sdk_runtime(self) -> None:
        source = Path(
            "apps/supervisor-agent-worker/src/"
            "campus_supervisor_agent_worker/agents_sdk_tool_bridge.py"
        ).read_text(encoding="utf-8")

        forbidden_fragments = (
            "Runner.run",
            "from agents import",
            "import agents",
            "hosted_mcp",
            "web_search",
            "file_search",
            "computer_use",
            "object_store",
            "collector",
            "ingestion",
            "index_build",
            "raw_sql",
        )
        for fragment in forbidden_fragments:
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, source)


def _sdk_candidate_tool_registry(
    tool_name: str,
    *,
    runtime_posture: str = "sdk_adapter_candidate",
):
    registry = default_tool_spec_registry()
    return replace(
        registry,
        tools=tuple(
            replace(tool, runtime_posture=runtime_posture) if tool.name == tool_name else tool
            for tool in registry.tools
        ),
    )


if __name__ == "__main__":
    unittest.main()
