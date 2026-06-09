from __future__ import annotations

import json
import unittest
from pathlib import Path


class KnowledgeCapabilitySdkBoundaryTest(unittest.TestCase):
    def test_retrieval_query_remains_internal_closed_tool(self) -> None:
        tools = json.loads(Path("configs/runtime/tools.v3.json").read_text(encoding="utf-8"))
        tool_by_name = {tool["name"]: tool for tool in tools["tools"]}

        retrieval_query = tool_by_name["retrieval.query"]

        self.assertEqual(retrieval_query["owner_capability"], "knowledge")
        self.assertEqual(retrieval_query["surface"], "capability_internal")
        self.assertEqual(retrieval_query["runtime_posture"], "closed")
        self.assertFalse(retrieval_query["function_schema"]["available"])

    def test_knowledge_capability_does_not_admit_capability_facing_tools(self) -> None:
        capabilities = json.loads(Path("configs/runtime/capabilities.v1.json").read_text(encoding="utf-8"))
        capability_by_id = {
            capability["id"]: capability for capability in capabilities["capabilities"]
        }

        knowledge_capability = capability_by_id["knowledge"]

        self.assertEqual(knowledge_capability["allowed_structured_tools"], [])
        self.assertEqual(knowledge_capability["runtime_adapter"], "temporal_activity_worker")


if __name__ == "__main__":
    unittest.main()
