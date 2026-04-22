from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

RESULT_SCHEMA_VERSION = "workstream_harness_result_v1"
VALID_RESULTS = {"completed", "blocked", "failed_needs_repair"}
VALID_VERIFICATION_STATUSES = {"passed", "failed", "skipped", "not_applicable"}
VALID_BLOCKER_KINDS = {
    "external_input",
    "decision_required",
    "risk_gate",
    "environment_missing",
    "policy_denied",
}

_FENCED_JSON_PATTERN = re.compile(
    r"```json\s*(?P<body>\{.*?\})\s*```",
    re.DOTALL | re.IGNORECASE,
)


def extract_result_payload(message: str | None) -> dict[str, object] | None:
    if not message:
        return None

    for match in reversed(list(_FENCED_JSON_PATTERN.finditer(message))):
        candidate = _load_candidate(match.group("body"))
        if candidate is not None:
            return candidate

    decoder = json.JSONDecoder()
    for index, char in enumerate(message):
        if char != "{":
            continue
        try:
            candidate, _ = decoder.raw_decode(message[index:])
        except json.JSONDecodeError:
            continue
        parsed = _load_candidate(candidate)
        if parsed is not None:
            return parsed
    return None


def _load_candidate(candidate: object) -> dict[str, object] | None:
    payload = candidate
    if isinstance(candidate, str):
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            return None
    if not isinstance(payload, dict):
        return None
    if payload.get("schema_version") != RESULT_SCHEMA_VERSION:
        return None
    return dict(payload)


def has_tracked_changes(repo_root: Path | str) -> bool:
    repo = Path(repo_root)
    result = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=no"],
        cwd=str(repo),
        capture_output=True,
        check=False,
        text=True,
    )
    if result.returncode != 0:
        return False
    return bool(result.stdout.strip())


def validate_result_payload(
    payload: dict[str, object],
    *,
    tracked_changes: bool,
) -> list[str]:
    errors: list[str] = []
    result = payload.get("result")
    summary = payload.get("summary")
    next_action = payload.get("next_action")
    verification = payload.get("verification")
    blocker = payload.get("blocker")

    if payload.get("schema_version") != RESULT_SCHEMA_VERSION:
        errors.append("schema_version 必须是 workstream_harness_result_v1")

    if result not in VALID_RESULTS:
        errors.append("result 必须是 completed / blocked / failed_needs_repair")

    if not isinstance(summary, str) or not summary.strip():
        errors.append("summary 必须是非空字符串")

    if not isinstance(next_action, str) or not next_action.strip():
        errors.append("next_action 必须是非空字符串")

    if not isinstance(verification, dict):
        errors.append("verification 必须存在且为对象")
        verification = {}

    verification_status = verification.get("status")
    if verification_status not in VALID_VERIFICATION_STATUSES:
        errors.append("verification.status 不合法")

    commands = verification.get("commands", [])
    if commands is None:
        commands = []
    if not isinstance(commands, list) or any(not isinstance(item, str) for item in commands):
        errors.append("verification.commands 必须是字符串数组")

    notes = verification.get("notes")
    if notes is not None and not isinstance(notes, str):
        errors.append("verification.notes 必须是字符串或 null")

    if blocker is not None:
        if not isinstance(blocker, dict):
            errors.append("blocker 必须是对象或 null")
            blocker = {}
        blocker_kind = blocker.get("kind")
        if blocker_kind not in VALID_BLOCKER_KINDS:
            errors.append("blocker.kind 不合法")
        blocker_message = blocker.get("message")
        if not isinstance(blocker_message, str) or not blocker_message.strip():
            errors.append("blocker.message 必须是非空字符串")
    else:
        blocker = None

    if result == "completed":
        if blocker is not None:
            errors.append("completed 结果不能携带 blocker")
        if verification_status not in {"passed", "not_applicable"}:
            errors.append("completed 结果必须给出 passed 或 not_applicable 的 verification.status")
        if tracked_changes and verification_status == "failed":
            errors.append("有 tracked 改动时不能以 failed verification 完成")
        if tracked_changes and verification_status == "skipped":
            errors.append("有 tracked 改动时不能以 skipped verification 完成")

    if result == "blocked":
        if blocker is None:
            errors.append("blocked 结果必须提供 blocker")
        if verification_status not in {"skipped", "not_applicable", "passed"}:
            errors.append("blocked 结果的 verification.status 必须是 passed/skipped/not_applicable")

    if result == "failed_needs_repair":
        if blocker is not None:
            errors.append("failed_needs_repair 结果不能携带 blocker；需要 blocker 时应改为 blocked")
        if verification_status not in {"failed", "skipped", "not_applicable"}:
            errors.append(
                "failed_needs_repair 结果的 verification.status 必须是 failed/skipped/not_applicable"
            )

    return errors
