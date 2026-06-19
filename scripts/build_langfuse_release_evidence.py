from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping
from pathlib import Path

from scripts.check_langfuse_release_evidence import (
    SCHEMA_VERSION,
    validate_langfuse_release_evidence,
)


def build_langfuse_release_evidence_payload(
    *,
    environment: str,
    release: str,
    product_trace_id: str,
    request_id: str,
    run_id: str,
    workflow_id: str,
    session_id: str,
    user_id: str,
    required_tags: tuple[str, ...],
    verify_exit_code: int,
    verify_output: Mapping[str, object],
    verify_command: str,
    publish_exit_code: int,
    expected_publish_denominator: int,
    publish_output: Mapping[str, object],
    publish_command: str,
) -> dict[str, object]:
    return {
        "schema_version": SCHEMA_VERSION,
        "environment": environment,
        "release": release,
        "product_trace_id": product_trace_id,
        "langfuse_trace_id": str(verify_output.get("trace_id") or "").strip(),
        "request_id": request_id,
        "run_id": run_id,
        "workflow_id": workflow_id,
        "session_id": session_id,
        "user_id": user_id,
        "required_tags": list(required_tags),
        "verify_langfuse_trace": {
            "command": verify_command,
            "exit_code": verify_exit_code,
            "output": dict(verify_output),
        },
        "publish_langfuse_score_report": {
            "command": publish_command,
            "exit_code": publish_exit_code,
            "profile_id": "online-answer-path",
            "score_report_path": str(publish_output.get("score_report_path") or "").strip(),
            "expected_publish_denominator": expected_publish_denominator,
            "output": dict(publish_output),
        },
    }


def write_langfuse_release_evidence_file(path: Path, payload: Mapping[str, object]) -> None:
    result = validate_langfuse_release_evidence(payload)
    if not result.passed:
        raise ValueError("invalid Langfuse release evidence: " + "; ".join(result.errors))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build a validated langfuse_release_evidence.v1 JSON artifact."
    )
    parser.add_argument("--output", required=True)
    parser.add_argument("--environment", required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--product-trace-id", required=True)
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--workflow-id", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--tag", action="append", default=[])
    parser.add_argument("--verify-output", required=True)
    parser.add_argument("--verify-exit-code", type=int, required=True)
    parser.add_argument("--verify-command", required=True)
    parser.add_argument("--publish-output", required=True)
    parser.add_argument("--publish-exit-code", type=int, required=True)
    parser.add_argument("--expected-publish-denominator", type=int, required=True)
    parser.add_argument("--publish-command", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        verify_output = _load_json_object(Path(args.verify_output), "verify output")
        publish_output = _load_json_object(Path(args.publish_output), "publish output")
        payload = build_langfuse_release_evidence_payload(
            environment=args.environment,
            release=args.release,
            product_trace_id=args.product_trace_id,
            request_id=args.request_id,
            run_id=args.run_id,
            workflow_id=args.workflow_id,
            session_id=args.session_id,
            user_id=args.user_id,
            required_tags=tuple(args.tag or ()),
            verify_exit_code=args.verify_exit_code,
            verify_output=verify_output,
            verify_command=args.verify_command,
            publish_exit_code=args.publish_exit_code,
            expected_publish_denominator=args.expected_publish_denominator,
            publish_output=publish_output,
            publish_command=args.publish_command,
        )
        write_langfuse_release_evidence_file(Path(args.output), payload)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps({"artifact": args.output, "passed": True}, ensure_ascii=False))
    return 0


def _load_json_object(path: Path, label: str) -> Mapping[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"failed to read {label}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload


if __name__ == "__main__":
    raise SystemExit(main())
