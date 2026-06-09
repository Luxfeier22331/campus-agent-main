from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_supervisor_agent_worker.provider_function_schema import (
    generate_provider_function_schemas,
    provider_function_schema_for_tool,
)
from campus_supervisor_agent_worker.tool_spec_registry import load_tool_spec_registry


class ProviderFunctionSchemaTest(unittest.TestCase):
    def test_generates_strict_tool_function_schemas_for_structured_tools(self) -> None:
        schemas = generate_provider_function_schemas()

        self.assertEqual(
            tuple(schema["name"] for schema in schemas),
            (
                "service_status_lookup",
                "service_guide_lookup",
                "transport_schedule_lookup",
                "contact_directory_lookup",
                "academic_calendar_lookup",
                "campus_notice_change_set_lookup",
                "campus_notice_discover",
                "retrieve_evidence",
            ),
        )
        for schema in schemas:
            self.assertEqual(schema["type"], "function")
            self.assertEqual(schema["strict"], True)
            self.assertEqual(schema["parameters"]["type"], "object")
            self.assertEqual(schema["parameters"]["additionalProperties"], False)
            _assert_strict_object(schema["parameters"])

    def test_capability_internal_tools_do_not_get_tool_function_schemas(self) -> None:
        schemas = generate_provider_function_schemas()

        self.assertNotIn("retrieval.query", {schema["name"] for schema in schemas})
        self.assertIn("retrieve_evidence", {schema["name"] for schema in schemas})

    def test_preserves_contract_enums_and_nested_strict_objects(self) -> None:
        schemas = {schema["name"]: schema for schema in generate_provider_function_schemas()}

        service_guide = schemas["service_guide_lookup"]["parameters"]["properties"]
        self.assertIn("procedure", service_guide["guide_focus"]["enum"])
        self.assertIn("required_materials", service_guide["guide_focus"]["enum"])
        transport = schemas["transport_schedule_lookup"]["parameters"]["properties"]
        self.assertIn("next_departure", transport["intent"]["enum"])
        self.assertEqual(
            transport["route_selector"]["additionalProperties"],
            False,
        )
        self.assertEqual(
            set(transport["route_selector"]["required"]),
            set(transport["route_selector"]["properties"]),
        )
        academic_calendar = schemas["academic_calendar_lookup"]["parameters"]["properties"]
        self.assertIn("query_kind", academic_calendar)
        self.assertIn("answer_focus", academic_calendar)
        self.assertIn("event_query", academic_calendar)
        self.assertIn("target_date", academic_calendar)
        self.assertEqual(academic_calendar["query_kind"]["type"], "string")
        self.assertNotIn(None, academic_calendar["query_kind"]["enum"])

    def test_notice_body_get_is_not_a_tool_function_schema(self) -> None:
        schemas = {schema["name"]: schema for schema in generate_provider_function_schemas()}

        self.assertNotIn("campus_notice_get", schemas)

    def test_all_available_function_schema_tools_generate_from_payload_schema_refs(self) -> None:
        registry = load_tool_spec_registry()

        for tool in (
            *registry.callable_schema_tools(),
            *registry.provider_callable_internal_functions(),
        ):
            with self.subTest(tool=tool.name):
                schema = provider_function_schema_for_tool(tool)
                self.assertEqual(schema["name"], tool.name)
                self.assertEqual(schema["parameters"]["type"], "object")

    def test_no_payload_kind_switch_table_remains(self) -> None:
        source = Path(
            "apps/supervisor-agent-worker/src/"
            "campus_supervisor_agent_worker/provider_function_schema.py"
        ).read_text(encoding="utf-8")

        self.assertNotIn("_parameters_for_payload_kind", source)

    def test_provider_function_schema_snapshot_is_stable(self) -> None:
        snapshot_path = Path("packages/evals/fixtures/tool_function_schemas.v1.json")
        expected = json.loads(snapshot_path.read_text(encoding="utf-8"))

        self.assertEqual(
            {
                "schema_version": "tool-function-schemas-v1",
                "tools": generate_provider_function_schemas(),
            },
            expected,
        )


def _assert_strict_object(schema: dict[str, object]) -> None:
    if schema.get("type") == "object":
        properties = schema.get("properties")
        self_required = schema.get("required")
        if isinstance(properties, dict):
            if set(self_required or []) != set(properties):
                raise AssertionError(
                    f"strict object required={self_required!r} must match properties={properties!r}"
                )
            if schema.get("additionalProperties") is not False:
                raise AssertionError(
                    f"strict object missing additionalProperties=false: {schema!r}"
                )
            for nested in properties.values():
                if isinstance(nested, dict):
                    _assert_strict_object(nested)
    if schema.get("type") == "array":
        items = schema.get("items")
        if isinstance(items, dict):
            _assert_strict_object(items)


if __name__ == "__main__":
    unittest.main()
