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

    def test_notice_get_is_not_agent_facing_provider_tool(self) -> None:
        registry = load_tool_spec_registry()
        notice_get = registry.tool_by_name("campus_notice_get")
        service_status = registry.tool_by_name("service_status_lookup")

        self.assertIsNotNone(notice_get)
        self.assertIsNotNone(service_status)
        assert notice_get is not None
        assert service_status is not None
        self.assertTrue(notice_get.active)
        self.assertEqual(notice_get.surface, "agent_internal")
        self.assertFalse(notice_get.function_schema.available)
        self.assertEqual(notice_get.runtime_posture, "closed")
        self.assertEqual(
            registry.structured_tool_names_for_target("notice-agent"), ("campus_notice_discover",)
        )
        self.assertTrue(service_status.function_schema.available)
        self.assertEqual(service_status.runtime_posture, "typed_handoff_only")

    def test_domain_agent_sdk_adapter_admitted_tools_are_explicit(self) -> None:
        registry = load_tool_spec_registry()
        notice_discover = registry.tool_by_name("campus_notice_discover")
        campus_service_tools = {
            tool.name: tool
            for tool in registry.tools
            if tool.owner_agent == "campus-services-agent"
        }

        self.assertIsNotNone(notice_discover)
        assert notice_discover is not None
        self.assertEqual(notice_discover.surface, "structured_handoff")
        self.assertTrue(notice_discover.function_schema.available)
        self.assertTrue(notice_discover.function_schema.strict)
        self.assertEqual(notice_discover.runtime_posture, "sdk_adapter_admitted")
        self.assertEqual(
            campus_service_tools["service_status_lookup"].runtime_posture,
            "typed_handoff_only",
        )
        self.assertEqual(
            campus_service_tools["service_guide_lookup"].runtime_posture,
            "sdk_adapter_admitted",
        )
        self.assertEqual(
            campus_service_tools["transport_schedule_lookup"].runtime_posture,
            "typed_handoff_only",
        )
        self.assertEqual(
            campus_service_tools["contact_directory_lookup"].runtime_posture,
            "sdk_adapter_admitted",
        )


if __name__ == "__main__":
    unittest.main()
