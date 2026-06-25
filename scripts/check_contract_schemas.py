from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError

REPO_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = REPO_ROOT / "packages/contracts/schemas/contract-schema-registry.v1.json"
REGISTRY_SCHEMA_PATH = (
    REPO_ROOT / "packages/contracts/schemas/contract-schema-registry.v1.schema.json"
)
JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"
OPENAPI_VERSION = "3.1.1"


@dataclass(frozen=True)
class SchemaRegistryEntry:
    id: str
    kind: str
    path: Path
    owner: str
    status: str
    validates: tuple[Path, ...]
    fixture_groups: tuple[dict[str, str], ...]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Validate contract schema registry entries.")
    parser.add_argument(
        "--registry",
        default=str(REGISTRY_PATH),
        help="Path to contract-schema-registry.v1.json.",
    )
    args = parser.parse_args(argv)

    registry_path = _repo_path(args.registry)
    registry_schema = _load_json(REGISTRY_SCHEMA_PATH)
    registry = _load_json(registry_path)
    _validate_json_schema_document(REGISTRY_SCHEMA_PATH, registry_schema)
    _validate_instance("contract-schema-registry.v1.json", registry_schema, registry)

    for entry in _registry_entries(registry):
        if entry.kind == "openapi_wire":
            _validate_openapi_document(entry.path)
        elif entry.kind == "json_artifact":
            _validate_json_schema_entry(entry)
        elif entry.kind in {"language_local", "legacy_helper"}:
            _require_path(entry.path)
        else:
            raise ValueError(f"{entry.id}: unsupported schema registry kind: {entry.kind}")


def _validate_json_schema_entry(entry: SchemaRegistryEntry) -> None:
    schema = _load_json(entry.path)
    _validate_json_schema_document(entry.path, schema)
    validator = Draft202012Validator(schema)

    for target in entry.validates:
        instance = _load_json(target)
        _validate_instance(str(_relative(target)), schema, instance)

    for group in entry.fixture_groups:
        group_dir = _repo_path(group["path"])
        _require_path(group_dir)
        valid_fixtures = tuple(sorted(group_dir.glob(group["valid_glob"])))
        invalid_fixtures = tuple(sorted(group_dir.glob(group["invalid_glob"])))
        if not valid_fixtures:
            raise ValueError(f"{entry.id}: fixture group has no valid fixtures: {group_dir}")
        if not invalid_fixtures:
            raise ValueError(f"{entry.id}: fixture group has no invalid fixtures: {group_dir}")
        for fixture_path in valid_fixtures:
            _validate_with_validator(validator, fixture_path, should_pass=True)
        for fixture_path in invalid_fixtures:
            _validate_with_validator(validator, fixture_path, should_pass=False)


def _validate_json_schema_document(path: Path, schema: dict[str, Any]) -> None:
    if schema.get("$schema") != JSON_SCHEMA_DIALECT:
        raise ValueError(f"{_relative(path)} must declare JSON Schema 2020-12")
    for key in ("$id", "title"):
        value = schema.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{_relative(path)} must declare non-empty {key}")
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise ValueError(f"{_relative(path)} is not a valid Draft 2020-12 schema: {exc}") from exc
    root_type = schema.get("type")
    if root_type is not None and root_type != "object":
        raise ValueError(f"{_relative(path)} root schema type must be object")


def _validate_openapi_document(path: Path) -> None:
    doc = _load_yaml(path)
    if not isinstance(doc, dict):
        raise ValueError(f"{_relative(path)} must contain an OpenAPI object")
    if doc.get("openapi") != OPENAPI_VERSION:
        raise ValueError(f"{_relative(path)} must use OpenAPI {OPENAPI_VERSION}")
    if doc.get("jsonSchemaDialect") != JSON_SCHEMA_DIALECT:
        raise ValueError(f"{_relative(path)} must use JSON Schema 2020-12")
    info = doc.get("info")
    if not isinstance(info, dict) or not isinstance(info.get("title"), str):
        raise ValueError(f"{_relative(path)} must declare info.title")
    paths = doc.get("paths")
    if not isinstance(paths, dict) or not paths:
        raise ValueError(f"{_relative(path)} must declare paths")
    components = doc.get("components")
    if not isinstance(components, dict) or not isinstance(components.get("schemas"), dict):
        raise ValueError(f"{_relative(path)} must declare components.schemas")


def _validate_instance(name: str, schema: dict[str, Any], instance: Any) -> None:
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(instance), key=_error_sort_key)
    if errors:
        first = errors[0]
        raise ValueError(f"{name} failed schema validation at {first.json_path}: {first.message}")


def _validate_with_validator(
    validator: Draft202012Validator,
    fixture_path: Path,
    *,
    should_pass: bool,
) -> None:
    instance = _load_json(fixture_path)
    errors = sorted(validator.iter_errors(instance), key=_error_sort_key)
    if should_pass and errors:
        first = errors[0]
        raise ValueError(
            f"{_relative(fixture_path)} should be valid but failed at "
            f"{first.json_path}: {first.message}"
        )
    if not should_pass and not errors:
        raise ValueError(f"{_relative(fixture_path)} should be invalid but passed")


def _registry_entries(registry: dict[str, Any]) -> tuple[SchemaRegistryEntry, ...]:
    raw_entries = registry.get("entries")
    if not isinstance(raw_entries, list):
        raise ValueError("contract schema registry entries must be a list")
    seen: set[str] = set()
    entries: list[SchemaRegistryEntry] = []
    for raw in raw_entries:
        if not isinstance(raw, dict):
            raise ValueError("contract schema registry entries must be objects")
        entry_id = _required_string(raw, "id")
        if entry_id in seen:
            raise ValueError(f"duplicate contract schema registry id: {entry_id}")
        seen.add(entry_id)
        entries.append(
            SchemaRegistryEntry(
                id=entry_id,
                kind=_required_string(raw, "kind"),
                path=_repo_path(_required_string(raw, "path")),
                owner=_required_string(raw, "owner"),
                status=_required_string(raw, "status"),
                validates=tuple(
                    _repo_path(path) for path in raw.get("validates", ()) if isinstance(path, str)
                ),
                fixture_groups=tuple(
                    group for group in raw.get("fixture_groups", ()) if isinstance(group, dict)
                ),
            )
        )
    return tuple(entries)


def _required_string(value: dict[str, Any], key: str) -> str:
    candidate = value.get(key)
    if not isinstance(candidate, str) or not candidate.strip():
        raise ValueError(f"contract schema registry entry missing non-empty {key}")
    return candidate


def _require_path(path: Path) -> None:
    if not path.exists():
        raise ValueError(f"registered contract schema path does not exist: {_relative(path)}")


def _load_json(path: Path) -> Any:
    _require_path(path)
    return json.loads(path.read_text(encoding="utf-8"))


def _load_yaml(path: Path) -> Any:
    _require_path(path)
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _repo_path(value: str | Path) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path


def _relative(path: Path) -> Path:
    try:
        return path.relative_to(REPO_ROOT)
    except ValueError:
        return path


def _error_sort_key(error: ValidationError) -> tuple[str, str]:
    return (".".join(str(item) for item in error.path), error.message)


if __name__ == "__main__":
    main()
