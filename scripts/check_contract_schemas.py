from __future__ import annotations

import argparse
import hashlib
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
            instance = _validate_with_validator(validator, fixture_path, should_pass=True)
            _validate_json_artifact_invariants(entry.id, fixture_path, instance)
        for fixture_path in invalid_fixtures:
            _validate_invalid_fixture(validator, entry.id, fixture_path)


def _validate_json_artifact_invariants(entry_id: str, path: Path, instance: Any) -> None:
    if entry_id == "raw-capture-policy.v1":
        _validate_raw_capture_policy_invariants(path, instance)
        return
    if entry_id == "llm-replay-packet.v1":
        _validate_llm_replay_packet_invariants(path, instance)
        return
    if entry_id == "llm-replay-packet-index.v1":
        _validate_llm_replay_packet_index_invariants(path, instance)
        return
    if entry_id == "llm-io-fingerprint.v1":
        if not isinstance(instance, dict):
            raise ValueError(f"{_relative(path)} must contain an object")
        _validate_llm_io_fingerprint_invariants(path, instance)
        return
    if entry_id == "answer-eval-fingerprint.v1":
        if not isinstance(instance, dict):
            raise ValueError(f"{_relative(path)} must contain an object")
        _reject_safe_projection_raw_keys(path, instance, "answer_eval_fingerprint")
        return
    if entry_id == "truncation-summary.v1":
        if not isinstance(instance, dict):
            raise ValueError(f"{_relative(path)} must contain an object")
        _reject_safe_projection_raw_keys(path, instance, "truncation_summary")
        return
    if entry_id == "sink-identity-projection.v1":
        if not isinstance(instance, dict):
            raise ValueError(f"{_relative(path)} must contain an object")
        _reject_sink_identity_direct_identifiers(path, instance, "sink_identity_projection")
        return
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


def validate_json_artifact_invariants_for_tests(entry_id: str, path: Path, instance: Any) -> None:
    _validate_json_artifact_invariants(entry_id, _repo_path(path), instance)


RAW_CAPTURE_FIELDS = {
    "rendered_messages",
    "provider_request_body",
    "provider_response_body",
    "provider_stream_deltas",
    "tool_calls",
    "tool_results",
    "selected_evidence_packet",
    "selected_memory_context",
    "output_schema",
}

FORBIDDEN_RAW_KEY_FRAGMENTS = {
    "authorization",
    "auth_header",
    "api_key",
    "apikey",
    "cookie",
    "database_url",
    "db_url",
    "jwt",
    "object_store_secret",
    "password",
    "provider_key",
    "secret",
    "token",
}


def _validate_raw_capture_policy_invariants(path: Path, instance: Any) -> None:
    if not isinstance(instance, dict):
        raise ValueError(f"{_relative(path)} must contain an object")
    mode = instance.get("mode")
    ttl_days = instance.get("ttl_days")
    allowed_sinks = instance.get("allowed_sinks")
    allowed_raw_fields = instance.get("allowed_raw_fields")
    if mode == "off":
        if ttl_days != 0 or allowed_sinks != [] or allowed_raw_fields != []:
            raise ValueError(f"{_relative(path)} off raw capture policy must not admit capture")
        return
    if not isinstance(ttl_days, int) or ttl_days <= 0:
        raise ValueError(f"{_relative(path)} non-off raw capture policy requires ttl_days > 0")
    if not isinstance(allowed_sinks, list) or not allowed_sinks:
        raise ValueError(f"{_relative(path)} non-off raw capture policy requires allowed_sinks")
    if not isinstance(allowed_raw_fields, list) or not allowed_raw_fields:
        raise ValueError(
            f"{_relative(path)} non-off raw capture policy requires allowed_raw_fields"
        )
    for raw_field in allowed_raw_fields:
        if raw_field not in RAW_CAPTURE_FIELDS:
            raise ValueError(f"{_relative(path)} forbidden raw capture field: {raw_field}")
    if instance.get("audit_required") is not True:
        raise ValueError(f"{_relative(path)} non-off raw capture policy requires audit")
    if instance.get("dsar_delete_linkage_required") is not True:
        raise ValueError(f"{_relative(path)} non-off raw capture policy requires deletion linkage")
    for field in ("request_id", "run_id", "trace_id"):
        if not isinstance(instance.get(field), str) or not instance[field].strip():
            raise ValueError(f"{_relative(path)} non-off raw capture policy requires {field}")


