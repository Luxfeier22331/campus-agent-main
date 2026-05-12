from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from .workstream_runtime_shared import _write_json_atomic

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


def write_result_artifact(
    path: Path | str,
    payload: dict[str, object],
    *,
    tracked_changes: bool,
) -> tuple[dict[str, object], list[str]]:
    normalized, notes = normalize_result_payload(payload)
    errors = validate_result_payload(normalized, tracked_changes=tracked_changes)
    if errors:
        raise ValueError("；".join(errors))
    _write_json_atomic(Path(path), normalized)
    return normalized, notes


def load_result_artifact(path: Path | str | None) -> dict[str, object]:
    if path is None:
        return {"present": False, "payload": None, "error": None}

    target = Path(path)
    if not target.exists():
        return {"present": False, "payload": None, "error": None}

    try:
        raw_payload = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {
            "present": True,
            "payload": None,
            "error": f"Result artifact is not valid JSON: {exc.msg}",
        }

    if not isinstance(raw_payload, dict):
        return {
            "present": True,
            "payload": None,
            "error": "Result artifact must be a JSON object.",
        }

    return {"present": True, "payload": dict(raw_payload), "error": None}


def resolve_terminal_result(
    *,
    result_artifact_path: Path | str | None,
) -> dict[str, object]:
    result_artifact = load_result_artifact(result_artifact_path)

    if bool(result_artifact["present"]):
        payload = result_artifact["payload"]
        if not isinstance(payload, dict):
            return {
                "payload": None,
                "source": "result_file",
                "normalization_notes": [],
                "hard_error": result_artifact["error"],
            }

        normalized, notes = normalize_result_payload(payload)
        return {
            "payload": normalized,
            "source": "result_file",
            "normalization_notes": notes,
            "hard_error": None,
        }

    return {
        "payload": None,
        "source": None,
        "normalization_notes": [],
        "hard_error": None,
    }


def normalize_result_payload(payload: dict[str, object]) -> tuple[dict[str, object], list[str]]:
    notes: list[str] = []
    normalized = {
        "schema_version": payload.get("schema_version"),
        "result": payload.get("result"),
        "summary": payload.get("summary"),
        "verification": _normalize_verification(payload.get("verification")),
        "blocker": _normalize_blocker(payload.get("blocker")),
        "next_action": payload.get("next_action"),
    }
    return normalized, notes


def _normalize_verification(value: object) -> object:
    if not isinstance(value, dict):
        return value
    return dict(value)


def _normalize_blocker(value: object) -> object:
    if value is None or not isinstance(value, dict):
        return value
    return {
        "kind": value.get("kind"),
        "message": value.get("message"),
    }


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
