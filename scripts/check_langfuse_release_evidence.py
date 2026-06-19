from __future__ import annotations

import argparse
import json
import shlex
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from campus_evals.langfuse_adapter import derive_langfuse_trace_id

SCHEMA_VERSION = "langfuse_release_evidence.v1"
REQUIRED_TOP_LEVEL_STRINGS = (
    "schema_version",
    "environment",
    "release",
    "product_trace_id",
    "langfuse_trace_id",
    "request_id",
    "run_id",
    "workflow_id",
    "session_id",
    "user_id",
)


@dataclass(frozen=True, slots=True)
class LangfuseReleaseEvidenceCheck:
    passed: bool
    errors: tuple[str, ...]


def validate_langfuse_release_evidence_file(path: Path) -> LangfuseReleaseEvidenceCheck:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        return LangfuseReleaseEvidenceCheck(False, (f"failed to read artifact: {exc}",))
    except json.JSONDecodeError as exc:
        return LangfuseReleaseEvidenceCheck(False, (f"artifact is not valid JSON: {exc}",))
    if not isinstance(payload, dict):
        return LangfuseReleaseEvidenceCheck(False, ("artifact root must be a JSON object",))
    return validate_langfuse_release_evidence(payload)


def validate_langfuse_release_evidence(
    payload: Mapping[str, object],
) -> LangfuseReleaseEvidenceCheck:
    errors: list[str] = []
    for key in REQUIRED_TOP_LEVEL_STRINGS:
        if not _string(payload.get(key)):
            errors.append(f"{key} is required")
    if (
        _string(payload.get("schema_version"))
        and _string(payload.get("schema_version")) != SCHEMA_VERSION
    ):
        errors.append(f"schema_version must be {SCHEMA_VERSION}")
    product_trace_id = _string(payload.get("product_trace_id"))
    langfuse_trace_id = _string(payload.get("langfuse_trace_id"))
    if product_trace_id and langfuse_trace_id:
        try:
            expected_langfuse_trace_id = derive_langfuse_trace_id(product_trace_id)
        except ValueError:
            expected_langfuse_trace_id = ""
        if langfuse_trace_id != expected_langfuse_trace_id:
            errors.append("langfuse_trace_id must be derived from product_trace_id")

    required_tags = _string_sequence(payload.get("required_tags"))
    if not required_tags:
        errors.append("required_tags must be a non-empty list")
    if required_tags and not any(tag.startswith("surface:") for tag in required_tags):
        errors.append("required_tags must include a surface tag")
    if required_tags and not any(tag.startswith("capability:") for tag in required_tags):
        errors.append("required_tags must include a capability tag")
    environment_tag = "env:" + _string(payload.get("environment"))
    if environment_tag != "env:" and environment_tag not in set(required_tags):
        errors.append(f"required_tags must include {environment_tag}")

    trace = _mapping(payload.get("verify_langfuse_trace"))
    if trace is None:
        errors.append("verify_langfuse_trace is required")
    else:
        _validate_trace_evidence(payload, required_tags, trace, errors)

    publish = _mapping(payload.get("publish_langfuse_score_report"))
    if publish is None:
        errors.append("publish_langfuse_score_report is required")
    else:
        _validate_publish_evidence(publish, errors)

    return LangfuseReleaseEvidenceCheck(passed=not errors, errors=tuple(errors))


