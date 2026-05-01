from __future__ import annotations

import unittest
from pathlib import Path

from campus_supervisor_agent_worker.agents_sdk_tool_bridge import (
    AgentsSdkToolBridgeError,
    build_agents_sdk_tool_descriptors,
)


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


if __name__ == "__main__":
    unittest.main()
