from __future__ import annotations

import unittest
from dataclasses import replace

from campus_supervisor_agent_worker.rag_sdk_internal_tool_bridge import (
    RagSdkInternalToolBridgeError,
    build_rag_sdk_internal_tool_descriptor,
)
from campus_supervisor_agent_worker.tool_spec_registry import default_tool_spec_registry


class RagSdkInternalToolBridgeTest(unittest.TestCase):
    def test_builds_retrieve_evidence_descriptor_from_tool_spec(self) -> None:
        descriptor = build_rag_sdk_internal_tool_descriptor()

        self.assertEqual(descriptor.name, "retrieve_evidence")
        self.assertEqual(descriptor.runtime_posture, "sdk_internal_admitted")
        self.assertTrue(descriptor.strict)
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
        with self.assertRaisesRegex(RagSdkInternalToolBridgeError, "must remain agent_internal"):
            build_rag_sdk_internal_tool_descriptor("service_status_lookup")

    def test_rejects_closed_internal_retrieval_query(self) -> None:
        with self.assertRaisesRegex(RagSdkInternalToolBridgeError, "runtime_posture"):
            build_rag_sdk_internal_tool_descriptor("retrieval.query")

    def test_rejects_wrong_surface_even_if_runtime_posture_is_changed(self) -> None:
        registry = default_tool_spec_registry()
        changed = replace(
            registry,
            tools=tuple(
                replace(tool, runtime_posture="sdk_internal_admitted")
                if tool.name == "service_status_lookup"
                else tool
                for tool in registry.tools
            ),
        )

        with self.assertRaisesRegex(RagSdkInternalToolBridgeError, "agent_internal"):
            build_rag_sdk_internal_tool_descriptor(
                "service_status_lookup",
                registry=changed,
            )


if __name__ == "__main__":
    unittest.main()
