from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_supervisor_agent_worker.tool_function_schema import (
    generate_provider_function_schemas,
)


class ToolFunctionSchemaTest(unittest.TestCase):
    def test_generates_strict_provider_function_schemas_for_structured_tools(self) -> None:
        schemas = generate_provider_function_schemas()

        self.assertEqual(
            tuple(schema["name"] for schema in schemas),
            (
                "service_status_lookup",
                "service_guide_lookup",
                "transport_schedule_lookup",
                "contact_directory_lookup",
                "campus_notice_discover",
                "campus_notice_get",
            ),
        )
        for schema in schemas:
            self.assertEqual(schema["type"], "function")
            self.assertEqual(schema["strict"], True)
            self.assertEqual(schema["parameters"]["type"], "object")
            self.assertEqual(schema["parameters"]["additionalProperties"], False)
            _assert_strict_object(schema["parameters"])

    def test_agent_internal_tools_do_not_get_provider_function_schemas(self) -> None:
        schemas = generate_provider_function_schemas()

        self.assertNotIn("retrieval.query", {schema["name"] for schema in schemas})

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

    def test_optional_fields_are_strict_nullable_instead_of_missing_from_required(self) -> None:
        schemas = {schema["name"]: schema for schema in generate_provider_function_schemas()}

        notice_get = schemas["campus_notice_get"]["parameters"]

        self.assertEqual(set(notice_get["required"]), {"notice_id", "source_family"})
        self.assertEqual(notice_get["properties"]["source_family"]["type"], ["string", "null"])

    def test_provider_function_schema_snapshot_is_stable(self) -> None:
        snapshot_path = Path("packages/evals/fixtures/provider_function_tools.v1.json")
        expected = json.loads(snapshot_path.read_text(encoding="utf-8"))

        self.assertEqual(
            {
                "schema_version": "provider-function-tools-v1",
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
