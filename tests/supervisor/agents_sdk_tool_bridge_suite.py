from __future__ import annotations

import unittest
from pathlib import Path

from campus_supervisor_agent_worker.agents_sdk_tool_bridge import (
    AgentsSdkToolBridgeError,
    build_agents_sdk_tool_descriptors,
)
from campus_supervisor_agent_worker.tool_function_schema import (
    generate_provider_function_schemas,
)


class AgentsSdkToolBridgeTest(unittest.TestCase):
    def test_builds_notice_get_descriptor_from_toolspec_and_provider_schema(self) -> None:
        descriptors = build_agents_sdk_tool_descriptors(("campus_notice_get",))

        self.assertEqual(len(descriptors), 1)
        descriptor = descriptors[0]
        provider_schema = _provider_schema("campus_notice_get")
        self.assertEqual(descriptor.name, "campus_notice_get")
        self.assertEqual(descriptor.owner_agent, "notice-agent")
        self.assertEqual(descriptor.capability, "notice")
        self.assertEqual(descriptor.payload_kind, "campus_notice_get")
        self.assertEqual(descriptor.runtime_posture, "provider_loop_pilot")
        self.assertTrue(descriptor.read_only)
        self.assertTrue(descriptor.function_schema_strict)
        self.assertEqual(descriptor.function_schema, provider_schema)
        self.assertEqual(descriptor.parameters, provider_schema["parameters"])
        self.assertEqual(descriptor.runtime_policy["read_only"], True)
        self.assertEqual(descriptor.runtime_policy["result_projection"], "repo_bounded")
        self.assertEqual(descriptor.runtime_policy["fail_close_reason"], "sdk_tool_not_admitted")
        self.assertGreater(descriptor.runtime_policy["timeout_seconds"], 0)
        self.assertGreater(descriptor.runtime_policy["max_result_bytes"], 0)

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


def _provider_schema(name: str) -> dict[str, object]:
    for schema in generate_provider_function_schemas():
        if schema["name"] == name:
            return schema
    raise AssertionError(f"missing provider schema for {name}")


if __name__ == "__main__":
    unittest.main()
