from __future__ import annotations

import unittest
from dataclasses import replace

from campus_supervisor_agent_worker.agents_sdk_tool_bridge import (
    AgentsSdkToolBridgeError,
    build_agents_sdk_tool_descriptors,
)
from campus_supervisor_agent_worker.tool_spec_registry import default_tool_spec_registry


class AgentsSdkInternalToolSuite(unittest.TestCase):
    def test_builds_retrieve_evidence_descriptor_from_tool_spec(self) -> None:
        descriptor = build_agents_sdk_tool_descriptors(("retrieve_evidence",))[0]

        self.assertEqual(descriptor.name, "retrieve_evidence")
        self.assertEqual(descriptor.runtime_posture, "sdk_internal_admitted")
        self.assertTrue(descriptor.function_schema_strict)
        self.assertEqual(descriptor.parameters["type"], "object")
        self.assertEqual(descriptor.parameters["additionalProperties"], False)
        self.assertEqual(
            set(descriptor.parameters["properties"]),
            {"query_slot_id", "retrieval_intent"},
        )
        self.assertEqual(
            descriptor.parameters["properties"]["query_slot_id"]["type"],
            ["string", "null"],
        )
        self.assertEqual(
            descriptor.parameters["properties"]["retrieval_intent"]["type"],
            "string",
        )

    def test_rejects_structured_handoff_tools(self) -> None:
        descriptors = build_agents_sdk_tool_descriptors(("service_status_lookup",))

        self.assertEqual(len(descriptors), 1)
        self.assertEqual(descriptors[0].name, "service_status_lookup")

    def test_rejects_closed_internal_retrieval_query(self) -> None:
        with self.assertRaisesRegex(
            AgentsSdkToolBridgeError,
            "runtime_posture_not_admitted",
        ):
            build_agents_sdk_tool_descriptors(("retrieval.query",))

    def test_admits_any_explicitly_sdk_admitted_agent_internal_tool(self) -> None:
        registry = default_tool_spec_registry()
        changed = replace(
            registry,
            tools=tuple(
                replace(tool, surface="agent_internal", runtime_posture="sdk_internal_admitted")
                if tool.name == "service_status_lookup"
                else tool
                for tool in registry.tools
            ),
        )

        descriptor = build_agents_sdk_tool_descriptors(
            ("service_status_lookup",),
            registry=changed,
        )[0]

        self.assertEqual(descriptor.name, "service_status_lookup")
        self.assertEqual(descriptor.runtime_posture, "sdk_internal_admitted")


if __name__ == "__main__":
    unittest.main()
