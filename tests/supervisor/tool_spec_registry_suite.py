from __future__ import annotations

import unittest

from campus_contracts import RagRequestPayload, ServiceStatusLookupPayload
from campus_supervisor_agent_worker.tool_spec_registry import load_tool_spec_registry


class ToolSpecRegistryTest(unittest.TestCase):
    def test_resolves_payload_schema_refs_to_contract_classes(self) -> None:
        registry = load_tool_spec_registry()

        payload_classes = {
            tool.name: registry.payload_class_for_tool(tool.name)
            for tool in registry.structured_handoff_tools()
        }

        self.assertIs(payload_classes["service_status_lookup"], ServiceStatusLookupPayload)

    def test_agent_internal_retrieval_query_is_not_structured_handoff(self) -> None:
        registry = load_tool_spec_registry()
        retrieval_tool = registry.tool_by_name("retrieval.query")

        self.assertIsNotNone(retrieval_tool)
        assert retrieval_tool is not None
        self.assertEqual(retrieval_tool.surface, "agent_internal")
        self.assertEqual(
            registry.expected_allowed_tools_for_payload("rag-agent", RagRequestPayload()),
            (),
        )
        self.assertEqual(registry.structured_tool_names_for_target("rag-agent"), ())

    def test_function_schema_availability_is_separate_from_runtime_posture(self) -> None:
        registry = load_tool_spec_registry()
        notice_get = registry.tool_by_name("campus_notice_get")
        service_status = registry.tool_by_name("service_status_lookup")

        self.assertIsNotNone(notice_get)
        self.assertIsNotNone(service_status)
        assert notice_get is not None
        assert service_status is not None
        self.assertTrue(notice_get.function_schema.available)
        self.assertEqual(notice_get.runtime_posture, "provider_loop_pilot")
        self.assertTrue(service_status.function_schema.available)
        self.assertEqual(service_status.runtime_posture, "typed_handoff_only")


if __name__ == "__main__":
    unittest.main()
