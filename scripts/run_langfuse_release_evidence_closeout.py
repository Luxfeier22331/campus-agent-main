from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from campus_evals.langfuse_score_report import (
    build_score_report_from_profile_report,
    write_langfuse_score_report,
)

from scripts.build_langfuse_release_evidence import (
    build_langfuse_release_evidence_payload,
    write_langfuse_release_evidence_file,
)


@dataclass(frozen=True, slots=True)
class CommandResult:
    exit_code: int
    stdout: str
    stderr: str


@dataclass(frozen=True, slots=True)
class LangfuseReleaseCloseoutResult:
    passed: bool
    artifact_path: Path
    errors: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ProductIdentity:
    product_trace_id: str
    request_id: str
    run_id: str
    workflow_id: str
    session_id: str
    user_id: str


CommandRunner = Callable[[tuple[str, ...]], CommandResult]


def run_langfuse_release_evidence_closeout(
    *,
    output_dir: Path,
    profile_report_path: Path,
    environment: str,
    release: str,
    product_trace_id: str | None,
    request_id: str | None,
    run_id: str | None,
    workflow_id: str | None,
    session_id: str | None,
    user_id: str | None,
    required_tags: tuple[str, ...],
    durable_chat_artifact_path: Path | None = None,
    command_runner: CommandRunner | None = None,
) -> LangfuseReleaseCloseoutResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = output_dir / "langfuse-release-evidence.json"
    runner = command_runner or _run_command
    try:
        _validate_closeout_inputs(profile_report_path=profile_report_path, release=release)
    except ValueError as exc:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=(str(exc),),
        )
    try:
        _validate_required_tags(environment=environment, required_tags=required_tags)
    except ValueError as exc:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=(str(exc),),
        )
    try:
        identity = _resolve_product_identity(
            product_trace_id=product_trace_id,
            request_id=request_id,
            run_id=run_id,
            workflow_id=workflow_id,
            session_id=session_id,
            user_id=user_id,
            durable_chat_artifact_path=durable_chat_artifact_path,
        )
    except ValueError as exc:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=(str(exc),),
        )
    try:
        _validate_profile_report_correlations(
            profile_report_path=profile_report_path,
            product_trace_id=identity.product_trace_id,
        )
    except ValueError as exc:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=(str(exc),),
        )

    verify_command = _verify_command(
        product_trace_id=identity.product_trace_id,
        session_id=identity.session_id,
        user_id=identity.user_id,
        release=release,
        request_id=identity.request_id,
        run_id=identity.run_id,
        workflow_id=identity.workflow_id,
        required_tags=required_tags,
    )
    verify_result = runner(verify_command)
    if verify_result.exit_code != 0:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=("verify-langfuse-trace failed", _trim(verify_result.stderr)),
        )
    verify_output_path = output_dir / "verify-langfuse-trace.json"
    try:
        verify_output = _load_command_json("verify-langfuse-trace", verify_result.stdout)
    except ValueError as exc:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=(str(exc),),
        )
    verify_output_path.write_text(
        json.dumps(verify_output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    try:
        score_report_path = _build_score_report_artifact(
            profile_report_path=profile_report_path,
            output_dir=output_dir,
            environment=environment,
        )
    except ValueError as exc:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=(str(exc),),
        )

    publish_command = _publish_command(score_report_path)
    publish_result = runner(publish_command)
    if publish_result.exit_code != 0:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=("publish-langfuse-score-report failed", _trim(publish_result.stderr)),
        )
    publish_output_path = output_dir / "publish-langfuse-score-report.json"
    try:
        publish_output = _load_command_json("publish-langfuse-score-report", publish_result.stdout)
    except ValueError as exc:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=(str(exc),),
        )
    try:
        expected_publish_denominator = _score_report_expected_publish_denominator(score_report_path)
        _validate_publish_output_matches_score_report(
            score_report_path=score_report_path,
            publish_output=publish_output,
        )
    except ValueError as exc:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=(str(exc),),
        )
    publish_output_path.write_text(
        json.dumps(publish_output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    try:
        payload = build_langfuse_release_evidence_payload(
            environment=environment,
            release=release,
            product_trace_id=identity.product_trace_id,
            request_id=identity.request_id,
            run_id=identity.run_id,
            workflow_id=identity.workflow_id,
            session_id=identity.session_id,
            user_id=identity.user_id,
            required_tags=required_tags,
            verify_exit_code=verify_result.exit_code,
            verify_output=verify_output,
            verify_command=" ".join(verify_command),
            publish_exit_code=publish_result.exit_code,
            expected_publish_denominator=expected_publish_denominator,
            publish_output=publish_output,
            publish_command=" ".join(publish_command),
        )
        write_langfuse_release_evidence_file(artifact_path, payload)
    except ValueError as exc:
        return LangfuseReleaseCloseoutResult(
            passed=False,
            artifact_path=artifact_path,
            errors=(str(exc),),
        )

    return LangfuseReleaseCloseoutResult(passed=True, artifact_path=artifact_path, errors=())


def _validate_closeout_inputs(*, profile_report_path: Path, release: str) -> None:
    if not _normalize(release):
        raise ValueError("release is required")
    if not profile_report_path.exists() or not profile_report_path.is_file():
        raise ValueError("profile report artifact must exist")
    payload = _load_profile_report_payload(profile_report_path)
    if _normalize(str(payload.get("profile_id") or "")) != "online-answer-path":
        raise ValueError("profile report profile_id must be online-answer-path")
    sanitized_results = payload.get("sanitized_results")
    if not isinstance(sanitized_results, list) or not sanitized_results:
        raise ValueError("profile report sanitized_results must be a non-empty list")


def _validate_profile_report_correlations(
    *,
    profile_report_path: Path,
    product_trace_id: str,
) -> None:
    payload = _load_profile_report_payload(profile_report_path)
    sanitized_results = payload.get("sanitized_results")
    if not isinstance(sanitized_results, list):
        raise ValueError("profile report sanitized_results must be a non-empty list")
    trace_ids: list[str] = []
    for raw_result in sanitized_results:
        if not isinstance(raw_result, dict):
            raise ValueError("profile report sanitized_results must all be JSON objects")
        correlation = raw_result.get("request_correlation")
        if not isinstance(correlation, dict):
            raise ValueError(
                "profile report sanitized_results must all include request_correlation"
            )
        trace_id = _normalize(str(correlation.get("trace_id") or ""))
        request_id = _normalize(str(correlation.get("request_id") or ""))
        if not trace_id or not request_id:
            raise ValueError(
                "profile report request_correlation must include trace_id and request_id"
            )
        trace_ids.append(trace_id)
    if product_trace_id not in set(trace_ids):
        raise ValueError(
            "profile report must include a sanitized_result for the closeout product_trace_id"
        )


def _build_score_report_artifact(
    *,
    profile_report_path: Path,
    output_dir: Path,
    environment: str,
) -> Path:
    score_report_path = output_dir / "langfuse-score-report.json"
    write_langfuse_score_report(
        score_report_path,
        build_score_report_from_profile_report(
            profile_report_payload=_load_profile_report_payload(profile_report_path),
            profile_report_path=profile_report_path,
            environment=environment,
        ),
    )
    return score_report_path


def _validate_publish_output_matches_score_report(
    *,
    score_report_path: Path,
    publish_output: dict[str, object],
) -> None:
    expected_count = _score_report_expected_publish_denominator(score_report_path)
    output_expected = _integer(publish_output.get("expected_publish_denominator"))
    published = _integer(publish_output.get("published"))
    failed = _integer(publish_output.get("failed"))
    omitted = _integer(publish_output.get("omitted"))
    if output_expected != expected_count:
        raise ValueError(
            "publish-langfuse-score-report expected denominator must match score report"
        )
    if published != expected_count:
        raise ValueError(
            "publish-langfuse-score-report published count must match expected denominator"
        )
    if failed != 0:
        raise ValueError("publish-langfuse-score-report failed count must be 0")
    if omitted != 0:
        raise ValueError("publish-langfuse-score-report omitted count must be 0")


def _score_report_expected_publish_denominator(score_report_path: Path) -> int:
    try:
        payload = json.loads(score_report_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"score report artifact is not valid JSON: {exc}") from exc
    except OSError as exc:
        raise ValueError(f"score report artifact cannot be read: {score_report_path}") from exc
    if not isinstance(payload, dict):
        raise ValueError("score report artifact must be a JSON object")
    expected = _integer(payload.get("expected_publish_denominator"))
    if expected is None:
        raise ValueError("score report expected_publish_denominator must be an integer")
    return expected


def _load_profile_report_payload(profile_report_path: Path) -> dict[str, object]:
    try:
        payload = json.loads(profile_report_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"profile report artifact is not valid JSON: {exc}") from exc
    except OSError as exc:
        raise ValueError(f"profile report artifact cannot be read: {profile_report_path}") from exc
    if not isinstance(payload, dict):
        raise ValueError("profile report artifact must be a JSON object")
    return payload


def _validate_required_tags(*, environment: str, required_tags: tuple[str, ...]) -> None:
    normalized_environment = _normalize(environment)
    if not normalized_environment:
        raise ValueError("environment is required")
    normalized_tags = {_normalize(tag) for tag in required_tags if _normalize(tag)}
    if not normalized_tags:
        raise ValueError("required_tags must be a non-empty list")
    if not any(tag.startswith("surface:") for tag in normalized_tags):
        raise ValueError("required_tags must include a surface tag")
    if not any(tag.startswith("capability:") for tag in normalized_tags):
        raise ValueError("required_tags must include a capability tag")
    environment_tag = "env:" + normalized_environment
    if environment_tag not in normalized_tags:
        raise ValueError(f"required_tags must include {environment_tag}")


def _resolve_product_identity(
    *,
    product_trace_id: str | None,
    request_id: str | None,
    run_id: str | None,
    workflow_id: str | None,
    session_id: str | None,
    user_id: str | None,
    durable_chat_artifact_path: Path | None,
) -> ProductIdentity:
    explicit = {
        "product_trace_id": _normalize(product_trace_id),
        "request_id": _normalize(request_id),
        "run_id": _normalize(run_id),
        "workflow_id": _normalize(workflow_id),
        "session_id": _normalize(session_id),
        "user_id": _normalize(user_id),
    }
    artifact = (
        _load_product_identity_from_chat_artifact(durable_chat_artifact_path)
        if durable_chat_artifact_path
        else {}
    )
    values: dict[str, str] = {}
    for field, explicit_value in explicit.items():
        artifact_value = artifact.get(field)
        if explicit_value and artifact_value and explicit_value != artifact_value:
            raise ValueError(f"{field} does not match durable chat artifact langfuseCloseout value")
        values[field] = explicit_value or artifact_value or ""

    missing = tuple(field for field, value in values.items() if not value)
    if missing:
        raise ValueError(
            "Missing Langfuse closeout identity fields: "
            + ", ".join(missing)
            + ". Provide explicit flags or --durable-chat-artifact."
        )
    return ProductIdentity(**values)


def _load_product_identity_from_chat_artifact(path: Path) -> dict[str, str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"durable chat artifact cannot be read: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"durable chat artifact is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("durable chat artifact must be a JSON object")
    if payload.get("passed") is not True:
        raise ValueError("durable chat artifact passed must be true")
    closeout = payload.get("langfuseCloseout")
    if not isinstance(closeout, dict):
        raise ValueError("durable chat artifact must include langfuseCloseout object")
    return {
        "product_trace_id": _required_artifact_string(closeout, "productTraceId"),
        "request_id": _required_artifact_string(closeout, "requestId"),
        "run_id": _required_artifact_string(closeout, "runId"),
        "workflow_id": _required_artifact_string(closeout, "workflowId"),
        "session_id": _required_artifact_string(closeout, "sessionId"),
        "user_id": _required_artifact_string(closeout, "userId"),
    }


def _required_artifact_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"durable chat artifact langfuseCloseout.{key} must be a string")
    return value.strip()


def _verify_command(
    *,
    product_trace_id: str,
    session_id: str,
    user_id: str,
    release: str,
    request_id: str,
    run_id: str,
    workflow_id: str,
    required_tags: tuple[str, ...],
) -> tuple[str, ...]:
    command = [
        "uv",
        "run",
        "--all-packages",
        "python",
        "-m",
        "scripts.eval_gate",
        "verify-langfuse-trace",
        "--product-trace-id",
        product_trace_id,
        "--session-id",
        session_id,
        "--user-id",
        user_id,
        "--release",
        release,
        "--request-id",
        request_id,
        "--run-id",
        run_id,
        "--workflow-id",
        workflow_id,
    ]
    for tag in required_tags:
        command.extend(("--tag", tag))
    command.append("--json")
    return tuple(command)


def _publish_command(score_report_path: Path) -> tuple[str, ...]:
    return (
        "uv",
        "run",
        "--all-packages",
        "python",
        "-m",
        "scripts.eval_gate",
        "publish-langfuse-score-report",
        "--score-report",
        str(score_report_path),
        "--json",
    )


def _load_command_json(label: str, raw_output: str) -> dict[str, object]:
    try:
        payload = json.loads(raw_output)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} output is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{label} output must be a JSON object")
    return payload


def _run_command(command: tuple[str, ...]) -> CommandResult:
    completed = subprocess.run(command, text=True, capture_output=True, check=False)
    return CommandResult(completed.returncode, completed.stdout, completed.stderr)


def _trim(value: str) -> str:
    return value.strip()


def _normalize(value: str | None) -> str:
    if value is None:
        return ""
    return value.strip()


def _integer(value: object) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run Langfuse trace verification, score publish and release evidence closeout."
    )
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--profile-report", required=True)
    parser.add_argument("--environment", required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--product-trace-id")
    parser.add_argument("--request-id")
    parser.add_argument("--run-id")
    parser.add_argument("--workflow-id")
    parser.add_argument("--session-id")
    parser.add_argument("--user-id")
    parser.add_argument("--durable-chat-artifact")
    parser.add_argument("--tag", action="append", default=[])
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = run_langfuse_release_evidence_closeout(
        output_dir=Path(args.output_dir),
        profile_report_path=Path(args.profile_report),
        environment=args.environment,
        release=args.release,
        product_trace_id=args.product_trace_id,
        request_id=args.request_id,
        run_id=args.run_id,
        workflow_id=args.workflow_id,
        session_id=args.session_id,
        user_id=args.user_id,
        durable_chat_artifact_path=Path(args.durable_chat_artifact)
        if args.durable_chat_artifact
        else None,
        required_tags=tuple(args.tag or ()),
    )
    if result.passed:
        print(
            json.dumps({"artifact": str(result.artifact_path), "passed": True}, ensure_ascii=False)
        )
        return 0
    for error in result.errors:
        if error:
            print(error, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
