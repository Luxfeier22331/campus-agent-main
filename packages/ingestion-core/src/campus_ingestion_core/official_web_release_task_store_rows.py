from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from campus_ingestion_core.official_web_release_task import OfficialWebReleaseTask
from campus_ingestion_core.registry import _coerce_json_payload


def _insert_params(task: OfficialWebReleaseTask) -> tuple[object, ...]:
    return (
        task.task_id,
        task.task_type,
        task.status,
        task.inventory_id,
        task.job_id,
        task.run_id,
        task.selected_write_target,
        task.publish_alias,
        _json_dump(dict(task.input_ref)),
        _json_dump(dict(task.output_ref or {})),
        task.attempt_count,
        task.max_attempts,
        task.lease_owner or None,
        task.lease_expires_at,
        task.last_error_code or None,
        task.last_error_message or None,
        task.created_at,
        task.updated_at,
    )


def _task_from_row(row: Sequence[Any]) -> OfficialWebReleaseTask:
    return OfficialWebReleaseTask(
        task_id=str(row[0]),
        task_type=str(row[1]),
        status=str(row[2]),
        inventory_id=str(row[3]),
        job_id=str(row[4]),
        run_id=str(row[5]),
        selected_write_target=str(row[6] or ""),
        publish_alias=bool(row[7]),
        input_ref=_coerce_json_payload(row[8]),
        output_ref=_coerce_json_payload(row[9]) if row[9] is not None else None,
        attempt_count=int(row[10]),
        max_attempts=int(row[11]),
        lease_owner=str(row[12] or ""),
        lease_expires_at=row[13],
        last_error_code=str(row[14] or ""),
        last_error_message=str(row[15] or ""),
        created_at=row[16],
        updated_at=row[17],
    )


def _json_dump(value: dict[str, Any]) -> str:

    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _positive_int(value: object, label: str) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be positive") from exc
    if parsed <= 0:
        raise ValueError(f"{label} must be positive")
    return parsed
