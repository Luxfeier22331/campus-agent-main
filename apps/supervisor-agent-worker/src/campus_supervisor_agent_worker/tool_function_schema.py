from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from campus_contracts.models_shared import (
    ALLOWED_CONTACT_DIRECTORY_FOCUSES,
    ALLOWED_NOTICE_SOURCE_FAMILIES,
    ALLOWED_NOTICE_TARGET_SURFACES,
    ALLOWED_SERVICE_GUIDE_AUDIENCES,
    ALLOWED_SERVICE_GUIDE_FOCUSES,
    ALLOWED_TEMPORAL_QUERY_MODES,
    ALLOWED_TRANSPORT_DAYPARTS,
    ALLOWED_TRANSPORT_SCHEDULE_INTENTS,
    ALLOWED_TRANSPORT_SERVICE_DATE_MODES,
)

from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpec,
    load_tool_spec_registry,
)

PROVIDER_FUNCTION_TOOLS_SCHEMA_VERSION = "provider-function-tools-v1"


def generate_provider_function_schemas(
    tool_spec_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    registry = load_tool_spec_registry(tool_spec_path)
    schemas: list[dict[str, Any]] = []
    for tool in registry.provider_function_tools():
        schemas.append(provider_function_schema_for_tool(tool))
    return schemas


def provider_function_schema_for_tool(tool: ToolSpec) -> dict[str, Any]:
    return {
        "type": "function",
        "name": tool.name,
        "description": tool.description,
        "strict": tool.function_schema.strict,
        "parameters": _parameters_for_tool(tool),
    }


def provider_function_schema_artifact(
    tool_spec_path: Path | str | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": PROVIDER_FUNCTION_TOOLS_SCHEMA_VERSION,
        "tools": generate_provider_function_schemas(tool_spec_path),
    }


def write_provider_function_schema_snapshot(
    output_path: Path | str,
    tool_spec_path: Path | str | None = None,
) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(provider_function_schema_artifact(tool_spec_path), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )


def _parameters_for_tool(tool: ToolSpec) -> dict[str, Any]:
    return _parameters_for_payload_kind(tool.payload_kind)


def _parameters_for_payload_kind(payload_kind: str) -> dict[str, Any]:
    if payload_kind == "service_status_lookup":
        return _strict_object(
            {
                "subject_query": _string("Campus service, facility, or operation to check."),
                "temporal_query": _temporal_query_schema(),
                "campus_scope": _string("Optional campus scope such as haidian or fengtai."),
            },
            required=("subject_query",),
        )
    if payload_kind == "service_guide_lookup":
        return _strict_object(
            {
                "service_query": _string("Campus service or process to explain."),
                "guide_focus": _enum(
                    ALLOWED_SERVICE_GUIDE_FOCUSES,
                    "Requested service guide section.",
                ),
                "temporal_query": _temporal_query_schema(),
                "campus_scope": _string("Optional campus scope such as haidian or fengtai."),
                "audience": _enum(ALLOWED_SERVICE_GUIDE_AUDIENCES, "Audience for the guide."),
                "result_limit": _integer("Optional positive maximum result count."),
            },
            required=("service_query", "guide_focus"),
        )
    if payload_kind == "transport_schedule_lookup":
        return _strict_object(
            {
                "query_text": _string("Original transport schedule question."),
                "intent": _enum(
                    ALLOWED_TRANSPORT_SCHEDULE_INTENTS,
                    "Transport schedule lookup intent.",
                ),
                "route_selector": _transport_route_selector_schema(),
                "snapshot_query": _temporal_query_schema(),
                "service_time_query": _transport_service_time_query_schema(),
                "result_limit": _integer("Optional positive maximum result count."),
            },
            required=("query_text", "intent"),
        )
    if payload_kind == "contact_directory_lookup":
        return _strict_object(
            {
                "query_text": _string("Original contact directory question."),
                "contact_focus": _enum(
                    ALLOWED_CONTACT_DIRECTORY_FOCUSES,
                    "Requested contact information focus.",
                ),
                "entity_selector": _contact_entity_selector_schema(),
                "temporal_query": _temporal_query_schema(),
                "campus_scope": _string("Optional campus scope such as haidian or fengtai."),
                "audience": _enum(ALLOWED_SERVICE_GUIDE_AUDIENCES, "Audience for the contact."),
                "result_limit": _integer("Optional positive maximum result count."),
            },
            required=("query_text", "contact_focus"),
        )
    if payload_kind == "campus_notice_discover":
        return _strict_object(
            {
                "query_text": _string("Original notice discovery question."),
                "temporal_query": _temporal_query_schema(),
                "source_families": _string_array(
                    ALLOWED_NOTICE_SOURCE_FAMILIES,
                    "Allowed notice source families.",
                ),
                "target_surfaces": _string_array(
                    ALLOWED_NOTICE_TARGET_SURFACES,
                    "Allowed notice target surfaces.",
                ),
                "max_results": _integer("Positive maximum number of notice cards."),
            },
            required=("query_text",),
        )
    if payload_kind == "campus_notice_get":
        return _strict_object(
            {
                "notice_id": _string("Normalized governed notice id."),
                "source_family": _enum(
                    ALLOWED_NOTICE_SOURCE_FAMILIES,
                    "Optional notice source family.",
                ),
            },
            required=("notice_id",),
        )
    raise ValueError(f"unsupported provider function payload kind: {payload_kind}")


def _strict_object(
    properties: dict[str, Any],
    *,
    required: tuple[str, ...] = (),
) -> dict[str, Any]:
    semantic_required = set(required)
    strict_properties = {
        name: schema if name in semantic_required else _nullable_schema(schema)
        for name, schema in properties.items()
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": strict_properties,
        "required": list(properties),
    }


def _string(description: str) -> dict[str, Any]:
    return {"type": "string", "description": description}


def _integer(description: str) -> dict[str, Any]:
    return {"type": "integer", "description": description, "minimum": 1}


def _enum(values: tuple[str, ...], description: str) -> dict[str, Any]:
    return {"type": "string", "enum": list(values), "description": description}


def _string_array(values: tuple[str, ...], description: str) -> dict[str, Any]:
    return {
        "type": "array",
        "items": _enum(values, description),
        "description": description,
    }


def _nullable_schema(schema: dict[str, Any]) -> dict[str, Any]:
    nullable = dict(schema)
    schema_type = nullable.get("type")
    if isinstance(schema_type, str):
        nullable["type"] = [schema_type, "null"]
    elif isinstance(schema_type, list) and "null" not in schema_type:
        nullable["type"] = [*schema_type, "null"]
    if "enum" in nullable and None not in nullable["enum"]:
        nullable["enum"] = [*nullable["enum"], None]
    return nullable


def _temporal_query_schema() -> dict[str, Any]:
    return _strict_object(
        {
            "mode": _enum(ALLOWED_TEMPORAL_QUERY_MODES, "Temporal query mode."),
            "as_of": _string("Required only when mode is as_of."),
            "year_hint": _string("Required only when mode is current_year."),
        }
    )


def _transport_route_selector_schema() -> dict[str, Any]:
    return _strict_object(
        {
            "route_id": _string("Known route id if already resolved."),
            "service_family": _string("Service family such as intercampus or metro shuttle."),
            "route_variant_query": _string("Route variant words from the user query."),
            "origin_campus": _string("Origin campus if stated."),
            "destination_campus": _string("Destination campus if stated."),
            "origin_stop_query": _string("Origin stop if stated."),
            "destination_stop_query": _string("Destination stop if stated."),
        }
    )


def _transport_service_time_query_schema() -> dict[str, Any]:
    return _strict_object(
        {
            "date_mode": _enum(
                ALLOWED_TRANSPORT_SERVICE_DATE_MODES,
                "Service date interpretation.",
            ),
            "service_date": _string("ISO date when date_mode is date."),
            "daypart": _enum(ALLOWED_TRANSPORT_DAYPARTS, "Requested daypart."),
            "departure_not_before": _string("Lower bound departure time in HH:MM if stated."),
            "departure_not_after": _string("Upper bound departure time in HH:MM if stated."),
        }
    )


def _contact_entity_selector_schema() -> dict[str, Any]:
    return _strict_object(
        {
            "contact_id": _string("Known contact id if already resolved."),
            "department_query": _string("Department name fragment."),
            "office_query": _string("Office name fragment."),
            "service_query": _string("Service or task the contact should support."),
            "person_query": _string("Person name fragment."),
            "role_query": _string("Role name fragment."),
            "purpose_query": _string("Reason for contacting."),
            "contact_group_query": _string("Contact group fragment."),
            "location_query": _string("Location fragment."),
        }
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate provider function tool schemas.")
    parser.add_argument(
        "--check", action="store_true", help="Check snapshot matches generated output."
    )
    parser.add_argument("--write", action="store_true", help="Write generated snapshot.")
    parser.add_argument(
        "--output",
        default="packages/evals/fixtures/provider_function_tools.v1.json",
        help="Snapshot output path.",
    )
    args = parser.parse_args(argv)
    output = Path(args.output)
    generated = provider_function_schema_artifact()
    if args.write:
        write_provider_function_schema_snapshot(output)
        return 0
    if args.check:
        expected = json.loads(output.read_text(encoding="utf-8"))
        if expected != generated:
            raise SystemExit("provider function schema snapshot is stale")
        return 0
    print(json.dumps(generated, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
