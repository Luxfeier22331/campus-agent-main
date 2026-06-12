from __future__ import annotations

import unittest

from campus_contracts import (
    AcademicCalendarLookupPayload,
    RagRequestPayload,
    ServiceStatusLookupPayload,
)
from campus_knowledge_capability.rag_sdk_models import RagSdkRetrieveEvidenceArguments
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpecRegistryError,
    load_tool_spec_registry,
)


class ToolSpecRegistryTest(unittest.TestCase):
    def test_registry_rejects_missing_runtime_posture(self) -> None:
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory

        registry = load_tool_spec_registry()
        tool_payload = []
        for tool in registry.tools:
            item = {
                "name": tool.name,
                "owner_capability": tool.owner_capability,
                "capability": tool.capability,
                "surface": tool.surface,
                "active": tool.active,
                "payload_kind": tool.payload_kind,
                "payload_schema_ref": tool.payload_schema_ref,
                "result_schema_ref": tool.result_schema_ref,
                "backend": tool.backend,
                "read_only": tool.read_only,
                "description": tool.description,
                "function_schema": {
                    "available": tool.function_schema.available,
                    "strict": tool.function_schema.strict,
                },
            }
            if tool.name != "campus_notice_discover":
                item["runtime_posture"] = tool.runtime_posture
            tool_payload.append(item)

        payload = {
            "schema_version": "tools.v3",
            "tools": tool_payload,
        }

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "tools.v3.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                ToolSpecRegistryError, "runtime_posture must be a non-empty string"
            ):
                load_tool_spec_registry(path)

    def test_resolves_payload_schema_refs_to_contract_classes(self) -> None:
        registry = load_tool_spec_registry()

        payload_classes = {
            tool.name: registry.payload_class_for_tool(tool.name)
            for tool in registry.capability_facing_tools()
        }

        self.assertIs(payload_classes["service_status_lookup"], ServiceStatusLookupPayload)
        self.assertIs(
            payload_classes["academic_calendar_lookup"],
            AcademicCalendarLookupPayload,
        )

    def test_capability_internal_retrieval_query_is_not_structured_handoff(self) -> None:
        registry = load_tool_spec_registry()
        retrieval_tool = registry.tool_by_name("retrieval.query")

        self.assertIsNotNone(retrieval_tool)
        assert retrieval_tool is not None
        self.assertEqual(retrieval_tool.surface, "capability_internal")
        self.assertEqual(
            registry.expected_allowed_tools_for_payload("knowledge", RagRequestPayload()),
            (),
        )
        self.assertEqual(registry.capability_facing_tool_names_for_capability("knowledge"), ())

    def test_rag_sdk_retrieve_evidence_is_internal_sdk_function_only(self) -> None:
        registry = load_tool_spec_registry()
        retrieve_evidence = registry.tool_by_name("retrieve_evidence")

        self.assertIsNotNone(retrieve_evidence)
        assert retrieve_evidence is not None
        self.assertEqual(retrieve_evidence.owner_capability, "knowledge")
        self.assertEqual(retrieve_evidence.surface, "capability_internal")
        self.assertTrue(retrieve_evidence.function_schema.available)
        self.assertTrue(retrieve_evidence.function_schema.strict)
        self.assertEqual(retrieve_evidence.runtime_posture, "capability_internal_admitted")
        self.assertIs(
            registry.payload_class_for_tool("retrieve_evidence"),
            RagSdkRetrieveEvidenceArguments,
        )
        self.assertEqual(
            registry.expected_allowed_tools_for_payload("knowledge", RagRequestPayload()),
            (),
        )
        self.assertEqual(registry.capability_facing_tool_names_for_capability("knowledge"), ())

    def test_notice_get_is_not_capability_facing_function_tool(self) -> None:
        registry = load_tool_spec_registry()
        notice_get = registry.tool_by_name("campus_notice_get")
        service_status = registry.tool_by_name("service_status_lookup")

        self.assertIsNotNone(notice_get)
        self.assertIsNotNone(service_status)
        assert notice_get is not None
        assert service_status is not None
        self.assertTrue(notice_get.active)
        self.assertEqual(notice_get.surface, "capability_internal")
        self.assertFalse(notice_get.function_schema.available)
        self.assertEqual(notice_get.runtime_posture, "internal_function")
        self.assertEqual(
            registry.capability_facing_tool_names_for_capability("notice"),
            ("campus_notice_change_set_lookup", "campus_notice_discover"),
        )
        self.assertTrue(service_status.function_schema.available)
        self.assertEqual(service_status.runtime_posture, "typed_activity_admitted")

    def test_internal_function_posture_is_reserved_for_capability_internal_non_model_tools(self) -> None:
        registry = load_tool_spec_registry()
        notice_get = registry.tool_by_name("campus_notice_get")
        retrieve_evidence = registry.tool_by_name("retrieve_evidence")

        self.assertIsNotNone(notice_get)
        self.assertIsNotNone(retrieve_evidence)
        assert notice_get is not None
        assert retrieve_evidence is not None
        self.assertEqual(notice_get.surface, "capability_internal")
        self.assertEqual(notice_get.runtime_posture, "internal_function")
        self.assertFalse(notice_get.function_schema.available)
        self.assertEqual(retrieve_evidence.runtime_posture, "capability_internal_admitted")

    def test_domain_capability_typed_activity_admitted_tools_are_explicit(self) -> None:
        registry = load_tool_spec_registry()
        notice_discover = registry.tool_by_name("campus_notice_discover")
        campus_service_tools = {
            tool.name: tool
            for tool in registry.tools
            if tool.owner_capability == "campus_services"
        }

        self.assertIsNotNone(notice_discover)
        assert notice_discover is not None
        self.assertEqual(notice_discover.surface, "structured_handoff")
        self.assertTrue(notice_discover.function_schema.available)
        self.assertTrue(notice_discover.function_schema.strict)
        self.assertEqual(notice_discover.runtime_posture, "typed_activity_admitted")
        self.assertEqual(
            campus_service_tools["service_status_lookup"].runtime_posture,
            "typed_activity_admitted",
        )
        self.assertEqual(
            campus_service_tools["service_guide_lookup"].runtime_posture,
            "typed_activity_admitted",
        )
        self.assertEqual(
            campus_service_tools["transport_schedule_lookup"].runtime_posture,
            "typed_activity_admitted",
        )
        self.assertEqual(
            campus_service_tools["contact_directory_lookup"].runtime_posture,
            "typed_activity_admitted",
        )
        self.assertEqual(
            campus_service_tools["academic_calendar_lookup"].capability,
            "campus_services",
        )
        self.assertEqual(
            campus_service_tools["academic_calendar_lookup"].runtime_posture,
            "typed_activity_admitted",
        )

    def test_registry_rejects_legacy_sdk_adapter_candidate_runtime_posture(self) -> None:
        from dataclasses import replace

        registry = load_tool_spec_registry()
        mutated_tools = tuple(
            replace(tool, runtime_posture="sdk_adapter_candidate")
            if tool.name == "campus_notice_discover"
            else tool
            for tool in registry.tools
        )

        with self.assertRaisesRegex(ToolSpecRegistryError, "runtime_posture is unsupported"):
            replace(registry, tools=mutated_tools).validate()


if __name__ == "__main__":
    unittest.main()