def _validate_llm_replay_packet_invariants(path: Path, instance: Any) -> None:
    if not isinstance(instance, dict):
        raise ValueError(f"{_relative(path)} must contain an object")
    policy = instance.get("capture_policy")
    if not isinstance(policy, dict):
        raise ValueError(f"{_relative(path)} capture_policy must be an object")
    _validate_raw_capture_policy_invariants(path, policy)
    allowed_fields = policy.get("allowed_raw_fields")
    if not isinstance(allowed_fields, list):
        raise ValueError(f"{_relative(path)} capture_policy.allowed_raw_fields must be a list")
    allowed = set(allowed_fields)
    for raw_section in RAW_CAPTURE_FIELDS:
        if raw_section in instance and raw_section not in allowed:
            raise ValueError(
                f"{_relative(path)} raw section is not admitted by policy: {raw_section}"
            )
        if raw_section in instance:
            _reject_forbidden_raw_keys(path, instance[raw_section], raw_section)
    for field in ("run_id", "request_id", "trace_id"):
        fingerprint = instance.get("llm_io_fingerprint")
        if isinstance(fingerprint, dict) and instance.get(field) != fingerprint.get(field):
            raise ValueError(f"{_relative(path)} packet {field} must match llm_io_fingerprint")
        if policy.get("mode") != "off" and instance.get(field) != policy.get(field):
            raise ValueError(f"{_relative(path)} packet {field} must match capture_policy")
    fingerprint = instance.get("llm_io_fingerprint")
    if isinstance(fingerprint, dict):
        _validate_llm_io_fingerprint_invariants(path, fingerprint)
    deletion_linkage = instance.get("deletion_linkage")
    if isinstance(deletion_linkage, dict):
        for field in ("request_id", "trace_id"):
            if instance.get(field) != deletion_linkage.get(field):
                raise ValueError(f"{_relative(path)} packet {field} must match deletion_linkage")


def _validate_llm_replay_packet_index_invariants(path: Path, instance: Any) -> None:
    if not isinstance(instance, dict):
        raise ValueError(f"{_relative(path)} must contain an object")
    policy = instance.get("capture_policy")
    if not isinstance(policy, dict):
        raise ValueError(f"{_relative(path)} capture_policy must be an object")
    _validate_raw_capture_policy_invariants(path, policy)
    fingerprint = instance.get("llm_io_fingerprint")
    if not isinstance(fingerprint, dict):
        raise ValueError(f"{_relative(path)} llm_io_fingerprint must be an object")
    for field in ("run_id", "request_id", "trace_id"):
        if instance.get(field) != fingerprint.get(field):
            raise ValueError(f"{_relative(path)} index {field} must match llm_io_fingerprint")
        if policy.get("mode") != "off" and instance.get(field) != policy.get(field):
            raise ValueError(f"{_relative(path)} index {field} must match capture_policy")
    _validate_llm_io_fingerprint_invariants(path, fingerprint)
    answer_eval = instance.get("answer_eval_fingerprint")
    if isinstance(answer_eval, dict):
        _validate_answer_eval_fingerprint_invariants(path, answer_eval, fingerprint)
        evidence_replay_index = instance.get("evidence_replay_index")
        if isinstance(evidence_replay_index, dict):
            expected = _sha256_json_ref(evidence_replay_index)
            if answer_eval.get("evidence_replay_index_sha256") != expected:
                raise ValueError(
                    f"{_relative(path)} answer_eval_fingerprint.evidence_replay_index_sha256 "
                    "must match evidence_replay_index"
                )
    deletion_linkage = instance.get("deletion_linkage")
    if not isinstance(deletion_linkage, dict):
        raise ValueError(f"{_relative(path)} deletion_linkage must be an object")
    for field in ("request_id", "trace_id"):
        if instance.get(field) != deletion_linkage.get(field):
            raise ValueError(f"{_relative(path)} index {field} must match deletion_linkage")
    _reject_raw_replay_index_keys(path, instance)


