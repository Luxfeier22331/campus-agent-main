from __future__ import annotations

import json
import shutil
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

from campus_ingestion_worker.official_web_handoff_consumer_models import (
    OfficialWebHandoffConsumeError,
    OfficialWebSourceObjectStore,
)


def build_execution_paths(*, execution_root_dir: Path, event_id: str) -> dict[str, Path]:
    safe_event_id = safe_event_id_for_path(event_id)
    work_dir = execution_root_dir / safe_event_id
    return {
        "work_dir": work_dir,
        "replay_input_dir": work_dir / "replay-input",
        "projection_output_dir": work_dir / "projection-output",
        "execution_report_path": work_dir / "execution-report.json",
    }


def reset_execution_dirs(*, replay_input_dir: Path, projection_output_dir: Path) -> None:
    if replay_input_dir.exists():
        shutil.rmtree(replay_input_dir)
    if projection_output_dir.exists():
        shutil.rmtree(projection_output_dir)
    replay_input_dir.mkdir(parents=True, exist_ok=True)
    projection_output_dir.mkdir(parents=True, exist_ok=True)


def download_json_object(
    *,
    object_store: OfficialWebSourceObjectStore,
    bucket: str,
    key: str,
    missing_code: str,
    invalid_code: str,
) -> dict[str, object]:
    payload_bytes = download_bytes(
        object_store=object_store,
        bucket=bucket,
        key=key,
        missing_code=missing_code,
    )
    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OfficialWebHandoffConsumeError(
            code=invalid_code,
            message=f"invalid JSON payload for {key}: {exc}",
        ) from exc
    if not isinstance(payload, dict):
        raise OfficialWebHandoffConsumeError(
            code=invalid_code,
            message=f"JSON payload for {key} must be an object.",
        )
    return payload


def download_bytes(
    *,
    object_store: OfficialWebSourceObjectStore,
    bucket: str,
    key: str,
    missing_code: str,
) -> bytes:
    try:
        return object_store.get_bytes(bucket=bucket, key=key)
    except Exception as exc:
        raise OfficialWebHandoffConsumeError(
            code=missing_code,
            message=f"required object not found: {bucket}/{key}",
        ) from exc


def read_json(path: Path) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON file: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"JSON file must be an object: {path}")
    return payload


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def require_object(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object.")
    return value


def require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string.")
    return value.strip()


def optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def parse_attempt_count(value: object) -> int:
    if value is None:
        return 0
    if not isinstance(value, int) or value < 0:
        raise ValueError("processingAttemptCount must be a non-negative integer.")
    return value


def parse_processing_status(value: object) -> str:
    if value is None:
        return "pending"
    if not isinstance(value, str):
        raise ValueError("processingStatus must be a string.")
    normalized = value.strip()
    if normalized not in {"pending", "running", "staged", "promoted", "succeeded", "failed"}:
        raise ValueError(f"unsupported processingStatus: {normalized!r}")
    return normalized


def should_skip_existing_record(
    *,
    existing_status: str,
    promote_import: bool,
    force: bool,
) -> bool:
    if force:
        return False
    if existing_status in {"promoted", "succeeded"}:
        return True
    return existing_status == "staged" and not promote_import


def as_error_dict(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    code = optional_text(value.get("code"))
    message = optional_text(value.get("message"))
    occurred_at = optional_text(value.get("occurredAt"))
    if code is None or message is None:
        return None
    result: dict[str, object] = {"code": code, "message": message}
    if occurred_at is not None:
        result["occurredAt"] = occurred_at
    return result


def normalize_error(error: Exception) -> dict[str, object]:
    if isinstance(error, OfficialWebHandoffConsumeError):
        code = error.code
        message = str(error)
    else:
        code = "handoff_execution_failed"
        message = str(error) or error.__class__.__name__
    return {
        "code": code,
        "message": message,
        "occurredAt": utcnow(),
    }


def safe_event_id_for_path(event_id: str) -> str:
    sanitized = "".join(
        character for character in event_id if character.isalnum() or character in {"-", "_"}
    )
    if not sanitized:
        raise ValueError("eventId must contain at least one safe filename character.")
    return sanitized


def utcnow() -> str:
    return datetime.now(UTC).isoformat()


def load_manifest_hosts(replay_input_dir: Path) -> set[str]:
    hosts: set[str] = set()
    for path in replay_input_dir.glob("source-assets/*/*/source-truth/page-manifest.json"):
        payload = read_json(path)
        host = optional_text(payload.get("host"))
        if host is not None:
            hosts.add(host)
    return hosts


def count_by_value(values: Iterable[object]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        normalized = str(value or "").strip() or "unknown"
        counts[normalized] = counts.get(normalized, 0) + 1
    return counts


def normalize_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [normalized for item in value if (normalized := optional_text(item)) is not None]


def require_object_list(value: object, field_name: str) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be an array.")
    result: list[dict[str, object]] = []
    for item in value:
        result.append(require_object(item, f"{field_name}[]"))
    return result


def coerce_non_negative_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return max(value, 0)
    if isinstance(value, float):
        return max(int(value), 0)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return 0
