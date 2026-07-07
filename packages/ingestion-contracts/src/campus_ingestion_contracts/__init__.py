from __future__ import annotations

import json
from dataclasses import dataclass
from importlib.resources import files
from typing import Any

from jsonschema import Draft202012Validator


@dataclass(frozen=True, slots=True)
class ValidationResult:
    ok: bool
    errors: tuple[str, ...] = ()


_SCHEMAS_ROOT = files("campus_ingestion_contracts").joinpath("schemas")


def validate_canonical_document_unit(value: object) -> ValidationResult:
    return _validate_with_schema("canonical-document-units.v1.schema.json", value)


def validate_canonical_document_units_jsonl(value: str) -> ValidationResult:
    errors: list[str] = []
    for index, line in enumerate(value.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as error:
            errors.append(f"line {index}: invalid JSON: {error.msg}")
            continue
        result = validate_canonical_document_unit(payload)
        errors.extend(f"line {index}: {message}" for message in result.errors)
    return _result(errors)


def validate_ingestion_task_envelope(value: object) -> ValidationResult:
    return _validate_with_schema("ingestion-task-envelope.v2.schema.json", value)


def validate_ingestion_task_registry(value: object) -> ValidationResult:
    return _validate_with_schema("ingestion-task-registry.v2.schema.json", value)


def validate_ingestion_release_manifest(value: object) -> ValidationResult:
    return _validate_with_schema("ingestion-release-manifest.v1.schema.json", value)


def _validate_with_schema(schema_name: str, value: object) -> ValidationResult:
    schema = _load_schema(schema_name)
    validator = Draft202012Validator(schema)
    return _result([_format_error(error) for error in validator.iter_errors(value)])


def _load_schema(schema_name: str) -> dict[str, Any]:
    return json.loads(_SCHEMAS_ROOT.joinpath(schema_name).read_text(encoding="utf-8"))


def _format_error(error: Any) -> str:
    path = _format_path(error.absolute_path)
    message = str(error.message)
    if error.validator == "required":
        missing = _extract_missing_required_property(message)
        if missing:
            return f"{path + '.' if path else ''}{missing} is required"
    if error.validator == "enum":
        return f"{path} is not supported: {error.instance}"
    if path:
        return f"{path}: {message}"
    return message


def _format_path(parts: Any) -> str:
    path = ""
    for part in parts:
        if isinstance(part, int):
            path = f"{path}[{part}]"
        else:
            path = str(part) if not path else f"{path}.{part}"
    return path


def _extract_missing_required_property(message: str) -> str | None:
    marker = "'"
    if marker not in message:
        return None
    parts = message.split(marker)
    return parts[1] if len(parts) >= 3 and parts[1] else None


def _result(errors: list[str]) -> ValidationResult:
    if errors:
        return ValidationResult(ok=False, errors=tuple(sorted(errors)))
    return ValidationResult(ok=True)


__all__ = [
    "ValidationResult",
    "validate_canonical_document_unit",
    "validate_canonical_document_units_jsonl",
    "validate_ingestion_release_manifest",
    "validate_ingestion_task_envelope",
    "validate_ingestion_task_registry",
]