def _validate_llm_io_fingerprint_invariants(path: Path, fingerprint: dict[str, Any]) -> None:
    tool_runtime = fingerprint.get("tool_runtime_fingerprint")
    if not isinstance(tool_runtime, dict):
        raise ValueError(
            f"{_relative(path)} llm_io_fingerprint.tool_runtime_fingerprint must be an object"
        )
    checks = (
        ("tool_catalog_sha256", "tools_sha256"),
        ("tool_schema_sha256", "function_schema_sha256"),
        ("workflow_artifact_sha256", "workflow_artifact_sha256"),
    )
    for flat_field, nested_field in checks:
        if fingerprint.get(flat_field) != tool_runtime.get(nested_field):
            raise ValueError(
                f"{_relative(path)} llm_io_fingerprint.{flat_field} must match "
                f"tool_runtime_fingerprint.{nested_field}"
            )


def _validate_answer_eval_fingerprint_invariants(
    path: Path, answer_eval: dict[str, Any], fingerprint: dict[str, Any]
) -> None:
    _reject_safe_projection_raw_keys(path, answer_eval, "answer_eval_fingerprint")
    checks = (
        ("run_id", "run_id"),
        ("request_id", "request_id"),
        ("trace_id", "trace_id"),
        ("runtime_release", "runtime_release"),
        ("llm_call_site", "llm_call_site"),
        ("provider_profile_revision", "provider_profile_revision"),
        ("output_schema_id", "output_schema_id"),
    )
    for answer_field, fingerprint_field in checks:
        if answer_eval.get(answer_field) != fingerprint.get(fingerprint_field):
            raise ValueError(
                f"{_relative(path)} answer_eval_fingerprint.{answer_field} must match "
                f"llm_io_fingerprint.{fingerprint_field}"
            )
    tool_runtime = fingerprint.get("tool_runtime_fingerprint")
    if not isinstance(tool_runtime, dict):
        raise ValueError(
            f"{_relative(path)} llm_io_fingerprint.tool_runtime_fingerprint must be an object"
        )
    if answer_eval.get("tool_runtime_combined_sha256") != tool_runtime.get("combined_sha256"):
        raise ValueError(
            f"{_relative(path)} answer_eval_fingerprint.tool_runtime_combined_sha256 "
            "must match llm_io_fingerprint.tool_runtime_fingerprint.combined_sha256"
        )
    branch_identity = answer_eval.get("branch_identity")
    if not isinstance(branch_identity, dict):
        raise ValueError(
            f"{_relative(path)} answer_eval_fingerprint.branch_identity must be an object"
        )
    if branch_identity.get("prompt_id") != fingerprint.get("prompt_id"):
        raise ValueError(
            f"{_relative(path)} answer_eval_fingerprint.branch_identity.prompt_id must match "
            "llm_io_fingerprint.prompt_id"
        )
    if answer_eval.get("llm_io_fingerprint_sha256") != _sha256_json_ref(fingerprint):
        raise ValueError(
            f"{_relative(path)} answer_eval_fingerprint.llm_io_fingerprint_sha256 must match "
            "llm_io_fingerprint"
        )
    expected_answer_hash = _sha256_json_ref(
        {key: value for key, value in answer_eval.items() if key != "answer_fingerprint_sha256"}
    )
    if answer_eval.get("answer_fingerprint_sha256") != expected_answer_hash:
        raise ValueError(
            f"{_relative(path)} answer_eval_fingerprint.answer_fingerprint_sha256 must match "
            "answer_eval_fingerprint body"
        )


def _sha256_json_ref(value: Any) -> str:
    body = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )
    return "sha256:" + hashlib.sha256(body).hexdigest()


