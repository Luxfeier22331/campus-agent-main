from __future__ import annotations

import argparse
import importlib
import json
from pathlib import Path
from typing import Any

from campus_supervisor_agent_worker.contract_function_schema import (
    provider_parameters_schema_for_type,
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
        "parameters": provider_parameters_schema_for_type(_resolve_payload_class(tool)),
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


def _resolve_payload_class(tool: ToolSpec) -> type[object]:
    module_name, _, class_name = tool.payload_schema_ref.rpartition(".")
    if not module_name or not class_name:
        raise ValueError(f"{tool.name} payload_schema_ref is invalid: {tool.payload_schema_ref}")
    module = importlib.import_module(module_name)
    payload_class = getattr(module, class_name, None)
    if not isinstance(payload_class, type):
        raise ValueError(
            f"{tool.name} payload_schema_ref does not resolve to a class: {tool.payload_schema_ref}"
        )
    return payload_class


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
