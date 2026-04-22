from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from .workstream_harness_result import (
    RESULT_SCHEMA_VERSION,
    extract_result_payload,
    has_tracked_changes,
    validate_result_payload,
)
from .workstream_harness_runtime import append_run_event, update_run_record
from .workstream_runtime import resolve_current_workstream
from .workstream_runtime_shared import resolve_repo_root

_DANGEROUS_COMMAND_PATTERNS = (
    re.compile(r"(^|\s)git\s+reset\s+--hard(\s|$)"),
    re.compile(r"(^|\s)git\s+checkout\s+--(\s|$)"),
    re.compile(r"(^|\s)git\s+clean\s+-fdx?(\s|$)"),
    re.compile(r"(^|\s)git\s+push\s+--force(?:-with-lease)?(\s|$)"),
    re.compile(r"(^|\s)rm\s+-rf\s+/(?:\s|$)"),
    re.compile(r"(^|\s)rm\s+-rf\s+\.(?:\s|$)"),
)
_HIGH_RISK_APPROVAL_PATTERNS = (
    re.compile(r"(^|\s)wrangler\s+(deploy|secret|kv:|d1:|r2:)"),
    re.compile(r"(^|\s)terraform\s+apply(\s|$)"),
    re.compile(r"(^|\s)(gcloud|aws|az)\s+"),
    re.compile(r"(^|\s)(systemctl|service)\s+(restart|stop|start)\s+"),
)


def _load_event_payload(stdin_text: str) -> dict[str, object]:
    return json.loads(stdin_text)


def _resolve_repo(payload: dict[str, object]) -> Path | None:
    cwd = payload.get("cwd")
    if not isinstance(cwd, str) or not cwd:
        cwd = os.getcwd()
    try:
        return resolve_repo_root(cwd)
    except FileNotFoundError:
        return None


def _current_workstream(repo_root: Path | None, payload: dict[str, object]) -> str | None:
    direct = os.environ.get("GSD_WORKSTREAM")
    if direct:
        return direct
    if repo_root is None:
        return None
    try:
        return resolve_current_workstream(repo_root, environ=dict(os.environ))
    except Exception:
        return None


