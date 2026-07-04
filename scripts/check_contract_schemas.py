from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError

from scripts.materialize_observability_alerts import materialize_alert_artifact

REPO_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = REPO_ROOT / "packages/contracts/schemas/contract-schema-registry.v1.json"
REGISTRY_SCHEMA_PATH = (
    REPO_ROOT / "packages/contracts/schemas/contract-schema-registry.v1.schema.json"
)
TOOL_EXECUTION_OPENAPI_PATH = REPO_ROOT / "docs/contracts/schemas/tool-execution.openapi.yaml"
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
        _validate_json_artifact_invariants(entry.id, target, instance)

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


def _validate_json_artifact_invariants(entry_id: str, path: Path, instance: Any) -> None:
    if entry_id == "runtime-observability-alerts.v1":
        _validate_observability_alert_invariants(path, instance)
        return
    if entry_id != "runtime-latency-budgets.v1":
        return
    canonical_stage_fields = _canonical_stage_timing_fields()
    if not isinstance(instance, dict):
        raise ValueError(f"{_relative(path)} must contain an object")
    rules = instance.get("rules")
    if not isinstance(rules, list):
        raise ValueError(f"{_relative(path)} rules must be a list")
    enabled_fields: set[str] = set()
    reasons: set[str] = set()
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ValueError(f"{_relative(path)} rules[{index}] must be an object")
        field = rule.get("field")
        reason = rule.get("candidate_reason")
        warn_ms = rule.get("warn_ms")
        critical_ms = rule.get("critical_ms")
        if not isinstance(field, str) or not isinstance(reason, str):
            raise ValueError(
                f"{_relative(path)} rules[{index}] must declare field and candidate_reason"
            )
        if field not in canonical_stage_fields:
            raise ValueError(f"{_relative(path)} rules[{index}] field is not canonical: {field}")
        if not isinstance(warn_ms, int) or not isinstance(critical_ms, int):
            raise ValueError(f"{_relative(path)} rules[{index}] thresholds must be integers")
        if critical_ms <= warn_ms:
            raise ValueError(
                f"{_relative(path)} rules[{index}] critical_ms must be greater than warn_ms"
            )
        if reason in reasons:
            raise ValueError(f"{_relative(path)} duplicate candidate_reason: {reason}")
        reasons.add(reason)
        if rule.get("enabled") is True:
            if field in enabled_fields:
                raise ValueError(
                    f"{_relative(path)} duplicate enabled latency budget field: {field}"
                )
            enabled_fields.add(field)
    missing_fields = canonical_stage_fields - enabled_fields
    extra_fields = enabled_fields - canonical_stage_fields
    if missing_fields or extra_fields:
        raise ValueError(
            f"{_relative(path)} enabled latency budget fields must exactly cover "
            f"canonical stage_timing fields; missing={sorted(missing_fields)} "
            f"extra={sorted(extra_fields)}"
        )


def _validate_observability_alert_invariants(path: Path, instance: Any) -> None:
    canonical_stage_fields = _canonical_stage_timing_fields()
    if not isinstance(instance, dict):
        raise ValueError(f"{_relative(path)} must contain an object")
    rules = instance.get("rules")
    if not isinstance(rules, list):
        raise ValueError(f"{_relative(path)} rules must be a list")
    rule_ids: set[str] = set()
    enabled_keys: set[tuple[str, str | None, str]] = set()
    expected_units = {
        "stage_latency_p95": "ms",
        "request_error_rate": "ratio",
        "projection_outbox_stale": "count",
        "telemetry_export_failure": "count",
        "missing_trace_rate": "ratio",
    }
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ValueError(f"{_relative(path)} rules[{index}] must be an object")
        rule_id = rule.get("id")
        signal = rule.get("signal")
        window = rule.get("window")
        stage_field = rule.get("stage_field")
        threshold = rule.get("threshold")
        if not isinstance(rule_id, str) or not rule_id:
            raise ValueError(f"{_relative(path)} rules[{index}] must declare id")
        if rule_id in rule_ids:
            raise ValueError(f"{_relative(path)} duplicate alert rule id: {rule_id}")
        rule_ids.add(rule_id)
        if not isinstance(signal, str) or signal not in expected_units:
            raise ValueError(f"{_relative(path)} rules[{index}] has unsupported signal")
        if not isinstance(window, str):
            raise ValueError(f"{_relative(path)} rules[{index}] must declare window")
        if not isinstance(threshold, dict):
            raise ValueError(f"{_relative(path)} rules[{index}] must declare threshold")
        if signal == "stage_latency_p95":
            if not isinstance(stage_field, str) or stage_field not in canonical_stage_fields:
                raise ValueError(f"{_relative(path)} rules[{index}] stage_field must be canonical")
        elif stage_field is not None:
            raise ValueError(
                f"{_relative(path)} rules[{index}] stage_field is only valid for stage_latency_p95"
            )
        if threshold.get("unit") != expected_units[signal]:
            raise ValueError(
                f"{_relative(path)} rules[{index}] threshold unit must be "
                f"{expected_units[signal]} for {signal}"
            )
        if rule.get("enabled") is True:
            key = (signal, stage_field if isinstance(stage_field, str) else None, window)
            if key in enabled_keys:
                raise ValueError(f"{_relative(path)} duplicate enabled alert signal/window: {key}")
            enabled_keys.add(key)
    try:
        materialized = materialize_alert_artifact(instance)
    except ValueError as exc:
        raise ValueError(f"{_relative(path)} cannot materialize alert monitors: {exc}") from exc
    monitors = materialized.get("monitors")
    if not isinstance(monitors, list) or len(monitors) != len(enabled_keys):
        raise ValueError(f"{_relative(path)} must materialize one monitor per enabled alert rule")


def _canonical_stage_timing_fields() -> set[str]:
    doc = _load_yaml(TOOL_EXECUTION_OPENAPI_PATH)
    if not isinstance(doc, dict):
        raise ValueError(f"{_relative(TOOL_EXECUTION_OPENAPI_PATH)} must contain an object")
    components = doc.get("components")
    if not isinstance(components, dict):
        raise ValueError(f"{_relative(TOOL_EXECUTION_OPENAPI_PATH)} must declare components")
    schemas = components.get("schemas")
    if not isinstance(schemas, dict):
        raise ValueError(f"{_relative(TOOL_EXECUTION_OPENAPI_PATH)} must declare schemas")
    stage_timing = schemas.get("StageTiming")
    if not isinstance(stage_timing, dict):
        raise ValueError(f"{_relative(TOOL_EXECUTION_OPENAPI_PATH)} must declare StageTiming")
    properties = stage_timing.get("properties")
    if not isinstance(properties, dict) or not properties:
        raise ValueError(
            f"{_relative(TOOL_EXECUTION_OPENAPI_PATH)} StageTiming must declare properties"
        )
    return {key for key in properties if isinstance(key, str)}


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