def _validate_trace_evidence(
    payload: Mapping[str, object],
    required_tags: tuple[str, ...],
    trace: Mapping[str, object],
    errors: list[str],
) -> None:
    _validate_command_tokens(
        trace,
        label="verify_langfuse_trace",
        required_tokens=(
            "verify-langfuse-trace",
            "--product-trace-id",
            "--session-id",
            "--user-id",
            "--release",
            "--request-id",
            "--run-id",
            "--workflow-id",
            "--tag",
            "--json",
        ),
        required_tags=required_tags,
        errors=errors,
    )
    _validate_trace_command_identity_values(payload, trace, errors)
    exit_code = _integer(trace.get("exit_code"))
    if exit_code is None:
        errors.append("verify_langfuse_trace.exit_code must be an integer")
    elif exit_code != 0:
        errors.append("verify_langfuse_trace.exit_code must be 0")
    output = _mapping(trace.get("output"))
    if output is None:
        errors.append("verify_langfuse_trace.output is required")
        return

    _require_equal(
        output, "trace_id", payload, "langfuse_trace_id", "verify_langfuse_trace.output", errors
    )
    _require_equal(
        output, "session_id", payload, "session_id", "verify_langfuse_trace.output", errors
    )
    _require_equal(output, "user_id", payload, "user_id", "verify_langfuse_trace.output", errors)
    _require_equal(output, "release", payload, "release", "verify_langfuse_trace.output", errors)

    observation_count = _integer(output.get("observation_count"))
    if observation_count is None:
        errors.append("verify_langfuse_trace.output.observation_count must be an integer")
    elif observation_count <= 0:
        errors.append("verify_langfuse_trace.output.observation_count must be greater than zero")
    repo_owned_observation_count = _integer(output.get("repo_owned_observation_count"))
    if repo_owned_observation_count is None:
        errors.append(
            "verify_langfuse_trace.output.repo_owned_observation_count must be an integer"
        )
    elif repo_owned_observation_count <= 0:
        errors.append(
            "verify_langfuse_trace.output.repo_owned_observation_count must be greater than zero"
        )
    contract_checked_observation_count = _integer(output.get("contract_checked_observation_count"))
    if contract_checked_observation_count is None:
        errors.append(
            "verify_langfuse_trace.output.contract_checked_observation_count must be an integer"
        )
    elif contract_checked_observation_count != repo_owned_observation_count:
        errors.append(
            "verify_langfuse_trace.output.contract_checked_observation_count must match "
            "repo_owned_observation_count"
        )
    non_repo_observation_count = _integer(output.get("non_repo_observation_count"))
    if non_repo_observation_count is None:
        errors.append("verify_langfuse_trace.output.non_repo_observation_count must be an integer")
    elif non_repo_observation_count < 0:
        errors.append(
            "verify_langfuse_trace.output.non_repo_observation_count must be non-negative"
        )
    if (
        observation_count is not None
        and repo_owned_observation_count is not None
        and non_repo_observation_count is not None
        and observation_count != repo_owned_observation_count + non_repo_observation_count
    ):
        errors.append(
            "verify_langfuse_trace.output.observation_count must equal repo_owned plus non_repo"
        )
    actual_tags = set(_string_sequence(output.get("tags")))
    for tag in required_tags:
        if tag not in actual_tags:
            errors.append(f"verify_langfuse_trace.output.tags missing required tag: {tag}")

    identity = _mapping(output.get("trace_identity"))
    if identity is None:
        errors.append("verify_langfuse_trace.output.trace_identity is required")
        return
    for key in ("request_id", "run_id", "workflow_id"):
        _require_equal(
            identity,
            key,
            payload,
            key,
            "verify_langfuse_trace.output.trace_identity",
            errors,
        )
    _require_equal(
        identity,
        "trace_id",
        payload,
        "product_trace_id",
        "verify_langfuse_trace.output.trace_identity",
        errors,
    )


def _validate_publish_evidence(publish: Mapping[str, object], errors: list[str]) -> None:
    _validate_command_tokens(
        publish,
        label="publish_langfuse_score_report",
        required_tokens=("publish-langfuse-score-report", "--score-report", "--json"),
        errors=errors,
    )
    exit_code = _integer(publish.get("exit_code"))
    if exit_code is None:
        errors.append("publish_langfuse_score_report.exit_code must be an integer")
    elif exit_code != 0:
        errors.append("publish_langfuse_score_report.exit_code must be 0")
    if _string(publish.get("profile_id")) != "online-answer-path":
        errors.append("publish_langfuse_score_report.profile_id must be online-answer-path")
    if not _string(publish.get("score_report_path")):
        errors.append("publish_langfuse_score_report.score_report_path is required")
    expected_publish_denominator = _integer(publish.get("expected_publish_denominator"))
    if expected_publish_denominator is None:
        errors.append(
            "publish_langfuse_score_report.expected_publish_denominator must be an integer"
        )
    elif expected_publish_denominator <= 0:
        errors.append(
            "publish_langfuse_score_report.expected_publish_denominator must be greater than zero"
        )
    output = _mapping(publish.get("output"))
    if output is None:
        errors.append("publish_langfuse_score_report.output is required")
        return
    output_expected = _integer(output.get("expected_publish_denominator"))
    if output_expected is None:
        errors.append(
            "publish_langfuse_score_report.output.expected_publish_denominator must be an integer"
        )
    elif (
        expected_publish_denominator is not None and output_expected != expected_publish_denominator
    ):
        errors.append(
            "publish_langfuse_score_report.output.expected_publish_denominator must match "
            "expected_publish_denominator"
        )
    published = _integer(output.get("published"))
    if published is None:
        errors.append("publish_langfuse_score_report.output.published must be an integer")
    elif published <= 0:
        errors.append("publish_langfuse_score_report.output.published must be greater than zero")
    elif expected_publish_denominator is not None and published != expected_publish_denominator:
        errors.append(
            "publish_langfuse_score_report.output.published must match expected_publish_denominator"
        )
    failed = _integer(output.get("failed"))
    if failed is None:
        errors.append("publish_langfuse_score_report.output.failed must be an integer")
    elif failed != 0:
        errors.append("publish_langfuse_score_report.output.failed must be 0")
    omitted = _integer(output.get("omitted"))
    if omitted is None:
        errors.append("publish_langfuse_score_report.output.omitted must be an integer")
    elif omitted != 0:
        errors.append("publish_langfuse_score_report.output.omitted must be 0")


