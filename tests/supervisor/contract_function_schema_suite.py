from __future__ import annotations

import unittest
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal

from campus_contracts.schema_metadata import schema_metadata
from campus_supervisor_agent_worker.contract_function_schema import (
    ContractFunctionSchemaError,
    function_parameters_schema_for_type,
)


class _LocalMode(StrEnum):
    CURRENT = "current"
    HISTORICAL = "historical"


@dataclass(frozen=True, slots=True)
class _LocalNestedPayload:
    code: str = field(metadata=schema_metadata(description="Nested code."))


@dataclass(frozen=True, slots=True)
class _LocalPayload:
    query_text: str = field(metadata=schema_metadata(description="Original query text."))
    literal_mode: Literal["current", "historical"] = field(
        metadata=schema_metadata(description="Literal mode.")
    )
    enum_mode: _LocalMode = field(metadata=schema_metadata(description="Enum mode."))
    nested: _LocalNestedPayload | None = field(
        default=None,
        metadata=schema_metadata(description="Optional nested payload."),
    )
    labels: tuple[str, ...] = field(
        default_factory=tuple,
        metadata=schema_metadata(description="Optional labels."),
    )
    hidden: str = field(
        default="",
        metadata=schema_metadata(description="Excluded hidden field.", exclude=True),
    )


@dataclass(frozen=True, slots=True)
class _UnsupportedPayload:
    raw_mapping: dict[str, str] = field(
        metadata=schema_metadata(description="Unsupported mapping.")
    )


class ContractFunctionSchemaTest(unittest.TestCase):
    def test_generates_strict_schema_from_dataclass_contract(self) -> None:
        schema = function_parameters_schema_for_type(_LocalPayload)

        self.assertEqual(schema["type"], "object")
        self.assertEqual(schema["additionalProperties"], False)
        self.assertEqual(
            tuple(schema["properties"]),
            ("query_text", "literal_mode", "enum_mode", "nested", "labels"),
        )
        self.assertEqual(schema["required"], list(schema["properties"]))
        self.assertEqual(
            schema["properties"]["query_text"]["description"],
            "Original query text.",
        )
        self.assertEqual(
            schema["properties"]["literal_mode"]["enum"],
            ["current", "historical"],
        )
        self.assertEqual(
            schema["properties"]["enum_mode"]["enum"],
            ["current", "historical"],
        )

    def test_optional_and_nested_fields_are_nullable_strict_objects(self) -> None:
        schema = function_parameters_schema_for_type(_LocalPayload)

        nested = schema["properties"]["nested"]
        self.assertEqual(nested["type"], ["object", "null"])
        self.assertEqual(nested["additionalProperties"], False)
        self.assertEqual(tuple(nested["properties"]), ("code",))
        self.assertEqual(nested["required"], ["code"])

        labels = schema["properties"]["labels"]
        self.assertEqual(labels["type"], ["array", "null"])
        self.assertEqual(labels["items"]["type"], "string")

    def test_excluded_fields_do_not_appear_in_generated_schema(self) -> None:
        schema = function_parameters_schema_for_type(_LocalPayload)

        self.assertNotIn("hidden", schema["properties"])

    def test_unsupported_contract_types_fail_closed(self) -> None:
        with self.assertRaisesRegex(ContractFunctionSchemaError, "unsupported annotation"):
            function_parameters_schema_for_type(_UnsupportedPayload)


if __name__ == "__main__":
    unittest.main()
