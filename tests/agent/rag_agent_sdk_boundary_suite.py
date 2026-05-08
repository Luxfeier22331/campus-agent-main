from __future__ import annotations

import json
import unittest
from pathlib import Path


class RagAgentSdkBoundaryTest(unittest.TestCase):
    def test_retrieval_query_remains_internal_closed_tool(self) -> None:
        tools = json.loads(Path("configs/runtime/tools.v2.json").read_text(encoding="utf-8"))
        tool_by_name = {tool["name"]: tool for tool in tools["tools"]}

        retrieval_query = tool_by_name["retrieval.query"]

        self.assertEqual(retrieval_query["owner_agent"], "rag-agent")
        self.assertEqual(retrieval_query["surface"], "agent_internal")
        self.assertEqual(retrieval_query["runtime_posture"], "closed")
        self.assertFalse(retrieval_query["function_schema"]["available"])

    def test_rag_agent_does_not_admit_agent_facing_tools(self) -> None:
        agents = json.loads(Path("configs/runtime/agents.v2.json").read_text(encoding="utf-8"))
        agent_by_id = {agent["id"]: agent for agent in agents["agents"]}

        rag_agent = agent_by_id["rag-agent"]

        self.assertEqual(rag_agent["allowed_structured_handoff_tools"], [])
        self.assertEqual(rag_agent["runtime_adapter"], "worker_dispatch")


if __name__ == "__main__":
    unittest.main()