def _reject_raw_replay_index_keys(path: Path, value: Any, context: str = "") -> None:
    forbidden_fragments = {
        "raw_answer",
        "raw_prompt",
        "rendered_messages",
        "provider_request_body",
        "provider_response_body",
        "provider_stream_deltas",
        "selected_evidence_packet",
        "selected_memory_context",
        "tool_calls",
        "tool_results",
    }
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = str(key).lower()
            if any(fragment in normalized for fragment in forbidden_fragments):
                label = f"{context}.{key}" if context else str(key)
                raise ValueError(f"{_relative(path)} forbidden replay index key: {label}")
            _reject_raw_replay_index_keys(path, nested, f"{context}.{key}" if context else str(key))
        return
    if isinstance(value, list):
        for index, nested in enumerate(value):
            _reject_raw_replay_index_keys(path, nested, f"{context}[{index}]")


SAFE_PROJECTION_FORBIDDEN_FRAGMENTS = {
    "authorization",
    "auth_header",
    "cookie",
    "email",
    "jwt",
    "memory_raw",
    "memory_text",
    "password",
    "provider_request_body",
    "provider_response_body",
    "provider_stream_deltas",
    "raw_answer",
    "raw_",
    "raw_memory",
    "raw_prompt",
    "raw_response",
    "raw_text",
    "raw_transcript",
    "rendered_messages",
    "secret",
    "selected_evidence_packet",
    "selected_memory_context",
    "tool_calls",
    "tool_results",
    "user_id",
}

SAFE_PROJECTION_FORBIDDEN_EXACT_KEYS = {
    "access_token",
    "auth_token",
    "id_token",
    "refresh_token",
    "session_token",
    "token",
}


def _reject_safe_projection_raw_keys(path: Path, value: Any, context: str) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = str(key).lower()
            if normalized in SAFE_PROJECTION_FORBIDDEN_EXACT_KEYS or any(
                fragment in normalized for fragment in SAFE_PROJECTION_FORBIDDEN_FRAGMENTS
            ):
                raise ValueError(
                    f"{_relative(path)} forbidden safe projection key: {context}.{key}"
                )
            _reject_safe_projection_raw_keys(path, nested, f"{context}.{key}")
        return
    if isinstance(value, list):
        for index, nested in enumerate(value):
            _reject_safe_projection_raw_keys(path, nested, f"{context}[{index}]")


def _reject_sink_identity_direct_identifiers(path: Path, value: Any, context: str) -> None:
    direct_fragments = {
        "authorization",
        "cookie",
        "email",
        "jwt",
        "principal_id",
        "session",
        "token",
        "user_id",
    }
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = str(key).lower()
            if any(fragment in normalized for fragment in direct_fragments):
                raise ValueError(
                    f"{_relative(path)} direct identity key is forbidden: {context}.{key}"
                )
            _reject_sink_identity_direct_identifiers(path, nested, f"{context}.{key}")
        return
    if isinstance(value, list):
        for index, nested in enumerate(value):
            _reject_sink_identity_direct_identifiers(path, nested, f"{context}[{index}]")


def _reject_forbidden_raw_keys(path: Path, value: Any, context: str) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = str(key).lower()
            if any(fragment in normalized for fragment in FORBIDDEN_RAW_KEY_FRAGMENTS):
                raise ValueError(f"{_relative(path)} forbidden raw replay key in {context}: {key}")
            _reject_forbidden_raw_keys(path, nested, f"{context}.{key}")
        return
    if isinstance(value, list):
        for index, nested in enumerate(value):
            _reject_forbidden_raw_keys(path, nested, f"{context}[{index}]")


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
) -> Any:
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
    return instance


def _validate_invalid_fixture(
    validator: Draft202012Validator,
    entry_id: str,
    fixture_path: Path,
) -> None:
    instance = _load_json(fixture_path)
    errors = sorted(validator.iter_errors(instance), key=_error_sort_key)
    if errors:
        return
    try:
        _validate_json_artifact_invariants(entry_id, fixture_path, instance)
    except ValueError:
        return
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