def _hook_output(
    *,
    hook_event_name: str,
    additional_context: str | None = None,
    continue_running: bool | None = None,
    stop_reason: str | None = None,
    system_message: str | None = None,
    permission_decision: str | None = None,
    permission_decision_reason: str | None = None,
    permission_request_behavior: str | None = None,
    permission_request_message: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {}
    if continue_running is not None:
        payload["continue"] = continue_running
    if stop_reason:
        payload["stopReason"] = stop_reason
    if system_message:
        payload["systemMessage"] = system_message

    hook_specific: dict[str, object] = {"hookEventName": hook_event_name}
    if additional_context:
        hook_specific["additionalContext"] = additional_context
    if permission_decision:
        hook_specific["permissionDecision"] = permission_decision
        hook_specific["permissionDecisionReason"] = permission_decision_reason or ""
    if permission_request_behavior:
        hook_specific["decision"] = {
            "behavior": permission_request_behavior,
        }
        if permission_request_message:
            hook_specific["decision"]["message"] = permission_request_message
    payload["hookSpecificOutput"] = hook_specific
    return payload


def _command_matches(command: str, patterns: tuple[re.Pattern[str], ...]) -> bool:
    return any(pattern.search(command) for pattern in patterns)


def _append_event_from_env(event_type: str, details: dict[str, object] | None = None) -> None:
    run_id = os.environ.get("CAMPUS_WORKSTREAM_RUN_ID")
    repo_root = os.environ.get("CAMPUS_WORKSTREAM_REPO_ROOT")
    if not run_id or not repo_root:
        return
    try:
        append_run_event(repo_root, run_id=run_id, event_type=event_type, details=details)
    except Exception:
        return


def _persist_result_from_env(
    payload: dict[str, object],
    *,
    state: str,
    exit_code: int | None,
) -> None:
    run_id = os.environ.get("CAMPUS_WORKSTREAM_RUN_ID")
    repo_root = os.environ.get("CAMPUS_WORKSTREAM_REPO_ROOT")
    if not run_id or not repo_root:
        return
    try:
        update_run_record(
            repo_root,
            run_id=run_id,
            updates={
                "state": state,
                "result": payload.get("result"),
                "summary": payload.get("summary"),
                "verification": payload.get("verification"),
                "blocker": payload.get("blocker"),
                "result_payload": payload,
                "exit_code": exit_code,
            },
        )
        append_run_event(
            repo_root,
            run_id=run_id,
            event_type="result_persisted",
            details={"result": payload.get("result")},
        )
    except Exception:
        return


def handle_session_start(payload: dict[str, object]) -> dict[str, object] | None:
    repo_root = _resolve_repo(payload)
    workstream = _current_workstream(repo_root, payload)
    if repo_root is None or workstream is None:
        return None

    _append_event_from_env(
        "session_started",
        {
            "source": payload.get("source"),
            "session_id": payload.get("session_id"),
        },
    )

    context = (
        f"Active workstream: {workstream}. "
        "Use the repo-wide workstream harness contract before stopping: "
        f"emit a final JSON result block with schema_version={RESULT_SCHEMA_VERSION}, "
        "continue until target state or a real blocker, do not stop at a partial milestone, "
        "and when blocked give blocker.kind/message plus the exact next action. "
        "If you modify tracked files, finish with verification.status=passed or explain why "
        "verification is not applicable. See docs/reference/workstream-agent-harness-contract.md "
        "and docs/runbooks/workstream-harness-workflow.md."
    )
    return _hook_output(
        hook_event_name="SessionStart",
        additional_context=context,
    )


def handle_pre_tool_use(payload: dict[str, object]) -> dict[str, object] | None:
    command = str((payload.get("tool_input") or {}).get("command") or "")
    if not command or not _command_matches(command, _DANGEROUS_COMMAND_PATTERNS):
        return None
    _append_event_from_env(
        "dangerous_command_denied",
        {"command": command},
    )
    return _hook_output(
        hook_event_name="PreToolUse",
        permission_decision="deny",
        permission_decision_reason="Repo harness blocked a destructive Bash command.",
        system_message=(
            "This Bash command is blocked by the repo harness because it is destructive. "
            "Do not try to work around the guardrail. Either choose a non-destructive path "
            "or end the run with result=blocked and blocker.kind=risk_gate."
        ),
    )


def handle_permission_request(payload: dict[str, object]) -> dict[str, object] | None:
    command = str((payload.get("tool_input") or {}).get("command") or "")
    mode = os.environ.get("CAMPUS_WORKSTREAM_HARNESS_MODE")
    if mode == "exec":
        _append_event_from_env(
            "permission_request_denied",
            {"command": command, "reason": "exec_mode"},
        )
        return _hook_output(
            hook_event_name="PermissionRequest",
            permission_request_behavior="deny",
            permission_request_message=(
                "Non-interactive harness runs cannot wait on an approval prompt. "
                "End with result=blocked and blocker.kind=risk_gate or choose a lower-risk path."
            ),
            system_message=(
                "The harness denied this approval request because exec mode must finish "
                "autonomously. Convert this into a real blocker or avoid the escalation."
            ),
        )
    if command and _command_matches(command, _HIGH_RISK_APPROVAL_PATTERNS):
        _append_event_from_env(
            "permission_request_denied",
            {"command": command, "reason": "high_risk"},
        )
        return _hook_output(
            hook_event_name="PermissionRequest",
            permission_request_behavior="deny",
            permission_request_message=(
                "Blocked by repo harness: this command is high-risk. "
                "If it is still required, stop with result=blocked and blocker.kind=risk_gate."
            ),
            system_message=(
                "The repo harness converted this approval request into a risk gate. "
                "Do not wait silently for approval; either choose a safer path or emit a blocked result."
            ),
        )
    return None


def handle_stop(payload: dict[str, object]) -> dict[str, object] | None:
    repo_root = _resolve_repo(payload)
    message = payload.get("last_assistant_message")
    stop_hook_active = bool(payload.get("stop_hook_active"))
    extracted = extract_result_payload(message if isinstance(message, str) else None)

    if extracted is None:
        if stop_hook_active:
            _persist_result_from_env(
                {
                    "schema_version": RESULT_SCHEMA_VERSION,
                    "result": "failed_needs_repair",
                    "summary": "The run stopped without a valid workstream harness result block.",
                    "verification": {
                        "status": "not_applicable",
                        "commands": [],
                        "notes": "Stop hook exhausted its single continuation budget.",
                    },
                    "blocker": None,
                    "next_action": "Resume the run and emit a valid harness result payload before stopping.",
                },
                state="failed_needs_repair",
                exit_code=21,
            )
            return {
                "continue": False,
                "stopReason": "workstream harness result missing after continuation",
                "systemMessage": (
                    "The repo harness stopped this run because the final assistant message still "
                    "did not contain a valid workstream result JSON block."
                ),
            }
        return {
            "decision": "block",
            "reason": (
                "Before stopping, emit a final JSON object with "
                f"schema_version={RESULT_SCHEMA_VERSION}, result, summary, verification, blocker, "
                "and next_action."
            ),
        }

    tracked_changes = has_tracked_changes(repo_root) if repo_root is not None else False
    errors = validate_result_payload(extracted, tracked_changes=tracked_changes)
    if errors:
        reason = "；".join(errors)
        if stop_hook_active:
            _persist_result_from_env(
                {
                    "schema_version": RESULT_SCHEMA_VERSION,
                    "result": "failed_needs_repair",
                    "summary": "The run stopped with an invalid workstream harness result payload.",
                    "verification": {
                        "status": "failed",
                        "commands": [],
                        "notes": reason,
                    },
                    "blocker": None,
                    "next_action": "Resume the run, fix the payload, and stop again with a valid result.",
                },
                state="failed_needs_repair",
                exit_code=21,
            )
            return {
                "continue": False,
                "stopReason": "workstream harness result remained invalid after continuation",
                "systemMessage": f"Invalid workstream result payload: {reason}",
            }
        return {
            "decision": "block",
            "reason": f"Fix the final workstream result payload before stopping: {reason}",
        }

    exit_code = 0
    if extracted.get("result") == "blocked":
        exit_code = 20
    elif extracted.get("result") == "failed_needs_repair":
        exit_code = 21
    _persist_result_from_env(extracted, state=str(extracted["result"]), exit_code=exit_code)
    return None


def handle_event(event_name: str, payload: dict[str, object]) -> dict[str, object] | None:
    if event_name == "SessionStart":
        return handle_session_start(payload)
    if event_name == "PreToolUse":
        return handle_pre_tool_use(payload)
    if event_name == "PermissionRequest":
        return handle_permission_request(payload)
    if event_name == "Stop":
        return handle_stop(payload)
    return None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repo-local Codex workstream harness hooks")
    parser.add_argument(
        "event",
        choices=("session-start", "pre-tool-use", "permission-request", "stop"),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    payload = _load_event_payload(sys.stdin.read())
    event_map = {
        "session-start": "SessionStart",
        "pre-tool-use": "PreToolUse",
        "permission-request": "PermissionRequest",
        "stop": "Stop",
    }
    result = handle_event(event_map[args.event], payload)
    if result is not None:
        json.dump(result, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