def _validate_command_tokens(
    evidence: Mapping[str, object],
    *,
    label: str,
    required_tokens: tuple[str, ...],
    required_tags: tuple[str, ...] = (),
    errors: list[str],
) -> None:
    command = _string(evidence.get("command"))
    if not command:
        errors.append(f"{label}.command is required")
        return
    try:
        args = tuple(shlex.split(command))
    except ValueError as exc:
        errors.append(f"{label}.command is not parseable: {exc}")
        return
    tokens = set(args)
    for token in required_tokens:
        if token not in tokens:
            errors.append(f"{label}.command must include {token}")
    tag_values = _command_flag_values(args, "--tag")
    for tag in required_tags:
        if tag not in tag_values:
            errors.append(f"{label}.command must include required --tag value {tag}")


def _validate_trace_command_identity_values(
    payload: Mapping[str, object],
    trace: Mapping[str, object],
    errors: list[str],
) -> None:
    label = "verify_langfuse_trace"
    command = _string(trace.get("command"))
    if not command:
        return
    try:
        args = tuple(shlex.split(command))
    except ValueError:
        return
    for flag, payload_key in (
        ("--product-trace-id", "product_trace_id"),
        ("--session-id", "session_id"),
        ("--user-id", "user_id"),
        ("--release", "release"),
        ("--request-id", "request_id"),
        ("--run-id", "run_id"),
        ("--workflow-id", "workflow_id"),
    ):
        actual = _command_flag_value(args, flag)
        expected = _string(payload.get(payload_key))
        if expected and actual != expected:
            errors.append(f"{label}.command {flag} must match {payload_key}")


def _command_flag_value(args: tuple[str, ...], flag: str) -> str:
    try:
        index = args.index(flag)
    except ValueError:
        return ""
    if index + 1 >= len(args):
        return ""
    return _string(args[index + 1])


def _command_flag_values(args: tuple[str, ...], flag: str) -> tuple[str, ...]:
    values: list[str] = []
    for index, arg in enumerate(args):
        if arg != flag or index + 1 >= len(args):
            continue
        normalized = _string(args[index + 1])
        if normalized:
            values.append(normalized)
    return tuple(values)


def _require_equal(
    actual_source: Mapping[str, object],
    actual_key: str,
    expected_source: Mapping[str, object],
    expected_key: str,
    actual_prefix: str,
    errors: list[str],
) -> None:
    if _string(actual_source.get(actual_key)) != _string(expected_source.get(expected_key)):
        errors.append(f"{actual_prefix}.{actual_key} must match {expected_key}")


def _mapping(value: object) -> Mapping[str, object] | None:
    return value if isinstance(value, Mapping) else None


def _string(value: object) -> str:
    return str(value or "").strip()


def _integer(value: object) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _string_sequence(value: object) -> tuple[str, ...]:
    if not isinstance(value, Sequence) or isinstance(value, str):
        return ()
    return tuple(item for item in (_string(item) for item in value) if item)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate Langfuse release evidence artifact JSON."
    )
    parser.add_argument("artifact", help="Path to langfuse_release_evidence.v1 JSON artifact.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = validate_langfuse_release_evidence_file(Path(args.artifact))
    if result.passed:
        print(json.dumps({"passed": True}, ensure_ascii=False))
        return 0
    for error in result.errors:
        print(error, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
