from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from .workstream_harness_result import (
    RESULT_SCHEMA_VERSION,
    has_tracked_changes,
    resolve_terminal_result,
    validate_result_payload,
)
from .workstream_harness_runtime import (
    append_run_event,
    result_file_path,
    update_run_record,
)
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
_RESULT_TEMPLATE = json.dumps(
    {
        "schema_version": RESULT_SCHEMA_VERSION,
        "result": "completed",
        "summary": "string",
        "verification": {
            "status": "passed",
            "commands": ["pnpm web:lint"],
            "notes": "string",
        },
        "blocker": None,
        "next_action": "string",
    },
    ensure_ascii=False,
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


def _harness_session_active() -> bool:
    run_id = os.environ.get("CAMPUS_WORKSTREAM_RUN_ID")
    repo_root = os.environ.get("CAMPUS_WORKSTREAM_REPO_ROOT")
    result_path = os.environ.get("CAMPUS_WORKSTREAM_RESULT_PATH")
    mode = os.environ.get("CAMPUS_WORKSTREAM_HARNESS_MODE")
    return bool(run_id and repo_root and result_path and mode in {"shell", "exec"})


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
    result_source: str | None,
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
                "result_source": result_source,
                "exit_code": exit_code,
            },
        )
        append_run_event(
            repo_root,
            run_id=run_id,
            event_type="result_persisted",
            details={"result": payload.get("result"), "result_source": result_source},
        )
    except Exception:
        return


def handle_session_start(payload: dict[str, object]) -> dict[str, object] | None:
    if not _harness_session_active():
        return None
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
        "write the terminal result through the runtime side channel with "
        "`uv run --all-packages python -m scripts.workstream_harness result write ...`, "
        "continue until target state or a real blocker, do not stop at a partial milestone, "
        "and when blocked give blocker.kind/message plus the exact next action. "
        f"The canonical payload shape is: {_RESULT_TEMPLATE} "
        "The final assistant message is for human-readable closeout only; "
        "the result artifact side channel is the only terminal-result transport. "
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
    if not _harness_session_active():
        return None
    repo_root = _resolve_repo(payload)
    stop_hook_active = bool(payload.get("stop_hook_active"))
    run_id = os.environ.get("CAMPUS_WORKSTREAM_RUN_ID")
    result_path: Path | None = None
    if repo_root is not None and isinstance(run_id, str) and run_id:
        result_path = Path(os.environ.get("CAMPUS_WORKSTREAM_RESULT_PATH") or result_file_path(repo_root, run_id))

    resolution = resolve_terminal_result(
        result_artifact_path=result_path,
    )
    normalized = resolution["payload"]
    source = resolution["source"]

    if resolution["normalization_notes"]:
        _append_event_from_env(
            "result_normalized",
            {
                "notes": resolution["normalization_notes"],
                "normalized_result": normalized.get("result") if isinstance(normalized, dict) else None,
                "source": source,
            },
        )

    if normalized is None:
        hard_error = resolution["hard_error"]
        summary = (
            "The run stopped with an unreadable workstream harness result artifact."
            if hard_error
            else "The run stopped without any valid workstream harness result artifact."
        )
        notes = (
            hard_error
            if isinstance(hard_error, str) and hard_error
            else "Stop hook exhausted its single continuation budget."
            if stop_hook_active
            else "No valid terminal result artifact was found."
        )
        next_action = "Resume the run and write a valid harness result artifact before stopping."
        if stop_hook_active:
            _persist_result_from_env(
                {
                    "schema_version": RESULT_SCHEMA_VERSION,
                    "result": "failed_needs_repair",
                    "summary": summary,
                    "verification": {
                        "status": "failed" if hard_error else "not_applicable",
                        "commands": [],
                        "notes": notes,
                    },
                    "blocker": None,
                    "next_action": next_action,
                },
                state="failed_needs_repair",
                exit_code=21,
                result_source=source or "synthetic_failure",
            )
            return {
                "continue": False,
                "stopReason": (
                    "workstream harness result artifact remained unreadable after continuation"
                    if hard_error
                    else "workstream harness result artifact missing after continuation"
                ),
                "systemMessage": (
                    hard_error
                    if isinstance(hard_error, str) and hard_error
                    else "The repo harness stopped this run because no valid terminal result artifact was written."
                ),
            }
        return {
            "decision": "block",
            "reason": (
                "Before stopping, write a canonical workstream result artifact with "
                "`uv run --all-packages python -m scripts.workstream_harness result write ...`."
                if not hard_error
                else f"Fix the unreadable workstream result artifact before stopping: {hard_error}"
            ),
        }

    tracked_changes = has_tracked_changes(repo_root) if repo_root is not None else False
    errors = validate_result_payload(normalized, tracked_changes=tracked_changes)
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
                    "next_action": "Resume the run, fix the result artifact, and stop again with a valid result.",
                },
                state="failed_needs_repair",
                exit_code=21,
                result_source=source or "synthetic_failure",
            )
            return {
                "continue": False,
                "stopReason": "workstream harness result remained invalid after continuation",
                "systemMessage": f"Invalid workstream result payload: {reason}",
            }
        return {
            "decision": "block",
            "reason": f"Fix the workstream result artifact before stopping: {reason}",
        }

    exit_code = 0
    if normalized.get("result") == "blocked":
        exit_code = 20
    elif normalized.get("result") == "failed_needs_repair":
        exit_code = 21
    _persist_result_from_env(
        normalized,
        state=str(normalized["result"]),
        exit_code=exit_code,
        result_source=str(source) if isinstance(source, str) else None,
    )
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
